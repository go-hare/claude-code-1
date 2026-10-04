/**
 * densable 2.1.283 leftover `tn.initializeWorker` compositor BODY.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 *   leftover `tn.initializeWorker` @202378433 BODY 1004 B next `async applyOpeningRequests`
 *   leftover `tn.applyOpeningRequests` @202379437 BODY 656 B
 *   leftover `mo` @202401343 / leftover `go` @202401514
 *
 * CALL leftoverHeadlessCopy logs. Keep SDK `{done}` host on cloudSession
 * (`startHeadlessCloudSession` / `HeadlessCloudSdkHost`). Seams for
 * WS/manager/dialogs injected. NEVER `export class tn`.
 */
import { logEvent } from 'src/services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from 'src/services/analytics/index.js'
import {
  cloudSessionDidNotAcceptOptionalCopy,
  cloudSessionDidNotAcceptRequiredCopy,
  cloudSessionWaitingUndeclaredDialogCopy,
  logHeadlessClientInitializeNotAnswered,
  logHeadlessNotPassingUndeclaredDialog,
  logHeadlessOpeningRequestFailed,
  logHeadlessWorkerTookClientInitialize,
  logRemoteHeadlessClientWorkerInitialize,
} from './leftoverHeadlessCopy.js'

/** gold `oo` @202373828 next to leftover `tn` */
const WORKER_INITIALIZE_RETRY_MS = [400, 1200] as const
/** gold `io` */
const WORKER_INITIALIZE_RETRY_WINDOW_MS = 5000
/** gold `no` */
const WORKER_INITIALIZE_TIMEOUT_MS = 300_000

/**
 * leftover `Xe` @202333532 — own-question kinds filtered off initialize.
 * Same four kinds as leftoverUnique `isHeadlessHostDialogKind` (QUe/Lre/be/Cgt).
 */
const OWN_QUESTION_DIALOG_KINDS = new Set([
  'cloud_sync_consent',
  'cloud_sync_offline',
  'unattended_serving_consent',
  'device_mcp_consent',
])

export type HeadlessWorkerInitializeReason =
  | 'declare_dialog_kinds'
  | 'rearm_parked_prompt'

export type HeadlessWorkerInitializePosted = {
  outcome: string
  cause?: string
  status?: number
}

export type HeadlessWorkerClock = {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => () => void
}

export type HeadlessWorkerManager = {
  postControlRequest: (
    request: { subtype: 'initialize'; supportedDialogKinds?: string[] },
    opts: {
      answerExpected: false
      background: true
      timeoutMs: number
      signal: AbortSignal
    },
  ) => {
    posted: Promise<HeadlessWorkerInitializePosted>
    response: Promise<unknown>
  }
}

export type HeadlessOpeningRequest = {
  request: { subtype: string }
  required: boolean
  describe: string
}

const defaultClock: HeadlessWorkerClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const id = setTimeout(fn, ms)
    return () => clearTimeout(id)
  },
}

/**
 * leftover `mo` @202401343
 * create + no prompt + declared kinds → `declare_dialog_kinds`
 * attach + workerAwaitsAnswer → `rearm_parked_prompt`
 */
export function headlessWorkerInitializeReason(
  session: {
    entry: 'create' | 'attach'
    initialPrompt?: unknown
    workerAwaitsAnswer?: boolean
  },
  supportedDialogKinds: readonly string[],
): HeadlessWorkerInitializeReason | null {
  if (session.entry === 'create') {
    return session.initialPrompt === undefined && supportedDialogKinds.length > 0
      ? 'declare_dialog_kinds'
      : null
  }
  return session.workerAwaitsAnswer === true ? 'rearm_parked_prompt' : null
}

/**
 * leftover `go` @202401514 — retry only failed http 5xx / 429 / 408.
 */
export function isRetryableWorkerInitializePost(
  posted: HeadlessWorkerInitializePosted,
): boolean {
  return (
    posted.outcome === 'failed' &&
    posted.cause === 'http' &&
    posted.status !== undefined &&
    (posted.status >= 500 || posted.status === 429 || posted.status === 408)
  )
}

