import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { errorMessage } from '../utils/errors.js'
import { BridgeFatalError } from './bridgeApi.js'
import type { BridgeApiClient, BridgeConfig } from './types.js'

/** Official `Pt` — max in-place remints after poll 404. */
export const MAX_ENV_REREGISTER_ATTEMPTS = 3

/** Official `er` — max pending reconnect retries after remint. */
export const MAX_PENDING_REQUEUE_ATTEMPTS = 5

export type ReregisterResult =
  | {
      outcome: 'reregistered'
      environmentSecret: string
      pendingRequeues: string[]
    }
  | { outcome: 'transient'; retryAfterMs?: number }
  | { outcome: 'fatal' }

/**
 * Official `It` — environment is gone (404/410 or "environment … not found").
 */
export function isEnvironmentGone(err: unknown): boolean {
  if (err instanceof BridgeFatalError) {
    return err.status === 404 || err.status === 410
  }
  return /environment .* not found/i.test(errorMessage(err))
}

/**
 * Official `gn` — client rejected the request (do not retry).
 * Every `BridgeFatalError` is rejected; other objects retry only when status
 * is 4xx except 408/429.
 */
export function isClientReject(err: unknown): boolean {
  if (err instanceof BridgeFatalError) {
    return true
  }
  if (
    err &&
    typeof err === 'object' &&
    'status' in err &&
    typeof err.status === 'number'
  ) {
    return (
      err.status >= 400 &&
      err.status < 500 &&
      err.status !== 408 &&
      err.status !== 429
    )
  }
  return false
}

/** Official `Li`. */
export function retryAfterMs(err: unknown): number | undefined {
  if (
    err &&
    typeof err === 'object' &&
    'retryAfterMs' in err &&
    typeof (err as { retryAfterMs: unknown }).retryAfterMs === 'number'
  ) {
    return (err as { retryAfterMs: number }).retryAfterMs
  }
  return undefined
}

/** Official `ar` — append reconnect hint to an expiry status line. */
export function formatExpiredReconnectMessage(message: string): string {
  return `${message.replace(/[.!?]?\s*$/, '.')} Re-run \`claude remote-control\` to reconnect.`
}

/**
 * Official `yt` / `ht` copy when poll 404/410 is fatal after crashed sessions.
 */
export function formatOfflineCleanupMessages(opts: {
  crashedSessionCount: number
  keptWorktreePaths: readonly string[]
}): string[] {
  const { crashedSessionCount, keptWorktreePaths } = opts
  const lines = [
    crashedSessionCount > 0
      ? `${crashedSessionCount} ${pluralize(crashedSessionCount, 'session')} ended while this machine was offline — the environment was cleaned up on the server and can't be resumed.`
      : "This environment was cleaned up while the machine was offline and can't be resumed.",
  ]
  if (keptWorktreePaths.length > 0) {
    lines.push(
      `Your work is safe — worktrees kept: ${[...keptWorktreePaths].join(', ')}`,
    )
  }
  lines.push('Run `claude remote-control` to start a fresh environment.')
  return lines
}

/** Official `ht(count, word)`. */
function pluralize(count: number, word: string): string {
  return count === 1 ? word : `${word}s`
}

