/**
 * densable pluginUsage helpers (vzn/vzc/IUr/WDt/F$/s4i).
 * Tracks last use so ManagePlugins can surface “Not used recently”.
 *
 * densable F$ is an in-process pending map (T6e) flushed every 60s and on
 * process exit — not a synchronous saveGlobalConfig per hit. s4i(id) is true
 * while a plugin has pending session use, so WDt/nRd treat days as 0.
 */
import {
  getGlobalConfig,
  saveGlobalConfig,
  type GlobalConfig,
} from '../config.js'
import { recordPluginActivity } from './pluginActivity.js'

export type PluginUsageEntry = {
  usageCount: number
  lastUsedAt: number
  lastUsedNumStartups: number
}

/** densable s1y / a1y */
export const DISUSE_MIN_DAYS = 14
export const DISUSE_MIN_SESSIONS = 10

/** densable F$ flush interval (60s). */
const PENDING_FLUSH_MS = 60_000

type PendingUse = { count: number; lastUsedAt: number }

/** densable T6e — session pending F$ map. */
const pendingUses = new Map<string, PendingUse>()
let flushTimer: ReturnType<typeof setTimeout> | null = null
let exitHookInstalled = false

function clearFlushTimer(): void {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
}

/** densable i4i — drain pending map + cancel timer. */
function drainPendingUses(): [string, PendingUse][] | null {
  clearFlushTimer()
  if (pendingUses.size === 0) return null
  const entries = [...pendingUses.entries()]
  pendingUses.clear()
  return entries
}

/**
 * densable Ezc: merge drained pending counts into GlobalConfig.pluginUsage.
 * Shared by timer flush and exit flush.
 */
function mergePendingIntoConfig(
  pending: [string, PendingUse][],
): (cfg: GlobalConfig) => GlobalConfig {
  return cfg => {
    const next = { ...cfg.pluginUsage }
    for (const [id, o] of pending) {
      const prev = next[id]
      next[id] = {
        usageCount: (prev?.usageCount ?? 0) + o.count,
        lastUsedAt: o.lastUsedAt,
        lastUsedNumStartups: cfg.numStartups,
      }
    }
    return { ...cfg, pluginUsage: next }
  }
}

/** densable Itg — timer flush via saveGlobalConfig. */
function flushPendingUses(): void {
  const drained = drainPendingUses()
  if (!drained) return
  saveGlobalConfig(mergePendingIntoConfig(drained))
}

/**
 * densable Htg — exit flush. Uses saveGlobalConfig (test + normal paths).
 * densable uses a sync write helper; local saveGlobalConfig is already
 * process-exit-safe enough for residual alignment.
 */
function flushPendingUsesAtExit(): void {
  const drained = drainPendingUses()
  if (!drained) return
  try {
    saveGlobalConfig(mergePendingIntoConfig(drained))
  } catch {
    // exit path: best-effort
  }
}

/** densable fzc — schedule 60s flush + install exit hook once. */
function schedulePendingFlush(): void {
  if (!exitHookInstalled) {
    exitHookInstalled = true
    process.on('exit', flushPendingUsesAtExit)
  }
  if (!flushTimer) {
    flushTimer = setTimeout(flushPendingUses, PENDING_FLUSH_MS)
    // densable: _7t.unref?.() — don't keep process alive for usage flush alone
    flushTimer.unref?.()
  }
}

/**
 * densable s4i — true when plugin has unflushed session use.
 * WDt skips these; nRd returns 0 (used today/this session).
 */
export function hasPendingPluginUse(pluginId: string): boolean {
  return pendingUses.has(pluginId)
}

/** Test helper: clear pending F$ map + timer without writing config. */
export function clearPendingPluginUsesForTests(): void {
  clearFlushTimer()
  pendingUses.clear()
}

/** Test helper: force flush pending into config. */
export function flushPendingPluginUsesForTests(): void {
  flushPendingUses()
}

