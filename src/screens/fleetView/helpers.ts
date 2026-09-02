/**
 * FleetView helpers — derived from upstream's minified FleetView module.
 *
 * These functions classify, sort, and label background sessions for the
 * agent view dashboard.
 */

import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
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
    // State-mode unpinned: V0n (stateSortOrder) before directory pOs.
    if (!a.pinned && !b.pinned) {
      const ssoA = a.stateSortOrder
      const ssoB = b.stateSortOrder
      if (ssoA !== undefined && ssoB !== undefined && ssoA !== ssoB) {
        return ssoA - ssoB
      }
      if (ssoA !== undefined && ssoB === undefined) return -1
      if (ssoA === undefined && ssoB !== undefined) return 1
    }
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

/** densable Oc(() => cO(null), cy ? 2000 : null) — Ctrl+X delete/ungroup arm window. */
export const FLEET_DELETE_ARM_MS = 2000

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

/**
 * Official JIy Esc: `d!==void 0 && p && (d!=="NORMAL" || query!=="")`
 * → vim handler (INSERT→NORMAL, keep text) instead of `ee("")` clear.
 */
export function shouldFleetViewVimHandleEscape(
  vimMode: 'INSERT' | 'NORMAL' | undefined,
  dispatchInputActive: boolean,
  query: string,
): boolean {
  return (
    vimMode !== undefined &&
    dispatchInputActive &&
    (vimMode !== 'NORMAL' || query !== '')
  )
}

/** densable aVA — composed dispatch (intent / routine / match / cwd / exec). */
export function hasComposedDispatch(
  parsed: ParsedDispatch | null | undefined,
): boolean {
  return !!(
    parsed &&
    (parsed.intent ||
      parsed.routine ||
      parsed.matched ||
      parsed.cwd !== undefined ||
      parsed.exec !== undefined)
  )
}

/**
 * densable JIy: physical up/down with a newline → leftover `u(t)`.
 * ctrl+p / ctrl+n never take this branch.
 */
export function shouldFleetViewArrowDelegateToEditor(
  previewOpen: boolean,
  query: string,
): boolean {
  return !previewOpen && query.includes('\n')
}

/**
 * densable JIy tab: empty prompt + templates → toggle showAllAgents.
 * simpleView returns before this (no-op).
 */
export function shouldFleetViewTabToggleAllAgents(
  simpleView: boolean,
  query: string,
  mode: 'prompt' | 'bash',
  templateCount: number,
): boolean {
  return !simpleView && query === '' && mode === 'prompt' && templateCount > 0
}

/**
 * densable JIy right: empty prompt, no shift, no preview → open focused row.
 */
export function shouldFleetViewRightOpenFocusedRow(
  shift: boolean,
  query: string,
  mode: 'prompt' | 'bash',
  previewOpen: boolean,
): boolean {
  return !shift && query === '' && mode === 'prompt' && !previewOpen
}

/**
 * densable JIy: simpleView && !preview && renaming==null → q/l then skip leftover.
 */
export function shouldFleetViewSimpleViewSkipLeftover(
  simpleView: boolean,
  previewOpen: boolean,
  renaming: boolean,
): boolean {
  return simpleView && !previewOpen && !renaming
}

/**
 * densable ICy — sort templates by agentLastUsed desc, then name.
 * Callers pass `getGlobalConfig().agentLastUsed ?? {}`.
 */
export function sortFleetTemplatesByLastUsed<T extends { name: string }>(
  templates: readonly T[],
  lastUsed: Record<string, number> = {},
): T[] {
  return templates.slice().sort((a, b) => {
    const delta = (lastUsed[b.name] ?? 0) - (lastUsed[a.name] ?? 0)
    return delta !== 0 ? delta : a.name.localeCompare(b.name)
  })
}

/**
 * densable CAe.name analog — A8q default template when no agent is set.
 * UCy skips this so idle/default jobs do not pollute last-used sort.
 */
export const FLEET_DEFAULT_TEMPLATE_NAME = 'bg'

/**
 * densable UCy — backfill agentLastUsed from job createdAt.
 * Skip default template; skip keys already present; keep max createdAt.
 */
