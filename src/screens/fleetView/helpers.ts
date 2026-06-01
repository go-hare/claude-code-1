/**
 * FleetView helpers — derived from upstream's minified FleetView module.
 *
 * These functions classify, sort, and label background sessions for the
 * agent view dashboard.
 */

import type { SessionEntry } from '../../cli/bg/engine.js'
import figures from 'figures'

// ---------------------------------------------------------------------------
// Status bands
// ---------------------------------------------------------------------------

export type StatusBand = 'blocked' | 'review' | 'active' | 'completed'

/**
 * Derive the high-level status band for a session.
 * Official: g2H + group assignment
 * - "busy" status → active (Working)
 * - Terminal state (completed/failed/killed/idle) → completed
 * - Has open PR needing review → review (Ready for review)
 * - "waiting" status OR has waitingFor → blocked (Needs input)
 * - Otherwise → active (Working)
 */
export function deriveBand(session: SessionEntry): StatusBand {
  if (session.status === 'busy') return 'active'
  if (
    session.status === 'completed' ||
    session.status === 'failed' ||
    session.status === 'killed' ||
    session.status === 'idle' ||
    session.status === 'done' ||
    session.status === 'stopped'
  ) {
    // Done sessions with open PR needing review go to "review" band
    if (session.prReviewState && session.prReviewState !== 'approved') {
      return 'review'
    }
    return 'completed'
  }
  if (session.status === 'waiting' || session.waitingFor) return 'blocked'
  // Active sessions with open PR needing review
  if (session.prReviewState && session.prReviewState !== 'approved') {
    return 'review'
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
  if (
    session.status === 'completed' ||
    session.status === 'done' ||
    session.status === 'killed'
  ) {
    return 'success'
  }
  if (session.status === 'failed' || session.status === 'stopped')
    return 'failure'

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
/**
 * Determine the color for a session's status glyph.
 * Official: z1q
 * - Success (done) → green
 * - Failed/stopped → error (red) for failed, dim for stopped
 * - Blocked/waiting → warning (yellow)
 * - Working → dim (no color)
 */
export function glyphColor(
  band: StatusBand,
  activity: Activity,
  session: SessionEntry,
): GlyphStyle {
  if (activity === 'success') return { color: 'success', dim: false }
  if (activity === 'failure') return { color: 'error', dim: false }
  if (band === 'blocked') return { color: 'warning', dim: false }
  return { color: undefined, dim: true }
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

const BAND_ORDER: Record<StatusBand, number> = {
  blocked: 0,
  review: 1,
  active: 2,
  completed: 3,
}

/**
 * Sort sessions: pinned first, then by band, then by createdAt (newest first).
 * Official: XE_ sorts by JC6 (sortOrder ?? createdAt)
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
    // Then by most recently created (newest first)
    return b.startedAt - a.startedAt
  })
}

// ---------------------------------------------------------------------------
// Labels and formatting
// ---------------------------------------------------------------------------

/**
 * Generate a display label for a session.
 * Upstream: DC6 (jobLabel)
 * Note: The heavy lifting (intent truncation) is done in AgentView's
 * computeJobLabel when building SessionEntry.name.
 */
export function jobLabel(session: SessionEntry): string {
  if (session.name) {
    return (
      session.name
        // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is intentional
        .replace(/[\x00-\x1f]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    )
  }
  if (session.sessionId) {
    return session.sessionId.slice(0, 8)
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
 * Official: kj4
 * - Success (done) → ✻ (asterisk, green)
 * - Failed/stopped → ∙ (dot, dim)
 * - Working/blocked → ✻ (asterisk)
 */
export function pickIcon(
  band: StatusBand,
  activity: Activity,
  pinned?: boolean,
): string {
  if (band === 'completed') {
    if (activity === 'success') return '\u273B' // ✻ for done (green)
    return '\u2219' // ∙ for failed/stopped
  }
  return '\u273B' // ✻ for working/blocked
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
