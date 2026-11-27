/**
 * Code Mode persistent VM session lifecycle, per-root-session state slot,
 * per-turn step budget accounting, sandbox global initialization, and
 * conversation/subagent teardown.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import * as vm from 'node:vm'
import { getMainThreadAgentId } from '../../../bootstrap/state.js'
import {
  getBootstrapSession,
  RootSessionSlot,
} from '../../../utils/sessionHost.js'
import type { RemoteNativeToolSession } from '../../../utils/toolCreateRuntime.js'
import {
  REPL_MAIN_THREAD_KEY,
  REPL_SYNC_RUN_MS,
  REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
} from '../constants.js'
import { hasCodeModeBeenUsed, isCodeModeAccepted } from '../optIn.js'
import {
  ReplHostCallValidationError,
  ReplTurnCallBudget,
  resolveReplDosLimits,
} from '../replDosGuards.js'
import { getReplSessions, NO_EVALS } from '../replSessions.js'
import { CodeModeAutoVerdictTracker } from './autoVerdict.js'
import {
  elideReplOutputPart,
  formatArgsBounded,
  formatValueForOutput,
} from './boundedFormatting.js'
import {
  armVmFactoryInvoke,
  buildHostRealmBridge,
  createRealmBridgeInitSource,
  disarmVmFactoryInvoke,
  sealAsyncForRealm,
  sealForRealm,
} from './realmBridge.js'
import { quoteCodeModeShellArg } from './shellTemplate.js'
import {
  CODE_MODE_MAX_STRIDE,
  CODE_MODE_STEP_BUDGET,
  CODE_MODE_STRIDE_CLOCK_MS,
  type CodeModeEvalBinding,
  type CodeModeTurnState,
  CONSOLE_RING_BUFFER_MAX,
  MAX_CODE_MODE_TIMERS_PER_EVAL,
  MAX_LOG_ENTRY_CHARS,
  MAX_PERSISTENT_VM_SESSIONS,
  type PersistentCodeModeVmSession,
  type PollEventQueueCommandLike,
  type RawRealmBridge,
  type RealmBridge,
} from './types.js'

export type CodeModeExecutorSessionState = {
  persistentVmSessionsByKey: Map<string, PersistentCodeModeVmSession>
  codeModeAutoVerdictTracker: CodeModeAutoVerdictTracker
  sessionUnsetVarsByKey: Map<string, Set<string>>
  prevConnectedMcpServers: Set<string>
  codeModeScriptSeq: number
}

const codeModeExecutorSessionSlot =
  new RootSessionSlot<CodeModeExecutorSessionState>(() => ({
    persistentVmSessionsByKey: new Map<string, PersistentCodeModeVmSession>(),
    codeModeAutoVerdictTracker: new CodeModeAutoVerdictTracker(),
    sessionUnsetVarsByKey: new Map<string, Set<string>>(),
    prevConnectedMcpServers: new Set<string>(),
    codeModeScriptSeq: 0,
  }))

export function getExecutorSessionState(
  session?: RemoteNativeToolSession,
): CodeModeExecutorSessionState {
  return codeModeExecutorSessionSlot.of(session ?? getBootstrapSession())
}

export function getCodeModeAutoVerdictTracker(
  session?: RemoteNativeToolSession,
): CodeModeAutoVerdictTracker {
  return getExecutorSessionState(session).codeModeAutoVerdictTracker
}

export function resetCodeModeRuntimeStateForTests(
  session?: RemoteNativeToolSession,
): void {
  const state = getExecutorSessionState(session)
  for (const s of state.persistentVmSessionsByKey.values()) {
    s.clearAllTimers()
  }
  state.persistentVmSessionsByKey.clear()
  state.sessionUnsetVarsByKey.clear()
  state.prevConnectedMcpServers.clear()
  state.codeModeAutoVerdictTracker.reset()
  state.codeModeScriptSeq = 0
}

const MAX_EVAL_LOGS_TOTAL_CHARS = 512 * 1024
const EVAL_LOGS_TRUNCATION_MARKER =
  '... [console output truncated: log limit reached]'

const evalLogAccountingByBinding = new WeakMap<
  CodeModeEvalBinding,
  { totalChars: number; truncated: boolean }
>()

const evalRemainingMsGetterByBinding = new WeakMap<
  CodeModeEvalBinding,
  () => number
>()

const invokeFactoryScriptBySession = new WeakMap<
  PersistentCodeModeVmSession,
  vm.Script
>()

export function registerEvalRemainingMsGetter(
  binding: CodeModeEvalBinding,
  getRemainingMs: () => number,
): void {
  evalRemainingMsGetterByBinding.set(binding, getRemainingMs)
}

/**
 * Security (P0-4): Invoke a compiled VM script factory function inside the VM
 * realm via its private lexical invocation slot under `vm.Script` `{ timeout }`
 * with ZERO properties or host accessors ever placed on `sandbox`/`globalThis`.
 */