export function migrateAgentLastUsedFromJobs(
  current: Record<string, number>,
  jobs: readonly { template?: string; createdAt?: string }[],
  skipTemplate: string = FLEET_DEFAULT_TEMPLATE_NAME,
): { next: Record<string, number>; changed: boolean } {
  const next = { ...current }
  let changed = false
  for (const job of jobs) {
    const template = job.template
    if (!template || template === skipTemplate) continue
    if (current[template] !== undefined) continue
    const created = Date.parse(job.createdAt ?? '')
    if (Number.isNaN(created)) continue
    if (created > (next[template] ?? 0)) {
      next[template] = created
      changed = true
    }
  }
  return { next, changed }
}

/** densable AqA — VIy poll window after xAe. */
export const FLEET_NEW_SESSION_WAIT_MS = 5000

/** densable VIy `await Pr(100)`. */
export const FLEET_NEW_SESSION_POLL_MS = 100

/** densable VIy row_pending copy. */
export const FLEET_NEW_SESSION_PENDING_MSG =
  'Still starting \u2014 open the new session once it appears'

/** densable VIy: `newSessionOpening || attachingJobId !== null`. */
export function isFleetNewSessionSpawnBusy(
  newSessionOpening: boolean,
  attachingJobId: string | null,
): boolean {
  return newSessionOpening || attachingJobId !== null
}

/** densable VIy throw copy: `Couldn't start a new session — ${le(d)}`. */
export function formatFleetNewSessionThrow(err: unknown): string {
  const msg =
    err instanceof Error ? err.message : err !== undefined ? String(err) : ''
  return `Couldn't start a new session \u2014 ${msg}`
}

/** densable VIy `n.jobs?.find(f => f.id === u.short)`. */
export function findFleetJobByShort<T extends { short?: string; id?: string }>(
  jobs: readonly T[] | undefined,
  short: string,
): T | undefined {
  return jobs?.find(j => j.id === short || j.short === short)
}

/** densable VIy reload + poll until short appears or AqA. */
export async function waitForFleetJobByShort<
  T extends { short?: string; id?: string },
>(
  loadJobs: () => Promise<readonly T[] | undefined>,
  short: string,
  opts: {
    deadlineAt: number
    isCurrent: () => boolean
    now?: () => number
    sleep?: (ms: number) => Promise<void>
    intervalMs?: number
  },
): Promise<T | undefined> {
  const now = opts.now ?? Date.now
  const sleep = opts.sleep ?? (ms => new Promise(r => setTimeout(r, ms)))
  const interval = opts.intervalMs ?? FLEET_NEW_SESSION_POLL_MS
  let job = findFleetJobByShort(await loadJobs(), short)
  while (!job && now() < opts.deadlineAt && opts.isCurrent()) {
    await sleep(interval)
    job = findFleetJobByShort(await loadJobs(), short)
  }
  return job
}

/** densable JIy ctrl+s: simpleView returns before cycling group mode. */
export function shouldFleetViewCycleGroupMode(simpleView: boolean): boolean {
  return !simpleView
}

/**
 * densable JIy `!` → bash: `vgn()&&!simpleView` + empty prompt.
 */
export function shouldFleetViewEnterBashFromBang(
  simpleView: boolean,
  query: string,
  mode: 'prompt' | 'bash',
): boolean {
  return !simpleView && query === '' && mode === 'prompt'
}

/** densable JIy `?`: empty prompt only. */
export function shouldFleetViewToggleHelp(
  query: string,
  mode: 'prompt' | 'bash',
): boolean {
  return query === '' && mode === 'prompt'
}

/**
 * densable GP `isActive: Ct` — leftover always `u(t)`; editor is live unless
 * simpleView / preview / rename / group / attach / resume picker.
 * Official: previewOpen gates the composer; Esc closes peek first.
 */
export function isFleetComposerActive(opts: {
  simpleView: boolean
  previewOpen: boolean
  renaming: boolean
  groupEdit: boolean
  attaching: boolean
  resumePicker: boolean
}): boolean {
  return (
    !opts.simpleView &&
    !opts.previewOpen &&
    !opts.renaming &&
    !opts.groupEdit &&
    !opts.attaching &&
    !opts.resumePicker
  )
}

/**
 * densable JIy: shift+↑/↓ → RqA when no suggestions and preview closed.
 * No focusArea check — works from list or dispatch.
 */
