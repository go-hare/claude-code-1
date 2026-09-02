/**
 * densable Stn / wtn / MAm / SN / Jj / M2 / Uqe / mI / Gso / Lge (2.1.239).
 */
import { type Supervisor, un, type ArtifactAutoReactStore } from './store.js'

/** densable NAm / $Am — availability register for Lge. */
class AvailabilityGate {
  #availability: () => boolean = () => false
  register(fn: () => boolean): void {
    this.#availability = fn
  }
  isAvailable(): boolean {
    return this.#availability()
  }
}

const availabilityGate = new AvailabilityGate()

/** densable FAm */
export function registerAutoReactAvailability(fn: () => boolean): void {
  availabilityGate.register(fn)
}

/** densable Lge */
export function Lge(): boolean {
  return availabilityGate.isAvailable()
}

/**
 * densable Gso — opt-in for artifact comment auto-react.
 * Gold: `optIn ??= ENV ?? it("tengu_sorrel_trellis", false)`.
 * Tip: env string coerce when set; else GrowthBook cached gate (lazy import).
 */
export function Gso(): boolean {
  const ar = un().autoReact
  if (ar.optIn === null) {
    const env = process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
    if (env !== undefined && env !== '') {
      const lower = env.toLowerCase()
      ar.optIn = !(
        lower === '0' ||
        lower === 'false' ||
        lower === 'no' ||
        lower === 'off'
      )
    } else {
      // Lazy: avoid gates ↔ growthbook ↔ tasks ↔ MonitorWs cycle
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getFeatureValue_CACHED_MAY_BE_STALE } =
        require('../analytics/growthbook.js') as typeof import('../analytics/growthbook.js')
      ar.optIn = getFeatureValue_CACHED_MAY_BE_STALE(
        'tengu_sorrel_trellis',
        false,
      )
    }
  }
  return ar.optIn === true
}

/** densable fvl — live side-effects when enabledMemo flips (tip: no-op ok). */
export function fvl(_live: ArtifactAutoReactStore['live']): void {
  /* densable refreshes activity; tip has no activity UI wiring yet */
}

/** densable mI */
export function mI(): boolean {
  const e = un()
  const t = !e.autoReact.userDisarmed && Gso() && Lge()
  if (e.autoReact.enabledMemo !== t) {
    e.autoReact.enabledMemo = t
    fvl(e.live)
  }
  return t
}

/** densable Jj */
export function Jj(slug: string): boolean {
  return un().wakes.stoppedSlugs.has(slug)
}

/** densable SN */
export function SN(slug: string): boolean {
  const t = un()
  return t.wakes.stoppedSlugs.has(slug) || t.durable.stopLatches.isStopped(slug)
}

/** densable M2 */
export function M2(slug: string): boolean {
  return un().wakes.sweptSlugs.has(slug)
}

/** densable Uqe */
export function Uqe(slug: string): number | undefined {
  return un().wakes.stopGenerations.get(slug)
}

/** densable MAm — wired supervisors. */
export function* MAm(): Generator<Supervisor> {
  for (const e of un().live.supervisors.values()) {
    if (!e.stopped && e.autoReactWiring !== undefined && !SN(e.slug)) {
      yield e
    }
  }
}

/** densable Stn */
export function Stn(): Set<string> {
  if (un().autoReact.enabledMemo !== true) return new Set()
  return new Set(Array.from(MAm(), e => e.slug))
}

/** densable wtn */
export function wtn(): Set<string> {
  const { autoReact: e, durable: t, live: r, wakes: n } = un()
  const o = new Set<string>()
  if (e.enabledMemo === false || e.userDisarmed) return o
  for (const [i, s] of r.bootingWiredArms) {
    if (
      s.scanGeneration !== n.scanGeneration ||
      r.retiredInFlightArms.has(i) ||
      t.stopLatches.isStopped(i)
    ) {
      continue
    }
    if (!Jj(i) || (s.freshPublish && M2(i) && s.stopGeneration === Uqe(i))) {
      o.add(i)
    }
  }
  return o
}

/** densable OAm — global comment monitor active (g3a). */
export function OAm(): boolean {
  return un().autoReact.enabledMemo === true && vkl({ reconnecting: true })
}

/** densable vkl */
export function vkl(e?: { reconnecting?: boolean }): boolean {
  const { live: t } = un()
  for (const r of MAm()) {
    if (
      e?.reconnecting !== true ||
      r.timer !== undefined ||
      t.inFlightSubscribes.has(r.slug)
    ) {
      return true
    }
  }
  return false
}

/** densable q3i — user disarm. */
export function disarmAutoReactUser(): void {
  const e = un()
  e.autoReact.userDisarmed = true
  e.autoReact.enabledMemo = false
  fvl(e.live)
  // Lazy: avoid gates ↔ intent cycle at module init
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { stopAllArmedCommentMonitorIntents } =
    require('./intent.js') as typeof import('./intent.js')
  stopAllArmedCommentMonitorIntents()
}
