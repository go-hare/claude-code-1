/**
 * densable 2.1.238 #29/#30 — sendPeerReceipt / peer_message_status (fiw / afl / zih).
 *
 * Receiver → sender control frames for refuse / hold / drop. Circular-import
 * safe: this module does NOT import udsIdleNotify or udsMessaging. The UDS
 * listen path (startUdsMessaging) installs the sender via setSendPeerReceipt.
 */

import { logForDebugging } from './debug.js'
import { parseAddress } from './peerAddress.js'
import {
  canonicalOutboundPaceKey,
  getOutboundPacer,
} from './udsOutboundPacer.js'

export type PeerReceiptStatus =
  | 'held'
  | 'denied'
  | 'expired'
  | 'delivered'
  | 'refused'
  | 'dropped'

export type PeerReceiptDropReason =
  | 'rate-limited'
  | 'duplicate'
  | 'hop-loop'
  | 'hop-runaway'
  | 'queue-full'

export type PeerReceiptDropExtra = {
  dropReason?: string
  droppedMsgIds?: string[]
}

export type PeerReceiptMessage = {
  mode?: string
  agentId?: string
  value?: string
  origin?: {
    kind?: string
    from?: string
    msg_id?: string
    verifiedPeerPid?: number
  }
}

type SendPeerReceipt = (
  message: PeerReceiptMessage,
  status: PeerReceiptStatus,
  extra?: PeerReceiptDropExtra,
) => void

type OutstandingRow = { msgId: string; to: string }

/** densable pXd */
export const PEER_RECEIPT_OUTSTANDING_CAP = 200
/** densable rya */
export const PEER_RECEIPT_DROPPED_MSG_IDS_CAP = 256

/** densable prr */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** densable OWb */
const DROP_REASONS = new Set<PeerReceiptDropReason>([
  'rate-limited',
  'duplicate',
  'hop-loop',
  'hop-runaway',
  'queue-full',
])

let sendPeerReceiptImpl: SendPeerReceipt | null = null
let onPeerMessageStatus:
  | ((
      status: PeerReceiptStatus,
      destination: string,
      extra?: { dropReason?: PeerReceiptDropReason; droppedCount?: number },
    ) => void)
  | null = null

const outstandingSends: OutstandingRow[] = []
const awaitingTerminal: OutstandingRow[] = []

/** densable fiw — verbatim sender-visible reasons. */
export function peerReceiptReason(status: PeerReceiptStatus): string {
  switch (status) {
    case 'held':
      return "Your message is held for the recipient user's approval before it reaches their Claude session (permission-mode parity)."
    case 'denied':
      return 'The recipient user declined your message; it was not delivered to their Claude session.'
    case 'expired':
      return "Your held message expired without approval and was not delivered to the recipient's Claude session."
    case 'delivered':
      return "Your previously-held message was approved and released to the recipient's Claude session."
    case 'refused':
      return 'The recipient session is not accepting cross-session messages (the feature is off there, or a setting or policy there refuses them); your message was not delivered to its Claude.'
    case 'dropped':
      return "The recipient's session dropped your message at its inbox (rate limit, duplicate, relay loop, or full queue); it was not delivered and will not be."
  }
}

/** densable QJd */
export function admitDropReason(
  raw: unknown,
): PeerReceiptDropReason | undefined {
  if (typeof raw !== 'string') return undefined
  return DROP_REASONS.has(raw as PeerReceiptDropReason)
    ? (raw as PeerReceiptDropReason)
    : undefined
}

/** densable Xow */
export function filterDroppedMsgIds(raw: unknown): Set<string> {
  const out = new Set<string>()
  if (!Array.isArray(raw)) return out
  for (const id of raw) {
    if (typeof id !== 'string' || !UUID_RE.test(id)) continue
    out.add(id)
    if (out.size >= PEER_RECEIPT_DROPPED_MSG_IDS_CAP) break
  }
  return out
}

/**
 * densable afl wire map: refused is sent as expired + status_detail=refused
 * so older peers that only know expired still parse the frame.
 */
export function buildPeerReceiptControlFields(args: {
  status: PeerReceiptStatus
  from: string
  origMsgId?: string
  extra?: PeerReceiptDropExtra
}): Record<string, unknown> {
  const refused = args.status === 'refused'
  return {
    action: 'peer_message_status',
    ...(refused
      ? { status: 'expired', status_detail: 'refused' }
      : { status: args.status }),
    reason: peerReceiptReason(args.status),
    from: args.from,
    ...(typeof args.origMsgId === 'string'
      ? { orig_msg_id: args.origMsgId }
      : {}),
    ...(args.status === 'dropped' && args.extra !== undefined
      ? {
          ...(args.extra.dropReason !== undefined
            ? { drop_reason: args.extra.dropReason }
            : {}),
          ...(args.extra.droppedMsgIds !== undefined
            ? { dropped_msg_ids: args.extra.droppedMsgIds }
            : {}),
        }
      : {}),
  }
}

