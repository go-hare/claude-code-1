/**
 * densable 2.1.224 #7 — ListAgentsTool (wire name ListAgents; alias ListPeers).
 * densable 2.1.234 #34 — incomplete session-list notes (CSf / cloud-failed / bridge incomplete).
 *
 * SEA: cy / qWu / IRs / f5b / m5b / yWp=10000 / toAutoClassifierInput "list agents"
 * Local discovery: UDS + local registry bridge + account bridge walk + cloud walk.
 */
import { z } from 'zod/v4'
import {
  buildTool,
  type ToolDeps,
  toolMatchesName,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { getBootstrapSession, RootSessionSlot } from 'src/utils/sessionHost.js'
import { listAgentsIncompleteNotes } from 'src/utils/sessionListIncompleteCopy.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
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
  formatTokenOnlySessionName,
  isAddressableListingName,
  listSubagentsForListing,
  listTeammatesForListing,
  sanitizeListingName,
  sanitizeTeammateLabel,
  type ListingCandidate,
} from './teammatesListing.js'
import { randomBytes } from 'crypto'

/** densable yWp / official 2.1.328 _Ct */
export const LIST_AGENTS_MAX_RESULT_CHARS = 10_000
const LIST_AGENTS_CURSOR_CACHE_MAX = 32

export const LIST_AGENTS_INVALID_CURSOR_MESSAGE =
  '(that cursor is not valid: this session did not issue it, or it has expired — no agents were looked up; call again with no cursor to list them from the start)'
export const LIST_AGENTS_EXHAUSTED_CURSOR_MESSAGE =
  '(nothing more to list: every agent this call found is on an earlier page — call again with no cursor to list them from the start)'

/**
 * Official 2.1.328 (#440) `fMo` LRU cursor store: remembers cumulative row
 * keys already returned by previous pages in this session (max 32 cursors).
 */
const listAgentsCursorCacheSlot = new RootSessionSlot<Map<string, Set<string>>>(
  () => new Map(),
)

function getListAgentsCursorCache(session?: {
  readonly root: object
}): Map<string, Set<string>> {
  return listAgentsCursorCacheSlot.of(session ?? getBootstrapSession())
}

export function issueListAgentsCursor(
  shownKeys: Set<string>,
  session?: { readonly root: object },
): string {
  const listAgentsCursorCache = getListAgentsCursorCache(session)
  const token = randomBytes(6).toString('hex')
  listAgentsCursorCache.set(token, new Set(shownKeys))
  while (listAgentsCursorCache.size > LIST_AGENTS_CURSOR_CACHE_MAX) {
    const oldest = listAgentsCursorCache.keys().next().value
    if (oldest === undefined) break
    listAgentsCursorCache.delete(oldest)
  }
  return token
}

export function lookupListAgentsCursor(
  cursor: string,
  session?: { readonly root: object },
): Set<string> | null {
  const listAgentsCursorCache = getListAgentsCursorCache(session)
  const entry = listAgentsCursorCache.get(cursor)
  if (!entry) return null
  // Refresh LRU order
  listAgentsCursorCache.delete(cursor)
  listAgentsCursorCache.set(cursor, entry)
  return entry
}

export function clearListAgentsCursorCacheForTests(session?: {
  readonly root: object
}): void {
  getListAgentsCursorCache(session).clear()
}

/**
 * Official 2.1.328 (#658) `remoteControlOffNote`: explain that Remote Control
 * is off when cloud sessions or other computers are not listed.
 */
export function buildRemoteControlOffNote(opts: {
  isRemoteMode?: boolean
  isReplBridgeActive: boolean
  peerMessagingEnabled?: boolean
  isFirstPartyOAuth?: boolean
  isRcAllowed?: boolean
  hasCloudAccess?: boolean
  isDesktop?: boolean
}): string | null {
  if (opts.isRemoteMode) return null
  if (opts.isReplBridgeActive) return null
  if (opts.peerMessagingEnabled === false) return null
  if (opts.isFirstPartyOAuth === false) return null
  if (opts.isRcAllowed === false) return null
  const label = opts.hasCloudAccess
    ? 'Other computers'
    : 'Cloud sessions and other computers'
  const action = opts.isDesktop
    ? 'the Remote Control switch in the app'
    : '/remote-control'
  return `[${label} are not listed because Remote Control is off in this session. The user can turn it on with ${action}; then list again.]`
}

/**
 * Official 2.1.328 (#440): paginate a list of keyed peer rows within a char
 * budget (default 10,000), returning the page rows, remaining count, and next
 * cursor token when truncated.
 */
