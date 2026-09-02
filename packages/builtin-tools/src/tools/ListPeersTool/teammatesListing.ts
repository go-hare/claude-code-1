/**
 * densable 2.1.239 #51 — OHm / Z1w / NHm / Eao / LHm / K1w ListAgents teammates.
 * Refs via sBr/pYb (sha256 `${kind}:${id}` hex, grow from sti=6).
 */
import {
  ownSessionRefExtra,
  pinDigest,
  uniqueHexPrefixes,
} from '../SendMessageTool/nameResolve.js'
import { normalizeAgentName } from '../SendMessageTool/nameResolve.js'
import { parseAddress } from 'src/utils/peerAddress.js'
import { formatDuration } from 'src/utils/format.js'
import { isUncOrNtObjectPath } from 'src/utils/path.js'
import type { AppState } from 'src/state/AppState.js'
import type { TeamFile } from 'src/utils/swarm/teamHelpers.js'
import { getAgentId } from 'src/utils/teammate.js'

/** densable fle / dYb — ALe display-name cap */
const LISTING_NAME_MAX = 200
/** densable Y1w */
const TEAMMATES_LISTING_CAP = 100
/** densable X1w — hide since-ago older than this */
const SINCE_HINT_MAX_MS = 315360000000
/** densable sti */
const REF_MIN = 6

export type TeammateListingRow = {
  teammateId: string
  name: string
  agentType?: string
  status?: string
  backend: 'in-process' | 'pane' | 'roster'
  since?: number
  nameShadowed: false | 'unreachable' | 'bare-only'
}

export type ListingKind =
  | 'teammate'
  | 'subagent'
  | 'session'
  | 'cloud-session'
  | 'bridge-session'

export type ListingCandidate = {
  kind: ListingKind
  id: string
  name: string
  ref: string
}

export type TeammateListingCandidate = ListingCandidate & {
  kind: 'teammate'
}

export type SubagentListingRow = {
  agentId: string
  name?: string
  agentType: string
  status: string
  startTime: number
}

/** densable ALe */
export function sanitizeListingName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const cleaned = [
    ...value
      .replace(/[\p{Cc}\p{Cf}]/gu, ch => (/\s/.test(ch) ? ch : ''))
      .replace(/\s+/g, ' ')
      .trim(),
  ]
    .slice(0, LISTING_NAME_MAX)
    .join('')
    .trim()
  return cleaned || 'untitled session'
}

/** densable iBr — name looks like a messaging address, not a teammate label. */
function isAddressLikeName(value: string): boolean {
  const norm = normalizeAgentName(value)
  return (
    parseAddress(value).scheme !== 'other' ||
    parseAddress(norm).scheme !== 'other'
  )
}

/** densable ELe lite — UNC/NT paths are not listing labels. */
function isListingPathOk(value: string): boolean {
  return !isUncOrNtObjectPath(value)
}

/** densable TLe */
export function sanitizeTeammateLabel(value: unknown): string | null {
  const cleaned = sanitizeListingName(value)
  if (cleaned === null) return null
  if (isAddressLikeName(cleaned) || !isListingPathOk(cleaned)) return null
  return cleaned
}

/** densable __a */
export function isAddressableListingName(value: string): boolean {
  return (
    !isAddressLikeName(value) &&
    isListingPathOk(value) &&
    !value.includes('@') &&
    value !== '*'
  )
}

/** densable Abr */
export function formatListingAge(ms: number): string {
  return formatDuration(Math.max(0, ms), { mostSignificantOnly: true })
}

/** densable LHm */
function formatSinceHint(
  row: TeammateListingRow,
  now: number,
): string | undefined {
  if (
    typeof row.since !== 'number' ||
    !Number.isFinite(row.since) ||
    row.since > now ||
    now - row.since > SINCE_HINT_MAX_MS
  ) {
    return undefined
  }
  const verb = row.backend === 'roster' ? 'joined' : 'started'
  return `${verb} ${formatListingAge(now - row.since)} ago`
}