export function shouldFleetViewReorder(
  suggestionCount: number,
  previewOpen: boolean,
): boolean {
  return suggestionCount === 0 && !previewOpen
}

/** densable Plu / LCy kinds for FCy suggestions. */
export type FleetComposerSuggestionKind =
  | 'agent'
  | 'routine'
  | 'repo'
  | 'worktree'
  | 'skill'
  | 'command'
  | 'workflow'
  | 'model'

export type FleetComposerSuggestion = {
  kind: FleetComposerSuggestionKind
  name: string
  description?: string
}

const FLEET_SUGGESTION_PREFIX: Record<FleetComposerSuggestionKind, '@' | '/'> =
  {
    agent: '@',
    repo: '@',
    worktree: '@',
    routine: '@',
    skill: '/',
    command: '/',
    workflow: '/',
    model: '/',
  }

/** densable Plu — apply prefix for a FCy suggestion kind. */
export function fleetSuggestionDisplayText(
  suggestion: FleetComposerSuggestion,
): string {
  return `${FLEET_SUGGESTION_PREFIX[suggestion.kind]}${suggestion.name}`
}

function asFleetAgent(t: {
  name: string
  description?: string
}): FleetComposerSuggestion {
  return { kind: 'agent', name: t.name, description: t.description }
}

function asFleetRoutine(t: {
  name: string
  description?: string
}): FleetComposerSuggestion {
  return { kind: 'routine', name: t.name, description: t.description }
}

/** densable HCy */
function fleetRepoOrWorktree(
  name: string,
  repos: Record<string, string>,
  worktreeBranches: Record<string, string>,
): FleetComposerSuggestion {
  const branch = worktreeBranches[name]
  if (branch === undefined) {
    return { kind: 'repo', name, description: repos[name] }
  }
  return {
    kind: 'worktree',
    name,
    description: branch || repos[name],
  }
}

/**
 * densable FCy — Fleet composer suggestions.
 * Slash `/` commands stay with tip `generateCommandSuggestions` (skills/B5A
 * not a second command catalog). Models/skills default [].
 */
