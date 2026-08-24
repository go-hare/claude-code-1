import { resolve, sep, win32 } from 'node:path'

/**
 * densable `Jw` — NT object-manager `\??\` / `/??/`.
 * Duplicated here: workflow-engine has zero core-layer runtime deps.
 */
export function isNtObjectNamespacePath(path: string): boolean {
  return /^[\\/]\?\?[\\/]/.test(path)
}

/**
 * densable `Dwe` — NT `\??\` including after win32.normalize when `??` remains.
 */
function isNtObjectNamespacePathNormalized(path: string): boolean {
  if (isNtObjectNamespacePath(path)) return true
  if (!path.includes('??')) return false
  return isNtObjectNamespacePath(win32.normalize(path))
}

/**
 * densable `su` — UNC-shaped or NT-object path.
 */
function isUncOrNtObjectPath(path: string): boolean {
  return /^[\\/]{2}/.test(path) || isNtObjectNamespacePathNormalized(path)
}

/**
 * densable workflow `s7t` gate: `su(e)||Jw(e)||bu(e)||bu(t)` (`bu` is densable stub false).
 */
export function isForbiddenWorkflowScriptPath(path: string): boolean {
  return (
    isUncOrNtObjectPath(path) ||
    isNtObjectNamespacePath(path) ||
    isNtObjectNamespacePathNormalized(path)
  )
}

/**
 * Determine whether target, after resolution, is within base (including equal to base).
 * Relative targets are resolved against base (does not depend on process.cwd).
 * Uses the `sep` boundary to avoid false prefix positives (e.g. `/foo` is not the parent of `/foobar`).
 */
export function containsPath(base: string, target: string): boolean {
  const resolvedBase = resolve(base)
  const resolvedTarget = resolve(resolvedBase, target)
  if (resolvedTarget === resolvedBase) return true
  return resolvedTarget.startsWith(resolvedBase + sep)
}

/**
 * Validate whether the named workflow name is a legal identifier (reject path traversal).
 * Rejects: path separators, null bytes, `.` / `..`.
 * Returns the sanitized name, or null for illegal.
 */
export function sanitizeWorkflowName(name: string): string | null {
  if (typeof name !== 'string' || name.length === 0) return null
  if (name.includes('/') || name.includes('\\')) return null
  if (name.includes('\0')) return null
  if (name === '.' || name === '..') return null
  return name
}
