/**
 * densable `cku` — startup cwd probe. ENOENT (deleted/moved) gets a
 * dedicated message; any other `process.cwd()` failure includes the
 * errno when present.
 */
export function getStartupCwdError(): string | undefined {
  try {
    process.cwd()
    return
  } catch (e) {
    const code =
      e instanceof Error && 'code' in e && typeof e.code === 'string'
        ? e.code
        : undefined
    if (code === 'ENOENT') {
      return 'The current directory no longer exists (it was deleted or moved). Start Claude Code from an existing directory.'
    }
    return `Can't read the current directory${code ? ` (${code})` : ''}. Start Claude Code from a different directory.`
  }
}
