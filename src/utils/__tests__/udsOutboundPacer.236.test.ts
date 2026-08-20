/**
 * densable 2.1.236 #30 — outbound UDS burst pacer (T5d / wDn / jKo / zKo).
 *
 * Unit tests for reserve-fail-after-capacity, refund, and burst reset window.
 * Do not mock.module udsMessaging (process-global pollution).
 */
import { describe, expect, test } from 'bun:test'
import { resolve as pathResolve } from 'path'
import { isUdsConnectFailError, UdsPeerConnectionError } from '../udsClient.js'
import {
  canonicalOutboundPaceKey,
  createOutboundPacer,
  createUdsOutboundPacedError,
  DEFAULT_HARBOR_KITE_LIMITS,
  hasToken,
  isUdsOutboundPacedError,
  refillTokens,
  shouldPaceOutboundSend,
  UDS_OUTBOUND_PACED_ERROR_CLASS,
} from '../udsOutboundPacer.js'

describe('isUdsConnectFailError (densable qKo / QHr)', () => {
  test('ENOENT / ECONNREFUSED errno → true', () => {
    expect(
      isUdsConnectFailError(
        Object.assign(new Error('gone'), { code: 'ENOENT' }),
      ),
    ).toBe(true)
    expect(
      isUdsConnectFailError(
        Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }),
      ),
    ).toBe(true)
  })

  test('errno on UdsPeerConnectionError.cause → true', () => {
    const cause = Object.assign(new Error('no sock'), { code: 'ENOENT' })
    expect(
      isUdsConnectFailError(new UdsPeerConnectionError('/tmp/x.sock', cause)),
    ).toBe(true)
  })

  test('post-write timeout UdsPeerConnectionError → false (no refund)', () => {
    expect(
      isUdsConnectFailError(
        new UdsPeerConnectionError(
          '/tmp/x.sock',
          new Error('Connection timed out'),
        ),
      ),
    ).toBe(false)
  })
})

describe('refillTokens (wDn)', () => {
  test('refills toward capacity over elapsed seconds', () => {
    // 10 tokens, capacity 30, refill 0.5/s, 20s later → +10 → 20
    expect(refillTokens(10, 0, 20_000, 30, 0.5)).toBe(20)
  })

  test('clamps to capacity', () => {
    expect(refillTokens(29, 0, 10_000, 30, 0.5)).toBe(30)
  })

  test('negative elapsed does not drain', () => {
    expect(refillTokens(10, 1000, 0, 30, 0.5)).toBe(10)
  })
})

describe('hasToken (jKo)', () => {
  test('true when tokens >= 1', () => {
    expect(hasToken(1)).toBe(true)
    expect(hasToken(0.5)).toBe(false)
    expect(hasToken(0)).toBe(false)
  })
})

describe('createOutboundPacer (T5d)', () => {
  test('reserve fails after bucket capacity with sentInBurst', () => {
    let now = 1_000_000
    const pacer = createOutboundPacer(
      () => ({
        bucketCapacity: 3,
        refillPerSecond: 0.5,
        maxTrackedSenders: 256,
      }),
      () => now,
    )

    const r1 = pacer.reserve('peer-a')
    const r2 = pacer.reserve('peer-a')
    const r3 = pacer.reserve('peer-a')
    expect(r1.ok).toBe(true)
    expect(r2.ok).toBe(true)
    expect(r3.ok).toBe(true)

    const refused = pacer.reserve('peer-a')
    expect(refused.ok).toBe(false)
    if (!refused.ok) {
      expect(refused.sentInBurst).toBe(3)
    }
  })

  test('refund restores a token and decrements sentInBurst', () => {
    let now = 2_000_000
    const pacer = createOutboundPacer(
      () => ({
        bucketCapacity: 2,
        refillPerSecond: 0.5,
        maxTrackedSenders: 256,
      }),
      () => now,
    )

    const first = pacer.reserve('peer-b')
    const second = pacer.reserve('peer-b')
    expect(first.ok && second.ok).toBe(true)

    const blocked = pacer.reserve('peer-b')
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) {
      expect(blocked.sentInBurst).toBe(2)
    }

    if (second.ok) {
      second.refund()
      // refund is idempotent
      second.refund()
    }

    const afterRefund = pacer.reserve('peer-b')
    expect(afterRefund.ok).toBe(true)
    if (afterRefund.ok) {
      // sentInBurst: 2 - 1 (refund) + 1 (new reserve) = 2
      // touch does not reset because tokens < capacity
    }

    const blockedAgain = pacer.reserve('peer-b')
    expect(blockedAgain.ok).toBe(false)
    if (!blockedAgain.ok) {
      expect(blockedAgain.sentInBurst).toBe(2)
    }
  })

  test('burst window resets sentInBurst when tokens refill to capacity', () => {
    let now = 3_000_000
    const capacity = 2
    const refillPerSecond = 1
    const pacer = createOutboundPacer(
      () => ({
        bucketCapacity: capacity,
        refillPerSecond,
        maxTrackedSenders: 256,
      }),
      () => now,
    )

    expect(pacer.reserve('peer-c').ok).toBe(true)
    expect(pacer.reserve('peer-c').ok).toBe(true)
    const mid = pacer.reserve('peer-c')
    expect(mid.ok).toBe(false)
    if (!mid.ok) {
      expect(mid.sentInBurst).toBe(2)
    }

    // Wait full refill window: capacity / refill * 1000 ms
    now += (capacity / refillPerSecond) * 1000 + 1

    const next = pacer.reserve('peer-c')
    expect(next.ok).toBe(true)
    // After reset, this reserve is the first of a new burst
    const after = pacer.reserve('peer-c')
    expect(after.ok).toBe(true)
    const refuse = pacer.reserve('peer-c')
    expect(refuse.ok).toBe(false)
    if (!refuse.ok) {
      expect(refuse.sentInBurst).toBe(2)
    }
  })

  test('tracks senders independently', () => {
    let now = 4_000_000
    const pacer = createOutboundPacer(
      () => ({
        bucketCapacity: 1,
        refillPerSecond: 0.5,
        maxTrackedSenders: 256,
      }),
      () => now,
    )
    expect(pacer.reserve('a').ok).toBe(true)
    expect(pacer.reserve('a').ok).toBe(false)
    expect(pacer.reserve('b').ok).toBe(true)
  })
})

