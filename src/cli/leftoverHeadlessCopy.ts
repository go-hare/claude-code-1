/**
 * densable 2.1.283 leftover unique English (ADD next to existing minify hosts).
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `PWt` @202288597 · leftover `TXn` @202294745 · leftover `v` @202295842
 *   leftover `Ke` @202329540 · leftover `st` @202338533 / @202339066
 *   leftover `dt` @202357829 · leftover `tn` @202375809–202398657 unique copy
 *
 * Keep existing hosts: pushCreatePermissionMode / PERMISSION_MODE_PUSH_* /
 * truncateHeadlessError / logRemoteHeadlessClientAgentRequest /
 * isHeadlessPartialFrame / logDroppedCloudSessionKey /
 * applyInterruptCancelQueued / CLOUD_MESSAGE_NOT_DELIVERED /
 * CLOUD_CLIENT_IS_CLOSING / logRemoteHeadlessClientWorkerInitialize /
 * class st peer-hold / leftover TXn/v bind-unexpected.
 * Unique copy + log helpers. leftover `Yo`/`tn.initializeWorker` compositor
 * BODY lives in leftoverHeadlessAttach.ts / leftoverHeadlessWorker.ts;
 * leftover `tn` remaining methods in leftoverHeadlessClient.ts. Those
 * CALLs these logs. Keep SDK `{done}` host on cloudSession.
 */
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { firstLineOf, truncateCodeUnitsSafe } from 'src/utils/stringUtils.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

/** gold `po` @175826842 + leftover `re` @175598564 — PWt detail clip. */
function leftoverPoClip(err: unknown, maxCodeUnits: number): string {
  return truncateCodeUnitsSafe(
    errorMessage(err).replace(/\s+/g, ' ').trim(),
    maxCodeUnits,
  ).trim()
}

/** gold leftover `Sh(re(e,n))` / `Nt` clip — unique English hosts. */
function leftoverReClip(value: unknown, maxCodeUnits: number): string {
  return truncateCodeUnitsSafe(String(value), maxCodeUnits)
}

function leftoverErrorClip(err: unknown, maxCodeUnits: number): string {
  return leftoverReClip(errorMessage(err), maxCodeUnits)
}

/**
 * gold leftover `vU` @181178944 — PWt refusal reason.
 * Message suffixes only (no minify Error subclasses as public API).
 */
export function classifyRemoteControlRefusal(err: unknown): string {
  if (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name?: unknown }).name === 'AbortError'
  ) {
    return 'aborted'
  }
  if (err instanceof Error) {
    if (err.message.includes('got no response after')) return 'timeout'
    if (
      err.message.endsWith('Disconnected') ||
      err.message.endsWith('Connection to remote lost')
    ) {
      return 'disconnected'
    }
    if (
      err.message.endsWith('not connected') ||
      err.message.includes('Cannot send:')
    ) {
      return 'not_connected'
    }
  }
  return 'server_error'
}

/** leftover `PWt` @202288597 */
export function remoteCreatePermissionModeTakenCopy(mode: string): string {
  return `[remote] The session took its create's ${mode} permission mode as a live request`
}

/** leftover `PWt` @202288597 — gold `po(l(j),{maxCodeUnits:200})`. */
export function remoteCreatePermissionModeNotTakenCopy(
  mode: string,
  reason: string,
  detail: unknown,
): string {
  return `[remote] The create's ${mode} permission mode push was not taken (${reason}): ${leftoverPoClip(detail, 200)}`
}

/** leftover `PWt` @202288597 */
export function remoteCreatePermissionModeDefaultNotTakenCopy(
  detail: unknown,
): string {
  return `[remote] The default mode sent after that refusal was not taken either: ${leftoverPoClip(detail, 200)}`
}

export function logRemoteCreatePermissionModeTaken(mode: string): void {
  logForDebugging(remoteCreatePermissionModeTakenCopy(mode))
}

export function logRemoteCreatePermissionModeNotTaken(
  mode: string,
  err: unknown,
): string {
  const reason = classifyRemoteControlRefusal(err)
  const copy = remoteCreatePermissionModeNotTakenCopy(mode, reason, err)
  logForDebugging(copy)
  return reason
}

export function logRemoteCreatePermissionModeDefaultNotTaken(
  err: unknown,
): void {
  logForDebugging(remoteCreatePermissionModeDefaultNotTakenCopy(err))
}

/** leftover `TXn` @202294745 — keep `attach binding failed unexpectedly`. */
export function logDeviceBindAttachRegistrationStartFailed(err: unknown): void {
  logForDebugging(
    `[deviceBind] attach could not start the device registration: ${errorMessage(err)}`,
  )
}

/**
 * leftover `v` @202295842 — keep `attach binding failed unexpectedly`.
 */
