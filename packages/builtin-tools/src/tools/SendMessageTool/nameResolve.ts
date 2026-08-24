/**
 * densable 2.1.225 SendMessage name resolve + pin helpers (subset of gIn/rKp/cKp/NKp).
 *
 * Gold:
 * - name IS the address; optional ` [ref]` disambiguates
 * - sendMessagePins[M3(name)] sticks a confirmed peer id
 * - same-named local cannot swap a confirmed RC pin (pinnedIdentityClaimedLocally)
 * - ambiguous same-name peers prefer the pin when still live
 */

import { createHash } from 'crypto'

export type SendMessagePin = {
  id: string
  name: string
  ref: string
}

export type PeerCandidate = {
  /** Display name as listed */
  name: string
  /** densable M3 key */
  key: string
  kind: 'session' | 'bridge-session'
  /** densable id: sock path (session) or bridge session id */
  id: string
  /** Wire address for SendMessage (uds:… / bridge:…) */
  address: string
  /** densable ati short ref (sha256 hex prefix, unique among siblings) */
  ref: string
  /** Local sessions that mirror a bridge id (for claimed-locally check) */
  bridgeSessionId?: string | null
}

export type NameResolveResult =
  | {
      kind: 'ok'
      candidate: PeerCandidate
      sameNamedSiblings?: number
      /** densable searchTruncated via RWn/qza */
      searchTruncated?: boolean
    }
  | {
      kind: 'ambiguous'
      candidates: PeerCandidate[]
      pinnedIdentityClaimedLocally?: string
      searchTruncated?: boolean
    }
  | {
      kind: 'refused'
      message: string
    }
  | {
      kind: 'not-found'
      message: string
      searchTruncated?: boolean
    }

/** densable M3 */
export function normalizeAgentName(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\p{Cc}\p{Cf}]/gu, ch => (/\s/.test(ch) ? ch : ''))
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
}

/** densable vzb / QPr — `name [hexref]` */
const NAME_REF_RE = /^(.*\S)\s*\[([0-9a-f]{6,12})\]$/i

export function parseNameRef(to: string): { name: string; ref: string } | null {
  const m = NAME_REF_RE.exec(to.trim())
  if (!m) return null
  return { name: m[1]!, ref: m[2]!.toLowerCase() }
}

