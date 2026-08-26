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
import {
  callerTeammateIdFromContext,
  formatTeammatesSection,
  listTeammatesForListing,
  teammateCandidatesFromRows,
} from './teammatesListing.js'

/** densable yWp */
const LIST_AGENTS_MAX_RESULT_CHARS = 10_000

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

/**
 * densable 2.1.225 listing — every row leads with `name [ref]`.
 * densable 2.1.229 — append offline/cloud when known.
 * densable 2.1.234 #34 — append CSf / cloud-failed / account-incomplete notes.
 * Local peers still use address as the ref token when distinct from name.
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

  let peerBody: string | null
  if (peers.length === 0) {
    // densable V1w: teammates-only listing does not append "No agents found."
    if (teammatesSection && notes.length === 0) {
      peerBody = null
    } else if (teammatesSection) {
      // densable Q1w empty-rows: keep indent on every note
      peerBody = notes.map(n => `  ${n}`).join('\n')
    } else {
      peerBody =
        notes.length === 0
          ? 'No agents found.'
          : `No agents found.\n${notes.map(n => `  ${n}`).join('\n')}`
    }
  } else {
    const lines = peers.map(p => {
      const name = p.name?.trim() || p.address
      const ref = p.address
      const bits = [`${name} [${ref}]`]
      const status = resolvePeerStatusLabel(p)
      if (status) bits.push(status)
      if (p.cwd) bits.push(`@ ${p.cwd}`)
      if (p.pid !== undefined) bits.push(`pid ${p.pid}`)
      if (p.unreachableFromHere) {
        bits.push(CLOUD_PEER_UNREACHABLE_FROM_HERE)
      }
      return bits.join(' ')
    })
    peerBody = `Found ${lines.length} agent(s):\n${lines.join('\n')}`
    if (notes.length > 0) {
      peerBody += `\n${notes.map(n => `  ${n}`).join('\n')}`
    }
  }

  const sections = [teammatesSection, peerBody].filter((s): s is string =>
    Boolean(s),
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

    // densable SRl / OHm / Z1w — live teammates section
    // leftover: official reads e.teammateContext / e.agentContext on the tool
    // context; tip maps ALS + context.agentId. Hy is teamContext.teamName only.
    let teammatesSection: string | null = null
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
    if (teammateRows.length > 0) {
      teammatesSection = formatTeammatesSection(
        teammateRows,
        teammateCandidatesFromRows(teammateRows),
      )
    }

    return {
      data: {
        listing: formatPeersListing(peers, {
          listTruncated,
          cloudListFailed,
          bridgeWalkIncomplete,
          selfHeader: formatOwnSessionListing(self),
          teammatesSection,
        }),
      },
    }
  },
})

/** @deprecated densable export name is ListAgentsTool; keep ListPeersTool for import path stability. */
export const ListPeersTool = ListAgentsTool