/** densable afl */
export function setSendPeerReceipt(cb: SendPeerReceipt | null): void {
  sendPeerReceiptImpl = cb
}

export function sendPeerReceipt(
  message: PeerReceiptMessage,
  status: PeerReceiptStatus,
  extra?: PeerReceiptDropExtra,
): void {
  sendPeerReceiptImpl?.(message, status, extra)
}

export function setOnPeerMessageStatus(
  cb: NonNullable<typeof onPeerMessageStatus> | null,
): void {
  onPeerMessageStatus = cb
}

/** densable fXd */
export function noteOutstandingSend(msgId: string, to: string): void {
  if (outstandingSends.length >= PEER_RECEIPT_OUTSTANDING_CAP) {
    outstandingSends.shift()
  }
  outstandingSends.push({ msgId, to })
}

export function forgetOutstandingSend(msgId: string): void {
  const drop = (rows: OutstandingRow[]): void => {
    const idx = rows.findIndex(r => r.msgId === msgId)
    if (idx !== -1) rows.splice(idx, 1)
  }
  drop(outstandingSends)
  drop(awaitingTerminal)
}

/** densable cya */
export function matchOutstandingSend(
  msgId: string | undefined,
  status: string,
): { destination: string; wasHeld: boolean } | undefined {
  if (typeof msgId !== 'string') return undefined
  const idx = outstandingSends.findIndex(r => r.msgId === msgId)
  if (idx !== -1) {
    const [row] = outstandingSends.splice(idx, 1)
    if (!row) return undefined
    if (status === 'held') {
      if (awaitingTerminal.length >= PEER_RECEIPT_OUTSTANDING_CAP) {
        awaitingTerminal.shift()
      }
      awaitingTerminal.push(row)
    }
    return { destination: row.to, wasHeld: false }
  }
  if (status === 'held') return undefined
  const termIdx = awaitingTerminal.findIndex(r => r.msgId === msgId)
  if (termIdx === -1) return undefined
  const [row] = awaitingTerminal.splice(termIdx, 1)
  if (!row) return undefined
  return { destination: row.to, wasHeld: true }
}

/** densable uya */
export function dropOutstandingSends(
  ids: Set<string>,
): Map<string, { dropped: number; wereHeld: number }> {
  const map = new Map<string, { dropped: number; wereHeld: number }>()
  if (ids.size === 0) return map
  const bump = (to: string, wereHeld: boolean): void => {
    const cur = map.get(to) ?? { dropped: 0, wereHeld: 0 }
    cur.dropped += 1
    if (wereHeld) cur.wereHeld += 1
    map.set(to, cur)
  }
  const filter = (rows: OutstandingRow[], held: boolean): void => {
    const kept: OutstandingRow[] = []
    for (const row of rows) {
      if (ids.has(row.msgId)) bump(row.to, held)
      else kept.push(row)
    }
    rows.length = 0
    rows.push(...kept)
  }
  filter(outstandingSends, false)
  filter(awaitingTerminal, true)
  return map
}

function creditPacer(to: string): void {
  const parsed = parseAddress(to)
  if (parsed.scheme !== 'uds') return
  const key = canonicalOutboundPaceKey(parsed.target) ?? parsed.target
  getOutboundPacer().credit(key)
}

function debitPacer(to: string): void {
  const parsed = parseAddress(to)
  if (parsed.scheme !== 'uds') return
  const key = canonicalOutboundPaceKey(parsed.target) ?? parsed.target
  getOutboundPacer().debit(key)
}

function summarizeMsgId(id: string | undefined): string {
  return id ?? 'undefined'
}

function peerOriginOf(
  message: PeerReceiptMessage,
): PeerReceiptMessage['origin'] | undefined {
  const origin = message.origin
  if (origin?.kind !== 'peer') return undefined
  return origin
}

/**
 * densable afl body — skip unshaped replies; map refused → expired+status_detail.
 * `vetReplyAddress` / `send` are injected so this module never imports idle-notify.
 */
export function dispatchPeerReceipt(opts: {
  message: PeerReceiptMessage
  status: PeerReceiptStatus
  extra?: PeerReceiptDropExtra
  ownSocketPath: string
  from: string
  vetReplyAddress: (from: string, own: string) => string | undefined
  send: (target: string, fields: Record<string, unknown>) => Promise<void>
}): void {
  const origin = peerOriginOf(opts.message)
  const from = origin?.from
  if (typeof from !== 'string') return
  const reply = opts.vetReplyAddress(from, opts.ownSocketPath)
  if (reply === undefined) {
    logForDebugging(
      `[uds-messaging] hold-receipt skipped: reply address unshaped or outside our socket namespace (${from})`,
    )
    return
  }
  const origMsgId =
    typeof origin?.msg_id === 'string' ? origin.msg_id : undefined
  const fields = buildPeerReceiptControlFields({
    status: opts.status,
    from: opts.from,
    origMsgId,
    extra: opts.extra,
  })
  void opts.send(reply, fields).catch(err => {
    const detail = err instanceof Error ? err.message : String(err)
    logForDebugging(
      `[uds-messaging] hold-receipt send failed to ${from}: ${detail}`,
    )
  })
}