export function paginatePeerListingRows(
  rows: ReadonlyArray<{ key: string; line: string }>,
  opts?: {
    cursor?: string
    budgetChars?: number
    canSendMessages?: boolean
    session?: { readonly root: object }
  },
):
  | { kind: 'invalid-cursor'; message: string }
  | { kind: 'exhausted'; message: string }
  | {
      kind: 'page'
      lines: string[]
      remaining: number
      nextCursor?: string
      footer?: string
    } {
  const budget = opts?.budgetChars ?? LIST_AGENTS_MAX_RESULT_CHARS
  let alreadyShown: Set<string> | null = null
  if (opts?.cursor !== undefined && opts.cursor.trim() !== '') {
    alreadyShown = lookupListAgentsCursor(opts.cursor.trim(), opts.session)
    if (!alreadyShown) {
      return {
        kind: 'invalid-cursor',
        message: LIST_AGENTS_INVALID_CURSOR_MESSAGE,
      }
    }
  }

  const unseen = alreadyShown
    ? rows.filter(r => !alreadyShown!.has(r.key))
    : [...rows]

  if (alreadyShown && unseen.length === 0) {
    return {
      kind: 'exhausted',
      message: LIST_AGENTS_EXHAUSTED_CURSOR_MESSAGE,
    }
  }

  const pageLines: string[] = []
  const nextShown = new Set<string>(alreadyShown ?? [])
  let usedChars = 0
  let includedCount = 0

  for (const row of unseen) {
    const addedLen = row.line.length + (pageLines.length > 0 ? 1 : 0)
    if (pageLines.length > 0 && usedChars + addedLen > budget) {
      break
    }
    pageLines.push(row.line)
    nextShown.add(row.key)
    usedChars += addedLen
    includedCount++
  }

  const remaining = unseen.length - includedCount
  if (remaining > 0) {
    const nextCursor = issueListAgentsCursor(nextShown, opts?.session)
    const sendHint =
      opts?.canSendMessages === false
        ? ''
        : ` (or pass a target's name directly to ${SEND_MESSAGE_TOOL_NAME})`
    const footer = `  (\u2026 ${remaining} more not shown \u2014 call again with cursor="${nextCursor}" for the next page${sendHint})`
    return {
      kind: 'page',
      lines: pageLines,
      remaining,
      nextCursor,
      footer,
    }
  }

  return {
    kind: 'page',
    lines: pageLines,
    remaining: 0,
  }
}

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
    cursor: z
      .string()
      .max(256)
      .optional()
      .describe(
        'Pagination cursor returned by a previous ListAgents call to fetch the next page of results.',
      ),
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
    /** Official 2.1.328 (#658): Remote Control off note when applicable. */
    remoteControlOffNote?: string | null
    /** Official 2.1.328 (#440): pagination cursor & budget. */
    cursor?: string
    pageBudgetChars?: number
    canSendMessages?: boolean
    /** densable G1w */
    selfHeader?: string | null
    /** densable Z1w — Teammates (n): section */
    teammatesSection?: string | null
    /** densable J1w — Subagents (n): section */
    subagentsSection?: string | null
    candidates?: Map<string, ListingCandidate>
    now?: number
    session?: { readonly root: object }
  },
): string {
  const notes = listAgentsIncompleteNotes({
    listTruncated: opts?.listTruncated,
    cloudListFailed: opts?.cloudListFailed,
    bridgeWalkIncomplete: opts?.bridgeWalkIncomplete,
  })
  if (opts?.remoteControlOffNote) {
    notes.push(opts.remoteControlOffNote)
  }
  const teammatesSection = opts?.teammatesSection?.trim()
    ? opts.teammatesSection
    : null
  const subagentsSection = opts?.subagentsSection?.trim()
    ? opts.subagentsSection
    : null
  const hosted = Boolean(teammatesSection || subagentsSection)

  let peerBody: string | null
  if (peers.length === 0) {
    if (opts?.cursor && opts.cursor.trim() !== '') {
      const check = paginatePeerListingRows([], {
        cursor: opts.cursor,
        budgetChars: opts.pageBudgetChars,
        canSendMessages: opts.canSendMessages,
        session: opts.session,
      })
      if (check.kind !== 'page') {
        return check.message
      }
    }
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
    const keyedRows = peers.map(p => ({
      key: listingKey(peerCandidateKind(p), peerListingId(p)),
      line: formatQ1wPeerRow(p, opts?.candidates, now),
    }))
    const staticOverhead =
      (opts?.selfHeader?.length ?? 0) +
      (subagentsSection?.length ?? 0) +
      (teammatesSection?.length ?? 0) +
      notes.reduce((sum, n) => sum + n.length + 4, 0) +
      256
    const effectiveBudget = Math.max(
      1_000,
      (opts?.pageBudgetChars ?? LIST_AGENTS_MAX_RESULT_CHARS) - staticOverhead,
    )
    const paged = paginatePeerListingRows(keyedRows, {
      cursor: opts?.cursor,
      budgetChars: effectiveBudget,
      canSendMessages: opts?.canSendMessages,
      session: opts?.session,
    })
    if (paged.kind !== 'page') {
      return paged.message
    }
    if (paged.footer) {
      peerBody = `Peer sessions (${peers.length}):\n${paged.lines.join('\n')}\n${paged.footer}`
    } else {
      peerBody = formatCappedSection('Peer sessions', paged.lines)
    }
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

const listAgentsRuntime = {
  async call(
    input: ListAgentsInput,
    deps: ToolDeps,
  ): Promise<{ data: ListAgentsOutput }> {
    // Official 2.1.328 (#440): validate input.cursor BEFORE doing any peer
    // lookups so callers immediately know no agents were looked up.
    const cursorToken = input.cursor?.trim() || undefined
    if (
      cursorToken !== undefined &&
      !lookupListAgentsCursor(cursorToken, deps.session)
    ) {
      return {
        data: {
          listing: LIST_AGENTS_INVALID_CURSOR_MESSAGE,
        },
      }
    }

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
    // (e.teammateContext / e.agentContext) from ALS + deps.agentId.
    // DHm reads QV() (`getRegisteredSessionName`).
    const self = describeOwnSession(
      callerIsSubagentFromContext({
        teammateContext: getTeammateContext(),
        agentContext:
          getAgentContext() ??
          (deps.agentId ? { agentType: 'subagent' } : undefined),
      }),
    )

    // densable SRl / OHm / Z1w / MHm / J1w / GCe — live listing
    let teammatesSection: string | null = null
    let subagentsSection: string | null = null
    const baseAppState = deps.getAppState()
    const explicitTasks = deps.tasks()
    const appState =
      baseAppState?.tasks === explicitTasks
        ? baseAppState
        : { ...baseAppState, tasks: explicitTasks }
    const teamName = appState.teamContext?.teamName
    const teamFile = teamName ? await readTeamFileAsync(teamName) : null
    const callerTeammateId = callerTeammateIdFromContext(
      getTeammateContext(),
      getAgentContext()?.agentId ?? deps.agentId,
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
        // Official 2.1.328 (#588): cloud/bridge sessions that just started
        // (untitled) or have `@` in their title are included as token-only
        // candidates (`untitled` / `@` → `(at)`) with `[ref]` so they remain
        // reachable via `SendMessage({ to: "name [ref]" })`.
        if (name === null || !isAddressableListingName(name)) {
          if (peer.transport === 'bridge' || peer.transport === 'cloud') {
            return [
              {
                kind: peerCandidateKind(peer),
                id: peerListingId(peer),
                name: formatTokenOnlySessionName(peer.name),
              },
            ]
          }
          return []
        }
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

    // Official 2.1.328 (#658): explain when Remote Control is off so Claude knows
    // why cloud sessions or other computers are not listed.
    let rcOffNote: string | null = null
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { isReplBridgeActive } =
        require('src/bootstrap/state.js') as typeof import('src/bootstrap/state.js')
      const { isClaudeAISubscriber } =
        require('src/utils/auth.js') as typeof import('src/utils/auth.js')
      const { getAPIProvider } =
        require('src/utils/model/providers.js') as typeof import('src/utils/model/providers.js')
      const { isBridgeEnabled } =
        require('src/bridge/bridgeEnabled.js') as typeof import('src/bridge/bridgeEnabled.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      const entrypoint = process.env.CLAUDE_CODE_ENTRYPOINT ?? ''
      rcOffNote = buildRemoteControlOffNote({
        isRemoteMode: Boolean(process.env.CLAUDE_CODE_REMOTE),
        isReplBridgeActive: isReplBridgeActive(),
        isFirstPartyOAuth:
          getAPIProvider() === 'firstParty' && isClaudeAISubscriber(),
        isRcAllowed: isBridgeEnabled(),
        hasCloudAccess:
          cloudList.sessions.length > 0 || cloudList.unavailable === undefined,
        isDesktop: entrypoint === 'claude-desktop' || entrypoint === 'desktop',
      })
    } catch {
      // optional in isolated unit tests
    }

    return {
      data: {
        listing: formatPeersListing(peers, {
          listTruncated,
          cloudListFailed,
          bridgeWalkIncomplete,
          remoteControlOffNote: rcOffNote,
          cursor: input.cursor,
          selfHeader: formatOwnSessionListing(self),
          teammatesSection,
          subagentsSection,
          candidates,
          session: deps.session,
        }),
      },
    }
  },
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

  async description(
    _input?: ListAgentsInput,
    context?: { tools?: readonly { name: string; aliases?: string[] }[] },
  ) {
    const tools = context?.tools
    const canSendMessages = tools
      ? tools.some(t => toolMatchesName(t, SEND_MESSAGE_TOOL_NAME))
      : true
    return getListAgentsPrompt({ canSendMessages })
  },
  async prompt(context?: {
    tools?: readonly { name: string; aliases?: string[] }[]
  }) {
    const tools = context?.tools
    const canSendMessages = tools
      ? tools.some(t => toolMatchesName(t, SEND_MESSAGE_TOOL_NAME))
      : true
    return getListAgentsPrompt({ canSendMessages })
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

  create(deps: ToolDeps) {
    return {
      call(input: ListAgentsInput) {
        return listAgentsRuntime.call(input, deps)
      },
    }
  },
})

/** @deprecated densable export name is ListAgentsTool; keep ListPeersTool for import path stability. */
export const ListPeersTool = ListAgentsTool