function envReregisterOutcome(
  outcome: string,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

/**
 * Official `tr` — reconnect one session after remint.
 * Rejected / abort → `"done"` (do not spin). Transient → `"retry"`.
 */
export async function reconnectAfterReregister(
  api: BridgeApiClient,
  environmentId: string,
  sessionId: string,
  signal: AbortSignal,
): Promise<'done' | 'retry'> {
  try {
    await api.reconnectSession(environmentId, sessionId, signal)
    return 'done'
  } catch (err) {
    const rejected = isClientReject(err)
    logForDebugging(
      `[bridge:poll] reconnectSession(${sessionId}) after re-registration ${rejected ? 'rejected' : 'failed transiently'}: ${errorMessage(err)}`,
      { level: 'warn' },
    )
    return rejected || signal.aborted ? 'done' : 'retry'
  }
}

/**
 * Official `pn` — remint the same environment_id and re-queue active sessions.
 */
export async function reregisterEnvironment({
  api,
  config,
  environmentId,
  activeSessions,
  attempt,
  signal,
}: {
  api: BridgeApiClient
  config: BridgeConfig
  environmentId: string
  activeSessions: { keys(): IterableIterator<string>; has(id: string): boolean }
  attempt: number
  signal: AbortSignal
}): Promise<ReregisterResult> {
  logForDebugging(
    `[bridge:poll] Poll returned 404; re-registering environment ${environmentId} (attempt ${attempt}/${MAX_ENV_REREGISTER_ATTEMPTS})`,
    { level: 'warn' },
  )

  let registered: { environment_id: string; environment_secret: string }
  try {
    registered = await api.registerBridgeEnvironment(
      { ...config, reuseEnvironmentId: environmentId },
      signal,
    )
  } catch (err) {
    const rejected = isClientReject(err)
    logForDebugging(
      `[bridge:poll] Re-registration of ${environmentId} ${rejected ? 'rejected' : 'failed transiently'}: ${errorMessage(err)}`,
      { level: rejected ? 'error' : 'warn' },
    )
    if (signal.aborted) {
      return { outcome: 'transient' }
    }
    logEvent('tengu_bridge_env_reregister', {
      attempt,
      outcome: envReregisterOutcome(
        rejected ? 'register_rejected' : 'register_transient',
      ),
    })
    if (rejected) {
      logForDiagnosticsNoPII('error', 'bridge_env_reregister', {
        outcome: 'register_rejected',
      })
      return { outcome: 'fatal' }
    }
    return { outcome: 'transient', retryAfterMs: retryAfterMs(err) }
  }

  if (registered.environment_id !== environmentId) {
    logForDebugging(
      `[bridge:poll] Re-registration returned ${registered.environment_id}, not ${environmentId}; sessions attached to ${environmentId} cannot be reconnected`,
      { level: 'warn' },
    )
    logEvent('tengu_bridge_env_reregister', {
      attempt,
      outcome: envReregisterOutcome('replaced'),
    })
    logForDiagnosticsNoPII('error', 'bridge_env_reregister', {
      outcome: 'replaced',
    })
    await api
      .deregisterEnvironment(registered.environment_id)
      .catch((err: unknown) =>
        logForDebugging(
          `[bridge:poll] Failed to delete replacement environment ${registered.environment_id}: ${errorMessage(err)}`,
          { level: 'warn' },
        ),
      )
    return { outcome: 'fatal' }
  }

  const sessionIds = [...activeSessions.keys()]
  logEvent('tengu_bridge_env_reregister', {
    attempt,
    outcome: envReregisterOutcome('reregistered'),
    active_sessions: sessionIds.length,
  })
  logForDiagnosticsNoPII('info', 'bridge_env_reregistered', {
    attempt,
    active_sessions: sessionIds.length,
  })
  logForDebugging(
    `[bridge:poll] Environment ${environmentId} re-registered in place; re-queuing ${sessionIds.length} session(s)`,
    { level: 'info' },
  )

  const pendingRequeues: string[] = []
  for (const sessionId of sessionIds) {
    if (signal.aborted) {
      break
    }
    if (!activeSessions.has(sessionId)) {
      continue
    }
    if (
      (await reconnectAfterReregister(
        api,
        environmentId,
        sessionId,
        signal,
      )) === 'retry'
    ) {
      pendingRequeues.push(sessionId)
    }
  }
  return {
    outcome: 'reregistered',
    environmentSecret: registered.environment_secret,
    pendingRequeues,
  }
}

/**
 * Official `u` — drain leftover reconnects after a successful poll.
 */
export async function drainPendingRequeues({
  pendingRequeues,
  activeSessions,
  api,
  environmentId,
  signal,
}: {
  pendingRequeues: Map<string, number>
  activeSessions: { has(id: string): boolean }
  api: BridgeApiClient
  environmentId: string
  signal: AbortSignal
}): Promise<void> {
  for (const [sessionId, attempts] of pendingRequeues) {
    if (signal.aborted) {
      return
    }
    if (!activeSessions.has(sessionId)) {
      pendingRequeues.delete(sessionId)
      continue
    }
    if (
      (await reconnectAfterReregister(
        api,
        environmentId,
        sessionId,
        signal,
      )) === 'done'
    ) {
      pendingRequeues.delete(sessionId)
    } else if (attempts + 1 >= MAX_PENDING_REQUEUE_ATTEMPTS) {
      pendingRequeues.delete(sessionId)
      logForDebugging(
        `[bridge:poll] Giving up re-queuing sessionId=${sessionId} after ${MAX_PENDING_REQUEUE_ATTEMPTS} attempts; left to token refresh`,
        { level: 'warn' },
      )
      logEvent('tengu_bridge_env_reregister', {
        requeue_attempts: attempts + 1,
        outcome: envReregisterOutcome('requeue_dropped'),
      })
      logForDiagnosticsNoPII('warn', 'bridge_env_reregister', {
        outcome: 'requeue_dropped',
      })
    } else {
      pendingRequeues.set(sessionId, attempts + 1)
    }
  }
}
