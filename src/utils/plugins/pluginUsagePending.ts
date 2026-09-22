/**
 * densable pendingUsage cluster (`HP`/`iln`/`dm`/`sPe`/`yln`/`xit`/`oko`/
 * `Aln`/`dln`/`uln`/`sko`/`xvi`/`pPe`).
 *
 * `fn`/`bn` UNKNOWN — leftover-wired WeakOwnerCache.of(k.host), not an
 * invented WeakMap factory or `bn()` body. Official `X$n`/`xvi` @183765544:
 * `TNe` + `Et(()=>CNe)` + `Vk(()=>CNe)`. `Pln` UNKNOWN — leftover-wired to
 * `saveGlobalConfig` (sync exit path).
 */

import { type GlobalConfig, saveGlobalConfig } from '../config.js'
import { registerCleanup, registerPreExitFlush } from '../cleanupRegistry.js'
import { getBootstrapSessionHost } from '../sessionHost.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'

const Xwo = 60_000

type PendingUsageEntry = {
  count: number
  lastUsedAt: number
}

type PendingUsageFlushers = {
  flush: () => void
  flushAtExit: () => void
}

/** densable `iln`. */
class PendingUsageHostState {
  pendingUsage = new Map<string, PendingUsageEntry>()
  flushTimer: ReturnType<typeof setTimeout> | null = null
  exitFlushesInFlight: Array<Array<[string, PendingUsageEntry]>> = []
  flushStorageV5: unknown = undefined
}

/** densable `lln` / `r3`. */
class PendingUsageFlushRegistry {
  flushers: PendingUsageFlushers | null = null
  exitFlushRegistered = false
}

/** leftover-wired `fn` — same `.of(host)` shape as tipRegistry WeakOwnerCache. */
class WeakOwnerCache<T> {
  #e = new WeakMap<object, T>()
  constructor(private readonly factory: () => T) {}
  of(owner: object): T {
    const hit = this.#e.get(owner)
    if (hit) return hit
    const created = this.factory()
    this.#e.set(owner, created)
    return created
  }
}

const pendingUsageOwners = new WeakOwnerCache(() => new PendingUsageHostState())
const r3 = new PendingUsageFlushRegistry()

/** densable `HP()` — `aln.of(bn().host)` leftover-wired to `k.host`. */
function HP(): PendingUsageHostState {
  return pendingUsageOwners.of(getBootstrapSessionHost())
}

/** densable `gln`. */
function gln(e: unknown): void {
  HP().flushStorageV5 = e
}

/** densable `hln`. */
function hln(): unknown {
  return HP().flushStorageV5
}

/** densable `pln`. */
function pln(e: Array<[string, PendingUsageEntry]>): void {
  HP().exitFlushesInFlight.push(e)
}

/** densable `fln`. */
function fln(e: Array<[string, PendingUsageEntry]>): void {
  const t = HP().exitFlushesInFlight
  const n = t.indexOf(e)
  if (n !== -1) t.splice(n, 1)
}

/** densable `mln`. */
function mln(): Array<[string, PendingUsageEntry]> | null {
  const e = HP()
  const t = e.exitFlushesInFlight.flat()
  e.exitFlushesInFlight = []
  return t.length > 0 ? t : null
}

/** densable `sPe`. */
export function drainPendingPluginUsage(): Array<
  [string, PendingUsageEntry]
> | null {
  const e = HP()
  if (e.flushTimer) {
    clearTimeout(e.flushTimer)
    e.flushTimer = null
  }
  if (e.pendingUsage.size === 0) return null
  const t = [...e.pendingUsage.entries()]
  e.pendingUsage.clear()
  return t
}

/** densable `uvi`. */
export function hasPendingPluginUsage(e: string): boolean {
  return HP().pendingUsage.has(e)
}

/** densable `yln`. */
export function wipePendingPluginUsage(e: Set<string>): void {
  const { pendingUsage: t } = HP()
  for (const n of t.keys()) {
    if (e.has(n.toLowerCase())) t.delete(n)
  }
}

/** densable `xit`. */
function xit(e: Array<[string, PendingUsageEntry]>) {
  return (t: GlobalConfig): GlobalConfig => {
    const n = { ...t.pluginUsage }
    for (const [r, o] of e) {
      const s = n[r]
      n[r] = {
        usageCount: (s?.usageCount ?? 0) + o.count,
        lastUsedAt: o.lastUsedAt,
        lastUsedNumStartups: t.numStartups,
      }
    }
    return { ...t, pluginUsage: n }
  }
}

/** densable `dln`. */
function dln(e: PendingUsageHostState, t: PendingUsageFlushers): void {
  if (!r3.exitFlushRegistered) {
    r3.exitFlushRegistered = true
    process.on('exit', t.flushAtExit)
  }
  if (!e.flushTimer) {
    e.flushTimer = setTimeout(t.flush, Xwo)
    e.flushTimer.unref?.()
  }
}

/** densable `uln`. */
function uln(e: PendingUsageFlushers): void {
  r3.flushers = e
  const t = HP()
  if (t.pendingUsage.size > 0) dln(t, e)
}

/** densable `oko`. */
function oko(): void {
  const e = drainPendingPluginUsage()
  if (!e) return
  saveGlobalConfig(xit(e), hln())
}

/** densable `Aln`. `ca`/`i3` UNKNOWN — not invented-scheduled from `xvi`. */
export async function flushPendingPluginUsageToStorageV5(
  e: unknown,
): Promise<void> {
  const t = drainPendingPluginUsage()
  if (!t) return
  pln(t)
  await Promise.resolve(saveGlobalConfig(xit(t), e))
  fln(t)
}

/** densable `sko`. `Pln` UNKNOWN — leftover-wired to `saveGlobalConfig`. */
function sko(): void {
  const e = [...(mln() ?? []), ...(drainPendingPluginUsage() ?? [])]
  if (e.length === 0) return
  saveGlobalConfig(xit(e))
}

/** densable `dm` / `Y$` / `qe`. */
export function incrementPluginUsage(e: string): void {
  const t = Date.now()
  const n = HP()
  const r = n.pendingUsage.get(e)
  if (r) {
    r.count++
    r.lastUsedAt = t
  } else {
    n.pendingUsage.set(e, { count: 1, lastUsedAt: t })
  }
  if (r3.flushers) dln(n, r3.flushers)
}

/**
 * densable `xvi` / official `X$n` @183765544:
 * `if(D()&&e!==void 0)TNe(e),Et(()=>CNe(e)),Vk(()=>CNe(e))`.
 */
export function registerPluginUsageStorageV5(e: unknown): void {
  if (isHoverRestOn() && e !== undefined) {
    gln(e)
    registerCleanup(() => flushPendingPluginUsageToStorageV5(e))
    registerPreExitFlush(() => flushPendingPluginUsageToStorageV5(e))
  }
}

/** densable `pPe` — `uln({flush:oko,flushAtExit:sko})`. */
uln({ flush: oko, flushAtExit: sko })

export function resetPendingPluginUsageForTests(): void {
  const e = HP()
  if (e.flushTimer) {
    clearTimeout(e.flushTimer)
    e.flushTimer = null
  }
  e.pendingUsage.clear()
  e.exitFlushesInFlight = []
  e.flushStorageV5 = undefined
}
