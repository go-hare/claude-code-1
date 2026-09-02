/**
 * densable Skl / wkl / Ekl / LAm / C3i / Akl / oDE — unattended reply counters (2.1.239).
 * Source: gold-unattended-Skl-239 / gold-stamp-unattended-239.
 */
import { un } from './store.js'

/** densable tbr — per-slug unattended reply cap. */
export const UNATTENDED_REPLY_CAP = 10_000

/** densable Skl */
export function getUnattendedReplies(): Map<string, number> {
  return un().autoReact.unattendedReplies
}

/** densable wkl — increment by 1. */
export function bumpUnattendedReply(slug: string): void {
  const t = getUnattendedReplies()
  t.set(slug, Math.min((t.get(slug) ?? 0) + 1, UNATTENDED_REPLY_CAP))
}

/** densable Ekl — add delta (>0). */
export function addUnattendedReplies(slug: string, delta: number): void {
  if (delta <= 0) return
  const r = getUnattendedReplies()
  r.set(slug, Math.min((r.get(slug) ?? 0) + delta, UNATTENDED_REPLY_CAP))
}

/** densable LAm — take-and-clear one slug. */
export function takeUnattendedReplies(slug: string): number {
  const t = getUnattendedReplies()
  const r = t.get(slug) ?? 0
  t.delete(slug)
  return r
}

export type DrainedUnattended = {
  total: number
  bySlug: Map<string, number>
}

/** densable C3i — drain all unattended counters. */
export function drainUnattendedReplies(): DrainedUnattended {
  const e = un().autoReact
  const t = e.unattendedReplies
  e.unattendedReplies = new Map()
  let r = 0
  for (const n of t.values()) r += n
  return { total: r, bySlug: t }
}

/**
 * densable Akl — notice copy for drained unattended replies.
 * `where` e.g. ` on https://…`; `stop` is the turn-off hint suffix.
 */
export function formatUnattendedReplyNotice(
  count: number,
  opts: { where?: string; stop?: string } = {},
): string {
  const where = opts.where ?? ''
  const stop = opts.stop ?? ''
  const noun = count === 1 ? 'comment' : 'comments'
  return `Claude auto-replied to ${count} ${noun}${where} while you were away.${stop}`
}

export type FrameLiveUnattendedStamp = {
  slug: string
  unattendedReplies?: number
  [key: string]: unknown
}

/**
 * densable oDE — drain C3i into frameLive entries (adopt write path).
 * Clears the live unattended map as a side effect.
 */
export function stampUnattendedIntoFrameLive<
  T extends FrameLiveUnattendedStamp,
>(entries: readonly T[]): T[] {
  const { bySlug } = drainUnattendedReplies()
  if (bySlug.size === 0) return [...entries]
  return entries.map(r => {
    const n = Math.min(
      (bySlug.get(r.slug) ?? 0) + (r.unattendedReplies ?? 0),
      UNATTENDED_REPLY_CAP,
    )
    return n > 0 ? { ...r, unattendedReplies: n } : r
  })
}

/** Seed Ekl from carried adopt frameLive entries (resume path). */
export function seedUnattendedFromFrameLive(
  entries: ReadonlyArray<{ slug: string; unattendedReplies?: number }>,
  cap: number = Number.POSITIVE_INFINITY,
): void {
  let i = 0
  for (const e of entries) {
    if (i >= cap) break
    i++
    if (e.unattendedReplies !== undefined) {
      addUnattendedReplies(e.slug, e.unattendedReplies)
    }
  }
}
