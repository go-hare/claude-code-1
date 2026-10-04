/**
 * densable 2.1.283 leftover unique wrap for remote create-session failure.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * gold `Pn` @200204633 (`async function Pn(e,n,s,r)`).
 * gold `vt` = 2000 clip in the same chunk as Pn.
 * gold `Ms` = logEvent; gold `gn` = tengu_feature_bad.
 *
 * Semantic English exports only; minify names stay in comments.
 * Do not import cloudSession.ts (private gn + cycle). Same unable-string as
 * UNABLE_TO_CREATE_CLOUD_SESSION_ERROR there.
 */
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'

/** gold `vt` @200196582 — Pn message clip. */
const CREATE_SESSION_ERROR_CLIP = 2000

/**
 * Same copy as cloudSession `UNABLE_TO_CREATE_CLOUD_SESSION_ERROR`.
 * Duplicated so this module does not load that host.
 */
export const UNABLE_TO_CREATE_CLOUD_SESSION_ERROR =
  'Error: Unable to create cloud session'

export type RemoteCreateSessionFail = {
  message: string
  reason?: string
  detail?: {
    endpoint?: string
    serverReason?: string
    preflightTransient?: boolean
  }
}

export type RemoteCreateSessionFailed = {
  kind: 'failed'
  message: string
}

function verified(
  value: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return value as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

function clipCreateErrorMessage(message: string): string {
  return message.length > CREATE_SESSION_ERROR_CLIP
    ? message.slice(0, CREATE_SESSION_ERROR_CLIP)
    : message
}

/**
 * gold `Pn` @200204633 — tengu_remote_create_session_error, then gn unless aborted.
 */
export async function reportRemoteCreateSessionError(opts: {
  aborted: boolean
  fail?: RemoteCreateSessionFail
  branchMode: string
  entryPoint: string
}): Promise<RemoteCreateSessionFailed> {
  const fail = opts.fail
  await logEvent('tengu_remote_create_session_error', {
    error: opts.aborted
      ? verified('aborted')
      : fail
        ? verified(fail.reason ?? '')
        : verified('unknown'),
    entry_point: verified(opts.entryPoint),
    branch_mode: verified(opts.branchMode),
    ...(fail?.detail?.endpoint && {
      create_endpoint: verified(fail.detail.endpoint),
    }),
    ...(fail?.detail?.serverReason && {
      server_reason: verified(fail.detail.serverReason),
    }),
    ...(fail?.detail?.preflightTransient !== undefined && {
      deny_transient: verified(
        fail.detail.preflightTransient ? 'true' : 'false',
      ),
    }),
  })
  if (!opts.aborted) {
    // gold `gn("remote_headless_session","create_failed")` — logEvent, not cloudSession gn.
    logEvent('tengu_feature_bad', {
      feature_name: verified('remote_headless_session'),
      error_code: verified('create_failed'),
    })
  }
  return {
    kind: 'failed',
    message: fail
      ? `Error: ${clipCreateErrorMessage(fail.message)}`
      : UNABLE_TO_CREATE_CLOUD_SESSION_ERROR,
  }
}
