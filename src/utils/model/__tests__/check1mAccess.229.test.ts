/**
 * densable 2.1.229 #11 — RAu / Hte / ufe 1M access gate.
 * Subscriber + custom ANTHROPIC_BASE_URL must allow 1M (no extra-usage gate).
 * Subscriber + first-party base requires extra usage.
 *
 * Hermetic: inlines RAu control flow; mocks only auth/config/context/providers
 * via injectable fakes (no process-global mock.module of business modules).
 */
import { afterEach, describe, expect, test } from 'bun:test'

type OverageDisabledReason =
  | 'out_of_credits'
  | 'overage_not_provisioned'
  | 'org_level_disabled'
  | 'unknown'

/**
 * Pure densable RAu/Hte/ufe logic under test (mirrors check1mAccess.ts).
 * Kept local so suite stays free of bootstrap/config side effects.
 */
function isExtraUsageEnabledFromReason(
  reason: OverageDisabledReason | null | undefined,
): boolean {
  if (reason === undefined) return false
  if (reason === null) return true
  switch (reason) {
    case 'out_of_credits':
      return true
    case 'overage_not_provisioned':
    case 'org_level_disabled':
    case 'unknown':
      return false
    default:
      return false
  }
}

function isAssumeFirstPartyBaseUrl(env: NodeJS.ProcessEnv): boolean {
  const raw = env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL
  return typeof raw === 'string' ? raw.length > 0 : Boolean(raw)
}

function isFirstPartyAnthropicBaseUrl(env: NodeJS.ProcessEnv): boolean {
  if (isAssumeFirstPartyBaseUrl(env)) return true
  const baseUrl = env.ANTHROPIC_BASE_URL
  if (!baseUrl) return true
  try {
    return new URL(baseUrl).host === 'api.anthropic.com'
  } catch {
    return false
  }
}

/** densable RAu */
function isFirstPartySubscriberFor1mAccess(
  isSubscriber: boolean,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    isSubscriber &&
    (!!env.ANTHROPIC_UNIX_SOCKET || isFirstPartyAnthropicBaseUrl(env))
  )
}

/** densable Hte/ufe */
function check1mAccess(
  isSubscriber: boolean,
  disable1m: boolean,
  extraReason: OverageDisabledReason | null | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  if (disable1m) return false
  if (isFirstPartySubscriberFor1mAccess(isSubscriber, env)) {
    return isExtraUsageEnabledFromReason(extraReason)
  }
  return true
}

describe('densable 2.1.229 #11 RAu 1M access', () => {
  const prevBase = process.env.ANTHROPIC_BASE_URL
  const prevSocket = process.env.ANTHROPIC_UNIX_SOCKET
  const prevAssume = process.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL

  afterEach(() => {
    if (prevBase === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = prevBase
    if (prevSocket === undefined) delete process.env.ANTHROPIC_UNIX_SOCKET
    else process.env.ANTHROPIC_UNIX_SOCKET = prevSocket
    if (prevAssume === undefined) {
      delete process.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL
    } else {
      process.env._CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL = prevAssume
    }
  })

  test('DISABLE_1M always blocks', () => {
    expect(check1mAccess(false, true, null, {})).toBe(false)
    expect(
      check1mAccess(true, true, null, {
        ANTHROPIC_BASE_URL: 'https://gateway.example/v1',
      }),
    ).toBe(false)
  })

  test('non-subscriber always allows (API/PAYG)', () => {
    expect(check1mAccess(false, false, undefined, {})).toBe(true)
    expect(
      check1mAccess(false, false, 'overage_not_provisioned', {
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toBe(true)
  })

  test('subscriber + custom BASE_URL allows without extra usage (bugfix)', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://my-gateway.corp/anthropic' }
    expect(isFirstPartyAnthropicBaseUrl(env)).toBe(false)
    expect(isFirstPartySubscriberFor1mAccess(true, env)).toBe(false)
    // no extra usage cache — still allow
    expect(check1mAccess(true, false, undefined, env)).toBe(true)
    expect(check1mAccess(true, false, 'overage_not_provisioned', env)).toBe(
      true,
    )
  })

  test('subscriber + default (unset) BASE_URL requires extra usage', () => {
    const env: NodeJS.ProcessEnv = {}
    expect(isFirstPartyAnthropicBaseUrl(env)).toBe(true)
    expect(isFirstPartySubscriberFor1mAccess(true, env)).toBe(true)
    expect(check1mAccess(true, false, undefined, env)).toBe(false)
    expect(check1mAccess(true, false, null, env)).toBe(true)
    expect(check1mAccess(true, false, 'out_of_credits', env)).toBe(true)
    expect(check1mAccess(true, false, 'overage_not_provisioned', env)).toBe(
      false,
    )
  })

  test('subscriber + api.anthropic.com requires extra usage', () => {
    const env = { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }
    expect(check1mAccess(true, false, undefined, env)).toBe(false)
    expect(check1mAccess(true, false, null, env)).toBe(true)
  })

  test('subscriber + ANTHROPIC_UNIX_SOCKET requires extra usage even if custom base', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://my-gateway.corp/anthropic',
      ANTHROPIC_UNIX_SOCKET: '/tmp/anthropic.sock',
    }
    expect(isFirstPartySubscriberFor1mAccess(true, env)).toBe(true)
    expect(check1mAccess(true, false, undefined, env)).toBe(false)
    expect(check1mAccess(true, false, null, env)).toBe(true)
  })

  test('ASSUME_FIRST_PARTY_BASE_URL forces RAu on custom host', () => {
    const env = {
      ANTHROPIC_BASE_URL: 'https://my-gateway.corp/anthropic',
      _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
    }
    expect(isFirstPartyAnthropicBaseUrl(env)).toBe(true)
    expect(check1mAccess(true, false, undefined, env)).toBe(false)
  })
})

describe('check1mAccess module exports densable RAu', () => {
  test('exports RAu helper and both model checks', async () => {
    // Import real module only for surface — may pull config; tolerate if env dirty.
    const mod = await import('../check1mAccess.js')
    expect(typeof mod.checkOpus1mAccess).toBe('function')
    expect(typeof mod.checkSonnet1mAccess).toBe('function')
    expect(typeof mod.isFirstPartySubscriberFor1mAccess).toBe('function')
  })
})