export function logDeviceBindAttachBindingCheckFailed(
  code: string,
  err: unknown,
): { status: 'unbound'; reason: string } {
  logEvent('tengu_device_bind_attach', {
    outcome: code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  logForDebugging(
    `[deviceBind] attach could not check the session's binding (${code}): ${errorMessage(err)}`,
  )
  return { status: 'unbound', reason: code }
}

/** leftover `Ke` @202329540 — gold `Nt(n)` request id clip. */
export function headlessAgentReusesFinishedRequestIdCopy(
  subtype: string,
  requestId: unknown,
): string {
  return `[headlessCloudClient] agent ${subtype} reuses finished request_id ${leftoverReClip(requestId, 64)}; not passed to the host again`
}

export function logHeadlessAgentReusesFinishedRequestId(
  subtype: string,
  requestId: unknown,
): void {
  logForDebugging(headlessAgentReusesFinishedRequestIdCopy(subtype, requestId), {
    level: 'warn',
  })
}

/**
 * leftover `Ke` @202329540 — gold `L?re(l(T),2000):re(xr(l(T)),200)`.
 * Keep tengu_remote_headless_client_agent_request.
 */
export function headlessHostCouldNotAnswerCopy(
  subtype: string,
  requestId: unknown,
  err: unknown,
  invalidReply = false,
): string {
  const clip = invalidReply
    ? leftoverErrorClip(err, 2000)
    : leftoverReClip(firstLineOf(errorMessage(err)), 200)
  return `[headlessCloudClient] host could not answer ${subtype} ${leftoverReClip(requestId, 64)}: ${clip}`
}

export function logHeadlessHostCouldNotAnswer(
  subtype: string,
  requestId: unknown,
  err: unknown,
  invalidReply = false,
): void {
  logForDebugging(
    headlessHostCouldNotAnswerCopy(subtype, requestId, err, invalidReply),
    { level: 'error' },
  )
}

/**
 * leftover `st` @202338533 — keep `logDroppedCloudSessionKey`
 * (`dropped a cloud_session key`).
 */
export function headlessDroppedUnknownFrameCopy(
  type: string,
  source: string | undefined,
  serviceEvent: boolean,
): string {
  const kind = serviceEvent
    ? 'service event'
    : 'frame this build does not write'
  return `[headlessCloudClient] dropped a ${leftoverReClip(type, 40)} ${kind}, from source=${leftoverReClip(source ?? 'unknown', 40)}`
}

export function logHeadlessDroppedUnknownFrame(
  type: string,
  source: string | undefined,
  serviceEvent: boolean,
): void {
  const copy = headlessDroppedUnknownFrameCopy(type, source, serviceEvent)
  if (serviceEvent) logForDebugging(copy)
  else logForDebugging(copy, { level: 'warn' })
}

/** leftover `st` @202339066 */
export function headlessConsumedOwnEchoCopy(uuid: unknown): string {
  return `[headlessCloudClient] consumed our own echo of ${String(uuid)}`
}

export function logHeadlessConsumedOwnEcho(uuid: unknown): void {
  logForDebugging(headlessConsumedOwnEchoCopy(uuid))
}

/** leftover `dt` @202357829 — keep applyInterruptCancelQueued. */
export function logHeadlessInterruptNotDispatched(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] interrupt not dispatched: ${errorMessage(err)}`,
  )
}

export function logHeadlessCouldNotAnnounceSweptCommand(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] could not announce a swept command: ${errorMessage(err)}`,
  )
}

/** leftover `tn` @202375809 unique copy — not m_n worker_initialize compositor. */
export function logHeadlessDroppedUnknownControlResponse(
  requestId: unknown,
): void {
  logForDebugging(
    `[headlessCloudClient] dropped control_response for unknown request ${leftoverReClip(requestId, 64)}`,
  )
}

export function logHeadlessSettlingOpenerWorkFailed(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] settling the opener's work failed: ${errorMessage(err)}`,
  )
}

/**
 * leftover `m_n` / `tn.initializeWorker` @202378433 unique log host.
 * Gold: `i("tengu_remote_headless_client_worker_initialize",{reason,outcome,cause,status,attempt,n_dialog_kinds})`.
 * Keep SDK `{done}` host on cloudSession. Compositor CALLs this.
 */