/**
 * densable mzc: drop pending session uses whose ids match (case-insensitive).
 * Used by E7t before deleting durable pluginUsage keys.
 */
export function clearPendingPluginUsesMatching(pluginIds: string[]): void {
  if (pluginIds.length === 0 || pendingUses.size === 0) return
  const lower = new Set(pluginIds.map(id => id.toLowerCase()))
  for (const key of pendingUses.keys()) {
    if (lower.has(key.toLowerCase())) {
      pendingUses.delete(key)
    }
  }
  if (pendingUses.size === 0) {
    clearFlushTimer()
  }
}

/**
 * densable E7t: remove pluginUsage entries for uninstalled plugins and clear
 * matching T6e pending uses so WDt/nRd don't keep stale session hits.
 */
export function clearPluginUsage(pluginIds: string[]): void {
  if (pluginIds.length === 0) return
  clearPendingPluginUsesMatching(pluginIds)
  const lower = new Set(pluginIds.map(id => id.toLowerCase()))
  saveGlobalConfig(cfg => {
    const usage = cfg.pluginUsage
    if (!usage) return cfg
    const keys = Object.keys(usage).filter(k => lower.has(k.toLowerCase()))
    if (keys.length === 0) return cfg
    const next = { ...usage }
    for (const k of keys) {
      delete next[k]
    }
    return { ...cfg, pluginUsage: next }
  })
}

export function pluginUsageId(pluginId: string): string {
  return pluginId
}

export function getPluginUsageEntry(
  pluginId: string,
  cfg: GlobalConfig = getGlobalConfig(),
): PluginUsageEntry | undefined {
  return cfg.pluginUsage?.[pluginId]
}

export function usageAge(
  entry: PluginUsageEntry,
  numStartups: number = getGlobalConfig().numStartups,
  now: number = Date.now(),
): { sessionsSinceLastUse: number; daysSinceLastUse: number } {
  return {
    sessionsSinceLastUse: Math.max(0, numStartups - entry.lastUsedNumStartups),
    daysSinceLastUse: Math.max(
      0,
      Math.floor((now - entry.lastUsedAt) / 86_400_000),
    ),
  }
}

/**
 * densable nRd: days since last use for plugin detail “Last used:”.
 * Returns null under strictKnownMarketplaces or when no usage entry.
 * Returns 0 when pending session use (s4i).
 */
export function getPluginDaysSinceLastUse(
  pluginId: string,
  opts?: {
    cfg?: GlobalConfig
    now?: number
    /** densable mre(); pass true to skip (managed marketplace policy). */
    skipUnderStrictMarketplaces?: boolean
  },
): number | null {
  if (opts?.skipUnderStrictMarketplaces) return null
  if (hasPendingPluginUse(pluginId)) return 0
  const cfg = opts?.cfg ?? getGlobalConfig()
  const entry = cfg.pluginUsage?.[pluginId]
  if (!entry) return null
  return usageAge(entry, cfg.numStartups, opts?.now ?? Date.now())
    .daysSinceLastUse
}

/**
 * densable vzn: seed missing plugins with usageCount 0 at “now” so they are
 * not immediately treated as disused.
 */
export function seedPluginUsage(pluginIds: string[]): void {
  if (pluginIds.length === 0) return
  const now = Date.now()
  saveGlobalConfig(cfg => {
    const missing = pluginIds.filter(id => !cfg.pluginUsage?.[id])
    if (missing.length === 0) return cfg
    const next = { ...cfg.pluginUsage }
    for (const id of missing) {
      next[id] = {
        usageCount: 0,
        lastUsedAt: now,
        lastUsedNumStartups: cfg.numStartups,
      }
    }
    return { ...cfg, pluginUsage: next }
  })
}

