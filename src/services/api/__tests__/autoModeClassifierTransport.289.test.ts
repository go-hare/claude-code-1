/**
 * densable 2.1.289 Lj / lut / dcn.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resetRequestLatches } from '../../../bootstrap/state.js'
import {
  isAutoModeServerEnabled,
  resetAutoModeClassifierTransportForTests,
  resolveAutoModeClassifierTransport,
} from '../autoModeClassifierTransport.js'

const PROVIDER_ENV = [
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_BASE_URL',
  'CLAUDE_CODE_AUTO_MODE_SERVER',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
] as const

const savedEnv: Record<(typeof PROVIDER_ENV)[number], string | undefined> =
  Object.fromEntries(PROVIDER_ENV.map(k => [k, undefined])) as Record<
    (typeof PROVIDER_ENV)[number],
    string | undefined
  >

function clearProviderEnv(): void {
  for (const key of PROVIDER_ENV) {
    delete process.env[key]
  }
}

beforeEach(() => {
  for (const key of PROVIDER_ENV) {
    savedEnv[key] = process.env[key]
  }
  clearProviderEnv()
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
})

afterEach(() => {
  resetRequestLatches()
  resetAutoModeClassifierTransportForTests()
  for (const key of PROVIDER_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
})

describe('resolveAutoModeClassifierTransport (Lj)', () => {
  test('firstParty auto + experimental betas → arbiter', () => {
    expect(resolveAutoModeClassifierTransport('auto')).toBe('arbiter')
    expect(isAutoModeServerEnabled('auto')).toBe(true)
  })

  test('non-auto modes are off', () => {
    expect(resolveAutoModeClassifierTransport('default')).toBe('off')
    expect(isAutoModeServerEnabled('default')).toBe(false)
  })

  test('user switch false forces off', () => {
    process.env.CLAUDE_CODE_AUTO_MODE_SERVER = '0'
    resetAutoModeClassifierTransportForTests()
    expect(resolveAutoModeClassifierTransport('auto')).toBe('off')
  })

  test('custom ANTHROPIC_BASE_URL is 3P arbiterWithLocalFallback', () => {
    process.env.ANTHROPIC_BASE_URL = 'http://204.44.121.220:8413'
    resetAutoModeClassifierTransportForTests()
    expect(resolveAutoModeClassifierTransport('auto')).toBe(
      'arbiterWithLocalFallback',
    )
    expect(isAutoModeServerEnabled('auto')).toBe(true)
  })
})