export function buildFleetComposerSuggestions(
  query: string,
  opts: {
    templates?: readonly { name: string; description?: string }[]
    routines?: readonly { name: string; description?: string }[]
    repos?: Record<string, string>
    worktreeBranches?: Record<string, string>
    skills?: readonly FleetComposerSuggestion[]
    models?: readonly { name: string }[]
    dispatch: ParsedDispatch | null | undefined
    showAllAgents?: boolean
    lastUsed?: Record<string, number>
  },
): FleetComposerSuggestion[] {
  const templates = opts.templates ?? []
  const routines = opts.routines ?? []
  const repos = opts.repos ?? {}
  const worktreeBranches = opts.worktreeBranches ?? {}
  const skills = opts.skills ?? []
  const models = opts.models ?? []
  const space = query.indexOf(' ')
  const first = (space === -1 ? query : query.slice(0, space)).toLowerCase()
  const isSlashQuery = first.startsWith('/')
  const atMatch = query.match(/(?:^|\s)@(\S*)$/)
  const atPartial = atMatch?.[1]?.toLowerCase()
  const prefixBeforeAt = atMatch
    ? query.slice(0, query.length - atMatch[0].length)
    : ''
  const prefixHasCwd =
    !!atMatch &&
    parseDispatch(
      prefixBeforeAt,
      templates.map(t => ({ name: t.name })),
      repos,
      routines.map(r => ({ name: r.name })),
    ).cwd !== undefined
  const claimed = new Set([
    ...templates.map(t => t.name.toLowerCase()),
    ...routines.map(r => r.name.toLowerCase()),
  ])
  const repoNames = Object.keys(repos).filter(
    n => !claimed.has(n.toLowerCase()) && !/\s/.test(n),
  )
  const byName = (a: { name: string }, b: { name: string }) =>
    a.name.localeCompare(b.name)
  const atSuggestions =
    atPartial === undefined
      ? []
      : [
          ...sortFleetTemplatesByLastUsed(templates, opts.lastUsed)
            .filter(t => t.name.toLowerCase().startsWith(atPartial))
            .map(asFleetAgent),
          ...routines
            .filter(r => r.name.toLowerCase().startsWith(atPartial))
            .sort(byName)
            .map(asFleetRoutine),
          ...(prefixHasCwd
            ? []
            : repoNames
                .filter(n => n.toLowerCase().startsWith(atPartial))
                .sort((a, b) => a.localeCompare(b))
                .map(n => fleetRepoOrWorktree(n, repos, worktreeBranches))),
        ]
  const slashMatch = query.match(/(?:^|\s)\/(\S*)$/)
  const slashPartial = slashMatch?.[1]?.toLowerCase()
  const fleetModelCmd: FleetComposerSuggestion = {
    kind: 'model',
    name: 'model',
    description: 'Set model for this FleetView session (not persisted)',
  }
  const slashSuggestions =
    slashPartial === undefined
      ? []
      : [...(isSlashQuery ? [fleetModelCmd] : []), ...skills]
          .filter(s => s.name.toLowerCase().includes(slashPartial))
          .sort((a, b) => {
            const aPre = a.name.toLowerCase().startsWith(slashPartial)
            const bPre = b.name.toLowerCase().startsWith(slashPartial)
            if (aPre !== bPre) return aPre ? -1 : 1
            return a.name.localeCompare(b.name)
          })
  const modelArg = query.match(/^\s*\/model\s+(\S*)$/i)
  const modelPartial = modelArg?.[1]?.toLowerCase()
  const modelSuggestions =
    modelPartial === undefined
      ? []
      : models
          .filter(m => m.name.toLowerCase().startsWith(modelPartial))
          .map(m => ({ kind: 'model' as const, name: m.name }))
  const leadSuggestions = isSlashQuery
    ? []
    : [
        ...templates
          .filter(t => t.name.toLowerCase().startsWith(first))
          .sort(byName)
          .map(asFleetAgent),
        ...routines
          .filter(r => r.name.toLowerCase().startsWith(first))
          .sort(byName)
          .map(asFleetRoutine),
        ...repoNames
          .filter(n => n.toLowerCase().startsWith(first))
          .sort((a, b) => a.localeCompare(b))
          .map(n => fleetRepoOrWorktree(n, repos, worktreeBranches)),
        ...skills.filter(s => s.name.toLowerCase().startsWith(first)),
      ]
  const parsed = opts.dispatch
  if (!parsed || parsed.exec !== undefined) return []
  if (modelArg) return modelSuggestions
  if (atMatch) return atSuggestions
  if (slashMatch) return slashSuggestions
  if (opts.showAllAgents && !query) {
    return sortFleetTemplatesByLastUsed(templates, opts.lastUsed).map(
      asFleetAgent,
    )
  }
  if (!parsed.matched && first && !query.includes(' ')) {
    return leadSuggestions
  }
  return []
}

/**
 * densable Ouu — wrap list navigation. Composed+state/cwd freezes;
 * composed otherwise lands on non-pinned headers; preview lands on jobs.
 */
export function navigateFleetViewByArrow(
  rows: readonly FleetFlatRow[],
  focusedIdx: number,
  delta: -1 | 1,
  opts: {
    hasComposedDispatch: boolean
    byState: boolean
    dispatchRepoCwd?: string
    previewOpen: boolean
  },
): number {
  const len = rows.length
  if (len === 0) return 0
  if (opts.hasComposedDispatch && (opts.byState || opts.dispatchRepoCwd)) {
    return focusedIdx
  }
  const skip = opts.hasComposedDispatch
    ? (row: FleetFlatRow | undefined) =>
        row?.kind !== 'header' || row.group === 'pinned'
    : opts.previewOpen
      ? (row: FleetFlatRow | undefined) => row?.kind !== 'job'
      : null
  let next = (focusedIdx + delta + len) % len
  if (skip) {
    while (next !== focusedIdx && skip(rows[next])) {
      next = (next + delta + len) % len
    }
  }
  return next
}