/** densable vzc: bump lastUsedAt / startups for known plugins (no count++). */
export function touchPluginUsage(pluginIds: string[]): void {
  if (pluginIds.length === 0) return
  const now = Date.now()
  saveGlobalConfig(cfg => {
    const known = pluginIds.filter(id => cfg.pluginUsage?.[id])
    if (known.length === 0) return cfg
    const next = { ...cfg.pluginUsage }
    for (const id of known) {
      const prev = next[id]
      if (!prev) continue
      next[id] = {
        ...prev,
        lastUsedAt: now,
        lastUsedNumStartups: cfg.numStartups,
      }
    }
    return { ...cfg, pluginUsage: next }
  })
}

/**
 * densable F$: buffer a real use (count++ + lastUsedAt) in the session map,
 * then schedule a debounced flush. Does not write GlobalConfig immediately.
 */
export function recordPluginUse(pluginId: string): void {
  if (!pluginId) return
  const now = Date.now()
  const prev = pendingUses.get(pluginId)
  if (prev) {
    prev.count++
    prev.lastUsedAt = now
  } else {
    pendingUses.set(pluginId, { count: 1, lastUsedAt: now })
  }
  schedulePendingFlush()
}

/**
 * densable hook-batch F$: unique truthy pluginIds (order-stable via Set insertion).
 * Pure helper for executeHooks / executeHooksOutsideREPL call sites.
 */
