/**
 * densable 2.1.238 #29/#30 — sendPeerReceipt / fiw / refused wire map / outstanding.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyPeerInboundPolicy,
  clearPeerInboundHoldBuffer,
  getHeldPeerInboundMessages,
  releaseHeldPeerInboundMessages,
  resolveHeldPeerInboundMessage,
  setPeerInboundHoldListeners,
} from '../crossSessionInbound.js'
import {
  admitDropReason,
  buildPeerReceiptControlFields,
  dispatchPeerReceipt,
  filterDroppedMsgIds,
  handlePeerMessageStatusFrame,
  matchOutstandingSend,
  noteInboxQueueFullDrop,
  noteOutstandingSend,
  PEER_RECEIPT_OUTSTANDING_CAP,
  peerReceiptReason,
  resetPeerReceiptsForTests,
  sendPeerReceipt,
  setOnPeerMessageStatus,
  setSendPeerReceipt,
  summarizePeerMsgId,
} from '../peerReceipts.js'

afterEach(() => {
  resetPeerReceiptsForTests()
  clearPeerInboundHoldBuffer()
  setPeerInboundHoldListeners({})
})

const FIW = {
  held: "Your message is held for the recipient user's approval before it reaches their Claude session (permission-mode parity).",
  denied:
    'The recipient user declined your message; it was not delivered to their Claude session.',
  expired:
    "Your held message expired without approval and was not delivered to the recipient's Claude session.",
  delivered:
    "Your previously-held message was approved and released to the recipient's Claude session.",
  refused:
    'The recipient session is not accepting cross-session messages (the feature is off there, or a setting or policy there refuses them); your message was not delivered to its Claude.',
  dropped:
    "The recipient's session dropped your message at its inbox (rate limit, duplicate, relay loop, or full queue); it was not delivered and will not be.",
} as const

describe('peerReceiptReason (fiw)', () => {
  test('verbatim copy for all six statuses', () => {
    for (const [status, copy] of Object.entries(FIW)) {
      expect(peerReceiptReason(status as keyof typeof FIW)).toBe(copy)
    }
  })
})

describe('buildPeerReceiptControlFields (afl wire map)', () => {
  test('refused → expired + status_detail=refused', () => {
    expect(
      buildPeerReceiptControlFields({
        status: 'refused',
        from: 'uds:/tmp/own.sock',
        origMsgId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ).toEqual({
      action: 'peer_message_status',
      status: 'expired',
      status_detail: 'refused',
      reason: FIW.refused,
      from: 'uds:/tmp/own.sock',
      orig_msg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
  })

  test('held is not remapped', () => {
    const fields = buildPeerReceiptControlFields({
      status: 'held',
      from: 'uds:/tmp/own.sock',
    })
    expect(fields.status).toBe('held')
    expect(fields.status_detail).toBeUndefined()
    expect(fields.reason).toBe(FIW.held)
  })

  test('dropped payload includes drop_reason + dropped_msg_ids', () => {
    expect(
      buildPeerReceiptControlFields({
        status: 'dropped',
        from: 'uds:/tmp/own.sock',
        origMsgId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        extra: {
          dropReason: 'queue-full',
          droppedMsgIds: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
        },
      }),
    ).toMatchObject({
      action: 'peer_message_status',
      status: 'dropped',
      drop_reason: 'queue-full',
      dropped_msg_ids: ['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
    })
  })
})

describe('dispatchPeerReceipt skip unshaped', () => {
  test('skips when vetReplyAddress returns undefined (no send)', () => {
    const sent: unknown[] = []
    dispatchPeerReceipt({
      message: {
        origin: { kind: 'peer', from: 'bridge:session_x' },
      },
      status: 'refused',
      ownSocketPath: '/tmp/own.sock',
      from: 'uds:/tmp/own.sock',
      vetReplyAddress: () => undefined,
      send: async (target, fields) => {
        sent.push({ target, fields })
      },
    })
    expect(sent).toEqual([])
  })

  test('sends refused wire map when reply is shaped', async () => {
    const sent: Array<{ target: string; fields: Record<string, unknown> }> = []
    dispatchPeerReceipt({
      message: {
        origin: {
          kind: 'peer',
          from: 'uds:/tmp/peer.sock',
          msg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        },
      },
      status: 'refused',
      ownSocketPath: '/tmp/own.sock',
      from: 'uds:/tmp/own.sock',
      vetReplyAddress: from => (from.startsWith('uds:') ? from.slice(4) : from),
      send: async (target, fields) => {
        sent.push({ target, fields })
      },
    })
    await Bun.sleep(0)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.target).toBe('/tmp/peer.sock')
    expect(sent[0]?.fields.status).toBe('expired')
    expect(sent[0]?.fields.status_detail).toBe('refused')
  })
})

describe('applyPeerInboundPolicy receipts', () => {
  test('refuse fires sendPeerReceipt refused', () => {
    const receipts: Array<{ status: string; from?: string }> = []
    setSendPeerReceipt((message, status) => {
      receipts.push({ status, from: message.origin?.from })
    })
    const result = applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'refuse', holdCause: 'explicit-setting' },
    )
    expect(result).toBe('refused')
    expect(receipts).toEqual([
      { status: 'refused', from: 'uds:/tmp/peer.sock' },
    ])
  })

  test('hold fires held; hold-full eviction fires expired', () => {
    const receipts: string[] = []
    setSendPeerReceipt((_message, status) => {
      receipts.push(status)
    })
    for (let i = 0; i < 100; i++) {
      applyPeerInboundPolicy(
        { origin: { kind: 'peer', from: `uds:/tmp/p${i}.sock` } },
        { policy: 'hold', holdCause: 'explicit-setting' },
      )
    }
    expect(receipts.filter(s => s === 'held')).toHaveLength(100)
    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/overflow.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    expect(receipts.filter(s => s === 'expired')).toHaveLength(1)
    expect(receipts.filter(s => s === 'held')).toHaveLength(101)
  })

  test('release denied/delivered fire receipts', () => {
    const receipts: string[] = []
    setSendPeerReceipt((_message, status) => {
      receipts.push(status)
    })
    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    receipts.length = 0
    releaseHeldPeerInboundMessages('policy-accepts', { explicit: 'refuse' })
    expect(receipts).toEqual(['denied'])

    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    receipts.length = 0
    releaseHeldPeerInboundMessages('policy-accepts', { explicit: 'accept' })
    expect(receipts).toEqual(['delivered'])
  })

  test('resolveHeld approve/deny/expire fire receipts', () => {
    const receipts: string[] = []
    setSendPeerReceipt((_message, status) => {
      receipts.push(status)
    })
    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    const held = getHeldPeerInboundMessages()[0]
    expect(held).toBeDefined()
    receipts.length = 0
    resolveHeldPeerInboundMessage(held!, 'approve')
    expect(receipts).toEqual(['delivered'])

    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    const held2 = getHeldPeerInboundMessages()[0]!
    receipts.length = 0
    resolveHeldPeerInboundMessage(held2, 'deny')
    expect(receipts).toEqual(['denied'])

    applyPeerInboundPolicy(
      { origin: { kind: 'peer', from: 'uds:/tmp/peer.sock' } },
      { policy: 'hold', holdCause: 'explicit-setting' },
    )
    const held3 = getHeldPeerInboundMessages()[0]!
    receipts.length = 0
    resolveHeldPeerInboundMessage(held3, 'expire')
    expect(receipts).toEqual(['expired'])
  })
})

describe('outstanding + inbound remap', () => {
  test('cap is 200', () => {
    expect(PEER_RECEIPT_OUTSTANDING_CAP).toBe(200)
  })

  test('expired + status_detail=refused remaps to refused', () => {
    const seen: string[] = []
    setOnPeerMessageStatus(status => {
      seen.push(status)
    })
    noteOutstandingSend(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'uds:/tmp/p.sock',
    )
    expect(
      handlePeerMessageStatusFrame({
        action: 'peer_message_status',
        status: 'expired',
        status_detail: 'refused',
        orig_msg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      }),
    ).toBe(true)
    expect(seen).toEqual(['refused'])
  })

  test('held then delivered-after-held matches awaitingTerminal', () => {
    const seen: string[] = []
    setOnPeerMessageStatus(status => {
      seen.push(status)
    })
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    noteOutstandingSend(id, 'uds:/tmp/p.sock')
    handlePeerMessageStatusFrame({
      action: 'peer_message_status',
      status: 'held',
      orig_msg_id: id,
    })
    handlePeerMessageStatusFrame({
      action: 'peer_message_status',
      status: 'delivered',
      orig_msg_id: id,
    })
    expect(seen).toEqual(['held', 'delivered'])
    expect(matchOutstandingSend(id, 'delivered')).toBeUndefined()
  })

  test('queue-full drop matches orig + named uuid', () => {
    const drops: Array<{ dest: string; count?: number; reason?: string }> = []
    setOnPeerMessageStatus((status, dest, extra) => {
      if (status === 'dropped') {
        drops.push({
          dest,
          count: extra?.droppedCount,
          reason: extra?.dropReason,
        })
      }
    })
    const orig = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    const named = 'bbbbbbbb-cccc-dddd-eeee-ffffffffffff'
    noteOutstandingSend(orig, 'uds:/tmp/p.sock')
    noteOutstandingSend(named, 'uds:/tmp/p.sock')
    handlePeerMessageStatusFrame({
      action: 'peer_message_status',
      status: 'dropped',
      orig_msg_id: orig,
      drop_reason: 'queue-full',
      dropped_msg_ids: [named],
    })
    expect(drops).toEqual([
      { dest: 'uds:/tmp/p.sock', count: 2, reason: 'queue-full' },
    ])
  })
})

describe('QJd / Xow', () => {
  test('only admits SEA drop reasons', () => {
    expect(admitDropReason('queue-full')).toBe('queue-full')
    expect(admitDropReason('rate-limited')).toBe('rate-limited')
    expect(admitDropReason('nope')).toBeUndefined()
  })

  test('vkh summarizePeerMsgId is UUID / (none) / (malformed)', () => {
    expect(summarizePeerMsgId('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    )
    expect(summarizePeerMsgId(undefined)).toBe('(none)')
    expect(summarizePeerMsgId('not-a-uuid')).toBe('(malformed)')
    expect(summarizePeerMsgId(12)).toBe('(malformed)')
  })

  test('UUID-filters dropped_msg_ids cap 256', () => {
    const ids = filterDroppedMsgIds([
      'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      'not-a-uuid',
      12,
      'BBBBBBBB-CCCC-DDDD-EEEE-FFFFFFFFFFFF',
    ])
    expect(ids.size).toBe(2)
    expect(ids.has('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(true)
  })
})

describe('noteInboxQueueFullDrop', () => {
  test('fires dropped queue-full for uds peer from', () => {
    const receipts: Array<{ status: string; extra?: unknown }> = []
    setSendPeerReceipt((message, status, extra) => {
      receipts.push({ status, extra })
      expect(message.origin?.from).toBe('uds:/tmp/peer.sock')
    })
    noteInboxQueueFullDrop({
      from: 'uds:/tmp/peer.sock',
      msg_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    })
    expect(receipts).toEqual([
      { status: 'dropped', extra: { dropReason: 'queue-full' } },
    ])
  })

  test('skips non-uds from', () => {
    const receipts: unknown[] = []
    setSendPeerReceipt(message => {
      receipts.push(message)
    })
    noteInboxQueueFullDrop({ from: 'bridge:session_x' })
    expect(receipts).toEqual([])
  })
})

describe('sendPeerReceipt no-op without installer', () => {
  test('does not throw', () => {
    expect(() =>
      sendPeerReceipt(
        { origin: { kind: 'peer', from: 'uds:/tmp/x' } },
        'refused',
      ),
    ).not.toThrow()
  })
})
