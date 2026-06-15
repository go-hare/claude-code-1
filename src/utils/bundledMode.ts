/**
 * Detects if the current runtime is Bun.
 * Returns true when:
 * - Running a JS file via the `bun` command
 * - Running a Bun-compiled standalone executable
 */
export function isRunningWithBun(): boolean {
  // https://bun.com/guides/util/detect-bun
  return process.versions.bun !== undefined
}

/**
 * Detects if running as a Bun-compiled standalone executable.
 * Bun reports compiled entrypoints differently across platforms/versions:
 * macOS/Linux builds may expose embedded files, while Windows builds can expose
 * a virtual entry path such as B:/~BUN/root/claude.exe with no embedded files.
 */
export function isInBundledMode(): boolean {
  if (typeof Bun === 'undefined') return false
  return (
    (Array.isArray(Bun.embeddedFiles) && Bun.embeddedFiles.length > 0) ||
    isBunCompiledVirtualPath(process.argv[1])
  )
}

export function isBunCompiledVirtualPath(value: string | undefined): boolean {
  if (!value) return false
  const normalized = value.replace(/\\/g, '/')
  return (
    normalized.startsWith('compiled://') ||
    /^[A-Za-z]:\/~BUN\//.test(normalized) ||
    normalized.includes('/~BUN/root/')
  )
}
