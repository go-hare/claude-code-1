/**
 * densable consecutive-unavailable hold (vPt / Y7o / TPt / COo / EPt / cLt / X7o).
 */
import {
  clearClassifierChecking,
  setClassifierChecking,
} from '../classifierApprovals.js'
import {
  clearAutoModeUnavailableResponses,
  countAutoModeUnavailableResponsesInARow,
  getAutoModeUnavailableResponse,
  noteAutoModeUnavailableResponse,
} from '../../bootstrap/state.js'
import type { RetryStatus } from '../advisorNetworkStall.js'
import { describeClassifierGatewayHost } from '../../services/api/autoModeServerFallbackNotice.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { getRetryDelay } from '../../services/api/withRetry.js'
import type { Tool } from '../../Tool.js'

/** densable `Ib`. */
export const AUTO_MODE_UNAVAILABLE_STREAK_LIMIT = 10

/**
 * densable `zTn` — `decisionReason.reason` on the X7o stop denial, not the
 * user-facing copy.
 */
export const AUTO_MODE_UNAVAILABLE_STOP_REASON =
  'Auto mode unavailable — stopped after repeated responses with no safety verdict'

/** densable `cpo=!0` — leftover-at-limit always resets the streak. */
const RESET_UNAVAILABLE_STREAK_AT_LIMIT = true

/** densable `dpo`. */
const defaultScheduleTimeout = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms)
  return () => clearTimeout(handle)
}

export type AutoModeUnavailableHoldResult =
  | { kind: 'stop'; position: number; recorded: boolean }
  | { kind: 'deny'; position: number; interrupted: boolean }

export type AutoModeUnavailableWaitBanner = {
  position: number
  limit: number
  delayMs: number
}

export type AutoModeUnavailableHoldOptions = {
  runKey: string
  signal: AbortSignal
  scheduleTimeout?: (fn: () => void, ms: number) => () => void
  onWait?: (banner: AutoModeUnavailableWaitBanner | null) => void
}

/** densable `xV`. */
export function autoModeUnavailableRunKey(agentId?: string): string {
  return agentId ?? 'main'
}

/** densable `upo` — `BL(attempt)` on existing getRetryDelay. */
export function autoModeUnavailableDelayMs(attempt: number): number {
  return getRetryDelay(attempt)
}

/** densable `TPt`. */
export function isConsecutiveUnavailableErrorKind(
  errorKind: string | undefined,
  perCall: boolean,
): boolean {
  if (errorKind === undefined) return false
  if (errorKind.startsWith('server_call_unavailable_')) {
    return errorKind !== 'server_call_unavailable_truncated'
  }
  return (
    errorKind.startsWith('server_unavailable_') ||
    errorKind === 'server_stream_ended' ||
    errorKind === 'server_unrecognized_result' ||
    (!perCall &&
      (errorKind === 'server_no_result' ||
        errorKind === 'server_unsupported' ||
        errorKind === 'server_thread_unsupported'))
  )
}

/** densable `COo`. */
export function autoModeUnavailableAgentStopCopy(): string {
  return `Auto mode is unavailable: the server returned no safety verdict for ${AUTO_MODE_UNAVAILABLE_STREAK_LIMIT} responses in a row, so this agent was stopped before it finished. Nobody interrupted it; whatever it returned is partial. Retrying now will likely stop the same way — wait for the user's next message.`
}

/** densable `EPt`. */
export function autoModeUnavailableToolStopCopy(toolName: string): string {
  return `Auto mode is unavailable: the server returned no safety verdict for ${AUTO_MODE_UNAVAILABLE_STREAK_LIMIT} responses in a row, so ${toolName} was not run and this turn has ended. Wait for the user's next message before doing anything further.`
}

/** densable `cLt`. */
export function autoModeUnavailableUserStopCopy(gatewayHost?: string): string {
  const copy = `Auto mode is unavailable — the server returned no safety verdict for the last ${AUTO_MODE_UNAVAILABLE_STREAK_LIMIT} responses, so Claude stopped. Send a message to try again, or switch out of auto mode.`
  return gatewayHost === undefined
    ? copy
    : `${copy} Requests in this session go through ${gatewayHost}; a proxy that alters responses could cause this.`
}

/** densable `nie`. */
export function clearAutoModeUnavailableStreakIfAny(runKey: string): void {
  if (countAutoModeUnavailableResponsesInARow(runKey) > 0) {
    clearAutoModeUnavailableResponses(runKey)
  }
}

/** densable `fpo`. */
export function waitAutoModeUnavailableHold(
  delayMs: number,
  position: number,
  options: Pick<
    AutoModeUnavailableHoldOptions,
    'signal' | 'scheduleTimeout' | 'onWait'
  >,
): Promise<boolean> {
  const scheduleTimeout = options.scheduleTimeout ?? defaultScheduleTimeout
  const notify = (banner: AutoModeUnavailableWaitBanner | null): void => {
    try {
      options.onWait?.(banner)
    } catch (err) {
      logForDebugging(
        `[server-classifier] retry banner update failed: ${errorMessage(err)}`,
        { level: 'warn' },
      )
    }
  }
  return new Promise(resolve => {
    let cancel = (): void => {}
    const finish = (completed: boolean): void => {
      cancel()
      options.signal.removeEventListener('abort', onAbort)
      notify(null)
      resolve(completed)
    }
    const onAbort = (): void => finish(false)
    options.signal.addEventListener('abort', onAbort, { once: true })
    notify({
      position,
      limit: AUTO_MODE_UNAVAILABLE_STREAK_LIMIT,
      delayMs,
    })
    cancel = scheduleTimeout(() => finish(true), delayMs)
  })
}

