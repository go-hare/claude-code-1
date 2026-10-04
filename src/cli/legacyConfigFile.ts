/**
 * densable 2.1.283 leftover gold `Zgt` @202277137 + `Ni`/`Mi` @202276699.
 *
 * `bag.legacyConfigFile ??= locate(path, env)`, then `refreshIfDue`.
 * Seams for path / env / realpath. No settings.set.
 */

/** gold leftover unique `bo` @202276686 */
export const LEGACY_CONFIG_RETRY_MS = 30_000

export type LegacyConfigFileCache = {
  path: string
  real: string | null | 'unresolvable'
  env?: Record<string, string>
  retryAt?: number
  locate?: () => void
}

export type LegacyConfigBag = {
  legacyConfigFile?: LegacyConfigFileCache
  /** gold leftover unique `ruo` @183429905 */
  legacyEnvPin?: Record<string, string> | null
}

export type LegacyConfigLocateReal = (path: string) => Promise<{
  real: string
  aliased: boolean
}>

/**
 * gold leftover unique `ruo` @183429905 —
 * `e.legacyEnvPin===void 0?n:e.legacyEnvPin??void 0`.
 */
export function pinnedLegacyEnv(
  bag: Pick<LegacyConfigBag, 'legacyEnvPin'>,
  fallback?: Record<string, string>,
): Record<string, string> | undefined {
  return bag.legacyEnvPin === undefined
    ? fallback
    : (bag.legacyEnvPin ?? undefined)
}

/**
 * gold leftover unique `Ni` @202276699 — locate realpath, retry 30000 on alias
 * or non-ENOENT/ENOTDIR.
 */
export function createLegacyConfigLocator(
  path: string,
  env: Record<string, string> | undefined,
  locateReal: LegacyConfigLocateReal,
): LegacyConfigFileCache {
  const cache: LegacyConfigFileCache = {
    path,
    real: null,
    ...(env !== undefined && { env: { ...env } }),
    locate() {
      cache.retryAt = undefined
      locateReal(path).then(
        ({ real, aliased }) => {
          cache.real = aliased ? 'unresolvable' : real
          if (aliased) cache.retryAt = Date.now() + LEGACY_CONFIG_RETRY_MS
        },
        (err: { code?: string }) => {
          cache.real = 'unresolvable'
          if (err?.code !== 'ENOENT' && err?.code !== 'ENOTDIR') {
            cache.retryAt = Date.now() + LEGACY_CONFIG_RETRY_MS
          }
        },
      )
    },
  }
  cache.locate()
  return cache
}

/**
 * gold leftover unique `Mi` @202277060 — retry locate when due.
 */
export function refreshLegacyConfigIfDue(
  cache: LegacyConfigFileCache,
  now = Date.now(),
): void {
  if (cache.retryAt !== undefined && now >= cache.retryAt) cache.locate?.()
}

/**
 * gold leftover unique `Zgt` @202277137 —
 * `e.legacyConfigFile ??= Ni(ca(), ruo(e, kK())); Mi(...); return cache`.
 */
export function legacyConfigFileCache(
  bag: LegacyConfigBag,
  seams: {
    path: string
    env?: Record<string, string>
    locateReal?: LegacyConfigLocateReal
    now?: () => number
  },
): LegacyConfigFileCache {
  bag.legacyConfigFile ??= createLegacyConfigLocator(
    seams.path,
    pinnedLegacyEnv(bag, seams.env),
    seams.locateReal ??
      (async (path: string) => ({ real: path, aliased: false })),
  )
  refreshLegacyConfigIfDue(bag.legacyConfigFile, seams.now?.() ?? Date.now())
  return bag.legacyConfigFile
}
