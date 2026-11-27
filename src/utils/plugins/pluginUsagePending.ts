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
import {
  exitSessionContext,
  getBootstrapSession,
  getBootstrapSessionHost,
  hasActiveSessionAls,
  runWithSession,
} from '../sessionHost.js'
import type { Session } from '../sessionRoot.js'
import { isHoverRestOn } from '../storageV5/hoverRestPin.js'

const Xwo = 60_000

type PendingUsageEntry = {
  count: number
  lastUsedAt: number
}

type PendingUsageFlushers = {
  flush: (state?: PendingUsageHostState) => void
  flushAtExit: () => void
}

/** densable `iln`. */
class PendingUsageHostState {
  pendingUsage = new Map<string, PendingUsageEntry>()
  flushTimer: ReturnType<typeof setTimeout> | null = null
  exitFlushesInFlight: Array<Array<[string, PendingUsageEntry]>> = []
  flushStorageV5: unknown = undefined
  unregisterCleanup: (() => void) | undefined = undefined
  unregisterPreExitFlush: (() => void) | undefined = undefined
  sessionRef: WeakRef<Session> | undefined = undefined
}

/** densable `lln` / `r3`. */
class PendingUsageFlushRegistry {
  flushers: PendingUsageFlushers | null = null
  exitFlushRegistered = false
}

const livePendingUsageStates = new Set<WeakRef<PendingUsageHostState>>()

function pruneDeadPendingUsageStates(): void {
  for (const ref of livePendingUsageStates) {
    if (ref.deref() === undefined) {
      livePendingUsageStates.delete(ref)
    }
  }
}

/** leftover-wired `fn` — same `.of(host)` shape as tipRegistry WeakOwnerCache. */
class WeakOwnerCache<T extends object> {
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

const pendingUsageOwners = new WeakOwnerCache(() => {
  const state = new PendingUsageHostState()
  if (livePendingUsageStates.size > 64) {
    pruneDeadPendingUsageStates()
  }
  livePendingUsageStates.add(new WeakRef(state))
  return state
})
const r3 = new PendingUsageFlushRegistry()

/** densable `HP()` — `aln.of(bn().host)` leftover-wired to `k.host`. */
function HP(): PendingUsageHostState {
  const state = pendingUsageOwners.of(getBootstrapSessionHost())
  if (hasActiveSessionAls()) {
    try {
      const rootSession = getBootstrapSession().root
      if (state.sessionRef?.deref() !== rootSession) {
        state.sessionRef = new WeakRef(rootSession)
      }
    } catch {
      // sessionHost may be partially mocked in isolated unit tests
    }
  }
  return state
}

function drainHostPendingUsage(
  state: PendingUsageHostState,
): Array<[string, PendingUsageEntry]> | null {
  if (state.flushTimer) {
    clearTimeout(state.flushTimer)
    state.flushTimer = null
  }
  if (state.pendingUsage.size === 0) return null
  const entries = [...state.pendingUsage.entries()]
  state.pendingUsage.clear()
  return entries
}

function drainHostExitFlushesInFlight(
  state: PendingUsageHostState,
): Array<[string, PendingUsageEntry]> | null {
  const entries = state.exitFlushesInFlight.flat()
  state.exitFlushesInFlight = []
  return entries.length > 0 ? entries : null
}

function runWithHostStateSession(
  state: PendingUsageHostState,
  fn: () => void,
): void {
  if (state.sessionRef !== undefined) {
    const liveSession = state.sessionRef.deref()
    if (liveSession === undefined) {
      return
    }
    runWithSession(liveSession, fn)
    return
  }
  fn()
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

/** densable `sPe`. */
export function drainPendingPluginUsage(): Array<
  [string, PendingUsageEntry]
> | null {
  return drainHostPendingUsage(HP())
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
    const stateRef = new WeakRef(e)
    e.flushTimer = exitSessionContext(() =>
      setTimeout(() => {
        const liveState = stateRef.deref()
        if (!liveState) return
        t.flush(liveState)
      }, Xwo),
    )
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
function oko(state?: PendingUsageHostState): void {
  const target = state ?? HP()
  const e = drainHostPendingUsage(target)
  if (!e) return
  runWithHostStateSession(target, () => {
    saveGlobalConfig(xit(e), state ? target.flushStorageV5 : hln())
  })
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
  const states = new Set<PendingUsageHostState>()
  for (const ref of livePendingUsageStates) {
    const live = ref.deref()
    if (!live) {
      livePendingUsageStates.delete(ref)
      continue
    }
    states.add(live)
  }
  try {
    states.add(HP())
  } catch {
    // Ignore if sessionHost is unavailable during teardown
  }
  for (const state of states) {
    const e = [
      ...(drainHostExitFlushesInFlight(state) ?? []),
      ...(drainHostPendingUsage(state) ?? []),
    ]
    if (e.length === 0) continue
    try {
      runWithHostStateSession(state, () => {
        saveGlobalConfig(xit(e), state.flushStorageV5)
      })
    } catch {
      // Best-effort exit flush across hosts
    }
  }
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
  const state = HP()
  state.unregisterCleanup?.()
  state.unregisterCleanup = undefined
  state.unregisterPreExitFlush?.()
  state.unregisterPreExitFlush = undefined
  if (e === undefined) {
    gln(undefined)
    return
  }
  const viaHoverRest = isHoverRestOn() && e !== undefined
  if (viaHoverRest || e !== undefined) {
    gln(e)
    const c = registerCleanup(() => flushPendingPluginUsageToStorageV5(e))
    const f = registerPreExitFlush(() => flushPendingPluginUsageToStorageV5(e))
    state.unregisterCleanup = c
    state.unregisterPreExitFlush = f
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
  e.unregisterCleanup?.()
  e.unregisterCleanup = undefined
  e.unregisterPreExitFlush?.()
  e.unregisterPreExitFlush = undefined
  e.pendingUsage.clear()
  e.exitFlushesInFlight = []
  e.flushStorageV5 = undefined
}