/** densable JIy home/end/pageup/pagedown step (`Math.max(1, termRows-6)`). */
export function fleetViewPageJump(
  key: 'home' | 'end' | 'pageup' | 'pagedown',
  focusedIdx: number,
  rowCount: number,
  termRows: number,
): number {
  if (rowCount === 0) return 0
  const page = Math.max(1, termRows - 6)
  const raw =
    key === 'home'
      ? 0
      : key === 'end'
        ? rowCount - 1
        : key === 'pageup'
          ? focusedIdx - page
          : focusedIdx + page
  return Math.max(0, Math.min(rowCount - 1, raw))
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
/** Official W2v / rR — paste placeholders including Image / Audio. */
const FLEET_PASTE_REF_RE =
  /\[(Pasted text|Image|Audio|\.\.\.Truncated text) #(\d+)(?: \+\d+ lines)?(\.)*\]/g

export type FleetPasteRef = {
  id: number
  match: string
  index: number
  kind: string
}

export function parseFleetPasteRefs(text: string): FleetPasteRef[] {
  if (!text) return []
  return [...text.matchAll(FLEET_PASTE_REF_RE)]
    .map(r => ({
      id: parseInt(r[2] || '0', 10),
      match: r[0],
      index: r.index ?? 0,
      kind: r[1] ?? '',
    }))
    .filter(r => r.id > 0)
}

/** Official Ghi — `[Image #N]`. */
export function formatFleetImagePlaceholder(id: number): string {
  return `[Image #${id}]`
}

/**
 * Official Eet / jye — expand text refs only.
 * Image/Audio stay as placeholders (wbs rewrites Image to a job-dir path).
 */
export function expandPastedTextRefs(
  text: string,
  pastes: Readonly<Record<number, string>>,
): string {
  if (!text) return text
  const matches = parseFleetPasteRefs(text).filter(m => {
    if (m.kind === 'Image' || m.kind === 'Audio') return false
    return pastes[m.id] !== undefined
  })
  if (matches.length === 0) return text
  let out = text
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]!
    const content = pastes[m.id]
    if (content === undefined) continue
    out = out.slice(0, m.index) + content + out.slice(m.index + m.match.length)
  }
  return out
}

/** Official LOs setHint copies. */
export const FLEET_CLIPBOARD_IMAGE_NOT_FOUND = 'No image found in clipboard'
export const FLEET_CLIPBOARD_IMAGE_READ_FAILED =
  "Couldn't read an image from the clipboard"

/**
 * Official OOs — leftover image-paste chord.
 * ctrl+v on non-Windows; meta+v on windows|wsl. WSL accepts both.
 */
export function isFleetImagePasteKey(
  input: string,
  mods: { ctrl?: boolean; meta?: boolean },
  platform: string,
): boolean {
  if (input !== 'v') return false
  if (mods.ctrl && !mods.meta) return platform !== 'windows'
  if (mods.meta && !mods.ctrl) {
    return platform === 'windows' || platform === 'wsl'
  }
  return false
}

export type FleetImagePaste = {
  type: 'image'
  content: string
  mediaType?: string
}

/** Official wbs leaf: subtype before `;`, alphanumeric only. */
export function fleetPastedImageExt(mediaType?: string): string {
  const raw = (mediaType ?? 'image/png').split('/')[1] ?? 'png'
  const ext = raw.split(';')[0]?.trim() ?? ''
  return /^[a-z0-9]+$/i.test(ext) ? ext.toLowerCase() : 'png'
}

/**
 * Official wbs — replace `[Image #N]` with `jobs/<short>/pasted-N.ext`.
 * storageV5 write is official-only; tip uses writeFile encoding:base64.
 */