export function runVmFactoryWithTimeout(
  session: PersistentCodeModeVmSession,
  factory: unknown,
  timeoutMs: number,
): unknown {
  const invokeScript = invokeFactoryScriptBySession.get(session)
  if (invokeScript === undefined) {
    throw new Error('Code Mode VM session missing factory invocation script')
  }
  armVmFactoryInvoke(
    session.bridge,
    factory,
    session.checkBudgetFn,
    session.rawLiteralMarkerFn,
  )
  try {
    return invokeScript.runInContext(session.context, { timeout: timeoutMs })
  } finally {
    disarmVmFactoryInvoke(session.bridge)
  }
}

export function makeTurnState(): CodeModeTurnState {
  return {
    bound: 0,
    deadline: 0,
    lastClock: 0,
    stride: 1,
    left: 0,
    rest: 0,
    budget: CODE_MODE_STEP_BUDGET,
    stopped: false,
    budgetStopped: false,
    clockStops: 0,
    budgetStops: 0,
  }
}

/**
 * Official 2.1.328 (`Go`/`Uc`/`Mr`): start a new turn — the script's own run
 * time, excluding time spent inside tool calls. `boundMs` is the actual wall
 * clock deadline; optional `reportedBoundMs` preserves the script's canonical
 * timeout message when `boundMs` is clamped to the remaining eval budget.
 */
export function startCodeModeTurn(
  turnState: CodeModeTurnState,
  boundMs: number,
  reportedBoundMs: number = boundMs,
): void {
  const s = turnState
  const now = Date.now()
  s.bound = reportedBoundMs
  s.deadline = now + boundMs
  s.lastClock = now
  s.stride = 1
  s.rest = s.budget
  s.stopped = false
  s.budgetStopped = false
  s.left = 0
}

/**
 * Official 2.1.328 (the counter returned by `Uc`'s injected shim): charge one
 * step. Throws a RangeError when the turn's wall clock or step budget runs out.
 * Tool-call wait time is excluded because the turn is only re-armed on resume.
 */
export function chargeCodeModeStep(turnState: CodeModeTurnState): void {
  const s = turnState
  if (s.bound === 0) return
  s.left--
  if (s.left > 0) return
  if (s.rest <= 0) {
    s.left = 0
    if (!s.budgetStopped) {
      s.budgetStopped = true
      s.budgetStops++
    }
    throw new RangeError(
      `REPL: a turn ran ${s.budget} steps, its budget (a step is one pass through a loop or one call of a function), and was stopped. A turn is the code that runs from the script's start, a tool call's result or a timer's firing until the next tool call's result or timer. End the loop, or await a tool call or a timer in it.`,
    )
  }
  const now = Date.now()
  if (now > s.deadline) {
    s.left = 0
    if (!s.stopped) {
      s.stopped = true
      s.clockStops++
    }
    // Surface the same wall-clock timeout the deadline timer reports — the
    // script overran its bound; keep the canonical "timed out after Xms" text
    // so callers see one consistent stop reason.
    throw new RangeError(`Code Mode script timed out after ${s.bound}ms`)
  }
  const stride =
    now - s.lastClock >= CODE_MODE_STRIDE_CLOCK_MS
      ? 1
      : s.stride < CODE_MODE_MAX_STRIDE
        ? s.stride * 2
        : CODE_MODE_MAX_STRIDE
  s.lastClock = now
  s.stride = stride
  const take = stride < s.rest ? stride : s.rest
  s.rest -= take
  s.left = take - 1
}

