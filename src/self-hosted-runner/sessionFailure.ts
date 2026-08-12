/**
 * densable 2.1.224 Y2h / jjv — post failure-result to worker events after
 * child crash / setup failure, with session-gone / epoch-stale classification.
 */
import { randomUUID } from 'node:crypto'
import type { SelfHostedRunnerApi } from './runnerApi.js'
import { truncateSessionErrorText } from './sessionText.js'

/** densable `U2h` — stderr tail cap in failure assistant message */
export const FAILURE_STDERR_TAIL_MAX = 2_000

/**
 * densable placeholder model id for synthetic failure assistant messages.
 * SEA binds `rw` — exact string not needed for wire shape; keep stable.
 */
const FAILURE_ASSISTANT_MODEL = 'claude-sonnet-4-20250514'

/** densable `QJl` */
export function isNotFoundRunnerError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'isNotFound' in err &&
    (err as { isNotFound?: boolean }).isNotFound === true
  )
}

/** densable `ujv` */
export function isSessionNotActiveRunnerError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'isSessionNotActive' in err &&
    (err as { isSessionNotActive?: boolean }).isSessionNotActive === true
  )
}

/** densable `YJl` — session gone (404 not found OR 409 session_not_active) */
export function isSessionGoneRunnerError(err: unknown): boolean {
  return isNotFoundRunnerError(err) || isSessionNotActiveRunnerError(err)
}

/** densable `AKn` */
export function isEpochMismatchRunnerError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'isEpochMismatch' in err &&
    (err as { isEpochMismatch?: boolean }).isEpochMismatch === true
  )
}

/**
 * densable `Ze` — stdin control_request line telling child to end after server session gone.
 * densable builds via `Ie(…)+\\n` (JSON.stringify).
 */
export function buildSessionGoneEndSessionLine(sessionId: string): string {
  return (
    JSON.stringify({
      type: 'control_request',
      request_id: `runner-session-gone-${sessionId}`,
      request: {
        subtype: 'end_session',
        reason: 'session_not_found',
      },
    }) + '\n'
  )
}

/**
 * densable `$e` — if err is session-gone (YJl), once-only notify child via end_session.
 * Returns true when gone (caller should cancel refresh loops).
 */
export function notifyChildSessionGone(opts: {
  err: unknown
  source: string
  sessionId: string
  alreadySent: boolean
  endSessionLine: string
  write?: ((line: string) => void) | null
  onStatus: (msg: string) => void
}): { gone: boolean; sent: boolean } {
  if (!isSessionGoneRunnerError(opts.err)) {
    return { gone: false, sent: opts.alreadySent }
  }
  if (opts.alreadySent) {
    return { gone: true, sent: true }
  }
  opts.onStatus(
    `[runner:session] ${opts.sessionId} ${opts.source} says session gone server-side — sending end_session to child`,
  )
  opts.write?.(opts.endSessionLine)
  return { gone: true, sent: true }
}

/**
 * densable `jjv` — synthetic assistant + result events for failure post.
 */
export function buildFailureWorkerEvents(
  exitCode: number | null,
  stderrTail: string,
): unknown[] {
  let text = `The session process ${
    exitCode === null ? 'failed to start' : `exited with code ${exitCode}`
  }. You can try again by sending a new message or starting a new session.`
  if (stderrTail.trim().length > 0) {
    const s =
      stderrTail.length > FAILURE_STDERR_TAIL_MAX
        ? `…${stderrTail.slice(-FAILURE_STDERR_TAIL_MAX)}`
        : stderrTail
    text += `\n\nLast output before exit:\n${s}`
  }
  const assistant = {
    type: 'assistant',
    uuid: randomUUID(),
    message: {
      role: 'assistant',
      model: FAILURE_ASSISTANT_MODEL,
      content: [{ type: 'text', text }],
      stop_reason: 'stop_sequence',
      usage: { input_tokens: 0, output_tokens: 0 },
    },
    parent_tool_use_id: null,
    isApiErrorMessage: true,
  }
  const result = {
    type: 'result',
    uuid: randomUUID(),
    subtype: 'error_during_execution',
    is_error: true,
    duration_ms: 0,
    duration_api_ms: 0,
    num_turns: 0,
    total_cost_usd: 0,
    errors: [text],
    modelUsage: {},
    permission_denials: [],
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  }
  return [assistant, result]
}

