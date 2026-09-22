import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  cleanupDrainStarted,
  isCleanupDrainStarted,
  runCleanupFunctions,
} from '../cleanupRegistry.js'
import {
  _ensureGlobalConfigFreshnessMaForTesting,
  _handleGlobalConfigFreshnessWatchEndedForTesting,
  _isGlobalConfigFreshnessWatcherStartedForTesting,
  _resetGlobalConfigFreshnessWatchForTesting,
  _startGlobalConfigFreshnessWatchCdForTesting,
} from '../config.js'
import { resetSessionHostForTests } from '../sessionRoot.js'

function configSrc(): string {
  return readFileSync(join(import.meta.dir, '../config.ts'), 'utf8')
}

describe('densable 2.1.248 Ma/kD DYe on global config freshness (watchFile host)', () => {
  beforeEach(() => {
    resetSessionHostForTests()
    _resetGlobalConfigFreshnessWatchForTesting()
  })

  afterEach(() => {
    _resetGlobalConfigFreshnessWatchForTesting()
    resetSessionHostForTests()
  })

  test('exports official DYe alias isCleanupDrainStarted', () => {
    expect(isCleanupDrainStarted).toBe(cleanupDrainStarted)
    expect(isCleanupDrainStarted()).toBe(false)
  })

  test('Ma and kD gate cleanupDrainStarted before CD / resubscribe', () => {
    const body = configSrc()
    expect(body).toContain('function ensureGlobalConfigFreshnessMa')
    expect(body).toContain('function handleGlobalConfigFreshnessWatchEnded')
    expect(body).toContain('claimGlobalConfigFreshnessResubscribe')
    expect(body).toMatch(
      /function ensureGlobalConfigFreshnessMa[\s\S]*?if \(cleanupDrainStarted\(\)\) return/,
    )
    expect(body).toMatch(
      /function handleGlobalConfigFreshnessWatchEnded[\s\S]*?if \(cleanupDrainStarted\(\)\) return/,
    )
    expect(body).toContain(
      'Watching ~/.claude.json through the storage interface ended:',
    )
  })

  test('invent-ban: no leftover planFile storage-watch host (official only)', () => {
    const plans = readFileSync(join(import.meta.dir, '../plans.ts'), 'utf8')
    expect(plans).not.toContain('subscribePlanFile')
    expect(plans).not.toContain('planFileBackend')
    expect(configSrc()).not.toContain('plans: the watch on')
  })

  test('Ma starts watchFile CD; kD resubscribes once per generation', () => {
    _startGlobalConfigFreshnessWatchCdForTesting()
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)
    _handleGlobalConfigFreshnessWatchEndedForTesting(new Error('eacces'))
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)
    _handleGlobalConfigFreshnessWatchEndedForTesting(new Error('eacces again'))
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)
  })

  test('DYe blocks Ma and kD resubscribe after cleanup drain', async () => {
    _startGlobalConfigFreshnessWatchCdForTesting()
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(true)
    await runCleanupFunctions()
    expect(cleanupDrainStarted()).toBe(true)
    _resetGlobalConfigFreshnessWatchForTesting()
    _ensureGlobalConfigFreshnessMaForTesting()
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(false)
    _handleGlobalConfigFreshnessWatchEndedForTesting(new Error('after drain'))
    expect(_isGlobalConfigFreshnessWatcherStartedForTesting()).toBe(false)
  })
})
