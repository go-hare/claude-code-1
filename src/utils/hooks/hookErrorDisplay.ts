/**
 * Official 2.1.326 #53 & #249 (`Wm`, `wx`, `$W`, `HW` @318308740):
 * - When a Node.js or Python hook crashes with a stack trace, prefer the real
 *   error line (e.g. `TypeError: ...`, `SyntaxError: ...`, `ValueError: ...`)
 *   instead of the first stack-trace line (`file.js:42`, `Traceback ...`, `File "...", line N`).
 * - When expanded (Ctrl+O / verbose), show up to 10,000 characters of hook output.
 * - On PreToolUse exit code 127, explicitly state that the check may not have run.
 */

export const HOOK_ERROR_COLLAPSED_MAX_CHARS = 200
export const HOOK_ERROR_EXPANDED_MAX_CHARS = 10_000

export const HOOK_EXIT_127_PRETOOL_MESSAGE =
  'Exit 127, likely a missing program: The check may not have run. See /hooks.'

/**
 * Official 2.1.327 (#433): Distinguish a Stop hook that failed to run from
 * one that ran and reported a problem.
 */
export const STOP_HOOK_FAILED_HEADLINE = 'Stop hook failed'
export const STOP_HOOK_PROBLEM_HEADLINE = 'Stop hook reported a problem'

export function classifyStopHookErrorHeadline(opts: {
  failedToRun: boolean
  reason?: string
}): { headline: string; color: 'error' | 'warning' } {
  const isFailure =
    opts.failedToRun ||
    (typeof opts.reason === 'string' &&
      opts.reason.startsWith('Stop hook failed'))
  return isFailure
    ? { headline: STOP_HOOK_FAILED_HEADLINE, color: 'error' }
    : { headline: STOP_HOOK_PROBLEM_HEADLINE, color: 'warning' }
}

/**
 * Official 2.1.327 (#431): Format a clear user-facing error when a
 * UserPromptSubmit hook blocks a message sent while Claude works in a cloud
 * session.
 */
export function formatCloudUserPromptSubmitBlockError(
  blockingError: string | undefined,
): string {
  const detail = blockingError?.trim()
  return detail
    ? `UserPromptSubmit hook blocked this message: ${detail}`
    : 'UserPromptSubmit hook blocked this message.'
}

/**
 * Official 2.1.327 (#432): Collect user-visible error messages from failing
 * SessionEnd hooks (e.g. at `/clear` and `/resume`) or env hooks
 * (`CwdChanged`, `FileChanged`).
 */
export function formatOutsideReplHookFailures(
  hookEvent: 'SessionEnd' | 'CwdChanged' | 'FileChanged',
  results: ReadonlyArray<{
    command: string
    succeeded: boolean
    output: string
    cancelled?: boolean
  }>,
): string[] {
  const errors: string[] = []
  for (const r of results) {
    if (r.succeeded || r.cancelled) continue
    const detail = formatHookErrorOutput(r.output) || r.output.trim()
    errors.push(
      detail
        ? `${hookEvent} hook failed (${r.command}): ${detail}`
        : `${hookEvent} hook failed (${r.command})`,
    )
  }
  return errors
}

const STACK_TRACE_FIRST_LINE_RE =
  /^(?:\S+|(?:\/|[A-Za-z]:\\).*):\d+$|^Traceback \(most recent call last\):$|^File ".*", line \d+$/

const REAL_ERROR_LINE_RE = /^[\w.]*(?:Error|Exception)(?: \[\w+\])?(?::|\s*$)/

function stripExpectedSchemaSuffix(text: string): string {
  const marker = '\n\nExpected schema:'
  const idx = text.indexOf(marker)
  return (idx === -1 ? text : text.slice(0, idx)).trim()
}

function firstNonEmptyLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    if (line.trim().length > 0) {
      return line
    }
  }
  return text
}

/**
 * Format hook stderr/stdout for display (`Wm(stderr, stdout, verbose)`).
 * When `verbose` is true (Ctrl+O), returns up to 10,000 characters.
 * When `verbose` is false, returns a concise single-line summary that prefers
 * the real error line over a Node/Python stack-trace header line.
 */
export function formatHookErrorOutput(
  stderr?: string,
  stdout?: string,
  verbose = false,
): string {
  const raw = stderr?.trim() ? stderr : stdout?.trim() ? stdout : ''
  if (!raw) return ''
  const cleaned = stripExpectedSchemaSuffix(raw)
  if (!cleaned) return ''
  if (verbose) {
    return cleaned.length > HOOK_ERROR_EXPANDED_MAX_CHARS
      ? `${cleaned.slice(0, HOOK_ERROR_EXPANDED_MAX_CHARS)}…`
      : cleaned
  }
  const firstLine = firstNonEmptyLine(cleaned).trim()
  const lastColonIdx = firstLine.lastIndexOf(': ')
  const tail =
    lastColonIdx === -1 ? firstLine : firstLine.slice(lastColonIdx + 2).trim()
  const realErrorLine = STACK_TRACE_FIRST_LINE_RE.test(tail)
    ? cleaned
        .split(/\r?\n/)
        .map(line => line.trim())
        .findLast(line => REAL_ERROR_LINE_RE.test(line))
    : undefined
  const prefix =
    realErrorLine !== undefined && lastColonIdx !== -1
      ? firstLine.slice(0, lastColonIdx + 2)
      : ''
  const summary =
    realErrorLine === undefined ? firstLine : `${prefix}${realErrorLine}`
  return summary.length > HOOK_ERROR_COLLAPSED_MAX_CHARS
    ? `${summary.slice(0, HOOK_ERROR_COLLAPSED_MAX_CHARS)}…`
    : summary
}
