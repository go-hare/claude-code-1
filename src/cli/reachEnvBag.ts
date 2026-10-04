/**
 * densable 2.1.283 leftover gold `SSn` @202277244 + `_Sn` @202276620.
 *
 * Env merge over pinnedScopes / everInReach / stickyRoots.
 * `_g` settings.read only — no settings.set.
 * `_Sn` is CLAUDE_CODE_SHELL_PREFIX trim (not Dt omit+startsWith("/")).
 */

import {
  SETTING_SOURCES,
  type SettingSource,
} from '../utils/settings/constants.js'
import { getSettingsForSource } from '../utils/settings/settings.js'
import { isPlaceableAbsolutePath } from './extraReach.js'

/** gold leftover unique `q9e` / `yS` — project+local stay out of reach env merge. */
const PROJECT_LOCAL_SCOPES = new Set<SettingSource>([
  'projectSettings',
  'localSettings',
])

export type ReachEnvMemory = {
  pinnedScopes: Set<string>
  everInReach: Set<string>
  stickyRoots: Set<string>
}

export type LegacyConfigFileEnv = {
  path: string
  real: string | null | 'unresolvable'
  env?: Record<string, string>
}

/**
 * gold `_Sn` @202276620 —
 * `e.CLAUDE_CODE_SHELL_PREFIX?.trim()||void 0`.
 * Contrast leftover unique `Dt` @202166718 (omit + startsWith("/")) — do not merge.
 */
export function reachEnvShellPrefix(env: {
  CLAUDE_CODE_SHELL_PREFIX?: string | undefined
}): string | undefined {
  return env.CLAUDE_CODE_SHELL_PREFIX?.trim() || undefined
}

/** gold leftover unique `mn` sticky/pinned/everInReach fields used by `SSn`. */
export function emptyReachMemory(): ReachEnvMemory {
  return {
    pinnedScopes: new Set(),
    everInReach: new Set(),
    stickyRoots: new Set(),
  }
}

/**
 * gold leftover unique `SSn` pin predicate —
 * pinnedScopes, or userSettings∧everInReach user, or flagSettings∧everInReach flag.
 */
export function isReachEnvScopePinned(
  memory: ReachEnvMemory,
  scope: string,
): boolean {
  return (
    memory.pinnedScopes.has(scope) ||
    (scope === 'userSettings' && memory.everInReach.has('user')) ||
    (scope === 'flagSettings' && memory.everInReach.has('flag'))
  )
}

/**
 * gold leftover unique `g_` @181399696 — some/some overlap of path vs stickyRoots.
 */
export function stickyRootsOverlap(
  paths: string[],
  stickyRoots: Iterable<string>,
): boolean {
  const roots = [...stickyRoots]
  return paths.some(path =>
    roots.some(
      root => path === root || path.startsWith(root) || root.startsWith(path),
    ),
  )
}

function readScopeEnvDefault(
  scope: SettingSource,
): Record<string, string> | undefined {
  return getSettingsForSource(scope)?.env
}

/**
 * gold leftover unique `SSn` @202277244 — merge leftover unique env from
 * unpinned non-project/local scopes, plus leftover unique config env when
 * real is a string, path is placeable, and not in stickyRoots.
 */
export function mergeReachEnv(
  memory: ReachEnvMemory,
  legacy: LegacyConfigFileEnv,
  readScopeEnv: (
    scope: SettingSource,
  ) => Record<string, string> | undefined = readScopeEnvDefault,
): Record<string, string> {
  const includeLegacy =
    legacy.env !== undefined &&
    typeof legacy.real === 'string' &&
    legacy.real !== 'unresolvable' &&
    isPlaceableAbsolutePath(legacy.path) &&
    !stickyRootsOverlap([legacy.path, legacy.real], memory.stickyRoots)
  return Object.assign(
    {},
    includeLegacy ? legacy.env : {},
    ...SETTING_SOURCES.filter(
      scope =>
        !PROJECT_LOCAL_SCOPES.has(scope) &&
        !isReachEnvScopePinned(memory, scope),
    ).map(scope => readScopeEnv(scope) ?? {}),
  )
}
