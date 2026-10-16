/**
 * densable 2.1.289 session launch gates (`Oer` / `Zv` / `R4o` / `qd` / `Ier` /
 * `gZ` / `T4o` / `Aut` / `gHo` / `NLt`).
 *
 * Semantic names only — never export minify
 * `Oer|Zv|R4o|Aut|gHo|Ier|qd|gZ|T4o|NLt`.
 *
 * Host-keyed bag (`t.of(U().host)`) plus ALS override — not a process
 * singleton and not a field on leftover SessionHost.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { isBackgroundTasksDisabled as isBackgroundTasksDisabledEnv } from './residualFinalEnvGates.js'
import { isBareMode } from './envUtils.js'
import { logForDebugging } from './debug.js'
import { logError } from './log.js'
import { getBootstrapSessionHost } from './sessionRoot.js'

export const BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE =
  'Background agents cannot be started in this session right now. Run the agent without run_in_background.'

export type BackgroundLaunchAskInput = {
  toolUseId: string
  callerAgentId?: string
  signal: AbortSignal
}

export type BackgroundLaunchAdmission = {
  confirm: (signal: AbortSignal) =>
    | undefined
    | {
        kind: 'closed'
        message: string
      }
    | {
        kind: 'aborted'
      }
  registered: (handover: {
    agentId: string
    abortController: AbortController
  }) => void
}

export type BackgroundLaunchRule = {
  /** Appended to Agent `run_in_background` schema describe when the field is shown. */
  parameterDescription: string
  ask: (
    input: BackgroundLaunchAskInput,
  ) => BackgroundLaunchAdmission | undefined | null
}

export type BackgroundLaunchConfirmRefusal =
  | { kind: 'closed'; message: string }
  | { kind: 'aborted' }

export type AdmittedBackgroundLaunch = {
  confirm: (signal: AbortSignal) => BackgroundLaunchConfirmRefusal | undefined
  /**
   * densable `handOver` — `registered()` must return nothing. Any value/promise
   * or throw → false (caller kills the task and refuses the spawn).
   */
  handOver: (handover: {
    agentId: string
    abortController: AbortController
  }) => boolean
}

export class SessionBackgroundGates {
  backgroundTasksDisabled = false
  backgroundAgentLaunchDisabled = false
  remoteAgentIsolationDisabled = false
  unsandboxedCommandsDisabled = false
  backgroundDeadlineDisabled = false
  backgroundLaunchRule: BackgroundLaunchRule | undefined

  reset(): void {
    this.backgroundTasksDisabled = false
    this.backgroundAgentLaunchDisabled = false
    this.remoteAgentIsolationDisabled = false
    this.unsandboxedCommandsDisabled = false
    this.backgroundDeadlineDisabled = false
    this.backgroundLaunchRule = undefined
  }
}

/**
 * densable `z` — WeakMap host → Oer. Check `!== undefined`, not truthy.
 */
class WeakOwnerCache<T> {
  #e: () => T
  #t = new WeakMap<object, T>()
  constructor(e: () => T) {
    this.#e = e
  }
  of(e: object): T {
    const t = this.#t.get(e)
    if (t !== undefined) return t
    const o = this.#e()
    this.#t.set(e, o)
    return o
  }
}

const hostGates = new WeakOwnerCache(() => new SessionBackgroundGates())
const gatesAls = new AsyncLocalStorage<SessionBackgroundGates>()

/** densable `t.of(host)` — bag for a host object. */
export function sessionBackgroundGatesOf(host: object): SessionBackgroundGates {
  return hostGates.of(host)
}

/** densable `Zv` — ALS override, else bootstrap host bag. */
export function getSessionBackgroundGates(): SessionBackgroundGates {
  return gatesAls.getStore() ?? hostGates.of(getBootstrapSessionHost())
}

/** densable `R4o` — run `fn` with an ALS gates bag. */
export function runWithSessionBackgroundGates<T>(
  gates: SessionBackgroundGates,
  fn: () => T,
): T {
  return gatesAls.run(gates, fn)
}

export function resetSessionBackgroundGatesForTests(): void {
  getSessionBackgroundGates().reset()
}

export function disableBackgroundTasks(): void {
  getSessionBackgroundGates().backgroundTasksDisabled = true
}