export async function materializeFleetPastedImages(
  text: string,
  pastes: Readonly<Record<number, FleetImagePaste | undefined>>,
  jobDir: string,
  io?: {
    mkdir?: (dir: string) => Promise<void>
    writeBase64?: (file: string, content: string) => Promise<void>
    join?: (...parts: string[]) => string
  },
): Promise<string> {
  const refs = parseFleetPasteRefs(text).filter(
    c => pastes[c.id]?.type === 'image',
  )
  if (refs.length === 0) return text
  const joinPath = io?.join ?? join
  const makeDir =
    io?.mkdir ??
    ((dir: string) => mkdir(dir, { recursive: true }).then(() => {}))
  const write =
    io?.writeBase64 ??
    ((file: string, content: string) =>
      writeFile(file, content, { encoding: 'base64' }))
  await makeDir(jobDir)
  let out = text
  for (let i = refs.length - 1; i >= 0; i--) {
    const ref = refs[i]!
    const paste = pastes[ref.id]
    if (!paste) continue
    const ext = fleetPastedImageExt(paste.mediaType)
    const name = `pasted-${ref.id}.${ext}`
    const file = joinPath(jobDir, name)
    await write(file, paste.content)
    out =
      out.slice(0, ref.index) + file + out.slice(ref.index + ref.match.length)
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
  | { kind: 'job'; session: SessionEntry; group?: string }
  | { kind: 'fold'; group: string; hidden: number }
  | { kind: 'earlier'; session: SessionEntry }
  | { kind: 'newsession' }

/** Official job.origin for Wky — launcher cwd match. */
export function fleetJobOrigin(session: SessionEntry): string {
  return session.cwd
}

/** Official pOs — sortOrder ?? Date.parse(createdAt). */
export function fleetDirectorySortKey(session: SessionEntry): number {
  return session.sortOrder ?? session.startedAt
}

/** Official V0n — stateSortOrder ?? Date.parse(group==="done" ? firstTerminalAt??updatedAt : updatedAt). */
export function fleetStateSortKey(
  session: SessionEntry,
  group: string,
): number {
  const state = group.startsWith('state:') ? group.slice(6) : group
  if (session.stateSortOrder !== undefined) return session.stateSortOrder
  if (state === 'done') {
    return session.firstTerminalAt ?? session.updatedAt ?? session.startedAt
  }
  return session.updatedAt ?? session.startedAt
}

export type FleetReorderPatch = {
  short: string
  field: 'sortOrder' | 'stateSortOrder'
  value: number
}

function fleetJobVisualGroup(
  rows: readonly FleetFlatRow[],
  idx: number,
): string | undefined {
  const row = rows[idx]
  if (row?.kind === 'job' && row.group) return row.group
  if (row?.kind !== 'job') return undefined
  for (let i = idx; i >= 0; i--) {
    const prev = rows[i]
    if (prev?.kind === 'header') return prev.group
  }
  return undefined
}

function fleetJobShort(session: SessionEntry): string {
  return session.short ?? session.sessionId?.slice(0, 8) ?? ''
}

/**
 * Official RqA — swap two daemon jobs in the same visual group.
 * Do not invent reorderIssued. Skip earlier rows; fold/header is a hard stop.
 */
export function planFleetReorder(
  rows: readonly FleetFlatRow[],
  focusedIdx: number,
  direction: -1 | 1,
  opts: {
    simpleView: boolean
    groupMode: 'state' | 'directory' | 'group'
    pendingIds?: ReadonlySet<string>
  },
): { patches: FleetReorderPatch[]; nextFocusedIdx: number } | null {
  const pending = opts.pendingIds ?? new Set<string>()
  const p = rows[focusedIdx]
  if (p?.kind !== 'job') return null
  let f = focusedIdx + direction
  while (rows[f]?.kind === 'earlier') f += direction
  const m = rows[f]
  if (m?.kind !== 'job') return null
  const pGroup = fleetJobVisualGroup(rows, focusedIdx)
  const mGroup = fleetJobVisualGroup(rows, f)
  if (!pGroup || pGroup !== mGroup) return null
  const h = p.session
  const g = m.session
  const hId = fleetJobShort(h)
  const gId = fleetJobShort(g)
  if (!hId || !gId) return null
  if (pending.has(hId) || pending.has(gId)) return null
  if (h.backend && h.backend !== 'daemon') return null
  if (g.backend && g.backend !== 'daemon') return null
  const pinnedGroup =
    pGroup === 'pinned' || pGroup === FLEET_SIMPLE_PINNED_GROUP
  if ((opts.groupMode === 'group' || opts.simpleView) && !pinnedGroup) {
    return null
  }
  const useState = opts.groupMode === 'state' && !pinnedGroup
  const keyOf = (s: SessionEntry): number =>
    useState ? fleetStateSortKey(s, pGroup) : fleetDirectorySortKey(s)
  const S = keyOf(h)
  const W = keyOf(g)
  const field: FleetReorderPatch['field'] = useState
    ? 'stateSortOrder'
    : 'sortOrder'
  const order = new Map<string, number>()
  if (S === W) {
    let x = 0
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row?.kind !== 'job') continue
      if (fleetJobVisualGroup(rows, i) !== pGroup) continue
      const id = fleetJobShort(row.session)
      if (!id || pending.has(id)) continue
      order.set(id, x++)
    }
    const from = order.get(hId)
    const to = order.get(gId)
    if (from === undefined || to === undefined) return null
    order.set(hId, to)
    order.set(gId, from)
  } else {
    order.set(hId, W)
    order.set(gId, S)
  }
  const patches: FleetReorderPatch[] = []
  for (const [short, value] of order) {
    patches.push({ short, field, value })
  }
  return { patches, nextFocusedIdx: f }
}