export function installPeerReceiptSender(opts: {
  ownSocketPath: string
  from: string
  vetReplyAddress: (from: string, own: string) => string | undefined
  send: (target: string, fields: Record<string, unknown>) => Promise<void>
}): void {
  setSendPeerReceipt((message, status, extra) => {
    dispatchPeerReceipt({
      message,
      status,
      extra,
      ownSocketPath: opts.ownSocketPath,
      from: opts.from,
      vetReplyAddress: opts.vetReplyAddress,
      send: opts.send,
    })
  })
}

/**
 * densable knm — inbox-full drop. Only UDS peer origins; reason is queue-full.
 * Keep the socket close string ('inbox full') at the call site.
 */
export function noteInboxQueueFullDrop(message: {
  from?: string
  msg_id?: string
  meta?: Record<string, unknown>
}): void {
  const from = message.from
  if (typeof from !== 'string' || from.length === 0) return
  if (parseAddress(from).scheme !== 'uds') return
  const msgId =
    typeof message.msg_id === 'string'
      ? message.msg_id
      : typeof message.meta?.msg_id === 'string'
        ? message.meta.msg_id
        : undefined
  let agentId: string | undefined
  try {
    const { getAgentId } =
      require('./teammate.js') as typeof import('./teammate.js')
    agentId = getAgentId()
  } catch {
    agentId = undefined
  }
  sendPeerReceipt(
    {
      mode: 'prompt',
      agentId,
      value: '',
      origin: {
        kind: 'peer',
        from,
        ...(msgId !== undefined ? { msg_id: msgId } : {}),
      },
    },
    'dropped',
    { dropReason: 'queue-full' },
  )
}

/** densable zih — inbound peer_message_status. */
export function handlePeerMessageStatusFrame(
  frame: Record<string, unknown>,
): boolean {
  if (frame.action !== 'peer_message_status') return false
  const rawStatus = frame.status
  if (
    rawStatus !== 'held' &&
    rawStatus !== 'denied' &&
    rawStatus !== 'expired' &&
    rawStatus !== 'delivered' &&
    rawStatus !== 'refused' &&
    rawStatus !== 'dropped'
  ) {
    return false
  }
  const status: PeerReceiptStatus =
    rawStatus === 'expired' && frame.status_detail === 'refused'
      ? 'refused'
      : rawStatus
  const orig =
    typeof frame.orig_msg_id === 'string' ? frame.orig_msg_id : undefined

  if (status === 'dropped') {
    const dropReason = admitDropReason(frame.drop_reason)
    const named = filterDroppedMsgIds(frame.dropped_msg_ids)
    const matched =
      orig !== undefined ? matchOutstandingSend(orig, 'dropped') : undefined
    const byDest = dropOutstandingSends(named)
    if (matched !== undefined) {
      const cur = byDest.get(matched.destination) ?? {
        dropped: 0,
        wereHeld: 0,
      }
      cur.dropped += 1
      if (matched.wasHeld) cur.wereHeld += 1
      byDest.set(matched.destination, cur)
    }
    if (dropReason === 'queue-full') {
      for (const [dest, counts] of byDest) {
        for (let i = 0; i < counts.wereHeld; i++) debitPacer(dest)
      }
    }
    if (byDest.size === 0) {
      const id = summarizeMsgId(orig)
      logForDebugging(
        `[uds-messaging] peer_message_status dropped: neither orig_msg_id=${id} nor any named id matches an outstanding send`,
      )
    }
    for (const [dest, counts] of byDest) {
      onPeerMessageStatus?.('dropped', dest, {
        dropReason,
        droppedCount: counts.dropped,
      })
    }
    return true
  }

  const matched = matchOutstandingSend(orig, status)
  if (matched === undefined) {
    const id = summarizeMsgId(orig)
    logForDebugging(
      `[uds-messaging] peer_message_status dropped: no outstanding send matches orig_msg_id=${id}`,
    )
    return true
  }
  if (status === 'held') creditPacer(matched.destination)
  else if (status === 'delivered' && matched.wasHeld) {
    debitPacer(matched.destination)
  }
  onPeerMessageStatus?.(status, matched.destination)
  return true
}

export function resetPeerReceiptsForTests(): void {
  sendPeerReceiptImpl = null
  onPeerMessageStatus = null
  outstandingSends.length = 0
  awaitingTerminal.length = 0
}