export function disableBackgroundAgentLaunch(): void {
  getSessionBackgroundGates().backgroundAgentLaunchDisabled = true
}

export function disableRemoteAgentIsolation(): void {
  getSessionBackgroundGates().remoteAgentIsolationDisabled = true
}

export function disableUnsandboxedCommands(): void {
  getSessionBackgroundGates().unsandboxedCommandsDisabled = true
}

export function disableBackgroundDeadline(): void {
  getSessionBackgroundGates().backgroundDeadlineDisabled = true
}

/**
 * densable `installBackgroundLaunchRule` — requires background tasks disabled
 * first, a string `parameterDescription`, and at most one rule.
 */
export function installBackgroundLaunchRule(rule: BackgroundLaunchRule): void {
  const gates = getSessionBackgroundGates()
  if (!gates.backgroundTasksDisabled) {
    throw new Error(
      'A background launch rule needs background tasks disabled first',
    )
  }
  if (typeof rule.parameterDescription !== 'string') {
    throw new Error(
      'A background launch rule needs parameterDescription to be a string',
    )
  }
  if (gates.backgroundLaunchRule !== undefined) {
    throw new Error('A background launch rule is already installed')
  }
  gates.backgroundLaunchRule = rule
}

/** densable `qd` — env or session `backgroundTasksDisabled` or `Or()` (bare). */
export function areBackgroundTasksDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    getSessionBackgroundGates().backgroundTasksDisabled ||
    isBackgroundTasksDisabledEnv(env) ||
    isBareMode()
  )
}

/**
 * densable `Ier` — schema omit / hard disable:
 * (session tasks disabled AND no launch-rule) OR agent-launch-disabled OR env OR `Or()`.
 */
export function isBackgroundLaunchDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const gates = getSessionBackgroundGates()
  return (
    (gates.backgroundTasksDisabled &&
      gates.backgroundLaunchRule === undefined) ||
    gates.backgroundAgentLaunchDisabled ||
    isBackgroundTasksDisabledEnv(env) ||
    isBareMode()
  )
}

/** densable `gZ` — env/session tasks disabled OR agent-launch-disabled. */
export function isBackgroundAgentLaunchBlocked(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    areBackgroundTasksDisabled(env) ||
    getSessionBackgroundGates().backgroundAgentLaunchDisabled
  )
}

/** densable `T4o` — a launch-rule is installed and Ier is false. */
export function hasActiveBackgroundLaunchRule(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    getSessionBackgroundGates().backgroundLaunchRule !== undefined &&
    !isBackgroundLaunchDisabled(env)
  )
}

/** densable `Aut` — current launch-rule, or undefined. */
export function getBackgroundLaunchRule(): BackgroundLaunchRule | undefined {
  try {
    return getSessionBackgroundGates().backgroundLaunchRule
  } catch {
    return undefined
  }
}

function isAdmissionBag(value: unknown): value is BackgroundLaunchAdmission {
  if (typeof value !== 'object' || value === null) return false
  const bag = value as BackgroundLaunchAdmission
  return (
    typeof bag.confirm === 'function' && typeof bag.registered === 'function'
  )
}

function asConfirmRefusal(
  value: unknown,
): BackgroundLaunchConfirmRefusal | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const bag = value as { kind?: unknown; message?: unknown }
  if (bag.kind === 'closed' && typeof bag.message === 'string') {
    return { kind: 'closed', message: bag.message }
  }
  if (bag.kind === 'aborted') {
    return { kind: 'aborted' }
  }
  return undefined
}

function logLaunchRuleFailure(
  err: unknown,
  phase: 'ask' | 'confirm' | 'registered',
  signal: AbortSignal,
): void {
  const message = err instanceof Error ? err.message : String(err)
  logForDebugging(`[background launch rule] ${phase} failed: ${message}`, {
    level: 'error',
  })
  if (signal.aborted) {
    logError(err)
  }
}

/**
 * densable `gHo` — admit a background launch through the session rule.
 * `ask()` must return undefined/null (not admitted) or an admission bag.
 */
