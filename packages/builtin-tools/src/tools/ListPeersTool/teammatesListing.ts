/**
 * densable 2.1.239 #51 — OHm / Z1w / NHm / Eao / LHm / K1w ListAgents teammates.
 * Refs via sBr/pYb (sha256 `${kind}:${id}` hex, grow from sti=6).
 */
import { pinDigest } from '../SendMessageTool/nameResolve.js'
import { normalizeAgentName } from '../SendMessageTool/nameResolve.js'
import { parseAddress } from 'src/utils/peerAddress.js'
import { formatDuration } from 'src/utils/format.js'
import { isUncOrNtObjectPath } from 'src/utils/path.js'
import type { AppState } from 'src/state/AppState.js'
import type { TeamFile } from 'src/utils/swarm/teamHelpers.js'
import { getAgentId } from 'src/utils/teammate.js'
import { getUdsMessagingSocketPath } from 'src/utils/udsMessaging.js'

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

export type TeammateListingCandidate = {
  kind: 'teammate'
  id: string
  name: string
  ref: string
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
function isAddressableListingName(value: string): boolean {
  return (
    !isAddressLikeName(value) &&
    isListingPathOk(value) &&
    !value.includes('@') &&
    value !== '*'
  )
}

/** densable Abr */
function formatListingAge(ms: number): string {
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
  const own = getUdsMessagingSocketPath()
  const extra = own ? [pinDigest('session', own)] : []
  const digests = rows.map(r => pinDigest(r.kind, r.id))
  const pool = [...digests, ...extra]
  return digests.map((digest, i) => {
    let len = REF_MIN
    while (
      len < digest.length &&
      pool.some(
        (other, j) => j !== i && other.slice(0, len) === digest.slice(0, len),
      )
    ) {
      len++
    }
    return digest.slice(0, len)
  })
}

/** densable VCe */
function formatNameRef(name: string, ref: string): string {
  return `${name} [${ref}]`
}

/** densable Eao */
function formatListingRow(
  lead: string,
  bits: Array<string | undefined>,
): string {
  return `  ${[lead, ...bits.filter((b): b is string => b !== undefined)].join('  \u00B7  ')}`
}

/** densable NHm */
function formatCappedSection(title: string, rows: string[]): string {
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
  const refs = assignTeammateRefs(eligible)
  const map = new Map<string, TeammateListingCandidate>()
  for (let i = 0; i < eligible.length; i++) {
    const row = eligible[i]!
    map.set(`teammate\x00${row.id}`, {
      kind: 'teammate',
      id: row.id,
      name: row.name,
      ref: refs[i]!,
    })
  }
  return map
}

/** densable Z1w */
export function formatTeammatesSection(
  rows: TeammateListingRow[],
  candidates: Map<string, TeammateListingCandidate>,
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