export function filterSupportedDialogKindsForInitialize(
  hostDialogKinds: Iterable<string>,
  isOwnQuestionDialogKind: (kind: string) => boolean = kind =>
    OWN_QUESTION_DIALOG_KINDS.has(kind),
): string[] {
  return [...hostDialogKinds].filter(kind => !isOwnQuestionDialogKind(kind))
}

/**
 * leftover `tn` undeclared-dialog copy — CALL leftoverHeadlessCopy.
 */
export function noteHeadlessUndeclaredDialog(kind: unknown): string {
  logHeadlessNotPassingUndeclaredDialog(kind)
  return cloudSessionWaitingUndeclaredDialogCopy(String(kind))
}

/**
 * leftover `tn.applyOpeningRequests` @202379437 — CALL leftoverHeadlessCopy.
 */
export async function applyHeadlessOpeningRequests(
  openingRequests: readonly HeadlessOpeningRequest[],
  seams: {
    sendControlRequest: (request: { subtype: string }) => Promise<unknown>
    emitNotice?: (text: string) => void
  },
): Promise<void> {
  for (const { request, required, describe } of openingRequests) {
    try {
      await seams.sendControlRequest(request)
      logEvent('tengu_remote_headless_client_opening_request', {
        subtype:
          request.subtype as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        outcome:
          'applied' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } catch (err) {
      logHeadlessOpeningRequestFailed(request.subtype, err)
      logEvent('tengu_remote_headless_client_opening_request', {
        subtype:
          request.subtype as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        outcome: (required
          ? 'refused_required'
          : 'refused_optional') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      if (required) {
        throw new Error(cloudSessionDidNotAcceptRequiredCopy(describe))
      }
      seams.emitNotice?.(cloudSessionDidNotAcceptOptionalCopy(describe))
    }
  }
}

/**
 * leftover `tn.initializeWorker` @202378433 BODY wrap.
 * CALL logRemoteHeadlessClientWorkerInitialize + took/not-answered copies.
 */
export function initializeHeadlessCloudWorker(
  session: {
    entry: 'create' | 'attach'
    initialPrompt?: unknown
    workerAwaitsAnswer?: boolean
  },
  manager: HeadlessWorkerManager,
  seams: {
    hostDialogKinds?: Iterable<string>
    isOwnQuestionDialogKind?: (kind: string) => boolean
    clock?: HeadlessWorkerClock
    closing?: () => boolean
    holdLaterSendsBehind?: (work: Promise<void>) => void
  } = {},
): HeadlessWorkerInitializeReason | null {
  const supported = filterSupportedDialogKindsForInitialize(
    seams.hostDialogKinds ?? [],
    seams.isOwnQuestionDialogKind,
  )
  const reason = headlessWorkerInitializeReason(session, supported)
  if (reason === null) return null
  const clock = seams.clock ?? defaultClock
  const request = {
    subtype: 'initialize' as const,
    ...(supported.length > 0 && { supportedDialogKinds: supported }),
  }
  const startedAt = clock.now()
  const attempt = async (n: number): Promise<void> => {
    const abort = new AbortController()
    const posted = manager.postControlRequest(request, {
      answerExpected: false,
      background: true,
      timeoutMs: WORKER_INITIALIZE_TIMEOUT_MS,
      signal: abort.signal,
    })
    void posted.response.then(
      () => logHeadlessWorkerTookClientInitialize(reason),
      err => logHeadlessClientInitializeNotAnswered(reason, err),
    )
    const result = await posted.posted
    logRemoteHeadlessClientWorkerInitialize({
      reason,
      outcome: result.outcome,
      ...(result.cause !== undefined && { cause: result.cause }),
      ...(result.status !== undefined && { status: result.status }),
      attempt: n,
      nDialogKinds: supported.length,
    })
    if (result.outcome === 'accepted') return
    abort.abort()
    const delay = WORKER_INITIALIZE_RETRY_MS[n - 1]
    if (
      delay !== undefined &&
      isRetryableWorkerInitializePost(result) &&
      clock.now() - startedAt < WORKER_INITIALIZE_RETRY_WINDOW_MS
    ) {
      await new Promise<void>(resolve => {
        clock.setTimeout(resolve, delay)
      })
      if (!(seams.closing?.() ?? false)) return attempt(n + 1)
    }
  }
  const hold = seams.holdLaterSendsBehind ?? (work => void work)
  hold(attempt(1))
  return reason
}
