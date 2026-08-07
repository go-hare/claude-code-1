import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'

/**
 * densable `O5o` / `recordTipShown`:
 * - tipsHistory[id] = numStartups（同会话重复 show 不重复写）
 * - tipLifetimeShownCounts[id] += 1（仅在 tipsHistory 真正更新时 bump）
 */
export function recordTipShown(tipId: string): void {
  const numStartups = getGlobalConfig().numStartups
  saveGlobalConfig(c => {
    const history = c.tipsHistory ?? {}
    if (history[tipId] === numStartups) return c
    const lifetime = c.tipLifetimeShownCounts ?? {}
    return {
      ...c,
      tipsHistory: { ...history, [tipId]: numStartups },
      tipLifetimeShownCounts: {
        ...lifetime,
        [tipId]: (lifetime[tipId] ?? 0) + 1,
      },
    }
  })
}

/** densable `Svr` — lifetime show count for a tip id. */
export function getTipLifetimeShownCount(tipId: string): number {
  return getGlobalConfig().tipLifetimeShownCounts?.[tipId] ?? 0
}

export function getSessionsSinceLastShown(tipId: string): number {
  const config = getGlobalConfig()
  const lastShown = config.tipsHistory?.[tipId]
  if (!lastShown) return Infinity
  return config.numStartups - lastShown
}
