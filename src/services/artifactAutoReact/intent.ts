/**
 * densable $so / R3i / I3i / YAm / XAm / qAm / KAm — commentMonitorIntent (2.1.239).
 * Source: gold-dollar-so-239 / gold-R3i-239.
 */
import { un, type CommentMonitorIntentLine } from './store.js'

const FORGOTTEN_CAP = 256
const TITLE_MAX = 256

function isBgSession(): boolean {
  return Boolean(process.env.CLAUDE_JOB_DIR)
}

function sessionId(): string {
  return (
    process.env.CLAUDE_CODE_SESSION_ID ??
    process.env.CLAUDE_SESSION_ID ??
    'local'
  )
}

/**
 * densable $so(slugs, opts?)
 * Tip: in-memory commentMonitorIntent only (no v5 file park writer).
 */
export function forgetCommentMonitorIntent(
  slugs: string | Iterable<string>,
  _opts?: { storageV5?: unknown },
): void {
  const r = un().commentMonitorIntent
  const o = new Set(typeof slugs === 'string' ? [slugs] : slugs)
  const i = Date.now()
  for (const s of o) {
    r.bySlug.delete(s)
    r.forgottenAt.delete(s)
    if (r.forgottenAt.size >= FORGOTTEN_CAP) {
      const a = r.forgottenAt.keys().next().value
      if (a !== undefined) r.forgottenAt.delete(a)
    }
    r.forgottenAt.set(s, i)
  }
  for (const [parkKey, a] of r.parked) {
    let l = false
    for (const c of o) {
      if (a.traveling?.has(c) && a.line[c]?.state === 'armed') {
        delete a.line[c]
        a.traveling.delete(c)
        l = true
      }
    }
    if (l && !Object.values(a.line).some(c => c.state === 'armed')) {
      r.parked.delete(parkKey)
    }
  }
}

/** Alias densable $so */
export const dollarSo = forgetCommentMonitorIntent

/** densable KAm */
export function getCommentMonitorIntentState(
  slug: string,
): CommentMonitorIntentLine['state'] | undefined {
  return un().commentMonitorIntent.bySlug.get(slug)?.state
}

/**
 * densable R3i — arm intent for slug (no-op when stop-latched).
 */
export function armCommentMonitorIntent(
  slug: string,
  opts?: { title?: string; storageV5?: unknown },
): void {
  if (un().durable.stopLatches.isStopped(slug)) return
  const r = un().commentMonitorIntent
  const n = opts?.title
  const o =
    n !== undefined &&
    typeof n === 'string' &&
    n.length >= 1 &&
    n.length <= TITLE_MAX
  const i = r.bySlug.get(slug)?.title
  r.forgottenAt.delete(slug)
  r.bySlug.set(slug, {
    state: 'armed',
    writtenAtMs: Date.now(),
    ...(o ? { title: n } : i !== undefined ? { title: i } : {}),
    ...(isBgSession() ? { holder: 'bg' as const } : {}),
  })
}

/** densable I3i — mark intent stopped. */
export function stopCommentMonitorIntent(
  slug: string,
  _opts?: { storageV5?: unknown },
): void {
  const r = un().commentMonitorIntent
  const n = r.bySlug.get(slug)
  r.bySlug.set(slug, {
    state: 'stopped',
    writtenAtMs: Date.now(),
    ...(n?.title !== undefined ? { title: n.title } : {}),
  })
  for (const [, i] of r.parked) {
    const s = i.line[slug]
    if (s?.state === 'armed') {
      i.line[slug] = {
        state: 'stopped',
        writtenAtMs: Date.now(),
        ...(s.title !== undefined ? { title: s.title } : {}),
      }
    }
  }
}

/**
 * densable YAm — apply restored stopped map (reaffirm stop latches).
 */
export function applyStoppedIntents(
  stopped: Map<string, number> | Iterable<[string, number]>,
  _opts?: { storageV5?: unknown },
): void {
  const r = un().commentMonitorIntent
  const { stopLatches: n } = un().durable
  for (const [o, i] of stopped) {
    if (n.wasClearedByRewatch(o)) continue
    const s = r.bySlug.get(o)
    if (s === undefined || s.state === 'armed' || s.writtenAtMs <= i) {
      r.bySlug.set(o, {
        state: 'stopped',
        writtenAtMs: i,
        ...(s?.title !== undefined ? { title: s.title } : {}),
      })
    }
    n.reaffirmStop(o)
  }
}

/** densable XAm — stop all armed intents (user disarm companion). */
export function stopAllArmedCommentMonitorIntents(): void {
  const e = un().commentMonitorIntent
  const t = Date.now()
  let r = false
  for (const [n, o] of e.bySlug) {
    if (o.state === 'armed') {
      e.bySlug.set(n, {
        state: 'stopped',
        writtenAtMs: t,
        ...(o.title !== undefined ? { title: o.title } : {}),
      })
      r = true
    }
  }
  void r
  for (const [, o] of e.parked) {
    for (const [s, a] of Object.entries(o.line)) {
      if (a.state === 'armed') {
        o.line[s] = {
          state: 'stopped',
          writtenAtMs: t,
          ...(a.title !== undefined ? { title: a.title } : {}),
        }
      }
    }
  }
}

/**
 * densable qAm — early-seed adopt frameLive into intent + adoptPendingFor.
 */
export function seedAdoptPendingFrameLive(
  earlySeed:
    | Map<string, CommentMonitorIntentLine>
    | Record<string, CommentMonitorIntentLine>
    | undefined,
  _opts?: { storageV5?: unknown },
): void {
  if (earlySeed === undefined) return
  const r = un().commentMonitorIntent
  r.earlySeed = earlySeed
  r.adoptPendingFor = sessionId()
}

/** densable Ikl */
export function getTornStops(): Set<string> {
  return un().commentMonitorIntent.tornStops
}
