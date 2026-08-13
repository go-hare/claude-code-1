/**
 * densable 2.1.224 #7 — ListAgentsTool (wire name ListAgents; alias ListPeers).
 *
 * SEA: cy / qWu / IRs / f5b / m5b / yWp=10000 / toAutoClassifierInput "list agents"
 * Local discovery still uses UDS peer registry + bridge peers (listPeers path);
 * densable listAllPeers/formatForModel extras remain a future deepen if needed.
 */
import { z } from 'zod/v4'
import type { ToolResultBlockParam } from 'src/Tool.js'
import { buildTool } from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  LIST_AGENTS_TOOL_NAME,
  LIST_PEERS_LEGACY_TOOL_NAME,
} from './constants.js'
import { getListAgentsPrompt } from './prompt.js'

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
 * Local peers still use address as the ref token when distinct from name.
 */
function formatPeersListing(peers: PeerInfo[]): string {
  if (peers.length === 0) {
    return 'No agents found.'
  }
  const lines = peers.map(p => {
    const name = p.name?.trim() || p.address
    const ref = p.address
    const bits = [`${name} [${ref}]`]
    const status = resolvePeerStatusLabel(p)
    if (status) bits.push(status)
    if (p.cwd) bits.push(`@ ${p.cwd}`)
    if (p.pid !== undefined) bits.push(`pid ${p.pid}`)
    return bits.join(' ')
  })
  return `Found ${lines.length} agent(s):\n${lines.join('\n')}`
}

/** @internal densable 2.1.229 tests */
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

  async call(_input: ListAgentsInput) {
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
    /* eslint-enable @typescript-eslint/no-require-imports */

    for (const peer of await udsClient.listPeers()) {
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

    for (const peer of await bridgePeers.listBridgePeers()) {
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

    return {
      data: { listing: formatPeersListing(peers) },
    }
  },
})

/** @deprecated densable export name is ListAgentsTool; keep ListPeersTool for import path stability. */
export const ListPeersTool = ListAgentsTool
