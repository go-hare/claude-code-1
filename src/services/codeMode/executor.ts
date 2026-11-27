/**
 * Code Mode (2.1.323 #1964) JavaScript VM runtime & session resume planner.
 *
 * Allows Claude to write JavaScript that calls its available tools
 * (Read, Write, Edit, Glob, Grep, Bash, NotebookEdit, Agent, MCP tools, etc.)
 * through the session's permission pipeline (`canUseTool`) inside a sandboxed
 * Node `vm` context.
 *
 * Core VM eval orchestration lives here; cohesive subsystems live under
 * `src/services/codeMode/executor/` and are re-exported below for 100%
 * backwards compatibility.
 */
import { randomBytes } from 'node:crypto'
import { types as utilTypes } from 'node:util'
import * as vm from 'node:vm'
import type { Tool } from '../../Tool.js'
import {
  REPL_MAIN_THREAD_KEY,
  REPL_MAX_TIMEOUT_MS,
  REPL_SCRIPT_FILENAME,
  REPL_SYNC_RUN_MS,
  REPL_TOOL_CALL_CAP,
  REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
} from './constants.js'
import {
  createPausableCodeModeTimer,
  shouldPauseCodeModeTimerForTool,
} from './executor/autoVerdict.js'
import {
  elideReplOutputPart,
  formatValueForOutput,
} from './executor/boundedFormatting.js'
import {
  extractTopLevelDeclaredVars,
  injectUnsetVarGuards,
} from './executor/jsSourceAnalysis.js'
import {
  transformCodeModeScript,
  unwrapReplTransformValue,
  wrapScriptWithClosureParams,
} from './executor/loopInstrumentation.js'
import {
  type SettledVmOutcome,
  settleVmResult,
} from './executor/realmBridge.js'
import { wrapReplToolForCodeModeWithExecutor } from './executor/replToolWrapper.js'
import {
  buildCodeModeShellEnvPrefix,
  quoteCodeModeShellArg,
  renderCodeModeShellTemplate,
} from './executor/shellTemplate.js'
import {
  findClosestEditMatchHint,
  isNoOpCodeModeEdit,
} from './executor/toolHelpers.js'
import {
  type CodeModeEvalBinding,
  type CodeModeExecutionResult,
  type CodeModeShellRunner,
  type ExecuteCodeModeScriptOptions,
  type PausableCodeModeTimer,
  PRIMITIVE_SHORTHAND_MAP,
  VALID_IDENTIFIER_RE,
} from './executor/types.js'
import {
  clearTimersForEvalBinding,
  createCodeModeVmSession,
  ensureToolGlobalBound,
  getOrCreatePersistentVmSession,
  makeTurnState,
  registerEvalRemainingMsGetter,
  runVmFactoryWithTimeout,
  startCodeModeTurn,
} from './executor/vmSession.js'
import { noteReplContextCreated } from './optIn.js'
import {
  createReplCodec,
  decodeReplWireValue,
  formatThrownErrorHeader,
  mapReplPlainErrorLine,
  ReplHostCallValidationError,
  ReplTurnCallBudget,
  resolveReplDosLimits,
  summarizeReplErrorLine,
} from './replDosGuards.js'
import { getReplSessions } from './replSessions.js'