/**
 * densable Wky(rows, launcherCwd) — default list focus for grouped view.
 * Simple view uses 0 (the newsession row) instead.
 */
export function fleetHomeIdx(
  rows: ReadonlyArray<FleetFlatRow>,
  launcherOrigin: string,
): number {
  const second = rows[1]
  if (
    second?.kind === 'job' &&
    fleetJobOrigin(second.session) === launcherOrigin
  ) {
    return 1
  }
  if (second?.kind === 'earlier') return 1
  const earlierIdx = rows.findIndex(r => r.kind === 'earlier')
  return earlierIdx !== -1 && !rows.some(r => r.kind === 'job') ? earlierIdx : 0
}

/** densable oxy constants (2.1.239). */
export const FLEET_SIMPLE_PINNED_GROUP = 'simple:pinned' // iAn
export const FLEET_SIMPLE_FINISHED_GROUP = 'simple:finished' // OXt
const SIMPLE_Y5A = 172_800_000 // 48h
const SIMPLE_X5A = 3
const SIMPLE_J5A = 3
const SIMPLE_Z5A = 2
const SIMPLE_Q5A = 2
const SIMPLE_EVA = 4
const SIMPLE_TVA = 1
const SIMPLE_OLU = 4

export type SimpleStatusBand = 'needs' | 'live' | 'done'

/**
 * densable sAn — simple-view bucket. busy/shell → live; terminal → done;
 * waiting / waitingFor → needs; else live.
 */
export function simpleStatusBand(session: SessionEntry): SimpleStatusBand {
  const status = session.status
  if (status === 'busy' || status === 'running' || status === 'shell') {
    return 'live'
  }
  if (
    status === 'completed' ||
    status === 'done' ||
    status === 'failed' ||
    status === 'killed' ||
    status === 'stopped' ||
    status === 'idle'
  ) {
    return 'done'
  }
  if (status === 'waiting' || session.waitingFor) return 'needs'
  return 'live'
}

/** densable Qlu — recency for done sort / age fold. */
export function simpleJobRecencyMs(session: SessionEntry): number {
  return session.updatedAt ?? session.startedAt ?? 0
}

/** densable nVA(termRows, used) = max(0, rows - X5A - olu - used). */
export function simpleDoneCap(terminalRows: number, usedRows: number): number {
  return Math.max(0, terminalRows - SIMPLE_X5A - SIMPLE_OLU - usedRows)
}

export type SimpleModeBuilt = {
  rows: FleetFlatRow[]
  needsCount: number
  liveCount: number
}

/**
 * densable oxy — simple FleetView rows.
 * First row is always + new session. No Working/Completed headers.
 * Done fold uses capExpanded (`showFinishedEarlier`) as OXt.
 */