export function logRemoteHeadlessClientWorkerInitialize(opts: {
  reason: string
  outcome: string
  cause?: string
  status?: number
  attempt: number
  nDialogKinds: number
}): void {
  logEvent('tengu_remote_headless_client_worker_initialize', {
    reason:
      opts.reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    outcome:
      opts.outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    ...(opts.cause !== undefined && {
      cause:
        opts.cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(opts.status !== undefined && { status: opts.status }),
    attempt: opts.attempt,
    n_dialog_kinds: opts.nDialogKinds,
  })
}

export function logHeadlessWorkerTookClientInitialize(reason: string): void {
  logForDebugging(
    `[headlessCloudClient] the worker took this client's initialize (${reason})`,
  )
}

export function logHeadlessClientInitializeNotAnswered(
  reason: string,
  err: unknown,
): void {
  logForDebugging(
    `[headlessCloudClient] this client's initialize (${reason}) was not answered: ${leftoverErrorClip(err, 200)}`,
  )
}

export function logHeadlessOpeningRequestFailed(
  subtype: string,
  err: unknown,
): void {
  logForDebugging(
    `[headlessCloudClient] opening request ${subtype} failed: ${leftoverErrorClip(err, 200)}`,
  )
}

export function cloudSessionDidNotAcceptRequiredCopy(feature: string): string {
  return `Error: the cloud session did not accept ${feature}, so this attach was stopped rather than continue without it.`
}

export function cloudSessionDidNotAcceptOptionalCopy(feature: string): string {
  return `The cloud session did not accept ${feature}; it keeps its own.`
}

export function logHeadlessDroppedFrameAfterStdoutClosed(type: string): void {
  logForDebugging(
    `[headlessCloudClient] dropped ${type} frame after stdout closed`,
  )
}

export function logHeadlessIgnoringFrameWhileClosing(type: string): void {
  logForDebugging(
    `[headlessCloudClient] ignoring ${type} frame while closing`,
  )
}

export function logHeadlessIgnoringHostFrame(type: string): void {
  logForDebugging(`[headlessCloudClient] ignoring host ${type} frame`)
}

export function logHeadlessDiscardedSessionNotReleased(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] discarded session not released: ${errorMessage(err)}`,
  )
}

export function headlessNotPassingOwnQuestionDialogCopy(kind: unknown): string {
  return `[headlessCloudClient] not passing a ${leftoverReClip(String(kind), 64)} dialog to the host: that kind is this client's own question, never the cloud session's`
}

export function logHeadlessNotPassingOwnQuestionDialog(kind: unknown): void {
  logForDebugging(headlessNotPassingOwnQuestionDialogCopy(kind))
}

export function headlessNotPassingUndeclaredDialogCopy(kind: unknown): string {
  const z = leftoverReClip(String(kind), 64)
  return `[headlessCloudClient] not passing a ${z} dialog to the host: its initialize did not declare the kind`
}

export function logHeadlessNotPassingUndeclaredDialog(kind: unknown): void {
  logForDebugging(headlessNotPassingUndeclaredDialogCopy(kind))
}

export function cloudSessionWaitingUndeclaredDialogCopy(kind: string): string {
  return `The cloud session is waiting on a ${kind} dialog this host did not declare it can show; it continues when another client answers it or the session's dialog timeout passes.`
}

/** leftover `tn` — gold `—` em-dash + `…`. */
export const CLOUD_SESSION_LOST_RECONNECTING =
  'Lost the connection to the cloud session — reconnecting…'

export function cloudSessionDidNotApplyCreatePermissionModeCopy(
  requested: string,
  actual: string | undefined,
  rawMode?: unknown,
): string {
  const mode = actual ?? leftoverReClip(rawMode ?? '', 24)
  return `The cloud session did not apply the ${requested} permission mode requested when it was created; it is in ${mode} mode.`
}

export function logHeadlessCreatePermissionModeNotApplied(
  requested: string,
  actual: string | undefined,
  rawMode?: unknown,
): string {
  const copy = cloudSessionDidNotApplyCreatePermissionModeCopy(
    requested,
    actual,
    rawMode,
  )
  logForDebugging(`[headlessCloudClient] ${copy}`, { level: 'warn' })
  return copy
}

export function logHeadlessStreamError(err: { message: string }): void {
  logForDebugging(`[headlessCloudClient] stream error: ${err.message}`)
}

/**
 * leftover `tn` — DIFFERENT from existing
 * `[headlessCloud] attach preflight failed (continuing via the stream)`.
 */
export function logHeadlessAttachPreflightFailed(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] attach preflight failed: ${leftoverErrorClip(err, 200)}`,
  )
}

/**
 * leftover `tn` — DIFFERENT from leftover `qo`
 * `re-reading the serve-only link failed (keeping it)`.
 */
export function logHeadlessRereadingServeOnlyLinkThrew(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] re-reading the serve-only link threw: ${errorMessage(err)}`,
  )
}

export function logHeadlessBuiltInToolNamesUnread(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] built-in tool names could not be read: ${leftoverErrorClip(err, 200)}`,
  )
}

export function logHeadlessTransportCloseFailed(err: unknown): void {
  logForDebugging(
    `[headlessCloudClient] transport close failed: ${errorMessage(err)}`,
  )
}