describe('UdsOutboundPacedError (x5d)', () => {
  test('message and errorClass match densable SEA', () => {
    const err = createUdsOutboundPacedError(7)
    expect(err.message).toBe(
      'Too many messages to this session just now: 7 were sent recently and more would be dropped by its rate limit, so this one was not sent. Batch what remains into one message, or wait a little before sending more.',
    )
    expect(err.code).toBe(
      'cross-session sends to one target outpaced its inbox rate limit',
    )
    expect(err.errorClass).toBe(UDS_OUTBOUND_PACED_ERROR_CLASS)
    expect(isUdsOutboundPacedError(err)).toBe(true)
  })
})

describe('shouldPaceOutboundSend (CDn / P5d fragment)', () => {
  test('skips on windows without own inbox', () => {
    expect(
      shouldPaceOutboundSend({
        ownSocketPath: undefined,
        platform: 'win32',
        env: {},
      }),
    ).toBe(false)
  })

  test('paces on windows when own inbox present', () => {
    expect(
      shouldPaceOutboundSend({
        ownSocketPath: '\\\\.\\pipe\\own',
        platform: 'win32',
        env: {},
      }),
    ).toBe(true)
  })

  test('paces on non-windows even without own inbox', () => {
    expect(
      shouldPaceOutboundSend({
        ownSocketPath: undefined,
        platform: 'darwin',
        env: {},
      }),
    ).toBe(true)
  })

  test('env CLAUDE_CODE_HARBOR_KITE_PACING_OFF disables pacing', () => {
    expect(
      shouldPaceOutboundSend({
        ownSocketPath: '/tmp/own.sock',
        platform: 'darwin',
        env: { CLAUDE_CODE_HARBOR_KITE_PACING_OFF: '1' },
      }),
    ).toBe(false)
  })
})

describe('DEFAULT_HARBOR_KITE_LIMITS (vla)', () => {
  test('matches densable defaults', () => {
    expect(DEFAULT_HARBOR_KITE_LIMITS).toEqual({
      bucketCapacity: 30,
      refillPerSecond: 0.5,
      dedupWindowMs: 30_000,
      maxSelfHops: 10,
      maxChainLength: 28,
      maxTrackedSenders: 256,
    })
  })
})

describe('canonicalOutboundPaceKey (dX twin)', () => {
  test('resolves relative unix socket paths to absolute', () => {
    const key = canonicalOutboundPaceKey('tmp/peer.sock')
    expect(key).toBe(pathResolve('tmp/peer.sock'))
  })

  test('normalizes windows named-pipe casing/form', () => {
    expect(canonicalOutboundPaceKey('\\\\.\\pipe\\ClaudeCode-Msg')).toBe(
      '\\\\.\\pipe\\claudecode-msg',
    )
    expect(canonicalOutboundPaceKey('//./pipe/ClaudeCode-Msg')).toBe(
      '\\\\.\\pipe\\claudecode-msg',
    )
  })

  test('returns undefined for null-byte or non-local IPC paths', () => {
    expect(canonicalOutboundPaceKey('bad\0path')).toBeUndefined()
    expect(canonicalOutboundPaceKey('\\\\server\\share')).toBeUndefined()
  })

  test('reserve aliases relative and absolute forms of the same socket', () => {
    let now = 5_000_000
    const pacer = createOutboundPacer(
      () => ({
        bucketCapacity: 1,
        refillPerSecond: 0.5,
        maxTrackedSenders: 256,
      }),
      () => now,
    )
    const relative = 'tmp/same-peer.sock'
    const absolute = pathResolve(relative)
    expect(canonicalOutboundPaceKey(relative)).toBe(absolute)
    expect(
      pacer.reserve(canonicalOutboundPaceKey(relative) ?? relative).ok,
    ).toBe(true)
    expect(
      pacer.reserve(canonicalOutboundPaceKey(absolute) ?? absolute).ok,
    ).toBe(false)
  })
})