function makeOutsideEvalBinding(): CodeModeEvalBinding {
  const unavailable = async (toolName: string): Promise<never> => {
    throw new Error(`${toolName} is not available outside a REPL eval`)
  }
  return {
    outside: true,
    ended: true,
    noMoreCalls: true,
    shellKind: 'bash',
    logs: [],
    turnState: makeTurnState(),
    clampedTimeout: REPL_SYNC_RUN_MS,
    timers: new Set(),
    allowedTools: undefined,
    exposedTools: [],
    toolDescriptors: [],
    evalsAccess: NO_EVALS,
    dosLimits: resolveReplDosLimits(),
    turnCallBudget: new ReplTurnCallBudget(),
    isStopped: () => true,
    getStopMessage: () => 'Code Mode script aborted',
    guardedCall: toolName => unavailable(String(toolName)),
    dispatchDollar: () => async () => unavailable('Bash'),
  }
}

export function getCurrentEvalBinding(
  session: PersistentCodeModeVmSession,
): CodeModeEvalBinding {
  return session.currentCall.getStore() ?? session.outsideBinding
}

export function clearTimersForEvalBinding(
  session: PersistentCodeModeVmSession,
  binding: CodeModeEvalBinding,
): void {
  for (const id of binding.timers) {
    const entry = session.timers.armed.get(id)
    if (entry !== undefined) {
      entry.clear()
      session.timers.armed.delete(id)
    }
  }
  binding.timers.clear()
}

export function ensureToolGlobalBound(
  session: PersistentCodeModeVmSession,
  globalName: string,
  canonicalToolName: string,
): void {
  if (session.boundToolNames.has(globalName)) return
  session.boundToolNames.add(globalName)
  session.sandbox[globalName] = sealAsyncForRealm(
    session,
    (input: unknown = {}) =>
      getCurrentEvalBinding(session).guardedCall(canonicalToolName, input),
  )
}

