/**
 * densable 2.1.243 #35 — keep sandbox violation details on Bash *success*
 * when the blocked command still exits 0 (e.g. curl printing a proxy 403).
 */

/** Official `_e.slice(Ce.length).trim()` when annotate appended a block. */
export function extractSandboxViolationSuffix(
  originalStdout: string,
  annotated: string,
): string {
  return annotated !== originalStdout
    ? annotated.slice(originalStdout.length).trim()
    : ''
}

/**
 * Official success stderr: `f ? [p, f].filter(Boolean).join(EOL) : p`
 * `p` = cwd-reset line, `f` = violation suffix.
 */
export function mergeBashStderr(
  cwdReset: string,
  violationSuffix: string,
  eol = '\n',
): string {
  return violationSuffix
    ? [cwdReset, violationSuffix].filter(Boolean).join(eol)
    : cwdReset
}
