/**
 * FleetView helpers — derived from upstream's minified FleetView module.
 *
 * These functions classify, sort, and label background sessions for the
 * agent view dashboard.
 */

import type { SessionEntry } from '../../cli/bg/engine.js'

// ---------------------------------------------------------------------------
// Status bands
// ---------------------------------------------------------------------------

export type StatusBand = 'blocked' | 'active' | 'completed'

/**
 * Derive the high-level status band for a session.
 * Upstream: xhH (deriveBand)
 */
export function deriveBand(session: SessionEntry): StatusBand {
  if (session.waitingFor) return 'blocked'
  if (session.status === 'running' || session.status === 'busy') {
    return 'active'
  }
  if (
    session.status === 'completed' ||
    session.status === 'failed' ||
    session.status === 'killed' ||
    session.status === 'idle'
  ) {
    return 'completed'
  }
  return 'active'
}

// ---------------------------------------------------------------------------
// Activity derivation
// ---------------------------------------------------------------------------

export type Activity =
  | 'flowing'
  | 'slowing'
  | 'stuck'
  | 'success'
  | 'failure'
  | 'stopped'

/**
 * Derive fine-grained activity from session state.
 * Upstream: jZ6 (deriveActivity)
 */
export function deriveActivity(session: SessionEntry): Activity {
  if (session.status === 'completed' || session.status === 'killed') {
    return 'success'
  }
  if (session.status === 'failed') return 'failure'

  const updatedAt = session.updatedAt ?? session.startedAt
  const elapsed = Date.now() - updatedAt
  const multiplier = session.status === 'running' ? 1 : 5

  if (elapsed < multiplier * 3 * 60_000) return 'flowing'
  if (elapsed < multiplier * 15 * 60_000) return 'slowing'
  return 'stuck'
}

// ---------------------------------------------------------------------------
// Glyph / color
// ---------------------------------------------------------------------------

export type GlyphStyle = {
  color: string | undefined
  dim: boolean
}

/**
 * Determine the color for a session's status glyph.
 * Upstream: cnq (glyphColor)
 */
export function glyphColor(
  band: StatusBand,
  activity: Activity,
  session: SessionEntry,
): GlyphStyle {
  if (
    activity === 'success' ||
    activity === 'failure' ||
    activity === 'stopped'
  ) {
    const color =
      activity === 'success'
        ? 'success'
        : activity === 'failure'
          ? 'error'
          : 'warning'
    return { color, dim: false }
  }
  if (session.status === 'busy') return { color: undefined, dim: false }
  if (band === 'blocked') return { color: 'warning', dim: false }
  return { color: undefined, dim: true }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const BAND_ORDER: Record<StatusBand, number> = {
  blocked: 0,
  active: 1,
  completed: 2,
}

/**
 * Sort sessions: pinned first, then by band, then by recency.
 * Upstream: effectiveSortOrder / effectiveStateSortOrder
 */
export function sortSessions(sessions: SessionEntry[]): SessionEntry[] {
  return [...sessions].sort((a, b) => {
    // Pinned first
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    // Then by status band
    const bandA = BAND_ORDER[deriveBand(a)]
    const bandB = BAND_ORDER[deriveBand(b)]
    if (bandA !== bandB) return bandA - bandB
    // Then by most recently updated
    return (b.updatedAt ?? b.startedAt) - (a.updatedAt ?? a.startedAt)
  })
}

// ---------------------------------------------------------------------------
// Labels and formatting
// ---------------------------------------------------------------------------

/**
 * Generate a display label for a session.
 * Upstream: JZ6 (jobLabel)
 */
export function jobLabel(session: SessionEntry): string {
  if (session.name) {
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is intentional
    return session.name.replace(/[\x00-\x1f]/g, '').trim()
  }
  return `session-${session.pid}`
}

/**
 * Format session age as a human-readable string.
 * Upstream: Fnq (formatJobAge)
 */
export function formatJobAge(startedAt: number): string {
  const ms = Date.now() - startedAt
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m`
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h`
  return `${Math.floor(ms / 86_400_000)}d`
}

// ---------------------------------------------------------------------------
// PR parsing
// ---------------------------------------------------------------------------

/**
 * Parse a PR reference from text (e.g., "#123" or a GitHub PR URL).
 * Upstream: wZ6 (parsePrRef)
 */
export function parsePrRef(text: string): string | null {
  const trimmed = text.trim()
  if (/\s/.test(trimmed)) return null
  const match = /^#(\d+)$/.exec(trimmed) ?? /\/pull\/(\d+)(?!\d)/.exec(trimmed)
  return match?.[1] ?? null
}

// ---------------------------------------------------------------------------
// Dispatch parsing
// ---------------------------------------------------------------------------

export type ParsedDispatch = {
  intent: string
  matched: boolean
  cwd?: string
}

/**
 * Parse dispatch input text into a structured command.
 * Upstream: xnq (parseDispatch)
 */
export function parseDispatch(input: string): ParsedDispatch {
  const trimmed = input.trim()
  const lower = trimmed.toLowerCase()

  // Skip special prefixes (a: = attach, s: = search, o: = open)
  if (
    lower.startsWith('a:') ||
    lower.startsWith('s:') ||
    lower.startsWith('o:')
  ) {
    return { intent: '', matched: false }
  }

  return { intent: trimmed, matched: trimmed.length > 0 }
}

// ---------------------------------------------------------------------------
// Self-driving / loop detection
// ---------------------------------------------------------------------------

/**
 * Check if a session is a loop job (started with /loop).
 * Upstream: WV8 (isLoopJob)
 */
export function isLoopJob(session: SessionEntry): boolean {
  return session.name?.toLowerCase().startsWith('/loop') ?? false
}

/**
 * Check if a session is self-driving (has a cron or loop).
 * Upstream: LZ6 (isSelfDriving)
 */
export function isSelfDriving(session: SessionEntry): boolean {
  return isLoopJob(session)
}

// ---------------------------------------------------------------------------
// Status icon
// ---------------------------------------------------------------------------

/**
 * Pick the status icon for a session row.
 * Upstream: Md_ (pickIcon) + taA/eaA/i$8
 */
export function pickIcon(
  band: StatusBand,
  activity: Activity,
  pinned?: boolean,
): string {
  if (pinned === true) return '\u25a0'
  if (band === 'blocked') return '\u25a1'
  if (band === 'active') {
    if (activity === 'flowing') return '\u25a1'
    if (activity === 'slowing') return '\u25a1'
    return '\u25a1'
  }
  if (activity === 'success') return '\u25a1'
  if (activity === 'failure') return '\u25a1'
  return '\u25a1'
}

// ---------------------------------------------------------------------------
// Done cap (fold)
// ---------------------------------------------------------------------------

/**
 * Calculate how many "done" sessions to show before folding.
 * Upstream: oQ_ (doneCapForRows)
 */
export function doneCapForRows(totalRows: number): number {
  return Math.max(Math.floor(totalRows / 5), 2)
}

// ---------------------------------------------------------------------------
// Repo grouping
// ---------------------------------------------------------------------------

/**
 * Extract a short repo label from a session's cwd.
 * Upstream: Bnq (repoGroup) + Ad_ (repoGroupLabel)
 */
export function repoGroupLabel(session: SessionEntry): string {
  if (!session.cwd) return ''
  const parts = session.cwd.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] ?? ''
}
