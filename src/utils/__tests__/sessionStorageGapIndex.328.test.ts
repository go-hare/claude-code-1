import { describe, expect, test } from 'bun:test'
import type { UUID } from 'node:crypto'
import type { TranscriptMessage } from '../../types/logs.js'
import { bridgeBrokenParentChain } from '../sessionStorage.js'

function makeUuid(n: number): UUID {
  return `22222222-2222-4222-8222-${String(n).padStart(12, '0')}` as UUID
}

function makeMsg(
  uuid: UUID,
  parentUuid: UUID | null,
  timestamp: string,
  extra?: Partial<TranscriptMessage>,
): TranscriptMessage {
  return {
    type: 'user',
    uuid,
    parentUuid,
    timestamp,
    sessionId: makeUuid(999),
    isSidechain: false,
    userType: 'external',
    cwd: '/tmp',
    version: '2.1.328',
    message: { role: 'user', content: `msg-${uuid}` },
    ...extra,
  } as unknown as TranscriptMessage
}

describe('Round 3 Fix 4: BH3-P1-8 FastParentGapIndex', () => {
  test('picks LATEST equal-timestamp preceding leaf instead of earliest', () => {
    const u1 = makeUuid(1)
    const u2 = makeUuid(2)
    const uMissing = makeUuid(99)
    const uOrphan = makeUuid(3)
    const ts = '2026-01-01T00:00:05.000Z'

    // Both u1 and u2 are unreferenced leaves with the exact same timestamp
    const messages = new Map<UUID, TranscriptMessage>([
      [u1, makeMsg(u1, null, ts)],
      [u2, makeMsg(u2, null, ts)],
      [uOrphan, makeMsg(uOrphan, uMissing, '2026-01-01T00:00:06.000Z')],
    ])

    const bridged = bridgeBrokenParentChain(messages, uOrphan)
    expect(bridged).toBe(1)
    expect(messages.get(uOrphan)?.parentUuid).toBe(u2)
  })

  test('does not exclude main-chain leaf referenced only by a sidechain row', () => {
    const uRoot = makeUuid(10)
    const uMainLeaf = makeUuid(11)
    const uSidechain = makeUuid(12)
    const uMissing = makeUuid(98)
    const uOrphan = makeUuid(13)

    const messages = new Map<UUID, TranscriptMessage>([
      [uRoot, makeMsg(uRoot, null, '2026-01-01T00:00:01.000Z')],
      [uMainLeaf, makeMsg(uMainLeaf, uRoot, '2026-01-01T00:00:02.000Z')],
      // Sidechain row referencing uMainLeaf must NOT disqualify uMainLeaf
      [
        uSidechain,
        makeMsg(uSidechain, uMainLeaf, '2026-01-01T00:00:03.000Z', {
          isSidechain: true,
        }),
      ],
      [uOrphan, makeMsg(uOrphan, uMissing, '2026-01-01T00:00:04.000Z')],
    ])

    const bridged = bridgeBrokenParentChain(messages, uOrphan)
    expect(bridged).toBe(1)
    expect(messages.get(uOrphan)?.parentUuid).toBe(uMainLeaf)
  })

  test('does not exclude preceding leaf referenced only by a row after orphan', () => {
    const uRoot = makeUuid(20)
    const uMainLeaf = makeUuid(21)
    const uMissing = makeUuid(97)
    const uOrphan = makeUuid(22)
    const uLaterBranch = makeUuid(23)

    const messages = new Map<UUID, TranscriptMessage>([
      [uRoot, makeMsg(uRoot, null, '2026-01-01T00:00:01.000Z')],
      [uMainLeaf, makeMsg(uMainLeaf, uRoot, '2026-01-01T00:00:02.000Z')],
      [uOrphan, makeMsg(uOrphan, uMissing, '2026-01-01T00:00:03.000Z')],
      // A later branch written AFTER uOrphan referencing uMainLeaf
      [
        uLaterBranch,
        makeMsg(uLaterBranch, uMainLeaf, '2026-01-01T00:00:04.000Z'),
      ],
    ])

    const bridged = bridgeBrokenParentChain(messages, uOrphan)
    expect(bridged).toBe(1)
    expect(messages.get(uOrphan)?.parentUuid).toBe(uMainLeaf)
  })

  test('E-P1-3: bridges orphan to node whose adjacent child at i+1 has a skewed later timestamp', () => {
    const m0 = makeUuid(30)
    const m1 = makeUuid(31)
    const uMissing = makeUuid(96)
    const u2 = makeUuid(32)

    // m0 (T=10) has adjacent child m1 (T=50) at i+1, while orphan u2 (T=20)
    // arrives at i+2 with a timestamp earlier than m1. Official i_r filters
    // to k.timestamp <= u2.timestamp, so m1 is excluded and m0 is an
    // unreferenced leaf for u2.
    const messages = new Map<UUID, TranscriptMessage>([
      [m0, makeMsg(m0, null, '2026-01-01T00:00:10.000Z')],
      [m1, makeMsg(m1, m0, '2026-01-01T00:00:50.000Z')],
      [u2, makeMsg(u2, uMissing, '2026-01-01T00:00:20.000Z')],
    ])

    const bridged = bridgeBrokenParentChain(messages, u2)
    expect(bridged).toBe(1)
    expect(messages.get(u2)?.parentUuid).toBe(m0)
  })

  test('E-P1-3: monotonic adjacent child still disqualifies parent and bridges to child leaf', () => {
    const m0 = makeUuid(40)
    const m1 = makeUuid(41)
    const uMissing = makeUuid(95)
    const u2 = makeUuid(42)

    const messages = new Map<UUID, TranscriptMessage>([
      [m0, makeMsg(m0, null, '2026-01-01T00:00:10.000Z')],
      [m1, makeMsg(m1, m0, '2026-01-01T00:00:20.000Z')],
      [u2, makeMsg(u2, uMissing, '2026-01-01T00:00:30.000Z')],
    ])

    const bridged = bridgeBrokenParentChain(messages, u2)
    expect(bridged).toBe(1)
    expect(messages.get(u2)?.parentUuid).toBe(m1)
  })
})