// Backwards-compatible barrel re-exports (100% of historical public API)
export {
  buildCodeModeInterruptedScriptNotice,
  CODE_MODE_HOOK_REWRITE_REASON,
  CODE_MODE_HOOK_REWRITE_REFUSAL,
  CODE_MODE_UNICODE_ESCAPE_REASON,
  CODE_MODE_UNICODE_ESCAPE_REFUSAL,
  CodeModeAutoVerdictTracker,
  classifyAutoModeScriptDecision,
  createPausableCodeModeTimer,
  formatAutoModeScriptBlockedMessage,
  getCodeModePostScriptPauseMs,
  hasUnicodeHexEscape,
  mergeCodeModeReplySideEffects,
  shouldPauseCodeModeTimerForTool,
  shouldRunCodeModeScriptInBackground,
} from './executor/autoVerdict.js'
export { elideReplOutputPart } from './executor/boundedFormatting.js'
export {
  extractAssignedVars,
  extractTopLevelDeclaredVars,
  injectUnsetVarGuards,
} from './executor/jsSourceAnalysis.js'
export {
  instrumentCodeModeLoops,
  markCodeModeRawLiterals,
  transformCodeModeScript,
} from './executor/loopInstrumentation.js'
export {
  applyCodeModePlan,
  cloudMoveRefusal,
  didSessionEndDuringCodeModeScript,
  inferReplModeFromMessages,
  planCodeModeFromSession,
} from './executor/resumePlan.js'
export {
  buildCodeModeShellEnvPrefix,
  checkPrefixedCodeModeShellCommand,
  quoteCodeModeShellArg,
  renderCodeModeShellTemplate,
} from './executor/shellTemplate.js'
export {
  buildConciseCodeModeToolDescription,
  diffCodeModeMcpServerStatus,
  expandCodeModePath,
  extractApprovalUserFeedback,
  extractEnteredWorktreePath,
  findClosestEditMatchHint,
  isNoOpCodeModeEdit,
  normalizeCodeModeToolInput,
  resolveCodeModeEffectiveTools,
  shouldAttachSmallMentionedFileInCodeMode,
  shouldAutoStartCodeModeTurnAfterCommand,
  syncExpiredMcpAuthInCodeMode,
} from './executor/toolHelpers.js'
export type {
  AutoScriptAwaitVerdictResult,
  AutoScriptRecord,
  AutoScriptVerdictState,
  CodeModeExecutionResult,
  CodeModeProgressEvent,
  CodeModeResumePlan,
  CodeModeScriptSideEffects,
  CodeModeToolInvoker,
  DeferredAutoScriptCheckEntry,
  ExecuteCodeModeScriptOptions,
  PausableCodeModeTimer,
} from './executor/types.js'
export {
  clearCodeModeVmSession,
  endMainThreadConversation,
  endSubagentRepl,
  getCodeModeAutoVerdictTracker,
  resetCodeModeRuntimeStateForTests,
} from './executor/vmSession.js'

/**
 * Executes a JavaScript snippet inside a sandboxed VM context (reused per
 * `sessionKey` across turns so top-level bindings persist), exposing async
 * bindings for primitive tools and `callTool(name, input)`.
 */