export function buildSimpleModeFlatRows(input: {
  sessions: readonly SessionEntry[]
  now: number
  terminalRows: number
  showFinishedEarlier: boolean
}): SimpleModeBuilt {
  const pinned: SessionEntry[] = []
  const needs: SessionEntry[] = []
  const live: SessionEntry[] = []
  const done: SessionEntry[] = []
  let needsCount = 0
  let liveCount = 0
  for (const session of input.sessions) {
    const band = simpleStatusBand(session)
    if (band === 'needs') needsCount++
    else if (band === 'live') liveCount++
    if (session.pinned) {
      pinned.push(session)
      continue
    }
    switch (band) {
      case 'needs':
        needs.push(session)
        break
      case 'live':
        live.push(session)
        break
      case 'done':
        done.push(session)
        break
    }
  }
  done.sort((a, b) => simpleJobRecencyMs(b) - simpleJobRecencyMs(a))

  const rows: FleetFlatRow[] = [{ kind: 'newsession' }]
  const pushJobs = (items: readonly SessionEntry[], group: string): void => {
    for (const session of items) rows.push({ kind: 'job', session, group })
  }
  pushJobs(pinned, FLEET_SIMPLE_PINNED_GROUP)
  pushJobs(needs, 'simple:needs')
  pushJobs(live, 'simple:live')

  const usedRows =
    1 +
    (live.length * SIMPLE_Z5A + (pinned.length + needs.length) * SIMPLE_J5A) +
    (needsCount + liveCount === 0 ? SIMPLE_EVA : 0) +
    (done.length > 0 ? 1 + SIMPLE_TVA : 0)
  const doneCap = simpleDoneCap(input.terminalRows, usedRows)
  const olderThanFold = done.filter(
    s => input.now - simpleJobRecencyMs(s) > SIMPLE_Y5A,
  ).length
  const overflow = Math.max(0, done.length - olderThanFold - doneCap)
  const hideRaw = input.showFinishedEarlier ? 0 : olderThanFold + overflow
  const hidden = hideRaw >= SIMPLE_Q5A ? hideRaw : 0
  pushJobs(done.slice(0, done.length - hidden), 'simple:done')
  if (hidden > 0) {
    rows.push({
      kind: 'fold',
      group: FLEET_SIMPLE_FINISHED_GROUP,
      hidden,
    })
  }
  return { rows, needsCount, liveCount }
}

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
        rows.push({ kind: 'job', session, group: 'state:done' })
      }
      rows.push({
        kind: 'fold',
        group: 'done',
        hidden: items.length - cap,
      })
    } else {
      const jobGroup = group === 'pinned' ? 'pinned' : `state:${group}`
      for (const session of items) {
        rows.push({ kind: 'job', session, group: jobGroup })
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
      rows.push({ kind: 'job', session, group })
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
      rows.push({ kind: 'job', session, group })
    }
  }
  const earlier = input.earlier ?? []
  if (earlier.length > 0) {
    rows.push({ kind: 'header', group: 'earlier' })
    if (!input.foldedGroups.has('earlier') && input.earlierExpanded) {
      for (const session of earlier) {
        rows.push({ kind: 'earlier', session })
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
  /** densable cy.justKilled — first X stopped the worker. */
  justKilled?: boolean
  rowKind?: FleetFlatRow['kind']
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
    if (input.ungroupPending) return 'ctrl+x again to ungroup'
    // densable footer: justKilled → "stopped · ctrl+x again to delete · esc to keep"
    if (input.justKilled) {
      return 'stopped \u00b7 ctrl+x again to delete \u00b7 esc to keep'
    }
    return 'ctrl+x again to delete \u00b7 esc to keep'
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
  } else if (input.rowKind === 'newsession') {
    // densable Wcu idle: `${arrowRight} or enter to start`
    parts.push('\u2192 or enter to start')
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

/**
 * densable Gnm — Esc after clearing help/dispatch/bash/delete-arm:
 * return to the left-arrow origin conversation when its row is present.
 */
export type OriginEscDecision =
  | { kind: 'exit' }
  | { kind: 'wait-starting' }
  | { kind: 'exit-with-hint' }
  | { kind: 'attach-origin' }

export type OriginSpawnState = {
  settled: boolean
  ok: boolean
  /** densable n.resumeHintRequested — set on exit-with-hint before done */
  resumeHintRequested?: boolean
}

export function decideOriginEscAction(input: {
  originJobId: string | undefined
  originRowPresent: boolean
  originSpawn?: OriginSpawnState
}): OriginEscDecision {
  if (input.originJobId === undefined) return { kind: 'exit' }
  if (input.originSpawn !== undefined && !input.originSpawn.settled) {
    return { kind: 'wait-starting' }
  }
  if (input.originSpawn !== undefined && !input.originSpawn.ok) {
    return { kind: 'exit-with-hint' }
  }
  return input.originRowPresent
    ? { kind: 'attach-origin' }
    : { kind: 'exit-with-hint' }
}

/** densable stderr after FleetView done when resumeHintRequested */
export function formatLeftArrowResumeHint(forkSessionId: string): string {
  return `Your conversation was backgrounded — resume it with: claude --resume ${forkSessionId}.`
}