/** densable K1w */
function nameShadowKind(
  name: string,
  appState: AppState,
  registryNorm: Set<string>,
): false | 'unreachable' | 'bare-only' {
  const cleaned = sanitizeListingName(name) ?? name
  if (!registryNorm.has(normalizeAgentName(cleaned))) return false
  return appState.agentNameRegistry.has(name) || cleaned !== name
    ? 'unreachable'
    : 'bare-only'
}

/** densable pYb / sBr — unique hex refs; pool includes own session digest. */
export function assignTeammateRefs(
  rows: Array<{ kind: string; id: string }>,
): string[] {
  const digests = rows.map(r => pinDigest(r.kind, r.id))
  return uniqueHexPrefixes(digests, ownSessionRefExtra(), REF_MIN)
}

/** densable VCe */
function formatNameRef(name: string, ref: string): string {
  return `${name} [${ref}]`
}

/** densable Eao */
export function formatListingRow(
  lead: string,
  bits: Array<string | undefined>,
): string {
  return `  ${[lead, ...bits.filter((b): b is string => b !== undefined)].join('  \u00B7  ')}`
}

/** densable NHm / f5i */
export function formatCappedSection(title: string, rows: string[]): string {
  const shown = rows.slice(0, TEAMMATES_LISTING_CAP)
  const hidden = rows.length - shown.length
  if (hidden > 0) {
    shown.push(`  (\u2026 ${hidden} more not shown)`)
  }
  return `${title} (${rows.length}):\n${shown.join('\n')}`
}

/**
 * densable OHm — live teammates minus self.
 * `callerTeammateId === null` means "caller is not this teammate" (SRl).
 */
export function listTeammatesForListing(
  appState: AppState,
  teamFile: TeamFile | null,
  callerTeammateId: string | null | undefined,
): TeammateListingRow[] {
  const teamContext = appState.teamContext
  if (!teamContext && !teamFile) return []

  const excludeId =
    callerTeammateId === null
      ? undefined
      : (callerTeammateId ??
        (teamContext
          ? (teamContext.selfAgentId ??
            (teamContext.isLeader === false
              ? undefined
              : teamContext.leadAgentId))
          : getAgentId()))

  const idleById = new Map<string, string>()
  for (const task of Object.values(appState.tasks)) {
    if (task.type === 'in_process_teammate') {
      idleById.set(task.identity.agentId, task.isIdle ? 'idle' : task.status)
    }
  }

  const rows: TeammateListingRow[] = []
  const seen = new Set<string>(excludeId !== undefined ? [excludeId] : [])
  const registryNorm = new Set<string>()
  for (const name of appState.agentNameRegistry.keys()) {
    registryNorm.add(normalizeAgentName(name))
  }

  for (const [id, mate] of Object.entries(teamContext?.teammates ?? {})) {
    if (seen.has(id)) continue
    seen.add(id)
    const inProcess =
      mate.tmuxPaneId === 'in-process' || mate.tmuxPaneId === 'leader'
    rows.push({
      teammateId: id,
      name: mate.name,
      agentType: mate.agentType,
      status: inProcess ? idleById.get(id) : undefined,
      backend: inProcess ? 'in-process' : 'pane',
      since: mate.spawnedAt,
      nameShadowed: false,
    })
  }

  for (const member of teamFile?.members ?? []) {
    if (seen.has(member.agentId)) continue
    seen.add(member.agentId)
    rows.push({
      teammateId: member.agentId,
      name: member.name,
      agentType: member.agentType,
      status: undefined,
      backend: 'roster',
      since: member.joinedAt,
      nameShadowed: nameShadowKind(member.name, appState, registryNorm),
    })
  }

  return rows
}

/** densable GCe + pYb — one uniqueness pool, then `${kind}\x00${id}` map. */
export function buildListingCandidateMap(
  entries: Array<{ kind: ListingKind; id: string; name: string }>,
): Map<string, ListingCandidate> {
  const refs = assignTeammateRefs(entries)
  const map = new Map<string, ListingCandidate>()
  for (let i = 0; i < entries.length; i++) {
    const row = entries[i]!
    map.set(`${row.kind}\x00${row.id}`, {
      kind: row.kind,
      id: row.id,
      name: row.name,
      ref: refs[i]!,
    })
  }
  return map
}

