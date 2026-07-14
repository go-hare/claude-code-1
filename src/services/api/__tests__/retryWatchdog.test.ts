import { afterEach, describe, expect, test } from 'bun:test'

/**
 * Official 2.1.199 CLAUDE_CODE_RETRY_WATCHDOG / MAX_RETRIES resolution.
 * Mirrors getDefaultMaxRetries without loading the full withRetry graph.
 * Includes official clamp-to-ufa (15) when MAX_RETRIES > 15 and watchdog off.
 */

const DEFAULT_MAX_RETRIES = 10
const DEFAULT_RETRY_WATCHDOG_MAX = 300
const MAX_RETRIES_CLAMP = 15

function isEnvTruthy(value: string | undefined): boolean {
  if (!value) return false
  const v = value.toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

function isRetryWatchdogActive(watchdog: string | undefined): boolean {
  if (watchdog === undefined || watchdog === '') return false
  if (watchdog === '0' || watchdog.toLowerCase() === 'false') return false
  const parsed = parseInt(watchdog, 10)
  if (!Number.isNaN(parsed) && parsed > 1) return true
  return isEnvTruthy(watchdog) || Number.isNaN(parsed) || parsed === 1
}

function getDefaultMaxRetries(env: NodeJS.ProcessEnv): number {
  const watchdogActive = isRetryWatchdogActive(env.CLAUDE_CODE_RETRY_WATCHDOG)
  if (env.CLAUDE_CODE_MAX_RETRIES) {
    const parsed = parseInt(env.CLAUDE_CODE_MAX_RETRIES, 10)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      if (parsed > MAX_RETRIES_CLAMP && !watchdogActive) {
        return MAX_RETRIES_CLAMP
      }
      return parsed
    }
  }
  const watchdog = env.CLAUDE_CODE_RETRY_WATCHDOG
  if (watchdog !== undefined && watchdog !== '') {
    if (watchdog === '0' || watchdog.toLowerCase() === 'false') {
      return DEFAULT_MAX_RETRIES
    }
    const parsed = parseInt(watchdog, 10)
    if (!Number.isNaN(parsed) && parsed > 1) return parsed
    if (isEnvTruthy(watchdog) || Number.isNaN(parsed) || parsed === 1) {
      return DEFAULT_RETRY_WATCHDOG_MAX
    }
  }
  return DEFAULT_MAX_RETRIES
}

const origMax = process.env.CLAUDE_CODE_MAX_RETRIES
const origWatch = process.env.CLAUDE_CODE_RETRY_WATCHDOG

afterEach(() => {
  if (origMax === undefined) delete process.env.CLAUDE_CODE_MAX_RETRIES
  else process.env.CLAUDE_CODE_MAX_RETRIES = origMax
  if (origWatch === undefined) delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
  else process.env.CLAUDE_CODE_RETRY_WATCHDOG = origWatch
})

describe('getDefaultMaxRetries (2.1.199)', () => {
  test('default is 10', () => {
    expect(getDefaultMaxRetries({})).toBe(10)
  })

  test('CLAUDE_CODE_MAX_RETRIES wins and is uncapped when watchdog active', () => {
    expect(
      getDefaultMaxRetries({
        CLAUDE_CODE_MAX_RETRIES: '50',
        CLAUDE_CODE_RETRY_WATCHDOG: '300',
      }),
    ).toBe(50)
  })

  test('CLAUDE_CODE_MAX_RETRIES >15 clamps to 15 when watchdog off', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_MAX_RETRIES: '50' })).toBe(15)
  })

  test('CLAUDE_CODE_MAX_RETRIES ≤15 is honored without clamp', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_MAX_RETRIES: '12' })).toBe(12)
  })

  test('CLAUDE_CODE_RETRY_WATCHDOG=300 raises budget', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_RETRY_WATCHDOG: '300' })).toBe(
      300,
    )
  })

  test('CLAUDE_CODE_RETRY_WATCHDOG=true defaults to 300', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_RETRY_WATCHDOG: 'true' })).toBe(
      300,
    )
  })

  test('CLAUDE_CODE_RETRY_WATCHDOG=1 enables with default 300', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_RETRY_WATCHDOG: '1' })).toBe(300)
  })

  test('CLAUDE_CODE_RETRY_WATCHDOG=0 keeps default 10', () => {
    expect(getDefaultMaxRetries({ CLAUDE_CODE_RETRY_WATCHDOG: '0' })).toBe(10)
  })
})
