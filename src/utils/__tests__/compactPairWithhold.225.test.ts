/**
 * densable 2.1.225 #7 — withhold compact-pair remote upload when the session
 * carries history-backfill suppression (mint-after-reattach-gone).
 *
 * Gold: oHr(t)&&jCt() → skip with
 *   "[persist-remote] Skipping compact-pair upload: session carries history-backfill suppression"
 * jCt = zCt()?.noHistoryBackfill===!0 || Dtf()
 * oHr = compact_boundary || user isCompactSummary
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { UUID } from 'crypto'

describe('densable 2.1.225 #7 compact-pair withhold', () => {
  let home: string

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'compact-pair-225-'))
    process.env.CLAUDE_CONFIG_DIR = home
  })

  afterEach(async () => {
    const {
      registerLiveSuppressionProbe,
      clearSessionMetadata,
      resetProjectForTesting,
    } = await import('../sessionStorage.js')
    registerLiveSuppressionProbe(undefined)
    clearSessionMetadata()
    resetProjectForTesting()
    delete process.env.CLAUDE_CONFIG_DIR
    try {
      rmSync(home, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })

  test('isCompactPairEntry matches boundary and compact summary', async () => {
    const { isCompactPairEntry } = await import('../sessionStorage.js')
    expect(
      isCompactPairEntry({
        type: 'system',
        subtype: 'compact_boundary',
      }),
    ).toBe(true)
    expect(
      isCompactPairEntry({
        type: 'user',
        isCompactSummary: true,
      }),
    ).toBe(true)
    expect(
      isCompactPairEntry({
        type: 'user',
        isCompactSummary: false,
      }),
    ).toBe(false)
    expect(isCompactPairEntry({ type: 'assistant' })).toBe(false)
  })

  test('isCompactPairWithheldFromRemote true when bridge noHistoryBackfill set', async () => {
    const {
      saveBridgeSession,
      isCompactPairWithheldFromRemote,
      registerLiveSuppressionProbe,
    } = await import('../sessionStorage.js')
    const { getSessionId } = await import('../../bootstrap/state.js')

    registerLiveSuppressionProbe(undefined)
    saveBridgeSession(
      getSessionId() as UUID,
      'cse_test_bridge',
      1,
      undefined,
      undefined,
      undefined,
      true,
    )
    expect(isCompactPairWithheldFromRemote()).toBe(true)
  })

  test('isCompactPairWithheldFromRemote true when live probe reports suppressed', async () => {
    const {
      isCompactPairWithheldFromRemote,
      registerLiveSuppressionProbe,
      clearBridgeSessionCache,
    } = await import('../sessionStorage.js')
    clearBridgeSessionCache()
    registerLiveSuppressionProbe(() => true)
    expect(isCompactPairWithheldFromRemote()).toBe(true)
    registerLiveSuppressionProbe(() => false)
    expect(isCompactPairWithheldFromRemote()).toBe(false)
  })

  test('isCompactPairWithheldFromRemote false when neither flag set', async () => {
    const {
      isCompactPairWithheldFromRemote,
      registerLiveSuppressionProbe,
      clearBridgeSessionCache,
    } = await import('../sessionStorage.js')
    clearBridgeSessionCache()
    registerLiveSuppressionProbe(undefined)
    expect(isCompactPairWithheldFromRemote()).toBe(false)
  })

  test('remoteBridgeCore exposes noHistoryBackfill from skipInitialHistoryFlush', async () => {
    const { readFileSync } = await import('node:fs')
    const { join: pathJoin } = await import('node:path')
    const core = readFileSync(
      pathJoin(import.meta.dir, '../../bridge/remoteBridgeCore.ts'),
      'utf8',
    )
    expect(core).toContain('noHistoryBackfill: skipInitialHistoryFlush')
    expect(core).toContain('noHistoryBackfill: true')
    // withhold helpers exported from sessionStorage
    const storage = readFileSync(
      pathJoin(import.meta.dir, '../sessionStorage.ts'),
      'utf8',
    )
    expect(storage).toContain(
      'Skipping compact-pair upload: session carries history-backfill suppression',
    )
    expect(storage).toContain('isCompactPairWithheldFromRemote')
    expect(storage).toContain('registerLiveSuppressionProbe')
  })
})
