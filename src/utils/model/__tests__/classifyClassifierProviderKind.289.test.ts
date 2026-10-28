/**
 * densable 2.1.289 `MV` @188544837 — classifier-facing provider kind.
 * Pass the provider explicitly so this file does not call getAPIProvider()
 * (process-global mock.module pollution).
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { classifyClassifierProviderKind } from '../providers.js'

const ENV_KEYS = [
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_ENTRYPOINT',
  'ANTHROPIC_BASE_URL',
  '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL',
] as const

const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
  }
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function env(
  overrides: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>,
): NodeJS.ProcessEnv {
  const next: NodeJS.ProcessEnv = {}
  for (const key of ENV_KEYS) {
    const value = key in overrides ? overrides[key] : undefined
    if (value !== undefined) next[key] = value
  }
  return next
}

describe('classifyClassifierProviderKind (MV 289)', () => {
  test('firstParty + official base → firstParty', () => {
    expect(classifyClassifierProviderKind('firstParty', env({}))).toBe(
      'firstParty',
    )
    expect(
      classifyClassifierProviderKind(
        'firstParty',
        env({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
      ),
    ).toBe('firstParty')
  })

  test('firstParty + custom base → thirdParty', () => {
    expect(
      classifyClassifierProviderKind(
        'firstParty',
        env({ ANTHROPIC_BASE_URL: 'https://proxy.example:8413' }),
      ),
    ).toBe('thirdParty')
  })

  test('firstParty + unix socket is thirdParty unless ssh-remote', () => {
    expect(
      classifyClassifierProviderKind(
        'firstParty',
        env({ ANTHROPIC_UNIX_SOCKET: '/tmp/auth.sock' }),
      ),
    ).toBe('thirdParty')
    expect(
      classifyClassifierProviderKind(
        'firstParty',
        env({
          ANTHROPIC_UNIX_SOCKET: '/tmp/auth.sock',
          CLAUDE_CODE_ENTRYPOINT: 'ssh-remote',
        }),
      ),
    ).toBe('firstParty')
  })

  test('unix socket wins over official base (not ssh-remote)', () => {
    expect(
      classifyClassifierProviderKind(
        'firstParty',
        env({
          ANTHROPIC_UNIX_SOCKET: '/tmp/auth.sock',
          ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        }),
      ),
    ).toBe('thirdParty')
  })

  test('cloud and gateway collapse to thirdParty', () => {
    for (const provider of [
      'bedrock',
      'mantle',
      'vertex',
      'foundry',
      'anthropicAws',
      'anthropicGoogleCloud',
      'gateway',
    ] as const) {
      expect(classifyClassifierProviderKind(provider, env({}))).toBe(
        'thirdParty',
      )
    }
  })

  test('openai/gemini/grok stay as themselves (not thirdParty)', () => {
    expect(classifyClassifierProviderKind('openai', env({}))).toBe('openai')
    expect(classifyClassifierProviderKind('gemini', env({}))).toBe('gemini')
    expect(classifyClassifierProviderKind('grok', env({}))).toBe('grok')
  })
})