export function createCodeModeVmSession(): PersistentCodeModeVmSession {
  // Official `Go`/`$c`/`Tl`: the realm starts from a null-prototype sandbox and
  // exposes ONLY realm-sealed bridge objects/functions — no host intrinsics.
  // All per-eval globals are bound ONCE here and dispatch through
  // `AsyncLocalStorage` (`session.currentCall.getStore() ?? outsideBinding`)
  // so concurrent/detached evals sharing one VM never clobber each other.
  const sandbox: Record<string, unknown> = { __proto__: null } as Record<
    string,
    unknown
  >
  const rawLiteralValues = new WeakMap<object, string>()
  const currentCall = new AsyncLocalStorage<CodeModeEvalBinding>()
  const outsideBinding = makeOutsideEvalBinding()
  const timers: PersistentCodeModeVmSession['timers'] = {
    nextId: 1,
    armed: new Map(),
  }
  const clearAllTimers = (): void => {
    for (const entry of timers.armed.values()) {
      entry.clear()
      entry.owner.timers.clear()
    }
    timers.armed.clear()
  }

  const session: PersistentCodeModeVmSession = {
    sandbox,
    context: undefined as unknown as vm.Context,
    bridge: undefined as unknown as RealmBridge,
    currentCall,
    outsideBinding,
    timers,
    boundToolNames: new Set(),
    clearAllTimers,
    rawLiteralValues,
    checkBudgetFn: undefined,
    rawLiteralMarkerFn: undefined,
    consoleBuffer: [],
    consoleDropped: 0,
  }
  const getBinding = (): CodeModeEvalBinding => getCurrentEvalBinding(session)

  // Official `kee({...},{codeGeneration:{strings:false}}): eval() and
  // `new Function()` are disabled inside the realm — script code can only run
  // through the instrumented transform, so it cannot bypass the step budget.
  session.context = vm.createContext(sandbox, {
    codeGeneration: { strings: false, wasm: false },
  })
  // Initialize realm-side bridge capturing realm intrinsics and locking down
  // WebAssembly before any user code runs. Uses a randomized per-session
  // lexical invocation slot (never exposed on `sandbox`/`globalThis`).
  const invokeSlotName = `__cm_run_${randomBytes(12).toString('hex')}`
  const rawBridge = new vm.Script(createRealmBridgeInitSource(invokeSlotName), {
    filename: 'code-mode-realm-init.js',
  }).runInContext(session.context) as RawRealmBridge
  session.bridge = buildHostRealmBridge(rawBridge)
  invokeFactoryScriptBySession.set(
    session,
    new vm.Script(`${invokeSlotName}()`, {
      filename: 'code-mode-factory-invoke.js',
    }),
  )

  // Security (E3-P1-1 / E3-P2-6 / P1-C1): keep both the step-budget checker and
  // the raw-literal marker off `sandbox`/`self`, inject them via per-eval
  // factory parameters, and fail-closed whenever invoked outside an active eval.
  session.checkBudgetFn = session.bridge.wrapSyncHostFn(() => {
    const active = getBinding()
    if (active.outside || active.ended) {
      throw new Error(active.getStopMessage())
    }
    chargeCodeModeStep(active.turnState)
    if (active.isStopped()) {
      throw new Error(active.getStopMessage())
    }
  })

  session.rawLiteralMarkerFn = session.bridge.wrapIdentityHostFn(
    (val: unknown) => {
      if (
        val !== null &&
        typeof val === 'object' &&
        Object.keys(val).length === 1 &&
        Object.hasOwn(val, 'raw') &&
        typeof (val as { raw?: unknown }).raw === 'string'
      ) {
        rawLiteralValues.set(val, (val as { raw: string }).raw)
      }
      return val
    },
  )

  const assertTextWithinLimit = (text: string): string => {
    if (text.length > getBinding().dosLimits.mostTextChars) {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    return text
  }

  // Official `Tl`: expose `atob` / `btoa` as realm-sealed sync functions.
  sandbox.atob = session.bridge.wrapSyncHostFn((input: unknown) =>
    Buffer.from(assertTextWithinLimit(String(input)), 'base64').toString(
      'binary',
    ),
  )
  sandbox.btoa = session.bridge.wrapSyncHostFn((input: unknown) =>
    Buffer.from(assertTextWithinLimit(String(input)), 'binary').toString(
      'base64',
    ),
  )

  // Official `Tl`: timers bound ONCE, tracking ownership per eval binding and
  // re-entering `currentCall.run(owner, ...)` when the timer fires.
  const armTimer = (
    cb: unknown,
    delayMs: unknown,
    args: unknown[],
    repeat: boolean,
  ): number => {
    if (typeof cb !== 'function') {
      throw new TypeError(
        `${repeat ? 'setInterval' : 'setTimeout'} callback must be a function`,
      )
    }
    const owner = getBinding()
    if (owner.ended) return 0
    if (owner.timers.size >= MAX_CODE_MODE_TIMERS_PER_EVAL) {
      throw new RangeError(
        `Code Mode timer limit exceeded (max ${MAX_CODE_MODE_TIMERS_PER_EVAL} active timers per eval)`,
      )
    }
    const id = timers.nextId++
    const ms = repeat
      ? Math.max(10, Number(delayMs) || 10)
      : Math.max(0, Number(delayMs) || 0)
    const fire = (): void => {
      if (!repeat) {
        owner.timers.delete(id)
        timers.armed.delete(id)
      }
      if (owner.ended || owner.isStopped()) {
        if (repeat) {
          const entry = timers.armed.get(id)
          entry?.clear()
          owner.timers.delete(id)
          timers.armed.delete(id)
        }
        return
      }
      currentCall.run(owner, () => {
        const getRemaining = evalRemainingMsGetterByBinding.get(owner)
        const remainingTurnMs = Math.min(
          owner.clampedTimeout,
          Math.max(1, getRemaining ? getRemaining() : owner.clampedTimeout),
        )
        startCodeModeTurn(
          owner.turnState,
          remainingTurnMs,
          owner.clampedTimeout,
        )
        // Security (E3-P1-1): never reset `owner.turnCallBudget` on timer fire
        // so repeating/re-armed timers cannot bypass per-turn call/data DoS limits.
        try {
          ;(cb as (...a: unknown[]) => unknown)(...args)
        } catch {
          // Unhandled timer errors must not crash host process
        }
      })
    }
    const handle = repeat ? setInterval(fire, ms) : setTimeout(fire, ms)
    if (typeof handle.unref === 'function') handle.unref()
    const clear = repeat
      ? () => clearInterval(handle)
      : () => clearTimeout(handle)
    owner.timers.add(id)
    timers.armed.set(id, { owner, clear })
    return id
  }
  const clearTimerById = (id: unknown): void => {
    const numId = typeof id === 'number' ? id : Number(id)
    const entry = timers.armed.get(numId)
    if (entry === undefined) return
    entry.clear()
    entry.owner.timers.delete(numId)
    timers.armed.delete(numId)
  }
  sandbox.setTimeout = sealForRealm(
    session,
    (cb: unknown, delayMs?: unknown, ...args: unknown[]) =>
      armTimer(cb, delayMs, args, false),
  )
  sandbox.clearTimeout = sealForRealm(session, clearTimerById)
  sandbox.setInterval = sealForRealm(
    session,
    (cb: unknown, delayMs?: unknown, ...args: unknown[]) =>
      armTimer(cb, delayMs, args, true),
  )
  sandbox.clearInterval = sealForRealm(session, clearTimerById)

  // Official `Tl`/`St(e,"console",...)`: bound ONCE; writes to active eval's
  // `logs` plus session-wide ring buffer with bounded incremental serialization
  // capped at 256 KB per entry BEFORE/DURING serialization (E3-P1-1).
  const pushLog = (...args: unknown[]): void => {
    const active = getBinding()
    const mostTextChars = active.dosLimits.mostTextChars
    const entryCap = Math.min(MAX_LOG_ENTRY_CHARS, mostTextChars)
    const formatted = formatArgsBounded(args, entryCap)
    if (formatted.truncated && mostTextChars < MAX_LOG_ENTRY_CHARS) {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    const suffix = '... [truncated]'
    const line = formatted.truncated
      ? entryCap <= suffix.length
        ? formatted.text.slice(0, entryCap)
        : `${formatted.text.slice(0, entryCap - suffix.length)}${suffix}`
      : formatted.text
    // Security (P2-7): cap per-eval `active.logs` by both entry count AND total
    // cumulative char budget (512 KB), appending a truncation marker once.
    let acc = evalLogAccountingByBinding.get(active)
    if (acc === undefined) {
      acc = { totalChars: 0, truncated: false }
      evalLogAccountingByBinding.set(active, acc)
    }
    if (!acc.truncated) {
      if (
        active.logs.length >= CONSOLE_RING_BUFFER_MAX ||
        acc.totalChars + line.length > MAX_EVAL_LOGS_TOTAL_CHARS
      ) {
        acc.truncated = true
        active.logs.push(EVAL_LOGS_TRUNCATION_MARKER)
      } else {
        active.logs.push(line)
        acc.totalChars += line.length
      }
    }
    session.consoleBuffer.push(line)
    if (session.consoleBuffer.length > CONSOLE_RING_BUFFER_MAX) {
      session.consoleBuffer.shift()
      session.consoleDropped++
    }
  }
  const sealedPushLog = sealForRealm(session, pushLog)
  sandbox.console = session.bridge.createRealmObj([
    ['log', sealedPushLog],
    ['warn', sealedPushLog],
    ['error', sealedPushLog],
    ['info', sealedPushLog],
    ['debug', sealedPushLog],
    [
      'tail',
      sealForRealm(session, (n?: unknown) => {
        const count =
          typeof n === 'number' && Number.isFinite(n) && n >= 0
            ? Math.floor(n)
            : 20
        return session.consoleBuffer.slice(-count)
      }),
    ],
    ['buffer', sealForRealm(session, () => [...session.consoleBuffer])],
    ['dropped', sealForRealm(session, () => session.consoleDropped)],
  ])
  sandbox.log = sealedPushLog

  // Official `Tl`: realm-sealed `self.running()` bound ONCE, dispatching via ALS.
  const sealedRunningHandle = session.bridge.createRealmObj([
    ['list', sealForRealm(session, () => getBinding().evalsAccess.list())],
    [
      'abort',
      sealForRealm(session, (targetId: unknown) =>
        getBinding().evalsAccess.abort(Number(targetId)),
      ),
    ],
  ])
  sandbox.running = session.bridge.wrapIdentityHostFn(() => sealedRunningHandle)
  sandbox.self = sandbox
  sandbox.preview = sealForRealm(
    session,
    (value: unknown, maxChars: unknown = 2000) => {
      const limit =
        typeof maxChars === 'number' &&
        Number.isFinite(maxChars) &&
        maxChars > 0
          ? Math.floor(maxChars)
          : 2000
      return elideReplOutputPart(formatValueForOutput(value), limit)
    },
  )

  sandbox.callTool = sealAsyncForRealm(
    session,
    (toolName: unknown, input: unknown = {}) =>
      getBinding().guardedCall(toolName, input),
  )
  sandbox.$ = session.bridge.createDollarFn(
    (first: unknown, values: unknown[]) =>
      getBinding().dispatchDollar(first, values),
    (s: unknown) => quoteCodeModeShellArg(s, getBinding().shellKind),
  )

  sandbox.searchTools = sealForRealm(
    session,
    (query: unknown, limit: unknown = 10) => {
      const q = assertTextWithinLimit(String(query ?? ''))
        .toLowerCase()
        .trim()
      const max =
        typeof limit === 'number' && Number.isFinite(limit) && limit > 0
          ? Math.floor(limit)
          : 10
      return getBinding()
        .toolDescriptors.filter(
          d =>
            !q ||
            d.name.toLowerCase().includes(q) ||
            d.description.toLowerCase().includes(q),
        )
        .slice(0, max)
        .map(d => ({ name: d.name, description: d.description }))
    },
  )
  sandbox.describeTool = sealForRealm(session, (name: unknown) => {
    const targetName = assertTextWithinLimit(String(name ?? ''))
    const found = getBinding().toolDescriptors.find(d => d.name === targetName)
    return found ? { name: found.name, description: found.description } : null
  })
  sandbox.tools = session.bridge.createRealmObj([
    [
      'list',
      sealForRealm(session, () => {
        const b = getBinding()
        return b.allowedTools ? [...b.allowedTools] : [...b.exposedTools]
      }),
    ],
  ])

  return session
}

export function getOrCreatePersistentVmSession(
  sessionKey: string,
  session?: RemoteNativeToolSession,
): PersistentCodeModeVmSession {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState(session)
  const existing = persistentVmSessionsByKey.get(sessionKey)
  if (existing) {
    // Refresh LRU order
    persistentVmSessionsByKey.delete(sessionKey)
    persistentVmSessionsByKey.set(sessionKey, existing)
    return existing
  }
  if (persistentVmSessionsByKey.size >= MAX_PERSISTENT_VM_SESSIONS) {
    const oldestKey = persistentVmSessionsByKey.keys().next().value
    if (oldestKey !== undefined) {
      persistentVmSessionsByKey.get(oldestKey)?.clearAllTimers()
      persistentVmSessionsByKey.delete(oldestKey)
      sessionUnsetVarsByKey.delete(oldestKey)
    }
  }
  const created = createCodeModeVmSession()
  persistentVmSessionsByKey.set(sessionKey, created)
  getReplSessions().set(sessionKey, created)
  return created
}

/**
 * Clear persistent Code Mode VM context(s) and unset-var tracking (on session
 * reset, clear, or eviction).
 */
export function clearCodeModeVmSession(
  sessionKey?: string,
  session?: RemoteNativeToolSession,
): void {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState(session)
  if (sessionKey !== undefined) {
    persistentVmSessionsByKey.get(sessionKey)?.clearAllTimers()
    persistentVmSessionsByKey.delete(sessionKey)
    sessionUnsetVarsByKey.delete(sessionKey)
    const sessions = getReplSessions()
    sessions.clear([sessionKey])
    sessions.release(sessionKey)
  } else {
    for (const s of persistentVmSessionsByKey.values()) {
      s.clearAllTimers()
    }
    persistentVmSessionsByKey.clear()
    sessionUnsetVarsByKey.clear()
    getReplSessions().clear()
  }
}

function settleDroppedPollEvents(
  removed: readonly PollEventQueueCommandLike[],
  reason: string,
): void {
  for (const cmd of removed) {
    cmd.pollEvent?.settleDropped?.(
      new Error(`poll event discarded undelivered: ${reason}`),
    )
  }
}

function extractEvalIdFromPollEnvelope(
  envelope: string | undefined,
): number | undefined {
  if (!envelope) return undefined
  const m = /\beval="(\d+)"/.exec(envelope)
  if (!m) return undefined
  const id = Number(m[1])
  return Number.isFinite(id) ? id : undefined
}

function isMainThreadPollCommand(cmd: PollEventQueueCommandLike): boolean {
  if (cmd.agentId === undefined) return true
  try {
    return cmd.agentId === getMainThreadAgentId()
  } catch {
    return false
  }
}

/**
 * Official `endMainThreadConversation` (`chunk@313694282.js @8309`):
 * Clears ONLY the main-thread (`REPL_MAIN_THREAD_KEY`) Code Mode VM session
 * and `ReplSessions` entry (preserving surviving background subagents' VMs!),
 * removes main-thread Code Mode `poll-event` items from the message queue,
 * and resets `codeModeAutoVerdictTracker`.
 */
export function endMainThreadConversation(
  reason = 'the conversation was cleared',
  keepToolUseIds: readonly string[] = [],
  queueOverride?: {
    removeByFilter: (
      predicate: (cmd: PollEventQueueCommandLike) => boolean,
    ) => PollEventQueueCommandLike[]
  },
): void {
  const {
    persistentVmSessionsByKey,
    sessionUnsetVarsByKey,
    codeModeAutoVerdictTracker,
  } = getExecutorSessionState()
  const sessions = getReplSessions()
  const hasMainState =
    isCodeModeAccepted() ||
    hasCodeModeBeenUsed() ||
    persistentVmSessionsByKey.has(REPL_MAIN_THREAD_KEY) ||
    sessions.has(REPL_MAIN_THREAD_KEY) ||
    sessions.depth(REPL_MAIN_THREAD_KEY) > 0 ||
    sessions.outstanding(REPL_MAIN_THREAD_KEY) > 0
  if (!hasMainState) {
    codeModeAutoVerdictTracker.reset()
    return
  }

  const keptIds = sessions.evalIdsOf(REPL_MAIN_THREAD_KEY, keepToolUseIds)
  const keptPred =
    keptIds.size === 0 ? undefined : (id: number) => keptIds.has(id)
  sessions.clear([REPL_MAIN_THREAD_KEY], keptPred)
  sessions.release(REPL_MAIN_THREAD_KEY)
  persistentVmSessionsByKey.get(REPL_MAIN_THREAD_KEY)?.clearAllTimers()
  persistentVmSessionsByKey.delete(REPL_MAIN_THREAD_KEY)
  sessionUnsetVarsByKey.delete(REPL_MAIN_THREAD_KEY)

  const shouldRemove = (cmd: PollEventQueueCommandLike): boolean => {
    if (cmd.mode !== 'poll-event') return false
    const kind = cmd.pollEvent?.kind
    if (kind !== 'repl-eval' && kind !== 'repl-status') return false
    if (!isMainThreadPollCommand(cmd)) return false
    if (keptPred !== undefined) {
      const evalId = extractEvalIdFromPollEnvelope(cmd.pollEvent?.envelope)
      if (evalId !== undefined && keptPred(evalId)) return false
    }
    return true
  }

  try {
    if (queueOverride) {
      settleDroppedPollEvents(
        queueOverride.removeByFilter(shouldRemove),
        reason,
      )
    } else {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mqm =
        require('../../../utils/messageQueueManager.js') as typeof import('../../../utils/messageQueueManager.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const removed = mqm.removeByFilter(cmd =>
        shouldRemove(cmd as unknown as PollEventQueueCommandLike),
      )
      settleDroppedPollEvents(
        removed as unknown as PollEventQueueCommandLike[],
        reason,
      )
    }
  } catch {
    // Best-effort outside full message queue lifecycle
  }

  codeModeAutoVerdictTracker.reset()
}

/**
 * Official `endSubagentRepl` (`chunk@313694282.js @8551`):
 * Clears, releases, and forgets ONLY `agentId`'s Code Mode VM session and
 * `ReplSessions` entry, and drops that subagent's queued `poll-event` items
 * without disturbing the main thread or sibling subagents.
 */
export function endSubagentRepl(
  agentId: string,
  queueOverride?: {
    removeByFilter: (
      predicate: (cmd: PollEventQueueCommandLike) => boolean,
    ) => PollEventQueueCommandLike[]
  },
): void {
  const { persistentVmSessionsByKey, sessionUnsetVarsByKey } =
    getExecutorSessionState()
  const sessions = getReplSessions()
  const hasAgentState =
    isCodeModeAccepted() ||
    hasCodeModeBeenUsed() ||
    persistentVmSessionsByKey.has(agentId) ||
    sessions.has(agentId) ||
    sessions.depth(agentId) > 0 ||
    sessions.outstanding(agentId) > 0
  if (!hasAgentState) return

  sessions.clear([agentId])
  sessions.release(agentId)
  sessions.forget(agentId)
  persistentVmSessionsByKey.get(agentId)?.clearAllTimers()
  persistentVmSessionsByKey.delete(agentId)
  sessionUnsetVarsByKey.delete(agentId)

  const shouldRemove = (cmd: PollEventQueueCommandLike): boolean =>
    cmd.mode === 'poll-event' && cmd.agentId === agentId
  const reason = 'the subagent that ran the script ended its run'

  try {
    if (queueOverride) {
      settleDroppedPollEvents(
        queueOverride.removeByFilter(shouldRemove),
        reason,
      )
    } else {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const mqm =
        require('../../../utils/messageQueueManager.js') as typeof import('../../../utils/messageQueueManager.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const removed = mqm.removeByFilter(cmd =>
        shouldRemove(cmd as unknown as PollEventQueueCommandLike),
      )
      settleDroppedPollEvents(
        removed as unknown as PollEventQueueCommandLike[],
        reason,
      )
    }
  } catch {
    // Best-effort outside full message queue lifecycle
  }
}