export async function executeCodeModeScript(
  options: ExecuteCodeModeScriptOptions,
): Promise<CodeModeExecutionResult> {
  const {
    code,
    invokeTool,
    timeoutMs = REPL_SYNC_RUN_MS,
    toolCallCap = REPL_TOOL_CALL_CAP,
    signal,
    shellKind = 'bash',
    sessionKey,
    allowedTools,
    unsetVars,
    onProgress,
    permissionMode,
    getCachedFileContent,
    availableToolNames,
    toolDescriptors,
    evalId,
    dosLimits,
    session,
  } = options

  noteReplContextCreated()

  const resolvedDosLimits = resolveReplDosLimits(dosLimits)
  const turnCallBudget = new ReplTurnCallBudget(resolvedDosLimits)
  const clampedTimeout = Math.max(100, Math.min(timeoutMs, REPL_MAX_TIMEOUT_MS))
  const logs: string[] = []
  let toolCalls = 0
  let nextCallSeq = 0
  // Official 2.1.328 (#653): track in-flight tool calls so failures report
  // which tool calls were still running when the script failed.
  const inFlightCalls = new Map<number, string>()
  const scriptReadCache = new Map<string, string>()

  // Execution-scoped stop/abort state so timeout or external abort immediately
  // stops in-flight waits, aborts inner tools, and refuses any subsequent
  // zombie tool calls from background continuations.
  const execAbortController = new AbortController()
  let stopped = false
  let stopMessage = ''
  let inFlightSnapshotAtStop: string[] | undefined
  let stopReject: ((err: Error) => void) | undefined
  const stopPromise = new Promise<never>((_resolve, reject) => {
    stopReject = reject
  })
  void stopPromise.catch(() => {})

  const triggerStop = (message: string) => {
    if (stopped) return
    stopped = true
    stopMessage = message
    inFlightSnapshotAtStop = [...inFlightCalls.values()]
    const err = new Error(message)
    if (!execAbortController.signal.aborted) {
      execAbortController.abort(err)
    }
    stopReject?.(err)
  }

  const isStopped = () =>
    stopped || signal?.aborted === true || execAbortController.signal.aborted

  const getStopMessage = () =>
    stopped ? stopMessage : 'Code Mode script aborted'

  const vmSession =
    sessionKey !== undefined
      ? getOrCreatePersistentVmSession(sessionKey, session)
      : createCodeModeVmSession()
  const { sandbox, context } = vmSession

  const callCodec = createReplCodec({
    mostItems: resolvedDosLimits.mostItems,
    mostDepth: resolvedDosLimits.mostDepth,
    mostDigits: resolvedDosLimits.mostDigits,
    mostChars: resolvedDosLimits.mostJsonChars,
    hides: value =>
      value === sandbox || value === globalThis || utilTypes.isProxy(value),
    extraObjectPrototypes: [vmSession.bridge.realmObjectPrototype],
    extraArrayPrototypes: [vmSession.bridge.realmArrayPrototype],
  })

  const evalTurnState = makeTurnState()

  let timerRef: PausableCodeModeTimer | undefined
  // Official `ft`/`startsNoMoreCalls`: after the script's deadline (or abort)
  // the realm must refuse to start NEW tool calls. Stored per-eval on `binding`
  // so concurrent detached evals never interfere with each other.
  const evalTimers = new Set<number>()

  const guardedCall = async (
    rawToolName: unknown,
    rawInput: unknown = {},
  ): Promise<unknown> => {
    // Official `ft` (`It.startsNoMoreCalls=!0`): once the turn deadline/abort
    // fires, zombie continuations cannot start new tool calls — they throw
    // the timeout message directly.
    if (binding.noMoreCalls) {
      throw new Error(getStopMessage())
    }
    if (isStopped()) {
      throw new Error(getStopMessage())
    }
    // Official 2.1.331 (`be.answer` / `MNt`): tool name must be a string within `mostTextChars`.
    if (
      typeof rawToolName !== 'string' ||
      rawToolName.length > resolvedDosLimits.mostTextChars
    ) {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    const toolName = rawToolName
    // Official 2.1.331 (`createCodec.encode(..., true)` + `ae` + `Ae.#E`):
    // validate nesting depth, BigInt digit count, per-call argument size, wire
    // length/depth, and per-turn call count / total data budget BEFORE invoking
    // the host tool.
    const encodedInput = callCodec.encode(rawInput, undefined, true)
    let decodedInput: unknown
    try {
      decodedInput = decodeReplWireValue(
        encodedInput,
        callCodec,
        resolvedDosLimits,
      )
    } catch {
      throw new ReplHostCallValidationError(
        REPL_UNKNOWN_OR_OVERSIZED_HOST_CALL_ERROR,
      )
    }
    binding.turnCallBudget.chargeOrThrow([toolName, encodedInput], false)
    const input = (
      typeof decodedInput === 'object' && decodedInput !== null
        ? decodedInput
        : decodedInput === undefined
          ? {}
          : decodedInput
    ) as Record<string, unknown>
    const inputObj =
      typeof input === 'object' && input !== null ? input : undefined
    if (
      allowedTools &&
      !toolName.startsWith('mcp__') &&
      !allowedTools.has(toolName)
    ) {
      throw new Error(`Tool not available in Code Mode: ${toolName}`)
    }
    if (++toolCalls > toolCallCap) {
      throw new Error(
        `Code Mode tool call limit reached (${toolCallCap} calls)`,
      )
    }
    // Official 2.1.328 (#652): an edit that changes nothing no longer stops a script.
    if (toolName === 'Edit' && inputObj && isNoOpCodeModeEdit(inputObj)) {
      return {
        filePath:
          typeof inputObj.file_path === 'string' ? inputObj.file_path : '',
        changed: false,
        noOp: true,
      }
    }
    const callId = ++nextCallSeq
    const callLabel =
      (toolName === 'Bash' || toolName === 'PowerShell') &&
      inputObj &&
      typeof inputObj.command === 'string'
        ? `${toolName}(${JSON.stringify(inputObj.command.slice(0, 60))})`
        : toolName
    inFlightCalls.set(callId, callLabel)
    // Official `Wl`/`Xo`/`Mr`: the step-budget turn only counts *script* code —
    // disarm it while inside a tool call. The elapsed deadline timer keeps
    // running so a tool that hangs still aborts the whole execution.
    const turn = binding.turnState
    const wasArmed = turn.bound !== 0
    turn.bound = 0
    const shouldPause = shouldPauseCodeModeTimerForTool(
      toolName,
      permissionMode,
    )
    if (shouldPause) timerRef?.pause()
    try {
      const toolPromise = Promise.resolve(
        invokeTool(toolName, input, execAbortController.signal),
      )
      void toolPromise.catch(() => {})
      const result = await Promise.race([toolPromise, stopPromise])
      // Official `wl`/`Mr` + `Ae.#k`: on resume, re-arm a fresh turn clamped to
      // the remaining eval deadline and reset the per-turn call/data budget so
      // awaiting lets subsequent turns proceed without extending past deadline.
      if (!isStopped()) {
        binding.turnCallBudget.reset()
        if (wasArmed) {
          const remainingTurnMs = Math.min(
            clampedTimeout,
            Math.max(1, timerRef?.getRemainingMs() ?? clampedTimeout),
          )
          startCodeModeTurn(binding.turnState, remainingTurnMs, clampedTimeout)
        }
      }
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      if (
        toolName === 'Read' &&
        inputObj &&
        typeof inputObj.file_path === 'string'
      ) {
        const readContent =
          result &&
          typeof result === 'object' &&
          'file' in result &&
          typeof (result as { file?: { content?: unknown } }).file?.content ===
            'string'
            ? (result as { file: { content: string } }).file.content
            : result &&
                typeof result === 'object' &&
                'content' in result &&
                typeof (result as { content?: unknown }).content === 'string'
              ? (result as { content: string }).content
              : undefined
        if (readContent !== undefined) {
          scriptReadCache.set(inputObj.file_path, readContent)
        }
      } else if (
        toolName === 'Write' &&
        inputObj &&
        typeof inputObj.file_path === 'string' &&
        typeof inputObj.content === 'string'
      ) {
        scriptReadCache.set(inputObj.file_path, inputObj.content)
      }
      return result
    } catch (err) {
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      // Official 2.1.328 (#652): on failed Edit, attach closest-match hint only
      // from already-cached readable content (never invoke Read, which could
      // bypass allowedTools or trigger a Read permission prompt).
      if (
        toolName === 'Edit' &&
        inputObj &&
        typeof inputObj.file_path === 'string' &&
        typeof inputObj.old_string === 'string' &&
        err instanceof Error &&
        /not found|multiple|match/i.test(err.message) &&
        (!allowedTools || allowedTools.has('Read'))
      ) {
        const content =
          scriptReadCache.get(inputObj.file_path) ??
          getCachedFileContent?.(inputObj.file_path)
        if (content !== undefined) {
          const hint = findClosestEditMatchHint(content, inputObj.old_string)
          if (hint) {
            throw new Error(`${err.message}\n${hint}`)
          }
        }
      }
      throw err
    } finally {
      if (shouldPause) timerRef?.resume()
      if (!isStopped()) {
        binding.turnCallBudget.reset()
        if (wasArmed) {
          const remainingTurnMs = Math.min(
            clampedTimeout,
            Math.max(1, timerRef?.getRemainingMs() ?? clampedTimeout),
          )
          startCodeModeTurn(binding.turnState, remainingTurnMs, clampedTimeout)
        }
      }
      if (!stopped) {
        inFlightCalls.delete(callId)
      }
    }
  }

  // Official 2.1.326 #293 + 2.1.328 (`$c`/`zc`/`Fc`): `$` shell helper exposed
  // as a 100% realm-sealed callable with realm `$.escape` and realm Promise.
  const mayLeaveUnquoted = (v: object): boolean =>
    Object.keys(v).length === 1 &&
    Object.hasOwn(v, 'raw') &&
    vmSession.rawLiteralValues.get(v) === (v as { raw: unknown }).raw

  const createShellRunner = (
    command: string,
    initialTimeout?: number,
  ): CodeModeShellRunner => {
    return async (
      nothrow: boolean,
      msOverride: number | undefined,
      cwdVal: string | undefined,
      envVal: unknown,
    ): Promise<Record<string, unknown>> => {
      if (isStopped()) {
        throw new Error(getStopMessage())
      }
      const ms = msOverride ?? initialTimeout
      let cmd = String(command)
      if (envVal !== undefined) {
        cmd = buildCodeModeShellEnvPrefix(envVal, shellKind) + cmd
      }
      if (cwdVal !== undefined) {
        const quotedCwd = quoteCodeModeShellArg(cwdVal, shellKind)
        cmd =
          (shellKind === 'powershell'
            ? `Set-Location -LiteralPath ${quotedCwd} -ErrorAction Stop; `
            : `cd ${quotedCwd} && `) + cmd
      }
      const shellToolName = shellKind === 'powershell' ? 'PowerShell' : 'Bash'
      onProgress?.({
        type: 'command_start',
        command: cmd,
        toolName: shellToolName,
      })
      const rawRes = await guardedCall(shellToolName, {
        command: cmd,
        ...(typeof ms === 'number' ? { timeout: ms } : {}),
      })
      const rec =
        rawRes && typeof rawRes === 'object'
          ? (rawRes as Record<string, unknown>)
          : {}
      const stdout = typeof rec.stdout === 'string' ? rec.stdout : ''
      const stderr = typeof rec.stderr === 'string' ? rec.stderr : ''
      if (stdout) {
        onProgress?.({
          type: 'command_output',
          command: cmd,
          chunk: stdout,
          stream: 'stdout',
        })
      }
      if (stderr) {
        onProgress?.({
          type: 'command_output',
          command: cmd,
          chunk: stderr,
          stream: 'stderr',
        })
      }
      const exitCode =
        typeof rec.exitCode === 'number'
          ? rec.exitCode
          : typeof rec.code === 'number'
            ? rec.code
            : 0
      const outputWasCut =
        rec.truncated === true ||
        rec.middleCut === true ||
        rec.spillFileCut === true ||
        stdout.includes('characters truncated') ||
        typeof rec.persistedOutputPath === 'string'
      if (exitCode !== 0 && !nothrow) {
        const cutNotice = outputWasCut
          ? '\nNote: the command failed, and its output was too long to keep whole, so stdout has a "characters truncated" line where the middle was cut out.'
          : ''
        const err = new Error(
          `Command failed with exit code ${exitCode}${stderr ? `:\n${stderr}` : ''}${cutNotice}`,
        )
        err.name = 'ShellError'
        throw err
      }
      return {
        stdout,
        stderr,
        exitCode,
        ...(outputWasCut ? { truncated: true } : {}),
      }
    }
  }

  const dispatchDollar = (first: unknown, values: unknown[]) => {
    if (Array.isArray(first) && Object.hasOwn(first, 'raw')) {
      const rendered = renderCodeModeShellTemplate(
        first as readonly string[] & { raw?: readonly string[] },
        values,
        { shellKind, mayLeaveUnquoted },
      )
      return createShellRunner(rendered)
    }
    return createShellRunner(
      String(first),
      typeof values[0] === 'number' ? values[0] : undefined,
    )
  }

  // Official 2.1.328 (#581 & `Tl`/`Rl`): bind each allowed tool global AT MOST
  // ONCE onto `vmSession.sandbox`, dispatching to the active eval via
  // `AsyncLocalStorage` so concurrent/detached evals never overwrite or delete
  // each other's bindings.
  const exposedTools: string[] = []
  const exposedToolSet = new Set<string>()
  for (const [fnName, toolName] of PRIMITIVE_SHORTHAND_MAP) {
    if (allowedTools && !allowedTools.has(toolName)) {
      continue
    }
    exposedTools.push(toolName)
    exposedToolSet.add(toolName)
    ensureToolGlobalBound(vmSession, fnName, toolName)
    ensureToolGlobalBound(vmSession, toolName, toolName)
  }
  const extraToolNames = [
    ...(availableToolNames ?? []),
    ...(allowedTools ? [...allowedTools] : []),
  ]
  for (const toolName of extraToolNames) {
    if (
      exposedToolSet.has(toolName) ||
      !VALID_IDENTIFIER_RE.test(toolName) ||
      toolName === 'REPL' ||
      toolName === 'Eval'
    ) {
      continue
    }
    if (
      allowedTools &&
      !toolName.startsWith('mcp__') &&
      !allowedTools.has(toolName)
    ) {
      continue
    }
    exposedTools.push(toolName)
    exposedToolSet.add(toolName)
    ensureToolGlobalBound(vmSession, toolName, toolName)
  }

  const descriptorList =
    toolDescriptors ?? exposedTools.map(name => ({ name, description: name }))
  const evalsAccess = getReplSessions().access(
    sessionKey ?? REPL_MAIN_THREAD_KEY,
    () => evalId,
  )

  const binding: CodeModeEvalBinding = {
    outside: false,
    ended: false,
    noMoreCalls: false,
    shellKind,
    logs,
    turnState: evalTurnState,
    clampedTimeout,
    timers: evalTimers,
    allowedTools,
    exposedTools,
    toolDescriptors: descriptorList,
    evalsAccess,
    dosLimits: resolvedDosLimits,
    turnCallBudget,
    isStopped,
    getStopMessage,
    guardedCall,
    dispatchDollar,
  }

  let onAbort: (() => void) | undefined
  // Official `ft`: the pausable deadline timer aborts the whole execution once
  // real elapsed time exceeds the budget — covers tool calls that never return
  // and async hangs. `runInContext` has no `timeout` so a single long tool call
  // doesn't count as script time; the step budget handles sync spin.
  timerRef = createPausableCodeModeTimer(clampedTimeout, () => {
    binding.noMoreCalls = true
    triggerStop(`Code Mode script timed out after ${clampedTimeout}ms`)
  })
  registerEvalRemainingMsGetter(binding, () =>
    timerRef ? timerRef.getRemainingMs() : clampedTimeout,
  )

  // Security (P1-C1): Run post-eval value unwrapping and formatting inside an
  // explicitly armed short-budget turn so a returned getter, Proxy trap, or
  // malicious `toString()` can never spin indefinitely outside an active eval.
  const runWithPostEvalBudget = <T>(fn: () => T): T => {
    const postTurn = makeTurnState()
    postTurn.budget = 50_000
    startCodeModeTurn(postTurn, Math.min(clampedTimeout, 150))
    const postBinding: CodeModeEvalBinding = {
      ...binding,
      outside: false,
      ended: false,
      noMoreCalls: true,
      turnState: postTurn,
      isStopped: () => false,
      getStopMessage: () => 'Code Mode post-eval formatting exceeded budget',
    }
    return vmSession.currentCall.run(postBinding, fn)
  }

  const formatThrownMessageSafe = (err: unknown): string =>
    runWithPostEvalBudget(() => {
      if (err instanceof Error) {
        try {
          const errName =
            typeof err.name === 'string' && err.name.length > 0
              ? err.name
              : 'Error'
          const errMsg =
            typeof err.message === 'string' ? err.message : String(err.message)
          if (errName !== 'Error') {
            return errMsg ? `${errName}: ${errMsg}` : errName
          }
          return errMsg
        } catch {
          return '<unprintable error>'
        }
      }
      try {
        return String(err)
      } catch {
        return '<unprintable thrown value>'
      }
    })

  const formatThrownHeaderSafe = (err: unknown): string =>
    runWithPostEvalBudget(() => {
      try {
        return formatThrownErrorHeader(err)
      } catch {
        return 'Error'
      }
    })
  const getAbortReasonMessage = (): string => {
    const reason = signal?.reason
    if (reason instanceof Error && reason.message.length > 0) {
      return reason.message
    }
    if (typeof reason === 'string' && reason.length > 0) {
      return reason
    }
    return 'Code Mode script aborted'
  }

  if (signal) {
    if (signal.aborted) {
      triggerStop(getAbortReasonMessage())
    } else {
      onAbort = () => triggerStop(getAbortReasonMessage())
      signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  try {
    if (isStopped()) {
      throw new Error(getStopMessage())
    }
    // Official 2.1.328 (#576): guard references to top-level variables declared
    // by an earlier failed script that were never set.
    const guardedCode = unsetVars ? injectUnsetVarGuards(code, unsetVars) : code
    // Security (E3-P1-1 / E3-P2-6 / P0-4): generate fresh unguessable per-eval
    // factory parameter names for step-budget enforcement and `{ raw }` literal
    // marking, invoking the VM-compiled factory via the session's private lexical
    // slot with ZERO temporary properties or host accessors ever placed on
    // `sandbox`/`globalThis`.
    const evalCheckBudgetName = `__cm_chk_${randomBytes(6).toString('hex')}`
    const evalRawMarkerName = `__cm_raw_${randomBytes(6).toString('hex')}`
    const transformedSource = transformCodeModeScript(
      guardedCode,
      evalRawMarkerName,
      evalCheckBudgetName,
    )
    const wrappedSource = wrapScriptWithClosureParams(
      transformedSource,
      evalCheckBudgetName,
      evalRawMarkerName,
    )
    let runPromise: Promise<SettledVmOutcome>
    if (wrappedSource.trim().length === 0) {
      runPromise = Promise.resolve({ ok: true, value: undefined })
    } else {
      const script = new vm.Script(wrappedSource, {
        filename: REPL_SCRIPT_FILENAME,
        importModuleDynamically: (() => {
          throw vmSession.bridge.makeError(
            'Dynamic import() is not allowed in Code Mode scripts',
          )
        }) as never,
      })
      try {
        // Official `Xo`/`El` + `currentCall.run(this.binding, ...)`: arm a fresh
        // per-eval turn and run inside `AsyncLocalStorage` so concurrent/detached
        // evals remain completely isolated. Pass a hard synchronous `{ timeout }`
        // backstop slightly past `clampedTimeout` so `chargeCodeModeStep` cleanly
        // terminates instrumented loops without racing JSC's native watchdog thread,
        // while uninstrumented sync hangs / ReDoS are still forcibly interrupted.
        startCodeModeTurn(binding.turnState, clampedTimeout)
        binding.turnCallBudget.reset()
        const syncBackstopTimeout = Math.min(
          REPL_MAX_TIMEOUT_MS,
          clampedTimeout + 250,
        )
        runPromise = vmSession.currentCall.run(binding, () => {
          const factory = script.runInContext(context, {
            timeout: syncBackstopTimeout,
          })
          const rawRun =
            typeof factory === 'function'
              ? runVmFactoryWithTimeout(vmSession, factory, syncBackstopTimeout)
              : factory
          // Security (P0-5): Settle `rawRun` completely inside the VM realm so
          // host Promise.resolve/race NEVER calls user `.then` with host funcs.
          return settleVmResult(vmSession.bridge, rawRun)
        })
      } catch (syncErr) {
        if (
          syncErr &&
          typeof syncErr === 'object' &&
          (syncErr as { code?: unknown }).code ===
            'ERR_SCRIPT_EXECUTION_TIMEOUT'
        ) {
          binding.noMoreCalls = true
          triggerStop(`Code Mode script timed out after ${clampedTimeout}ms`)
          throw new Error(getStopMessage())
        }
        throw syncErr
      }
    }
    // Suppress unhandledRejection if runPromise rejects after timeout/abort wins the race.
    void runPromise.catch(() => {})

    const settled = await Promise.race([runPromise, stopPromise])
    binding.noMoreCalls = true
    if (!settled.ok) {
      throw settled.error
    }

    const formattedValue = runWithPostEvalBudget(() => {
      try {
        const unwrapped = unwrapReplTransformValue(settled.value)
        if (unwrapped === undefined) return undefined
        return elideReplOutputPart(formatValueForOutput(unwrapped))
      } catch {
        return '<unprintable value>'
      }
    })

    const outputParts: string[] = logs.map(l => elideReplOutputPart(l))
    if (formattedValue !== undefined) {
      outputParts.push(formattedValue)
    }
    return {
      result:
        elideReplOutputPart(outputParts.join('\n')) ||
        '(completed with no output)',
      tool_calls: toolCalls,
    }
  } catch (err) {
    const message = formatThrownMessageSafe(err)
    const formattedError = formatThrownHeaderSafe(err)
    const plainErrorText = mapReplPlainErrorLine(err, formattedError)
    const prefix = logs.length > 0 ? `${logs.join('\n')}\n` : ''
    // Official 2.1.328 (#653): report which tool calls were still running when
    // the script failed.
    const stillRunning = inFlightSnapshotAtStop ?? [...inFlightCalls.values()]
    const runningSuffix =
      stillRunning.length > 0
        ? `\nStill running when script failed: ${stillRunning.join(', ')}`
        : ''
    // Official 2.1.328 (#576) + Security (P1-C1): inspect `sandbox` via
    // `Object.getOwnPropertyDescriptor` so malicious getters on `globalThis`
    // are never invoked outside the eval budget.
    const unsetVariables = extractTopLevelDeclaredVars(code).filter(varName => {
      try {
        const desc = Object.getOwnPropertyDescriptor(sandbox, varName)
        if (desc === undefined) return true
        if ('get' in desc || 'set' in desc) return false
        return desc.value === undefined
      } catch {
        return false
      }
    })
    return {
      result: `${prefix}Error: ${message}${runningSuffix}`,
      tool_calls: toolCalls,
      ...(stillRunning.length > 0 ? { inFlightAtFailure: stillRunning } : {}),
      ...(unsetVariables.length > 0 ? { unsetVariables } : {}),
      ...(plainErrorText !== undefined
        ? {
            plainErrorLine: {
              text: plainErrorText,
              replaces: summarizeReplErrorLine(formattedError),
            },
          }
        : {}),
    }
  } finally {
    binding.ended = true
    clearTimersForEvalBinding(vmSession, binding)
    timerRef?.clear()
    timerRef = undefined
    if (onAbort !== undefined) {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

/**
 * Wraps the base `REPLTool` so that when Code Mode is active, `call()` executes
 * JavaScript in the VM sandbox and routes every nested tool invocation through
 * `canUseTool` + the target tool's `call()` implementation.
 */
export function wrapReplToolForCodeMode(
  baseReplTool: Tool,
  resolveAvailableTools: () => readonly Tool[],
): Tool {
  return wrapReplToolForCodeModeWithExecutor(
    baseReplTool,
    resolveAvailableTools,
    executeCodeModeScript,
  )
}