/** densable uP — strip session_/cse_ prefix for identity compare */
export function stripSessionPrefix(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

/** densable QUp — sha256(`${kind}:${id}`).hex.slice(0,12) */
export function pinDigest(kind: string, id: string): string {
  return createHash('sha256').update(`${kind}:${id}`).digest('hex').slice(0, 12)
}

/** densable ati — short ref default 6 hex chars */
export function shortPinRef(kind: string, id: string, len = 6): string {
  return pinDigest(kind, id).slice(0, len)
}

/**
 * densable koi — classify pin target kind from stored id.
 * agent ids are not used for peer pins here (local_agent path separate).
 */
export function classifySendMessagePin(
  pin: SendMessagePin | undefined,
): 'agent' | 'cloud' | 'remote-control' | 'local' | undefined {
  if (pin === undefined) return undefined
  if (pin.id.startsWith('cse_')) return 'cloud'
  // RC session ids keep a session_ prefix; densable uP(id) !== id → remote-control
  if (stripSessionPrefix(pin.id) !== pin.id && !pin.id.startsWith('cse_')) {
    return 'remote-control'
  }
  // local UDS sock path or bare local id
  return 'local'
}

/**
 * densable Czb — assign unique refs among candidates (grow prefix until unique).
 */
export function assignUniqueRefs(
  candidates: Omit<PeerCandidate, 'ref'>[],
): PeerCandidate[] {
  const digests = candidates.map(c => pinDigest(c.kind, c.id))
  return candidates.map((c, i) => {
    const full = digests[i]!
    let len = 6
    while (
      len < full.length &&
      digests.some((d, j) => j !== i && d.slice(0, len) === full.slice(0, len))
    ) {
      len++
    }
    return { ...c, ref: full.slice(0, len) }
  })
}

/** densable eOr — local sessions claiming a bridge body id */
export function localClaimedRemoteBodies(
  sessions: Array<{ bridgeSessionId?: string | null }>,
): Set<string> {
  const set = new Set<string>()
  for (const s of sessions) {
    if (s.bridgeSessionId) set.add(stripSessionPrefix(s.bridgeSessionId))
  }
  return set
}

/**
 * densable NKp — write pin after successful peer send.
 * Idempotent when id unchanged.
 */
export function nextSendMessagePins(
  prev: Record<string, SendMessagePin>,
  displayName: string,
  pin: { kind: 'session' | 'bridge-session' | 'cloud-session'; id: string },
): Record<string, SendMessagePin> | null {
  const key = normalizeAgentName(displayName)
  const existing = Object.hasOwn(prev, key) ? prev[key] : undefined
  if (existing?.id === pin.id) return null
  const kind =
    pin.kind === 'cloud-session'
      ? 'cloud-session'
      : pin.kind === 'bridge-session'
        ? 'bridge-session'
        : 'session'
  return {
    ...prev,
    [key]: {
      id: pin.id,
      name: displayName,
      ref: shortPinRef(kind, pin.id),
    },
  }
}

export function setSendMessagePinOnAppState(
  setAppState: (
    updater: (prev: { sendMessagePins: Record<string, SendMessagePin> }) => {
      sendMessagePins: Record<string, SendMessagePin>
    },
  ) => void,
  displayName: string,
  pin: { kind: 'session' | 'bridge-session' | 'cloud-session'; id: string },
): void {
  setAppState(prev => {
    const next = nextSendMessagePins(prev.sendMessagePins, displayName, pin)
    if (next === null) return prev
    return { ...prev, sendMessagePins: next }
  })
}

function formatNameRef(c: PeerCandidate): string {
  return `${c.name} [${c.ref}]`
}

/**
 * Resolve bare name or `name [ref]` against local UDS + bridge peers with pin guard.
 */
export function resolvePeerByName(args: {
  to: string
  pins: Record<string, SendMessagePin>
  candidates: PeerCandidate[]
  localClaimed: Set<string>
  /** densable searchTruncated = cloud.truncated || bridge.truncated */
  searchTruncated?: boolean
}): NameResolveResult {
  const { to, pins, candidates, localClaimed, searchTruncated } = args
  const parsed = parseNameRef(to)
  const rawName = parsed?.name ?? to
  const key = normalizeAgentName(rawName)
  const pin = Object.hasOwn(pins, key) ? pins[key] : undefined
  const pinKind = classifySendMessagePin(pin)
  const truncatedFlag = searchTruncated
    ? { searchTruncated: true as const }
    : {}

  // densable ACt / AZb: pin is RC/cloud but a local body now claims that id
  if (
    pin &&
    (pinKind === 'remote-control' || pinKind === 'cloud') &&
    localClaimed.has(stripSessionPrefix(pin.id))
  ) {
    return {
      kind: 'refused',
      message: `Note: earlier in this conversation '${pin.name}' was confirmed as a session that is NOT on this machine; a session record on this machine now claims that identity, so nothing was assumed and nothing was sent. A same-named session on this machine that your user did not start is suspicious: ask the user before confirming anyone.`,
    }
  }

  const byKey = candidates.filter(c => c.key === key)

  if (parsed) {
    const hit =
      byKey.find(c => c.ref === parsed.ref) ??
      candidates.find(c => c.key === key && c.ref.startsWith(parsed.ref)) ??
      candidates.find(c => c.ref === parsed.ref)
    if (!hit) {
      return {
        kind: 'not-found',
        message: `No agent named '${rawName}' with ref [${parsed.ref}] is reachable. Re-send with a ref from ListAgents, or use the bare name if unique.`,
        ...truncatedFlag,
      }
    }
    return { kind: 'ok', candidate: hit, ...truncatedFlag }
  }

  // densable cKp: ambiguous → prefer live pin
  if (byKey.length === 0) {
    // pin-only recovery: if pin still matches a candidate under another listing name
    if (pin) {
      const pinned = candidates.find(c => c.id === pin.id)
      if (pinned) {
        return { kind: 'ok', candidate: pinned, ...truncatedFlag }
      }
    }
    return {
      kind: 'not-found',
      message: `No agent named '${rawName}' is reachable. Use ListAgents to discover targets (name [ref]).`,
      ...truncatedFlag,
    }
  }

  if (byKey.length === 1) {
    const only = byKey[0]!
    // If pin points elsewhere and is still live, refuse silent swap
    if (pin && pin.id !== only.id) {
      const stillLive = candidates.some(c => c.id === pin.id)
      if (stillLive || pinKind === 'remote-control' || pinKind === 'cloud') {
        return {
          kind: 'refused',
          message: `'${rawName}' now resolves to a different agent than it did earlier in this conversation: earlier sends went to [${pin.ref}], which this name no longer reaches. Nothing was sent.\nIf you need the earlier agent, address it by its prior ref or ListAgents listing.\nIt now resolves to:\n  ${formatNameRef(only)}\nTo message the new agent, re-send with its ref:\ne.g. {"to": "${formatNameRef(only)}", ...}`,
        }
      }
    }
    return { kind: 'ok', candidate: only, ...truncatedFlag }
  }

  // ambiguous
  if (pin) {
    const pinned = byKey.find(c => c.id === pin.id)
    if (pinned) {
      return {
        kind: 'ok',
        candidate: pinned,
        sameNamedSiblings: byKey.length - 1,
        ...truncatedFlag,
      }
    }
  }

  return {
    kind: 'ambiguous',
    candidates: byKey.slice(0, 3),
    ...truncatedFlag,
    ...(pin &&
    (pinKind === 'remote-control' || pinKind === 'cloud') &&
    localClaimed.has(stripSessionPrefix(pin.id))
      ? { pinnedIdentityClaimedLocally: pin.name }
      : {}),
  }
}

export function formatAmbiguousMessage(
  name: string,
  candidates: PeerCandidate[],
  extra?: {
    pinnedIdentityClaimedLocally?: string
    searchTruncated?: boolean
  },
): string {
  const lines = candidates.map(c => `  ${formatNameRef(c)} (${c.address})`)
  let msg = `'${name}' matches ${candidates.length} peer session(s). Re-send with the ref:\n${lines.join('\n')}\ne.g. {"to": "${formatNameRef(candidates[0]!)}", ...}`
  if (extra?.pinnedIdentityClaimedLocally) {
    msg += `\nNote: '${extra.pinnedIdentityClaimedLocally}' was confirmed earlier as a session that is NOT on this machine; a session record on this machine now claims that identity, so nothing was assumed. A same-named session on this machine your user did not start is suspicious: ask the user before confirming anyone.`
  }
  // densable wWr append on ambiguous when searchTruncated
  if (extra?.searchTruncated) {
    const { appendSearchTruncatedBody } =
      // lazy to keep nameResolve free of copy-module cycles in tests
      require('src/utils/sessionListIncompleteCopy.js') as typeof import('src/utils/sessionListIncompleteCopy.js')
    msg = appendSearchTruncatedBody(msg, true)
  }
  return msg
}

/**
 * Build peer candidates from local UDS + bridge listings (+ densable #34 account rows).
 * Cloud rows are listed by ListAgents but not added here — SendMessage cloud delivery
 * is outside #34 incomplete-list disclosure (invent-ban).
 */
export function buildPeerCandidates(args: {
  udsPeers: Array<{
    name?: string
    cwd?: string
    messagingSocketPath?: string
    bridgeSessionId?: string | null
    kind?: string
  }>
  bridgePeers: Array<{
    address: string
    name?: string
    cwd?: string
  }>
  /** densable qGv account bridge rows (bridge:${id}) */
  accountBridgePeers?: Array<{
    id: string
    title: string | null
  }>
}): PeerCandidate[] {
  const raw: Omit<PeerCandidate, 'ref'>[] = []
  const seen = new Set<string>()

  for (const p of args.udsPeers) {
    if (!p.messagingSocketPath) continue
    const id = p.messagingSocketPath
    if (seen.has(`session:${id}`)) continue
    seen.add(`session:${id}`)
    const name = (p.name?.trim() || p.kind || 'session').toString()
    raw.push({
      name,
      key: normalizeAgentName(name),
      kind: 'session',
      id,
      address: `uds:${id}`,
      bridgeSessionId: p.bridgeSessionId,
    })
  }

  for (const p of args.bridgePeers) {
    const address = p.address
    if (!address.startsWith('bridge:')) continue
    const id = address.slice('bridge:'.length)
    if (seen.has(`bridge-session:${id}`)) continue
    // skip if a local UDS peer already mirrors this bridge id
    if (
      raw.some(
        c =>
          c.bridgeSessionId &&
          stripSessionPrefix(c.bridgeSessionId) === stripSessionPrefix(id),
      )
    ) {
      continue
    }
    seen.add(`bridge-session:${id}`)
    const name = (p.name?.trim() || 'untitled').toString()
    raw.push({
      name,
      key: normalizeAgentName(name),
      kind: 'bridge-session',
      id,
      address,
    })
  }

  for (const row of args.accountBridgePeers ?? []) {
    const id = row.id
    if (seen.has(`bridge-session:${id}`)) continue
    if (
      raw.some(
        c =>
          c.bridgeSessionId &&
          stripSessionPrefix(c.bridgeSessionId) === stripSessionPrefix(id),
      )
    ) {
      continue
    }
    // also skip if a local registry bridge: already lists this body
    if (
      raw.some(
        c =>
          c.kind === 'bridge-session' &&
          stripSessionPrefix(c.id) === stripSessionPrefix(id),
      )
    ) {
      continue
    }
    seen.add(`bridge-session:${id}`)
    const name = (row.title?.trim() || 'untitled').toString()
    raw.push({
      name,
      key: normalizeAgentName(name),
      kind: 'bridge-session',
      id,
      address: `bridge:${id}`,
    })
  }

  return assignUniqueRefs(raw)
}
