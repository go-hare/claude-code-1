/**
 * densable durable registry — BAm / jAm / d6e / zAm / lxl / jMw / sxm (2.1.239).
 * Source: gold-d6e-239 / gold-lxl-full-239 / gold-durable-restore-239.
 */
import type { DurableWatchRow } from './store.js'
import { applyStoppedIntents } from './intent.js'
import { un } from './store.js'

/** densable Tkl — max rows/stops published. */
export const DURABLE_REGISTRY_CAP = 64
/** densable kkl — max orphans. */
export const DURABLE_ORPHAN_CAP = 16

export type { DurableWatchRow }

export type DurableRegistryPayload = {
  v: 1
  rows: Record<
    string,
    {
      trigger_id: string
      since: string
      events: string[]
      unreleased?: string[]
    }
  >
  stopped: Record<string, { at_ms: number }>
  orphans?: string[]
}

export type RegistrySink = (payload: {
  artifact_durable_watches: DurableRegistryPayload | null
}) => void

/** densable BAm */
export function setDurableRegistrySink(sink: RegistrySink | null): void {
  un().durable.registrySink = sink as
    | ((payload: { artifact_durable_watches: unknown }) => void)
    | null
}

/** densable jAm — force next d6e to publish (reset published fingerprint). */
export function invalidateDurableRegistryPublished(): void {
  un().durable.registryPublished = ''
}

function fingerprint(payload: DurableRegistryPayload | null): string {
  return JSON.stringify(payload)
}

/**
 * densable d6e — publish durable watches via registrySink.
 * No-op unless CLAUDE_CODE_REMOTE and sink is set.
 */
export function publishDurableRegistry(): void {
  if (!process.env.CLAUDE_CODE_REMOTE) return
  const e = un()
  const t = e.durable
  if (t.registrySink === null) return

  const r: DurableRegistryPayload['rows'] = {}
  const pendingExtras: DurableWatchRow[] = []
  const orphanExtra = new Set<string>()

  for (const u of t.pendingRestoredRows.values()) {
    const d = t.rows.get(u.slug)
    if (d === undefined && !t.unwatchedSlugs.has(u.slug)) {
      pendingExtras.push(u)
      continue
    }
    for (const p of [u.triggerId, ...(u.unreleased ?? [])]) {
      if (p !== d?.triggerId) orphanExtra.add(p)
    }
  }

  for (const u of [...t.rows.values(), ...pendingExtras].slice(
    0,
    DURABLE_REGISTRY_CAP,
  )) {
    r[u.slug] = {
      trigger_id: u.triggerId,
      since: u.since,
      events: [...u.events],
      ...(u.unreleased !== undefined && u.unreleased.length > 0
        ? { unreleased: [...u.unreleased] }
        : {}),
    }
  }

  const i: DurableRegistryPayload['stopped'] = {}
  const s = [...e.commentMonitorIntent.bySlug.entries()]
    .filter(([, u]) => u.state === 'stopped')
    .sort(([, u], [, d]) => d.writtenAtMs - u.writtenAtMs)
    .slice(0, DURABLE_REGISTRY_CAP)
  for (const [u, d] of s) i[u] = { at_ms: d.writtenAtMs }

  const a = [...new Set([...t.orphanTriggers, ...orphanExtra])].slice(
    0,
    DURABLE_ORPHAN_CAP,
  )
  const l: DurableRegistryPayload | null =
    t.rows.size + pendingExtras.length === 0 && s.length === 0 && a.length === 0
      ? null
      : {
          v: 1,
          rows: r,
          stopped: i,
          ...(a.length > 0 ? { orphans: a } : {}),
        }

  const c = fingerprint(l)
  if (c === t.registryPublished) return
  t.registryPublished = c
  t.registrySink({ artifact_durable_watches: l })
}

/** densable lxl — upsert restored row (or orphan triggers if already present). */
export function upsertDurableWatchRow(row: DurableWatchRow): void {
  const t = un().durable
  const r = t.rows.get(row.slug)
  if (
    r !== undefined ||
    t.unwatchedSlugs.has(row.slug) ||
    t.stopLatches.isStopped(row.slug)
  ) {
    for (const n of [row.triggerId, ...(row.unreleased ?? [])]) {
      if (n !== r?.triggerId) t.orphanTriggers.add(n)
    }
    return
  }
  t.rows.set(row.slug, { ...row, restored: true })
}

