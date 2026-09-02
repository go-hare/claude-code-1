/**
 * densable 2.1.224 #7 — ListAgentsTool (wire name ListAgents; alias ListPeers).
 * densable 2.1.234 #34 — incomplete session-list notes (CSf / cloud-failed / bridge incomplete).
 *
 * SEA: cy / qWu / IRs / f5b / m5b / yWp=10000 / toAutoClassifierInput "list agents"
 * Local discovery: UDS + local registry bridge + account bridge walk + cloud walk.
 */
import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { listAgentsIncompleteNotes } from 'src/utils/sessionListIncompleteCopy.js'
import {
  LIST_AGENTS_TOOL_NAME,
  LIST_PEERS_LEGACY_TOOL_NAME,
} from './constants.js'
import { CLOUD_PEER_UNREACHABLE_FROM_HERE } from 'src/utils/teleport/cloudPeerSessions.js'
import { getListAgentsPrompt } from './prompt.js'
import {
  callerIsSubagentFromContext,
  describeOwnSession,
  formatOwnSessionListing,
} from '../SendMessageTool/ownSession.js'
import { basename } from 'path'
import {
  buildListingCandidateMap,
  callerTeammateIdFromContext,
  formatCappedSection,
  formatListingAge,
  formatListingRow,
  formatSubagentsSection,
  formatTeammatesSection,
  isAddressableListingName,
  listSubagentsForListing,
  listTeammatesForListing,
  sanitizeListingName,
  sanitizeTeammateLabel,
  type ListingCandidate,
} from './teammatesListing.js'

/** densable yWp */
const LIST_AGENTS_MAX_RESULT_CHARS = 10_000

/** densable V1w machine-empty copy when self is listed and no peers. */
const NO_OTHER_SESSION_ON_MACHINE =
  'No reachable agents \u2014 no other Claude session is running on this machine right now (peer messaging itself is available; a session appears here once it is started).'