export function uniquePluginIds(
  pluginIds: Iterable<string | undefined | null>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of pluginIds) {
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** densable: record once per unique pluginId in a batch (hooks). */
export function recordPluginUses(
  pluginIds: Iterable<string | undefined | null>,
): void {
  for (const id of uniquePluginIds(pluginIds)) {
    recordPluginUse(id)
    // densable sJ: batch path records once per unique id with trigger "hook"
    recordPluginActivity(id, 'hook')
  }
}

/**
 * densable Czc: one-shot grace for LSP-only plugins that have never been
 * “used” via skills/MCP/agents. Touches lastUsedAt without bumping usageCount,
 * once per pluginId (tracked in pluginUsageLspGraceAppliedIds).
 */
export function applyPluginUsageLspGrace(pluginIds: string[]): void {
  if (pluginIds.length === 0) return
  const now = Date.now()
  saveGlobalConfig(cfg => {
    const applied = new Set(cfg.pluginUsageLspGraceAppliedIds ?? [])
    const pending = pluginIds.filter(id => !applied.has(id))
    if (pending.length === 0) return cfg
    const next = { ...cfg.pluginUsage }
    for (const id of pending) {
      const prev = next[id]
      // densable: only grace never-used entries that already exist
      if (!prev || prev.usageCount > 0) {
        applied.add(id)
        continue
      }
      next[id] = {
        ...prev,
        lastUsedAt: now,
        lastUsedNumStartups: cfg.numStartups,
      }
      applied.add(id)
    }
    return {
      ...cfg,
      pluginUsage: next,
      pluginUsageLspGraceAppliedIds: [...applied],
    }
  })
}

export type DisusedPluginInfo = {
  pluginId: string
  daysSinceLastUse: number
}

/**
 * densable w2: marketplaces that are not user marketplace installs
 * (session --plugin-dir / skills-dir mounts). Never tip-disuse these.
 */
export function isEphemeralMarketplace(
  marketplace: string | undefined,
): boolean {
  return marketplace === 'inline' || marketplace === 'skills-dir'
}

/**
 * densable l1y: plugins that primarily ship non-skill surfaces (themes,
 * output styles, monitors, workflows). Local LoadedPlugin only has
 * outputStyles*; extra keys accepted for forward-compat with densable fields.
 */
export function hasNonUsageOnlySurfaces(plugin: {
  outputStylesPath?: string
  outputStylesPaths?: string[]
  themesPath?: string
  themesPaths?: string[]
  monitors?: unknown[]
  workflowsPath?: string
  workflowsPaths?: string[]
}): boolean {
  return Boolean(
    plugin.themesPath ||
      (plugin.themesPaths && plugin.themesPaths.length > 0) ||
      plugin.outputStylesPath ||
      (plugin.outputStylesPaths && plugin.outputStylesPaths.length > 0) ||
      (plugin.monitors && plugin.monitors.length > 0) ||
      plugin.workflowsPath ||
      (plugin.workflowsPaths && plugin.workflowsPaths.length > 0),
  )
}

/**
 * densable WDt core: enabled plugins with usage older than thresholds.
 * Optional include() applies densable marketplace / user-install / themes-only
 * filters (caller supplies policy); age thresholds always apply.
 */
export function listDisusedFromUsage(
  pluginIds: string[],
  opts?: {
    minDays?: number
    minSessions?: number
    cfg?: GlobalConfig
    now?: number
    /** densable WDt filters: return false to skip (marketplace/policy/themes). */
    include?: (pluginId: string) => boolean
  },
): DisusedPluginInfo[] {
  const cfg = opts?.cfg ?? getGlobalConfig()
  const now = opts?.now ?? Date.now()
  const minDays = opts?.minDays ?? DISUSE_MIN_DAYS
  const minSessions = opts?.minSessions ?? DISUSE_MIN_SESSIONS
  const out: DisusedPluginInfo[] = []
  for (const id of pluginIds) {
    if (opts?.include && !opts.include(id)) continue
    // densable WDt: if (s4i(s.repository)) continue
    if (hasPendingPluginUse(id)) continue
    const entry = cfg.pluginUsage?.[id]
    if (!entry) continue
    const { sessionsSinceLastUse, daysSinceLastUse } = usageAge(
      entry,
      cfg.numStartups,
      now,
    )
    if (daysSinceLastUse >= minDays && sessionsSinceLastUse >= minSessions) {
      out.push({ pluginId: id, daysSinceLastUse })
    }
  }
  out.sort((a, b) => b.daysSinceLastUse - a.daysSinceLastUse)
  return out
}

export type DisusedPluginTipInfo = DisusedPluginInfo & {
  name: string
}

/**
 * densable WDt (full tip path): enabled user-install marketplace plugins past
 * age thresholds. Returns [] when org strictKnownMarketplaces is set, when
 * plugin cache is cold, or on load failure.
 */
export async function listDisusedPluginsWDt(): Promise<DisusedPluginTipInfo[]> {
  try {
    // densable: if (!th.cache?.has(void 0)) return []
    const { loadAllPluginsCacheOnly } = await import('./pluginLoader.js')
    if (!loadAllPluginsCacheOnly.cache?.has(undefined)) {
      return []
    }
    const { getStrictKnownMarketplaces } = await import(
      './marketplaceHelpers.js'
    )
    // densable mre() !== null → skip tips under managed marketplace allowlist
    if (getStrictKnownMarketplaces() !== null) {
      return []
    }
    const { enabled } = await loadAllPluginsCacheOnly()
    if (enabled.length === 0) return []

    const { parsePluginIdentifier } = await import('./pluginIdentifier.js')
    const candidates = enabled.filter(p => {
      const { marketplace } = parsePluginIdentifier(p.repository)
      if (!marketplace || isEphemeralMarketplace(marketplace)) return false
      if (p.isBuiltin) return false
      if (hasNonUsageOnlySurfaces(p)) return false
      return true
    })
    const disused = listDisusedFromUsage(candidates.map(p => p.repository))
    const byRepo = new Map(candidates.map(p => [p.repository, p]))
    return disused
      .map(d => {
        const p = byRepo.get(d.pluginId)
        if (!p) return null
        return {
          pluginId: d.pluginId,
          name: p.name,
          daysSinceLastUse: d.daysSinceLastUse,
        }
      })
      .filter((x): x is DisusedPluginTipInfo => x !== null)
  } catch (e) {
    const { logForDebugging } = await import('../debug.js')
    logForDebugging(
      `plugin-disuse tip: failed to compute disused plugins: ${e}`,
      { level: 'error' },
    )
    return []
  }
}