/** densable jMw — drop stop-latched row into unwatched + orphans. */
export function reapStopLatchedDurableRow(slug: string): void {
  const t = un().durable
  const n = t.rows.get(slug)
  if (n === undefined || !t.stopLatches.isStopped(slug)) return
  t.rows.delete(slug)
  t.unwatchedSlugs.add(slug)
  for (const o of [n.triggerId, ...(n.unreleased ?? [])]) {
    t.orphanTriggers.add(o)
  }
}

/**
 * densable zAm — lightweight parse of artifact_durable_watches envelope.
 * Tip: structural parse (no zod); invalid entries skipped.
 */
export function parseDurableRegistry(raw: unknown): {
  rows: DurableWatchRow[]
  stopped: Map<string, number>
  orphans: string[]
} | null {
  if (raw === undefined || raw === null || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const rowsIn =
    e.rows && typeof e.rows === 'object'
      ? (e.rows as Record<string, unknown>)
      : null
  const stoppedIn =
    e.stopped && typeof e.stopped === 'object'
      ? (e.stopped as Record<string, unknown>)
      : null
  if (!rowsIn || !stoppedIn) return null

  const n: DurableWatchRow[] = []
  for (const [slug, u] of Object.entries(rowsIn).slice(
    0,
    DURABLE_REGISTRY_CAP,
  )) {
    if (!slug || typeof u !== 'object' || u === null) continue
    const d = u as Record<string, unknown>
    if (typeof d.trigger_id !== 'string' || typeof d.since !== 'string')
      continue
    const events = Array.isArray(d.events)
      ? d.events.filter((x): x is string => typeof x === 'string').slice(0, 16)
      : []
    if (events.length === 0) continue
    const unreleased = Array.isArray(d.unreleased)
      ? d.unreleased
          .filter((x): x is string => typeof x === 'string')
          .slice(0, DURABLE_ORPHAN_CAP)
      : []
    n.push({
      slug,
      triggerId: d.trigger_id,
      since: d.since,
      events,
      ...(unreleased.length > 0 ? { unreleased } : {}),
    })
  }

  const i = new Map<string, number>()
  for (const [slug, u] of Object.entries(stoppedIn).slice(
    0,
    DURABLE_REGISTRY_CAP,
  )) {
    if (!slug) continue
    const at =
      typeof u === 'object' &&
      u !== null &&
      typeof (u as { at_ms?: unknown }).at_ms === 'number'
        ? (u as { at_ms: number }).at_ms
        : Date.now()
    i.set(slug, at)
  }

  const orphansRaw = Array.isArray(e.orphans) ? e.orphans : []
  const orphans = orphansRaw
    .filter((x): x is string => typeof x === 'string')
    .slice(0, DURABLE_ORPHAN_CAP)

  return { rows: n, stopped: i, orphans }
}

/**
 * densable sxm — restore durable registry from worker epoch payload + wire sink.
 */
export function restoreDurableRegistry(
  internal: { artifact_durable_watches?: unknown } | null | undefined,
  opts: { sink?: RegistrySink | null; storageV5?: unknown } = {},
): void {
  const parsed = parseDurableRegistry(internal?.artifact_durable_watches)
  const n = un().durable
  for (const o of parsed?.orphans ?? []) n.orphanTriggers.add(o)
  for (const o of parsed?.rows ?? []) {
    if (n.unwatchedSlugs.has(o.slug) && !n.rows.has(o.slug)) {
      upsertDurableWatchRow(o)
      continue
    }
    if (n.slugOps.has(o.slug)) {
      n.pendingRestoredRows.set(o.slug, o)
      continue
    }
    upsertDurableWatchRow(o)
  }
  applyStoppedIntents(parsed?.stopped ?? new Map(), opts)
  for (const o of new Set([
    ...n.rows.keys(),
    ...n.pendingRestoredRows.keys(),
    ...n.slugOps.keys(),
  ])) {
    if (n.stopLatches.isStopped(o)) reapStopLatchedDurableRow(o)
  }
  if (opts.sink !== undefined) setDurableRegistrySink(opts.sink)
  if (parsed !== null) invalidateDurableRegistryPublished()
  publishDurableRegistry()
  if (process.env.CLAUDE_CODE_REMOTE) {
    // Fire-and-forget densable nxm refresh after restore
    void import('./durableSubscribe.js').then(m => {
      void m.refreshRestoredDurableWatches()
    })
  }
}

/** Flush a pendingRestoredRows entry after slugOps clear (OGi stand-in). */
export function flushPendingRestoredRow(slug: string): void {
  const n = un().durable
  const o = n.pendingRestoredRows.get(slug)
  if (!o) return
  n.pendingRestoredRows.delete(slug)
  upsertDurableWatchRow(o)
  publishDurableRegistry()
}