const inputSchema = lazySchema(() =>
  z.strictObject({
    // densable f5b — reserved / not available in this build
    channel: z
      .string()
      .max(256)
      .optional()
      .describe('Not available in this build; leave unset.'),
    q: z
      .string()
      .max(256)
      .optional()
      .describe('Not available in this build; leave unset.'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
type ListAgentsInput = z.infer<InputSchema>

type PeerInfo = {
  address: string
  name?: string
  cwd?: string
  pid?: number
  /**
   * densable 2.1.229 Esf / gAS transport labels.
   * - connected===false → offline (disconnected Remote Control)
   * - transport==='cloud' → cloud
   */
  connected?: boolean
  transport?: 'uds' | 'bridge' | 'cloud' | 'did'
  status?: string
  /** Official D5v / xSf — cloud session cannot reach this elevated RC peer. */
  unreachableFromHere?: boolean
  /** densable Q1w — UDS sock / cloud|bridge id for GCe `session\x00` keys. */
  listingId?: string
  listingKind?: string
  startedAt?: number
  tmux?: string
}

/** densable m5b — model-facing listing string. */
type ListAgentsOutput = { listing: string }

/**
 * densable 2.1.229 Esf — bridge/RC status for listing.
 * `connected===false` wins over raw status → "offline".
 */
function resolvePeerStatusLabel(p: PeerInfo): string | undefined {
  if (p.transport === 'cloud') return 'cloud'
  if (p.connected === false) return 'offline'
  if (p.status === 'offline' || p.status === 'cloud') return p.status
  return undefined
}

const TMUX_LABEL_RE = /^[^\s/\\\p{Cc}\p{Cf}]{1,64}$/u

function listingKey(kind: string, id: string): string {
  return `${kind}\x00${id}`
}

function peerCandidateKind(
  p: PeerInfo,
): 'session' | 'cloud-session' | 'bridge-session' {
  if (p.transport === 'cloud') return 'cloud-session'
  if (p.transport === 'bridge') return 'bridge-session'
  return 'session'
}

function peerListingId(p: PeerInfo): string {
  return p.listingId ?? p.address
}

function formatPeerLead(
  p: PeerInfo,
  candidates: Map<string, ListingCandidate> | undefined,
): string {
  const kind = peerCandidateKind(p)
  const cand = candidates?.get(listingKey(kind, peerListingId(p)))
  if (cand) return `${cand.name} [${cand.ref}]`
  const fallback =
    sanitizeTeammateLabel(p.name) ??
    (p.cwd ? sanitizeTeammateLabel(basename(p.cwd)) : null) ??
    '(untitled)'
  return fallback
}

function formatQ1wPeerRow(
  p: PeerInfo,
  candidates: Map<string, ListingCandidate> | undefined,
  now: number,
): string {
  if (p.transport === 'cloud') {
    return formatListingRow(formatPeerLead(p, candidates), [
      'cloud session',
      p.unreachableFromHere ? CLOUD_PEER_UNREACHABLE_FROM_HERE : undefined,
    ])
  }
  if (p.transport === 'bridge') {
    return formatListingRow(formatPeerLead(p, candidates), [
      resolvePeerStatusLabel(p),
    ])
  }
  const tmux =
    p.tmux !== undefined && TMUX_LABEL_RE.test(p.tmux) && !p.tmux.includes('@')
      ? `tmux ${p.tmux}`
      : undefined
  const started =
    typeof p.startedAt === 'number' && Number.isFinite(p.startedAt)
      ? `started ${formatListingAge(now - p.startedAt)} ago`
      : undefined
  return formatListingRow(formatPeerLead(p, candidates), [
    p.listingKind,
    resolvePeerStatusLabel(p),
    tmux,
    started,
  ])
}

/**
 * densable V1w / Q1w listing — Eao rows + G1w / Z1w / J1w sections.
 */
function formatPeersListing(
  peers: PeerInfo[],
  opts?: {
    listTruncated?: boolean
    cloudListFailed?: boolean
    bridgeWalkIncomplete?: boolean
    /** densable G1w */
    selfHeader?: string | null
    /** densable Z1w — Teammates (n): section */
    teammatesSection?: string | null
    /** densable J1w — Subagents (n): section */
    subagentsSection?: string | null
    candidates?: Map<string, ListingCandidate>
    now?: number
  },
): string {
  const notes = listAgentsIncompleteNotes({
    listTruncated: opts?.listTruncated,
    cloudListFailed: opts?.cloudListFailed,
    bridgeWalkIncomplete: opts?.bridgeWalkIncomplete,
  })
  const teammatesSection = opts?.teammatesSection?.trim()
    ? opts.teammatesSection
    : null
  const subagentsSection = opts?.subagentsSection?.trim()
    ? opts.subagentsSection
    : null
  const hosted = Boolean(teammatesSection || subagentsSection)

  let peerBody: string | null
  if (peers.length === 0) {
    // densable V1w / Q1w: teammates/subagents-only or notes-only omit the empty banner.
    if (hosted && notes.length === 0) {
      peerBody = null
    } else if (notes.length > 0) {
      peerBody = notes.map(n => `  ${n}`).join('\n')
    } else if (opts?.selfHeader) {
      peerBody = NO_OTHER_SESSION_ON_MACHINE
    } else {
      peerBody = 'No reachable agents.'
    }
  } else {
    const now = opts?.now ?? Date.now()
    const rows = peers.map(p => formatQ1wPeerRow(p, opts?.candidates, now))
    peerBody = formatCappedSection('Peer sessions', rows)
    if (notes.length > 0) {
      peerBody += `\n${notes.map(n => `  ${n}`).join('\n')}`
    }
  }

  const sections = [subagentsSection, teammatesSection, peerBody].filter(
    (s): s is string => Boolean(s),
  )
  const body = sections.join('\n\n')
  if (opts?.selfHeader) {
    return `${opts.selfHeader}\n\n${body}`
  }
  return body
}

/** @internal densable 2.1.229 / 2.1.234 tests */
export const __test = {
  formatPeersListing,
  resolvePeerStatusLabel,
}

export const ListAgentsTool = buildTool({
  name: LIST_AGENTS_TOOL_NAME,
  // densable aliases:[qWu]
  aliases: [LIST_PEERS_LEGACY_TOOL_NAME],
  searchHint: 'list agents you can SendMessage to',
  maxResultSizeChars: LIST_AGENTS_MAX_RESULT_CHARS,
  strict: true,

  get inputSchema(): InputSchema {
    return inputSchema()
  },

  toAutoClassifierInput(_input: ListAgentsInput) {
    return 'list agents'
  },

  async description() {
    return getListAgentsPrompt()
  },
  async prompt() {
    return getListAgentsPrompt()
  },

  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },

  userFacingName() {
    return LIST_AGENTS_TOOL_NAME
  },

  // densable renderToolUseMessage(){return null}
  renderToolUseMessage() {
    return null
  },

  mapToolResultToToolResultBlockParam(
    content: ListAgentsOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: content.listing,
    }
  },

  async call(_input: ListAgentsInput, context) {
    const peers: PeerInfo[] = []
    const seen = new Set<string>()
    const addPeer = (peer: PeerInfo): void => {
      if (seen.has(peer.address)) return
      seen.add(peer.address)
      peers.push(peer)
    }

    /* eslint-disable @typescript-eslint/no-require-imports */
    const udsMessaging =
      require('src/utils/udsMessaging.js') as typeof import('src/utils/udsMessaging.js')
    const udsClient =
      require('src/utils/udsClient.js') as typeof import('src/utils/udsClient.js')
    const bridgePeers =
      require('src/bridge/peerSessions.js') as typeof import('src/bridge/peerSessions.js')
    const cloudPeers =
      require('src/utils/teleport/cloudPeerSessions.js') as typeof import('src/utils/teleport/cloudPeerSessions.js')
    const { stripSessionPrefix } =
      require('../SendMessageTool/nameResolve.js') as typeof import('../SendMessageTool/nameResolve.js')
    /* eslint-enable @typescript-eslint/no-require-imports */

    const accountStatus = { failed: false, truncated: false }
    const [udsList, localBridge, accountBridge, cloudList] = await Promise.all([
      udsClient.listPeers(),
      bridgePeers.listBridgePeers(),
      bridgePeers.listBridgePeerSessions(accountStatus).catch(() => {
        accountStatus.failed = true
        return [] as Awaited<
          ReturnType<typeof bridgePeers.listBridgePeerSessions>
        >
      }),
      cloudPeers.listCloudPeerSessions(),
    ])

    for (const peer of udsList) {
      if (!peer.messagingSocketPath) continue
      addPeer({
        address: udsMessaging.formatUdsAddress(peer.messagingSocketPath),
        name: peer.name ?? peer.kind,
        cwd: peer.cwd,
        pid: peer.pid,
        transport: 'uds',
        // densable-ish: dead registry entries surface as offline
        connected: peer.alive !== false,
        listingId: peer.messagingSocketPath,
        listingKind: peer.kind,
        startedAt: peer.startedAt,
      })
    }

    for (const peer of localBridge) {
      addPeer({
        address: peer.address,
        name: peer.name,
        cwd: peer.cwd,
        pid: peer.pid,
        transport:
          peer.transport ??
          (peer.address.startsWith('bridge:') ? 'bridge' : undefined),
        connected: peer.connected,
        status: peer.status,
        listingId: peer.address.startsWith('bridge:')
          ? peer.address.slice('bridge:'.length)
          : peer.address,
      })
    }

    // densable _Wa: account bridge rows (skip ones already mirrored locally)
    const localBridgeBodies = new Set(
      localBridge
        .filter(p => p.address.startsWith('bridge:'))
        .map(p => stripSessionPrefix(p.address.slice('bridge:'.length))),
    )
    for (const row of accountBridge) {
      const body = stripSessionPrefix(row.id)
      if (localBridgeBodies.has(body)) continue
      addPeer({
        address: `bridge:${row.id}`,
        name: row.title?.trim() || undefined,
        transport: 'bridge',
        connected: row.connected,
        status: row.connected === false ? 'offline' : row.status,
        listingId: row.id,
      })
    }

    for (const row of cloudList.sessions) {
      const body = stripSessionPrefix(row.id)
      if (localBridgeBodies.has(body)) continue
      if (seen.has(`bridge:${row.id}`) || seen.has(`cloud:${row.id}`)) continue
      addPeer({
        address: `cloud:${row.id}`,
        name: row.title?.trim() || undefined,
        transport: 'cloud',
        connected: true,
        status: 'cloud',
        listingId: row.id,
        ...(row.unreachableFromHere ? { unreachableFromHere: true } : {}),
      })
    }

    const listTruncated =
      cloudList.truncated === true || accountStatus.truncated === true
    const cloudListFailed = cloudPeers.isCloudListFailed(cloudList.unavailable)
    const bridgeWalkIncomplete =
      accountStatus.failed === true && accountBridge.length > 0

    /* eslint-disable @typescript-eslint/no-require-imports */
    const { getTeammateContext } =
      require('src/utils/teammateContext.js') as typeof import('src/utils/teammateContext.js')
    const { getAgentContext } =
      require('src/utils/agentContext.js') as typeof import('src/utils/agentContext.js')
    const { readTeamFileAsync } =
      require('src/utils/swarm/teamHelpers.js') as typeof import('src/utils/swarm/teamHelpers.js')
    /* eslint-enable @typescript-eslint/no-require-imports */

    // densable SRl(t, g5(t)) — leftover maps official tool-context fields
    // (e.teammateContext / e.agentContext) from ALS + context.agentId.
    // DHm reads QV() (`getRegisteredSessionName`).
    const self = describeOwnSession(
      callerIsSubagentFromContext({
        teammateContext: getTeammateContext(),
        agentContext:
          getAgentContext() ??
          (context.agentId ? { agentType: 'subagent' } : undefined),
      }),
    )

    // densable SRl / OHm / Z1w / MHm / J1w / GCe — live listing
    let teammatesSection: string | null = null
    let subagentsSection: string | null = null
    const appState = context.getAppState()
    const teamName = appState.teamContext?.teamName
    const teamFile = teamName ? await readTeamFileAsync(teamName) : null
    const callerTeammateId = callerTeammateIdFromContext(
      getTeammateContext(),
      getAgentContext()?.agentId ?? context.agentId,
    )
    const teammateRows = listTeammatesForListing(
      appState,
      teamFile,
      callerTeammateId,
    )
    const subagentRows = listSubagentsForListing(appState)
    const candidateEntries = [
      ...teammateRows.flatMap(row => {
        if (row.nameShadowed !== false) return []
        const name = sanitizeListingName(row.name)
        if (name === null || !isAddressableListingName(name)) return []
        return [{ kind: 'teammate' as const, id: row.teammateId, name }]
      }),
      ...subagentRows.flatMap(row => {
        if (!row.name) return []
        const name = sanitizeListingName(row.name)
        if (name === null || !isAddressableListingName(name)) return []
        return [{ kind: 'subagent' as const, id: row.agentId, name }]
      }),
      ...peers.flatMap(peer => {
        const name =
          sanitizeListingName(peer.name) ??
          (peer.cwd ? sanitizeListingName(basename(peer.cwd)) : null)
        if (name === null || !isAddressableListingName(name)) return []
        return [
          {
            kind: peerCandidateKind(peer),
            id: peerListingId(peer),
            name,
          },
        ]
      }),
    ]
    const candidates = buildListingCandidateMap(candidateEntries)
    if (teammateRows.length > 0) {
      teammatesSection = formatTeammatesSection(teammateRows, candidates)
    }
    if (subagentRows.length > 0) {
      subagentsSection = formatSubagentsSection(subagentRows, candidates)
    }

    return {
      data: {
        listing: formatPeersListing(peers, {
          listTruncated,
          cloudListFailed,
          bridgeWalkIncomplete,
          selfHeader: formatOwnSessionListing(self),
          teammatesSection,
          subagentsSection,
          candidates,
        }),
      },
    }
  },
})

/** @deprecated densable export name is ListAgentsTool; keep ListPeersTool for import path stability. */
export const ListPeersTool = ListAgentsTool
