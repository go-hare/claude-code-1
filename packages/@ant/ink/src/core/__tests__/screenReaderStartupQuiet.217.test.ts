/**
 * densable 2.1.217 #8 — Yqc / Xqc / qXn startup quiet window
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  AX_STARTUP_QUIET_ENV_KEY,
  endScreenReaderStartupQuiet,
  getScreenReaderStartupQuietRemainingMs,
  markScreenReaderStartupQuietStart,
  resetScreenReaderStartupQuietForTests,
  SR_STARTUP_QUIET_DEFAULT_MS,
  SR_STARTUP_QUIET_MAX_MS,
} from '../screenReaderStartupQuiet.js'

describe('screenReaderStartupQuiet densable 2.1.217 #8', () => {
  beforeEach(() => {
    resetScreenReaderStartupQuietForTests()
  })

  afterEach(() => {
    resetScreenReaderStartupQuietForTests()
  })

  test('Xqc is 0 before Yqc mark', () => {
    expect(getScreenReaderStartupQuietRemainingMs(1_000, {})).toBe(0)
  })

  test('Yqc starts default 3000ms quiet (mug)', () => {
    const t0 = 10_000
    markScreenReaderStartupQuietStart(t0)
    expect(getScreenReaderStartupQuietRemainingMs(t0, {})).toBe(
      SR_STARTUP_QUIET_DEFAULT_MS,
    )
    expect(getScreenReaderStartupQuietRemainingMs(t0 + 1000, {})).toBe(2000)
    expect(
      getScreenReaderStartupQuietRemainingMs(
        t0 + SR_STARTUP_QUIET_DEFAULT_MS,
        {},
      ),
    ).toBe(0)
  })

  test('Yqc is idempotent (does not restart clock)', () => {
    markScreenReaderStartupQuietStart(1000)
    markScreenReaderStartupQuietStart(5000)
    // still measured from first mark
    expect(getScreenReaderStartupQuietRemainingMs(1000, {})).toBe(
      SR_STARTUP_QUIET_DEFAULT_MS,
    )
  })

  test('qXn ends quiet immediately', () => {
    markScreenReaderStartupQuietStart(0)
    endScreenReaderStartupQuiet()
    expect(getScreenReaderStartupQuietRemainingMs(0, {})).toBe(0)
  })

  test('CLAUDE_AX_STARTUP_QUIET_MS overrides default', () => {
    markScreenReaderStartupQuietStart(0)
    expect(
      getScreenReaderStartupQuietRemainingMs(0, {
        [AX_STARTUP_QUIET_ENV_KEY]: '500',
      }),
    ).toBe(500)
    expect(
      getScreenReaderStartupQuietRemainingMs(200, {
        [AX_STARTUP_QUIET_ENV_KEY]: '500',
      }),
    ).toBe(300)
  })

  test('quiet ms capped at hug=600000', () => {
    markScreenReaderStartupQuietStart(0)
    expect(
      getScreenReaderStartupQuietRemainingMs(0, {
        [AX_STARTUP_QUIET_ENV_KEY]: '999999999',
      }),
    ).toBe(SR_STARTUP_QUIET_MAX_MS)
  })

  test('0 env ends quiet immediately', () => {
    markScreenReaderStartupQuietStart(0)
    expect(
      getScreenReaderStartupQuietRemainingMs(0, {
        [AX_STARTUP_QUIET_ENV_KEY]: '0',
      }),
    ).toBe(0)
  })
})
