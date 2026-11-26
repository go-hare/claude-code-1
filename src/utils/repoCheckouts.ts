/**
 * Official Dxi / hSc / ySc portable subset — multi-checkout map from
 * CLAUDE_CODE_REPO_CHECKOUTS (JSON object label → absolute path).
 *
 * Used by host-managed multi-repo sessions so branch/visibility enrichment
 * can label paths by checkout name. Default: single "" → cwd.
 */

import { sep } from 'path'
import { getCwd } from './cwd.js'
import { logForDebugging } from './debug.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

/** Official 2.1.331 [W-11] — per-host multi-checkout and base-ref caches. */
type RepoCheckoutsHostState = {
  cached: Map<string, string> | null
  cachedBaseRefs: Map<string, string> | null
}

const repoCheckoutsHostSlot = new HostSlot<RepoCheckoutsHostState>(() => ({
  cached: null,
  cachedBaseRefs: null,
}))

function getRepoCheckoutsHostState(): RepoCheckoutsHostState {
  return repoCheckoutsHostSlot.of(getBootstrapSessionHost())
}

/** Official hSc — parse JSON env map of string→string. */
export function parseEnvPathMap(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>()
  if (!raw) return out
  try {
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string' && v.length > 0) out.set(k, v)
      }
    }
  } catch (e) {
    logForDebugging(
      `[repo-checkouts] Failed to parse env map: ${e instanceof Error ? e.message : String(e)}`,
      { level: 'error' },
    )
  }
  return out
}

/**
 * Official Dxi — label → absolute checkout path.
 * Default single entry "" → cwd when env unset.
 */
export function getRepoCheckouts(
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = getCwd(),
): Map<string, string> {
  const hostState = getRepoCheckoutsHostState()
  if (hostState.cached) return hostState.cached
  const raw = env.CLAUDE_CODE_REPO_CHECKOUTS
  if (!raw) {
    hostState.cached = new Map([['', cwd]])
    return hostState.cached
  }
  hostState.cached = parseEnvPathMap(raw)
  if (hostState.cached.size === 0) hostState.cached = new Map([['', cwd]])
  return hostState.cached
}

/** Official gSc — CLAUDE_CODE_BASE_REFS label → ref. */
export function getBaseRefs(
  env: NodeJS.ProcessEnv = process.env,
): Map<string, string> {
  const hostState = getRepoCheckoutsHostState()
  if (hostState.cachedBaseRefs) return hostState.cachedBaseRefs
  hostState.cachedBaseRefs = parseEnvPathMap(env.CLAUDE_CODE_BASE_REFS)
  return hostState.cachedBaseRefs
}

/**
 * Official ySc — which checkout label owns `path` (exact or prefix).
 */
export function getRepoCheckoutLabelForPath(
  filePath: string,
  checkouts: Map<string, string> = getRepoCheckouts(),
): string | undefined {
  for (const [label, root] of checkouts) {
    if (filePath === root || filePath.startsWith(root + sep)) return label
  }
  return undefined
}

/** Test / re-read env after mutation. */
export function clearRepoCheckoutCaches(): void {
  const hostState = getRepoCheckoutsHostState()
  hostState.cached = null
  hostState.cachedBaseRefs = null
}
