/**
 * FleetView helpers — derived from upstream's minified FleetView module.
 *
 * These functions classify, sort, and label background sessions for the
 * agent view dashboard.
 */

import type { SessionEntry } from '../../cli/bg/engine.js'
import figures from 'figures'
import { formatDuration } from '../../utils/format.js'

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

/**
 * densable O7e — header stats buckets (blocked / active / completed).
 * Unlike deriveBand, PR-review jobs still count as completed here; pinned
 * busy jobs count as active. Matches RU.blocked/active/completed.
 */
export type StatsBand = 'blocked' | 'active' | 'completed'

export function deriveStatsBand(session: SessionEntry): StatsBand {
  if (session.status === 'busy' || session.status === 'running') {
    return 'active'
  }
  if (
    session.status === 'completed' ||
    session.status === 'failed' ||
    session.status === 'killed' ||
    session.status === 'idle' ||
    session.status === 'done' ||
    session.status === 'stopped'
  ) {
    return 'completed'
  }
  if (session.status === 'waiting' || session.waitingFor) {
    return 'blocked'
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
 * Sort sessions: pinned first, then by band, then sortOrder/createdAt.
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
    // Manual reorder (lower sortOrder first) when both set
    const soA = a.sortOrder
    const soB = b.sortOrder
    if (soA !== undefined && soB !== undefined && soA !== soB) {
      return soA - soB
    }
    if (soA !== undefined && soB === undefined) return -1
    if (soA === undefined && soB !== undefined) return 1
    // Then by most recently created (newest first)
    return b.startedAt - a.startedAt
  })
}

/** Soft-archive filter for main list (official archive hides without delete). */
export function partitionArchivedSessions(sessions: SessionEntry[]): {
  active: SessionEntry[]
  earlier: SessionEntry[]
} {
  const active: SessionEntry[] = []
  const earlier: SessionEntry[] = []
  for (const s of sessions) {
    if (s.archived) earlier.push(s)
    else active.push(s)
  }
  return { active, earlier }
}

/** Official reserved group names that cannot be assigned (cNg / soo). */
const RESERVED_FLEET_GROUP_NAMES = new Set([
  'pinned',
  'ungrouped',
  '(ungrouped)',
  'past',
  '(earlier)',
  'earlier',
  'review',
  'blocked',
  'working',
  'done',
])

/**
 * Normalize custom group name (official group assign / Ges).
 * Empty / whitespace / reserved → ungrouped (undefined).
 * Max 64 chars (official lNg).
 */
