import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  checkIdleCompactionEligibility,
  getIdleCompactMinTokens,
  IDLE_COMPACT_DEFAULT_MIN_TOKENS,
  IDLE_COMPACT_FLOOR_MIN_TOKENS,
  IDLE_RETURN_MIN_MS,
  IdleCompactionRunner,
  settleIdleCompaction,
} from '../idleCompaction.js'

describe('#1446 idleCompaction runner (d1r / hRn / f1r)', () => {
  test('getIdleCompactMinTokens clamps env override at 100k floor', () => {
    expect(getIdleCompactMinTokens({})).toBe(IDLE_COMPACT_DEFAULT_MIN_TOKENS)
    expect(
      getIdleCompactMinTokens({ CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '50000' }),
    ).toBe(IDLE_COMPACT_FLOOR_MIN_TOKENS)
    expect(
      getIdleCompactMinTokens({
        CLAUDE_CODE_IDLE_COMPACT_MIN_TOKENS: '250000',
      }),
    ).toBe(250_000)
  })

  test('checkIdleCompactionEligibility enforces official d1r guard order', () => {
    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: false,
      }),
    ).toBe('compaction_off')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: false,
      }),
    ).toBe('idle_compaction_off')

    expect(
      checkIdleCompactionEligibility(true, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        precomputeCompactionEnabled: false,
      }),
    ).toBe('precompute_compaction_off')

    expect(
      checkIdleCompactionEligibility(true, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        precomputeCompactionEnabled: true,
        swapSupported: false,
      }),
    ).toBe('swap_unsupported')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, false, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
      }),
    ).toBe('prefix_changed')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '5m',
      }),
    ).toBe('not_one_hour')

    expect(
      checkIdleCompactionEligibility(false, 60_001, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
      }),
    ).toBe('lapsed')

    expect(
      checkIdleCompactionEligibility(false, 0, 100_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
      }),
    ).toBe('small')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 2000,
      }),
    ).toBe('newer_request')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 500,
        rateLimitStatus: 'rejected',
      }),
    ).toBe('near_limit')

    expect(
      checkIdleCompactionEligibility(false, 0, 300_000, 1000, true, {
        autoCompactEnabled: true,
        idleCompactionEnabled: true,
        cacheTtl: '1h',
        cacheWarm: true,
        lastRequestAt: 500,
        rateLimitStatus: 'allowed',
      }),
    ).toBeNull()
  })

  test('settleIdleCompaction maps null, success, and abort', async () => {
    expect(
      await settleIdleCompaction(
        Promise.resolve(null),
        Date.now(),
        'compacted',
      ),
    ).toBe('not_compacted')
    expect(
      await settleIdleCompaction(
        Promise.resolve({ tokensBefore: 250_000, tokensAfter: 40_000 }),
        Date.now(),
        'summarized',
      ),
    ).toBe('summarized')
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    expect(
      await settleIdleCompaction(
        Promise.reject(abortErr),
        Date.now(),
        'compacted',
      ),
    ).toBe('cancelled')
  })

  test('#1357 & #1446 IdleCompactionRunner heldSummary, return-after-idle, and REPL/runReplTurn wiring', () => {
    const runner = new IdleCompactionRunner()
    expect(runner.consumeHeldSummary()).toBeNull()
    runner.setHeldSummary([{ uuid: 's1' }])
    expect(runner.consumeHeldSummary()).toEqual([{ uuid: 's1' }])
    expect(runner.consumeHeldSummary()).toBeNull()

    runner.recordTurnEnd('completed')
    expect(runner.lastTurnEndInfo?.reason).toBe('completed')
    // Below 30m idle threshold returns null and resets record
    expect(
      runner.consumeReturnAfterIdle(Date.now() - 10_000, 150_000),
    ).toBeNull()
    // Above 30m idle threshold & >=100k tokens returns summary
    const ret = runner.consumeReturnAfterIdle(
      Date.now() - (IDLE_RETURN_MIN_MS + 5000),
      150_000,
    )
    expect(ret?.contextTokens).toBe(150_000)

    const replSrc = readFileSync(
      join(import.meta.dir, '../../REPL.tsx'),
      'utf8',
    )
    expect(replSrc).toContain('getIdleCompactionRunner()')
    expect(replSrc).toContain('IDLE_COMPACT_COMPLETED_MESSAGE')

    const turnSrc = readFileSync(
      join(import.meta.dir, '../runReplTurn.ts'),
      'utf8',
    )
    expect(turnSrc).toContain('getIdleCompactionRunner()')
    expect(turnSrc).toContain('consumeHeldSummary()')
    expect(turnSrc).toContain('IDLE_COMPACT_SUMMARIZED_MESSAGE')
    expect(turnSrc).toContain('idleRunner.arm(')
  })
})