/** densable `vPt`. */
export async function holdForConsecutiveAutoModeUnavailable(
  request: unknown,
  options: AutoModeUnavailableHoldOptions,
): Promise<AutoModeUnavailableHoldResult> {
  const existing = getAutoModeUnavailableResponse(request)
  if (existing !== undefined) {
    return existing.position >= AUTO_MODE_UNAVAILABLE_STREAK_LIMIT
      ? {
          kind: 'stop',
          position: existing.position,
          recorded: false,
        }
      : {
          kind: 'deny',
          position: existing.position,
          interrupted: !(await existing.waited),
        }
  }
  let inRow = countAutoModeUnavailableResponsesInARow(options.runKey)
  if (options.signal.aborted) {
    return { kind: 'deny', position: inRow, interrupted: true }
  }
  if (
    RESET_UNAVAILABLE_STREAK_AT_LIMIT &&
    inRow >= AUTO_MODE_UNAVAILABLE_STREAK_LIMIT
  ) {
    clearAutoModeUnavailableResponses(options.runKey)
    inRow = 0
  }
  const position = inRow + 1
  if (position >= AUTO_MODE_UNAVAILABLE_STREAK_LIMIT) {
    noteAutoModeUnavailableResponse(request, {
      runKey: options.runKey,
      position,
      waited: Promise.resolve(true),
    })
    return { kind: 'stop', position, recorded: true }
  }
  const delayMs = autoModeUnavailableDelayMs(position)
  const waited = waitAutoModeUnavailableHold(delayMs, position, options)
  noteAutoModeUnavailableResponse(request, {
    runKey: options.runKey,
    position,
    waited,
  })
  return {
    kind: 'deny',
    position,
    interrupted: !(await waited),
  }
}

type HoldOnUnavailableContext = {
  agentId?: string
  abortController: AbortController
  scheduleTimeout?: (fn: () => void, ms: number) => () => void
  setRetryStatus?: (status: RetryStatus | null) => void
}

/**
 * densable `Y7o(e,n,r,s)` — WPe/qne are leftover setClassifierChecking /
 * clearClassifierChecking (module Set, not React bag).
 */
export async function holdOnAutoModeUnavailable(
  request: unknown,
  context: HoldOnUnavailableContext,
  toolUseId: string,
): Promise<AutoModeUnavailableHoldResult> {
  setClassifierChecking(toolUseId)
  try {
    return await holdForConsecutiveAutoModeUnavailable(request, {
      runKey: autoModeUnavailableRunKey(context.agentId),
      signal: context.abortController.signal,
      scheduleTimeout: context.scheduleTimeout,
      onWait: banner => {
        if (banner === null) {
          context.setRetryStatus?.(null)
          return
        }
        logForDebugging(
          `[server-classifier] no usable verdict for ${banner.position} response(s) in a row; holding this response's denials ${banner.delayMs}ms before the model may retry (${banner.position}/${banner.limit})`,
          { level: 'warn' },
        )
        context.setRetryStatus?.({
          kind: 'auto_mode_unavailable',
          attempt: banner.position,
          maxRetries: banner.limit,
          retryInMs: banner.delayMs,
          deadline: Date.now() + banner.delayMs,
        })
      },
    })
  } finally {
    clearClassifierChecking(toolUseId)
  }
}

/**
 * densable `X7o` — consecutive-unavailable stop denial.
 */
export function denyAutoModeUnavailableStop(
  tool: Tool,
  context: { agentId?: string },
  recorded: boolean,
): {
  behavior: 'deny'
  decisionReason: {
    type: 'classifier'
    classifier: 'auto-mode'
    reason: string
    noVerdict: true
  }
  message: string
  endsTurn: true
} {
  if (recorded) {
    const isSubagent = context.agentId !== undefined
    logEvent('tengu_auto_mode_unavailable_stop', {
      isSubagent,
      gatewayConfigured: describeClassifierGatewayHost() !== undefined,
    })
    logForDebugging(
      `[server-classifier] no usable verdict for ${AUTO_MODE_UNAVAILABLE_STREAK_LIMIT} responses in a row; stopping the ${isSubagent ? "agent's run" : 'turn'}`,
      { level: 'warn' },
    )
  }
  return {
    behavior: 'deny',
    decisionReason: {
      type: 'classifier',
      classifier: 'auto-mode',
      reason: AUTO_MODE_UNAVAILABLE_STOP_REASON,
      noVerdict: true,
    },
    message: autoModeUnavailableToolStopCopy(tool.name),
    endsTurn: true,
  }
}