export function normalizeFleetGroupName(raw: string): string | undefined {
  const cleaned = raw
    // biome-ignore lint/suspicious/noControlCharactersInRegex: strip control
    .replace(/[\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64)
  if (!cleaned) return undefined
  if (RESERVED_FLEET_GROUP_NAMES.has(cleaned.toLowerCase())) return undefined
  return cleaned
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
 * Official OhO/q1q: n9(ms, { mostSignificantOnly: true }) → formatDuration.
 */
export function formatJobAge(
  startedAt: number,
  now: number = Date.now(),
): string {
  if (!Number.isFinite(startedAt)) return ''
  const ms = Math.max(0, now - startedAt)
  return formatDuration(ms, { mostSignificantOnly: true })
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
// Dispatch parsing (official e$a)
// ---------------------------------------------------------------------------

/** Official H5b — minimum free-form intent length (not bash/template match). */
export const FLEET_MIN_INTENT_LEN = 4

/** Official Vkt — paste above this char count becomes a placeholder. */
export const FLEET_PASTE_CHAR_THRESHOLD = 800

/**
 * densable CJ fSg — Ctrl+C double-press arm window (ms).
 * Second Ctrl+C within this window → Tt exit; else Mt auto-clears.
 */
export const FLEET_EXIT_ARM_MS = 800

/**
 * Parse dispatch input text into a structured command.
 * Upstream: e$a (parseDispatch)
 *
 * - `!cmd` → bash exec
 * - `@name` → template / routine / cwd basename mention (stripped from intent)
 * - leading template name token → matched template
 */
export type ParsedDispatch = {
  intent: string
  matched: boolean
  cwd?: string
  /** Bash mode / `!` prefix — command to exec (not an agent prompt). */
  exec?: string
  routine?: string
  templateName?: string
}

export type DispatchMentionTarget = {
  name: string
}

export function parseDispatch(
  input: string,
  templates: readonly DispatchMentionTarget[] = [],
  cwdByBasename: Readonly<Record<string, string>> = {},
  routines: readonly DispatchMentionTarget[] = [],
): ParsedDispatch {
  const trimmed = input.trim()
  if (trimmed.startsWith('!')) {
    const exec = trimmed.slice(1).trim()
    return { intent: '', matched: !!exec, exec }
  }

  const lower = trimmed.toLowerCase()
  // Skip special prefixes (a: = attach, s: = search, o: = open)
  if (
    lower.startsWith('a:') ||
    lower.startsWith('s:') ||
    lower.startsWith('o:')
  ) {
    return { intent: '', matched: false }
  }

  let matchedTemplate: DispatchMentionTarget | undefined
  let cwd: string | undefined
  let routine: string | undefined

  const stripped = trimmed
    .replace(/(?:^|\s)@(\S+)/g, (full, name: string) => {
      const y = name.toLowerCase()
      const t = templates.find(b => b.name.toLowerCase() === y)
      if (t) {
        matchedTemplate ??= t
        return ''
      }
      const r = routines.find(b => b.name.toLowerCase() === y)
      if (r) {
        routine ??= r.name
        return ''
      }
      const key = Object.keys(cwdByBasename).find(b => b.toLowerCase() === y)
      if (key) {
        cwd ??= cwdByBasename[key]
        return ''
      }
      return full
    })
    .trim()

  const d = stripped.search(/\s/)
  const first = (d < 0 ? stripped : stripped.slice(0, d)).toLowerCase()
  const firstTemplate = matchedTemplate
    ? undefined
    : templates.find(m => m.name.toLowerCase() === first)
  if (firstTemplate) {
    return {
      intent: d < 0 ? '' : stripped.slice(d + 1).trim(),
      matched: true,
      cwd,
      routine,
      templateName: firstTemplate.name,
    }
  }
  if (matchedTemplate) {
    return {
      intent: stripped,
      matched: true,
      cwd,
      routine,
      templateName: matchedTemplate.name,
    }
  }
  return {
    intent: stripped,
    matched: false,
    cwd,
    routine,
  }
}

/** Official hat — newline count for paste placeholder. */
export function countNewlines(text: string): number {
  return (text.match(/\r\n|\r|\n/g) || []).length
}

/** Official uor — `[Pasted text #N]` / `+M lines`. */
export function formatPastedTextPlaceholder(
  id: number,
  newlineCount: number,
): string {
  if (newlineCount === 0) return `[Pasted text #${id}]`
  return `[Pasted text #${id} +${newlineCount} lines]`
}

/**
 * Official jye — expand `[Pasted text #N …]` refs using stored paste map.
 */
export function expandPastedTextRefs(
  text: string,
  pastes: Readonly<Record<number, string>>,
): string {
  if (!text) return text
  const re =
    /\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g
  const matches = [...text.matchAll(re)].filter(m => {
    const id = parseInt(m[2] || '0', 10)
    return id > 0 && pastes[id] !== undefined
  })
  if (matches.length === 0) return text
  let out = text
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!
    const id = parseInt(m[2]!, 10)
    const content = pastes[id]
    if (content === undefined) continue
    const index = m.index ?? 0
    out = out.slice(0, index) + content + out.slice(index + m[0].length)
  }
  return out
}

/**
 * Build cwd basename → absolute path map from sessions (for @mention).
 * Later sessions win on basename collision (official map overwrite).
 */
export function buildCwdBasenameMap(
  sessions: readonly SessionEntry[],
): Record<string, string> {
  const map: Record<string, string> = {}
  for (const s of sessions) {
    if (!s.cwd) continue
    const base = s.cwd
      .replace(/[/\\]+$/, '')
      .split(/[/\\]/)
      .pop()
    if (base) map[base] = s.cwd
  }
  return map
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
 * - Terminal (completed/failed/stopped) → ∙ (bullet)
 * - Working / blocked / review → ✻ (asterisk; color via glyphColor)
 */
export function pickIcon(
  band: StatusBand,
  _activity: Activity,
  _pinned?: boolean,
): string {
  if (band === 'completed') {
    return '\u2219' // ∙ terminal
  }
  return '\u273B' // ✻ non-terminal
}

// ---------------------------------------------------------------------------
// Done cap (fold)
// ---------------------------------------------------------------------------

/**
 * Calculate how many "done" sessions to show before folding.
 * Upstream: oQ_ (doneCapForRows) — legacy; FleetView prefers XFa doneCap.
 */
export function doneCapForRows(totalRows: number): number {
  return Math.max(Math.floor(totalRows / 5), 2)
}

/** densable JFa — only fold done when (done+earlier) >= doneCap + JFa. */
export const FLEET_DONE_FOLD_MIN_HIDDEN = 3

/**
 * densable zwf gate (simplified without earlier interleave / sticky id):
 * if totalDone < doneCap + JFa → Infinity (no fold); else doneCap.
 * doneCap=0 is valid (compact short terminal may yield 0).
 */
export function fleetDoneFoldAt(
  doneCount: number,
  earlierCount: number,
  doneCap: number,
): number {
  const total = doneCount + earlierCount
  if (total < doneCap + FLEET_DONE_FOLD_MIN_HIDDEN) {
    return Number.POSITIVE_INFINITY
  }
  return Math.max(0, doneCap)
}

/**
 * densable XFa(e=rows, t=listEst):
 *   remaining(header) = rows - N5b(8) - header - t
 *   if remaining(F5b=4) >= Fwf(3) → full header + that doneCap
 *   else → compactHeader ($5b=2) + remaining(2) doneCap
 */
export type FleetHeaderBudget = {
  doneCap: number
  compactHeader: boolean
}

/** densable N5b / F5b / $5b / Fwf */
const FLEET_CHROME_ROWS = 8
const FLEET_FULL_HEADER_ROWS = 4
const FLEET_COMPACT_HEADER_ROWS = 2
const FLEET_MIN_DONE_ROWS = 3

export function fleetHeaderBudget(
  termRows: number,
  listRowEstimate: number,
): FleetHeaderBudget {
  const remaining = (headerRows: number) =>
    termRows - FLEET_CHROME_ROWS - headerRows - listRowEstimate
  const withFull = remaining(FLEET_FULL_HEADER_ROWS)
  if (withFull >= FLEET_MIN_DONE_ROWS) {
    return { doneCap: withFull, compactHeader: false }
  }
  return {
    doneCap: Math.max(0, remaining(FLEET_COMPACT_HEADER_ROWS)),
    compactHeader: true,
  }
}

/**
 * densable XFa `t` argument.
 * State mode: non-done jobs outside folded groups + max(0, distinctGroups*2-1)
 * Other modes: allJobs + max(0, distinctGroups*2-1)
 */
export function fleetXfaListEstimate(opts: {
  mode: 'state' | 'other'
  distinctGroupCount: number
  /** state: count of non-done jobs whose group is not folded */
  visibleNonDoneJobs?: number
  /** other modes: all main jobs */
  allJobs?: number
}): number {
  const groupPad = Math.max(0, opts.distinctGroupCount * 2 - 1)
  if (opts.mode === 'state') {
    return (opts.visibleNonDoneJobs ?? 0) + groupPad
  }
  return (opts.allJobs ?? 0) + groupPad
}

/** densable wpe flag only. */
export function shouldCompactFleetHeader(
  termRows: number,
  listRowEstimate: number,
): boolean {
  return fleetHeaderBudget(termRows, listRowEstimate).compactHeader
}

// ---------------------------------------------------------------------------
// Column widths + artifact label (official $hO / zhO)
// ---------------------------------------------------------------------------

export type FleetColumnWidths = {
  /** Name column content width (icon rendered separately with +2). */
  label: number
  /** Age column content width. */
  age: number
  /** PR artifact column content width; 0 hides column. */
  artifact: number
}

/**
 * Official zhO densable — PR artifact text for a session row.
 * Multi-PR → "N PRs"; single with number → "PR #N"; bare PR → "PR".
 */
export function sessionArtifactLabel(session: SessionEntry): string {
  const count = session.prCount ?? (session.prNumber !== undefined ? 1 : 0)
  if (count > 1) return `${count} PRs`
  if (session.prNumber !== undefined) return `PR #${session.prNumber}`
  if (session.prUrl) return 'PR'
  return ''
}

/**
 * Official $hO densable — fixed column widths across the visible job list.
 * label: min 12 max 40; age: max of formatted ages (min 3); artifact: max label width.
 */
export function computeFleetColumnWidths(
  sessions: SessionEntry[],
  labelOf: (s: SessionEntry) => string = jobLabel,
): FleetColumnWidths {
  const label = Math.min(
    40,
    Math.max(12, ...sessions.map(s => labelOf(s).length), 12),
  )
  const age = Math.max(
    3,
    ...sessions.map(s => formatJobAge(s.startedAt).length),
    3,
  )
  const artifact = Math.max(
    0,
    ...sessions.map(s => sessionArtifactLabel(s).length),
    0,
  )
  return { label, age, artifact }
}

// ---------------------------------------------------------------------------
// Flat row list (state grouping — official cw4 order)
// ---------------------------------------------------------------------------

/** Official group order after pinned: review → blocked → working → done. */
export const FLEET_STATE_GROUP_ORDER = [
  'pinned',
  'review',
  'blocked',
  'working',
  'done',
] as const

export type FleetStateGroup = (typeof FLEET_STATE_GROUP_ORDER)[number]

/** Official lw4 group labels. */
export const FLEET_STATE_GROUP_LABELS: Record<FleetStateGroup, string> = {
  pinned: 'Pinned',
  review: 'Ready for review',
  blocked: 'Needs input',
  working: 'Working',
  done: 'Completed',
}

/**
 * Official L5b — helper copy under state headers / empty groups.
 */
export const FLEET_STATE_GROUP_DESCRIPTIONS: Record<
  Exclude<FleetStateGroup, 'pinned'>,
  string
> = {
  review: '',
  blocked: 'Sessions that have a question or need your decision land here',
  working:
    'Sessions Claude is actively working on — they keep running even if you close the terminal',
  done: 'Finished sessions wait here for you to review',
}

export type FleetFlatRow =
  | { kind: 'header'; group: string }
  | { kind: 'job'; session: SessionEntry }
  | { kind: 'fold'; group: string; hidden: number }

/**
 * Build selectable flat rows for state-mode FleetView.
 * - Headers always selectable; Enter toggles fold via foldedGroups.
 * - Done group applies doneCap unless doneCapExpanded (fold row expands).
 */
export function buildStateModeFlatRows(input: {
  pinned: SessionEntry[]
  review: SessionEntry[]
  blocked: SessionEntry[]
  working: SessionEntry[]
  done: SessionEntry[]
  foldedGroups: ReadonlySet<string>
  doneCap: number
  doneCapExpanded: boolean
}): FleetFlatRow[] {
  const rows: FleetFlatRow[] = []
  const byGroup: Record<FleetStateGroup, SessionEntry[]> = {
    pinned: input.pinned,
    review: input.review,
    blocked: input.blocked,
    working: input.working,
    done: input.done,
  }

  for (const group of FLEET_STATE_GROUP_ORDER) {
    const items = byGroup[group]
    if (items.length === 0) continue
    rows.push({ kind: 'header', group })
    if (input.foldedGroups.has(group)) continue

    // densable: fold when finite doneCap and items exceed it (0 is valid).
    if (
      group === 'done' &&
      !input.doneCapExpanded &&
      Number.isFinite(input.doneCap) &&
      items.length > input.doneCap
    ) {
      const cap = Math.max(0, input.doneCap)
      for (const session of items.slice(0, cap)) {
        rows.push({ kind: 'job', session })
      }
      rows.push({
        kind: 'fold',
        group: 'done',
        hidden: items.length - cap,
      })
    } else {
      for (const session of items) {
        rows.push({ kind: 'job', session })
      }
    }
  }
  return rows
}

/**
 * Directory mode: selectable cwd headers + jobs (current cwd first).
 */
export function buildDirectoryModeFlatRows(input: {
  groups: Array<[string, SessionEntry[]]>
  foldedGroups: ReadonlySet<string>
}): FleetFlatRow[] {
  const rows: FleetFlatRow[] = []
  for (const [cwd, items] of input.groups) {
    if (items.length === 0) continue
    const group = `dir:${cwd}`
    rows.push({ kind: 'header', group })
    if (input.foldedGroups.has(group)) continue
    for (const session of items) {
      rows.push({ kind: 'job', session })
    }
  }
  return rows
}

/**
 * Custom group mode (official fleetViewGroupMode === 'group').
 * Headers are group:name (or group:ungrouped). Optional earlier fold.
 */
export function buildCustomGroupModeFlatRows(input: {
  groups: Array<[string, SessionEntry[]]>
  foldedGroups: ReadonlySet<string>
  earlier?: SessionEntry[]
  earlierExpanded?: boolean
}): FleetFlatRow[] {
  const rows: FleetFlatRow[] = []
  for (const [name, items] of input.groups) {
    if (items.length === 0) continue
    const group = `group:${name}`
    rows.push({ kind: 'header', group })
    if (input.foldedGroups.has(group)) continue
    for (const session of items) {
      rows.push({ kind: 'job', session })
    }
  }
  const earlier = input.earlier ?? []
  if (earlier.length > 0) {
    rows.push({ kind: 'header', group: 'earlier' })
    if (!input.foldedGroups.has('earlier') && input.earlierExpanded) {
      for (const session of earlier) {
        rows.push({ kind: 'job', session })
      }
    } else if (!input.foldedGroups.has('earlier') && !input.earlierExpanded) {
      rows.push({ kind: 'fold', group: 'earlier', hidden: earlier.length })
    }
  }
  return rows
}

/**
 * Build footer chord hints aligned with official FleetView footer.
 * Help mode mirrors official n_k/Swf: include "@ to mention" when canMention.
 */
export function buildFleetFooterHints(input: {
  focusArea: 'list' | 'dispatch'
  viewMode: 'list' | 'rename' | 'reply' | 'group'
  deletePending: boolean
  ungroupPending: boolean
  rowKind?: 'header' | 'job' | 'fold'
  band?: StatusBand
  canPin: boolean
  canGroup: boolean
  canRename: boolean
  /** Official Swf — show "@ to mention" when sessions exist. */
  canMention?: boolean
  /** Dispatch composer is in bash (`!`) mode. */
  bashMode?: boolean
  pinned?: boolean
  openSlots: number
  exitArmed: boolean
  runningCount: number
  helpOpen: boolean
}): string {
  if (input.helpOpen) {
    const parts: string[] = []
    parts.push('shift+\u2191\u2193 to reorder')
    if (input.canRename) parts.push('ctrl+r to rename')
    if (input.canGroup) parts.push('ctrl+e to set group')
    parts.push('ctrl+s to switch views')
    if (input.canMention) parts.push('@ to mention')
    if (input.canPin) {
      parts.push(input.pinned ? 'ctrl+t to unpin' : 'ctrl+t to pin to top')
    }
    if (input.openSlots > 0) {
      parts.push(
        input.openSlots === 1
          ? 'alt+1 to open'
          : `alt+1-${Math.min(input.openSlots, 9)} to open`,
      )
    }
    parts.push('esc to quit')
    parts.push('? to close')
    return parts.join(' \u00b7 ')
  }
  if (input.exitArmed) {
    // densable Mt: only Ctrl+C double-press arms exit (CJ); Esc is cascade + Tt.
    const keep =
      input.runningCount > 0
        ? ` \u00b7 ${input.runningCount} agent${input.runningCount === 1 ? '' : 's'} will keep running`
        : ''
    return `Press Ctrl-C again to exit${keep}`
  }
  if (input.viewMode === 'rename') {
    return 'enter to save \u00b7 esc to cancel'
  }
  if (input.viewMode === 'group') {
    return 'enter to set group \u00b7 empty = ungroup \u00b7 esc to cancel'
  }
  if (input.viewMode === 'reply') {
    return 'enter to send \u00b7 esc to cancel'
  }
  if (input.deletePending) {
    return input.ungroupPending
      ? 'ctrl+x again to ungroup'
      : 'ctrl+x again to delete'
  }
  if (input.focusArea === 'dispatch') {
    if (input.bashMode) {
      return 'enter run bash \u00b7 backspace exit ! \u00b7 esc clear \u00b7 ? shortcuts'
    }
    return 'enter dispatch \u00b7 ! bash \u00b7 @ mention \u00b7 ctrl+j for newline \u00b7 \u2191 list \u00b7 esc clear'
  }

  const parts: string[] = []
  if (input.rowKind === 'fold') {
    parts.push('enter to show')
  } else if (input.rowKind === 'header') {
    parts.push('enter to fold')
  } else {
    parts.push('enter to open')
    if (input.band === 'blocked') parts.push('space to reply')
  }
  if (input.canRename) parts.push('ctrl+r to rename')
  if (input.canGroup) parts.push('ctrl+e to set group')
  parts.push('ctrl+s to switch views')
  if (input.canMention) parts.push('@ to mention')
  if (input.canPin) {
    parts.push(input.pinned ? 'ctrl+t to unpin' : 'ctrl+t to pin to top')
  }
  if (input.openSlots > 0) {
    parts.push(
      input.openSlots === 1
        ? 'alt+1 to open'
        : `alt+1-${Math.min(input.openSlots, 9)} to open`,
    )
  }
  parts.push('shift+\u2191\u2193 reorder')
  parts.push('esc to quit')
  parts.push('? for shortcuts')
  return parts.join(' \u00b7 ')
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

// ---------------------------------------------------------------------------
// Attach settle copy (official jC6 / wtK / FV-attach)
// ---------------------------------------------------------------------------

/**
 * Map raw attach/respawn errors to FleetView remount strings.
 * - ENOJOB / still-starting class → "Session is still starting — try again…"
 * - other failures → "Couldn't attach — …"
 */
export function formatAttachError(msg: string | undefined): string {
  if (!msg) return "Couldn't attach to that session"
  if (
    /ENOJOB|not found|restarting|estarting|still starting|socket missing|ENOTCONN|ENOCONN/i.test(
      msg,
    )
  ) {
    return 'Session is still starting \u2014 try again in a moment'
  }
  if (/^Couldn't attach/i.test(msg)) return msg
  return `Couldn't attach \u2014 ${msg}`
}

/**
 * Official isOrigin match: job id / short equals or prefixes restore/current id.
 */
export function isOriginSessionId(
  session: Pick<SessionEntry, 'sessionId' | 'short'>,
  originSessionId: string | undefined,
): boolean {
  if (!originSessionId) return false
  return (
    session.sessionId === originSessionId ||
    session.short === originSessionId ||
    (!!session.sessionId &&
      originSessionId.startsWith(session.sessionId.slice(0, 8))) ||
    (!!session.short && originSessionId.startsWith(session.short))
  )
}
