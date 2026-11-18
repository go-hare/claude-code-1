/**
 * densable 2.1.224 Y2h / jjv — post failure-result to worker events after
 * child crash / setup failure, with session-gone / epoch-stale classification.
 */
import { randomUUID } from 'node:crypto'
import stripAnsi from 'strip-ansi'
import {
  RepositoryAccessError,
  type RepositoryAccessInfo,
  type RepositoryDenial,
} from './gitPrepare.js'
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

const REPO_NAME_SEGMENT_RE = /^(?!\.{1,2}$)[a-zA-Z0-9._-]+$/
const REPO_NAME_MAX_LEN = 200

export function isSafeRepoDisplayName(repo: string): boolean {
  return (
    repo.length <= REPO_NAME_MAX_LEN &&
    repo.split('/').every(seg => REPO_NAME_SEGMENT_RE.test(seg)) &&
    truncateSessionErrorText(repo) === repo
  )
}

/** densable `xf` */
export function formatRepoNotFoundHint(repo: string): string {
  const display = isSafeRepoDisplayName(repo)
    ? repo
    : "one of this session's repositories (the output below may show which)"
  return `This runner couldn't read ${display}. Either it doesn't exist or this runner can't access it. If it's the wrong repository, start a new session with the right one. If it's the right one, ask the team that manages your runners to check that the runners can access it. Once that's fixed, start a new session.`
}

/** densable `wu` */
export function repositoryAccessDenialFromError(err: unknown):
  | {
      denial: RepositoryDenial
      error: RepositoryAccessError
      repository: RepositoryAccessInfo
    }
  | undefined {
  if (!(err instanceof RepositoryAccessError) || err.denial === undefined) {
    return undefined
  }
  return {
    denial: err.denial,
    error: err,
    repository: err.repository,
  }
}

/** densable `vu` */
export function insteadOfRetryHintFromError(err: unknown): string | undefined {
  const info = repositoryAccessDenialFromError(err)
  return info?.denial === 'repo_not_found_or_no_permission'
    ? formatRepoNotFoundHint(info.repository.repo)
    : undefined
}

/**
 * densable `jjv` — synthetic assistant + result events for failure post.
 */
export function buildFailureWorkerEvents(
  exitCode: number | null,
  stderrTail: string,
  insteadOfRetryHint?: string,
): unknown[] {
  const hint =
    insteadOfRetryHint ??
    'You can try again by sending a new message or starting a new session.'
  let text = `The session process ${
    exitCode === null ? 'failed to start' : `exited with code ${exitCode}`
  }. ${hint}`
  if (stderrTail.trim().length > 0) {
    // Official lc(QHe(s)): strip ANSI and C0/C1 control chars before slicing tail.
    const clean = stripAnsi(stderrTail).replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional strip of C0/C1
      /[\x00-\x08\x0E-\x1F\x7F-\x9F]/g,
      '',
    )
    const s =
      clean.length > FAILURE_STDERR_TAIL_MAX
        ? `…${clean.slice(-FAILURE_STDERR_TAIL_MAX)}`
        : clean
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
  insteadOfRetryHint?: string
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
    insteadOfRetryHint,
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
  const events = buildFailureWorkerEvents(
    exitCode,
    stderrTail,
    insteadOfRetryHint,
  )
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