export function admitBackgroundLaunch(
  rule: BackgroundLaunchRule,
  input: BackgroundLaunchAskInput,
): AdmittedBackgroundLaunch | undefined {
  let admission: BackgroundLaunchAdmission
  try {
    const asked = rule.ask(input)
    if (asked === undefined || asked === null) return undefined
    if (!isAdmissionBag(asked)) {
      void Promise.resolve(asked).catch(() => {})
      logError(
        new Error(
          "A background launch rule's ask() returned something other than undefined or an admission (a promise, if ask is async). The call was not admitted.",
        ),
      )
      return undefined
    }
    admission = asked
  } catch (err) {
    logLaunchRuleFailure(err, 'ask', input.signal)
    return undefined
  }
  return {
    confirm(signal) {
      try {
        const raw = admission.confirm(signal)
        if (raw === undefined) return undefined
        const refusal = asConfirmRefusal(raw)
        if (refusal?.kind === 'closed') {
          return refusal.message.trim() === ''
            ? { kind: 'closed', message: BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE }
            : refusal
        }
        if (refusal?.kind === 'aborted' && signal.aborted) return refusal
        void Promise.resolve(raw).catch(() => {})
        logError(
          refusal !== undefined
            ? new Error(
                "A background launch rule's confirm() returned 'aborted' for a call whose signal was not aborted. The launch was refused.",
              )
            : new Error(
                "A background launch rule's confirm() returned neither undefined nor a refusal. The launch was refused.",
              ),
        )
        return { kind: 'closed', message: BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE }
      } catch (err) {
        logLaunchRuleFailure(err, 'confirm', signal)
        const aborted =
          err instanceof Error &&
          (err.name === 'AbortError' ||
            err.message.toLowerCase().includes('abort'))
        return aborted && signal.aborted
          ? { kind: 'aborted' }
          : { kind: 'closed', message: BACKGROUND_LAUNCH_NOT_TAKEN_MESSAGE }
      }
    },
    handOver(handover) {
      try {
        const result = admission.registered(handover)
        if (result === undefined) return true
        void Promise.resolve(result).catch(() => {})
        logError(
          new Error(
            "A background launch rule's registered() returned a value (a promise, if it is async). It must return nothing. The task was ended and the call refused.",
          ),
        )
        return false
      } catch (err) {
        logLaunchRuleFailure(err, 'registered', input.signal)
        return false
      }
    },
  }
}

/**
 * densable `mn` — only the assistant tool_use whose input.run_in_background===true
 * yields a launch-rule toolUseId.
 */
export function launchRuleToolUseIdFromAssistant(
  assistant: { message?: { content?: unknown } } | undefined,
  toolUseId: string | undefined,
): string | undefined {
  if (!toolUseId || !assistant?.message) return undefined
  const content = assistant.message.content
  if (!Array.isArray(content)) return undefined
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'tool_use' &&
      'id' in block &&
      block.id === toolUseId &&
      'input' in block &&
      block.input &&
      typeof block.input === 'object' &&
      (block.input as { run_in_background?: unknown }).run_in_background ===
        true
    ) {
      return toolUseId
    }
  }
  return undefined
}

/**
 * Spawn-time disable flag (`Wn`):
 * - no rule → `gZ` (env/session tasks disabled OR agent-launch-disabled)
 * - rule present but not admitted → disable async
 * - rule admitted → false (async allowed; confirm/handOver still run)
 */
export function resolveSpawnBackgroundTasksDisabled(input: {
  wantsBackground: boolean | undefined
  assistant?: { message?: { content?: unknown } }
  toolUseId?: string
  callerAgentId?: string
  signal: AbortSignal
}): {
  backgroundTasksDisabled: boolean
  admitted: AdmittedBackgroundLaunch | undefined
} {
  const rule = getBackgroundLaunchRule()
  const blocked = isBackgroundAgentLaunchBlocked()
  if (rule === undefined) {
    return { backgroundTasksDisabled: blocked, admitted: undefined }
  }
  const toolUseId =
    rule && input.wantsBackground === true && !isBackgroundLaunchDisabled()
      ? launchRuleToolUseIdFromAssistant(input.assistant, input.toolUseId)
      : undefined
  const admitted =
    toolUseId !== undefined
      ? admitBackgroundLaunch(rule, {
          toolUseId,
          callerAgentId: input.callerAgentId,
          signal: input.signal,
        })
      : undefined
  return {
    backgroundTasksDisabled: admitted === undefined,
    admitted,
  }
}