/** densable GCe teammate candidates that survive ALe + __a, then pYb refs. */
export function teammateCandidatesFromRows(
  rows: TeammateListingRow[],
): Map<string, TeammateListingCandidate> {
  const eligible = rows.flatMap(row => {
    if (row.nameShadowed !== false) return []
    const name = sanitizeListingName(row.name)
    if (name === null || !isAddressableListingName(name)) return []
    return [{ kind: 'teammate' as const, id: row.teammateId, name }]
  })
  return buildListingCandidateMap(eligible) as Map<
    string,
    TeammateListingCandidate
  >
}

/**
 * densable MHm — in-process local_agent minus main-session.
 * Name omitted when it collides with a teammate label.
 */
export function listSubagentsForListing(
  appState: AppState,
): SubagentListingRow[] {
  const nameById = new Map<string, string>()
  for (const [name, id] of appState.agentNameRegistry) {
    nameById.set(id, name)
  }
  const teammateNames = new Set(
    Object.values(appState.teamContext?.teammates ?? {}).map(mate => mate.name),
  )
  const rows: SubagentListingRow[] = []
  for (const task of Object.values(appState.tasks)) {
    if (task.type !== 'local_agent' || task.agentType === 'main-session') {
      continue
    }
    const registered = nameById.get(task.id)
    rows.push({
      agentId: task.id,
      name:
        registered !== undefined && teammateNames.has(registered)
          ? undefined
          : registered,
      agentType: task.agentType,
      status: task.status,
      startTime: task.startTime,
    })
  }
  return rows
}

/** densable J1w */
export function formatSubagentsSection(
  rows: SubagentListingRow[],
  candidates: Map<string, ListingCandidate>,
  now = Date.now(),
): string {
  return formatCappedSection(
    'Subagents',
    rows.map(row => {
      const cand = row.name
        ? candidates.get(`subagent\x00${row.agentId}`)
        : undefined
      const lead = cand ? formatNameRef(cand.name, cand.ref) : row.agentId
      return formatListingRow(lead, [
        row.agentType,
        row.status,
        `started ${formatListingAge(now - row.startTime)} ago`,
      ])
    }),
  )
}

/** densable Z1w */
export function formatTeammatesSection(
  rows: TeammateListingRow[],
  candidates: Map<string, ListingCandidate>,
  now = Date.now(),
): string {
  return formatCappedSection(
    'Teammates',
    rows.map(row => {
      const cand =
        row.nameShadowed !== false
          ? undefined
          : candidates.get(`teammate\x00${row.teammateId}`)
      const lead = cand
        ? formatNameRef(cand.name, cand.ref)
        : (sanitizeTeammateLabel(row.name) ?? '(unnamed)')
      return formatListingRow(lead, [
        sanitizeTeammateLabel(row.agentType) ?? undefined,
        sanitizeTeammateLabel(row.status) ??
          (row.backend === 'in-process' ? undefined : row.backend),
        formatSinceHint(row, now),
        row.nameShadowed === 'unreachable'
          ? 'not messageable by name while a subagent in this session is registered under that name (the name reaches the subagent)'
          : row.nameShadowed === 'bare-only'
            ? 'message it by this exact name as printed \u2014 no [ref]: a subagent here is registered under a variant spelling of it'
            : undefined,
      ])
    }),
  )
}

/**
 * densable SRl callerTeammateId:
 * teammateContext missing → undefined
 * teammateContext present and agentId matches → that id
 * otherwise → null
 */
export function callerTeammateIdFromContext(
  teammateContext: { agentId: string } | undefined,
  agentId: string | undefined,
): string | null | undefined {
  if (teammateContext === undefined) return undefined
  return agentId === teammateContext.agentId ? teammateContext.agentId : null
}