export type PostFailureResult =
  | 'posted'
  | 'session_gone'
  | 'epoch_stale'
  | 'post_failed'
  | 'skipped'

export type PostFailureResultOpts = {
  apiClient: Pick<SelfHostedRunnerApi, 'postWorkerEvents'>
  apiBaseUrl: string
  sessionId: string
  sessionToken: string
  workerEpoch: number
  exitCode: number | null
  stderrTail: string
  onDebug: (msg: string) => void
  onStatus: (msg: string) => void
  signal: AbortSignal
  /** inject sleep for tests */
  sleepMs?: (ms: number, signal: AbortSignal) => Promise<void>
}

async function defaultSleep(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms)
    const onAbort = (): void => {
      clearTimeout(t)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * densable `Y2h` — post failure result once, retry after 2s on transient error.
 */
export async function postSessionFailureResult(
  opts: PostFailureResultOpts,
): Promise<PostFailureResult> {
  const {
    apiClient,
    apiBaseUrl,
    sessionId,
    sessionToken,
    workerEpoch,
    exitCode,
    stderrTail,
    onDebug,
    onStatus,
    signal,
  } = opts
  if (signal.aborted) {
    onDebug(
      `[runner:session] Skipping failure-result post for ${sessionId} — session was deliberately aborted`,
    )
    return 'skipped'
  }
  const sleep = opts.sleepMs ?? defaultSleep
  const events = buildFailureWorkerEvents(exitCode, stderrTail)
  const once = (): Promise<void> =>
    apiClient.postWorkerEvents(
      apiBaseUrl,
      sessionId,
      sessionToken,
      workerEpoch,
      events,
      signal,
    )
  try {
    await once()
    onDebug(
      `[runner:session] Posted failure result for ${sessionId} (exitCode=${exitCode})`,
    )
    return 'posted'
  } catch (err) {
    if (isSessionGoneRunnerError(err)) {
      onDebug(
        `[runner:session] failure-result rejected (session gone) — ${sessionId} is archived or deleted server-side`,
      )
      return 'session_gone'
    }
    if (isEpochMismatchRunnerError(err)) {
      onDebug(
        `[runner:session] failure-result rejected (stale epoch) — another runner has taken over ${sessionId}. This process was the orphan.`,
      )
      return 'epoch_stale'
    }
    const f = truncateSessionErrorText(
      err instanceof Error ? err.message : String(err),
    )
    onStatus(
      `[runner:stuck] Failed to post failure-result for ${sessionId} (attempt 1): ${f} — retrying in 2s`,
    )
    await sleep(2000, signal)
  }
  try {
    await once()
    onDebug(
      `[runner:session] Posted failure result for ${sessionId} on retry (exitCode=${exitCode})`,
    )
    return 'posted'
  } catch (err) {
    if (isSessionGoneRunnerError(err)) {
      onDebug(
        `[runner:session] failure-result rejected (session gone on retry) — ${sessionId} is archived or deleted server-side`,
      )
      return 'session_gone'
    }
    if (isEpochMismatchRunnerError(err)) {
      onDebug(
        `[runner:session] failure-result rejected (stale epoch on retry) — another runner has taken over ${sessionId}. This process was the orphan.`,
      )
      return 'epoch_stale'
    }
    const f = truncateSessionErrorText(
      err instanceof Error ? err.message : String(err),
    )
    onStatus(
      `[runner:stuck] Failed to post failure-result for ${sessionId} after retry: ${f} — UI spinner may not stop`,
    )
    return 'post_failed'
  }
}
