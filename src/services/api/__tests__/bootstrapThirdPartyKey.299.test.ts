import { afterEach, describe, expect, test } from 'bun:test'
import { filterAnthropicSendableApiKey } from '../../policyLimits/index.js'

describe('2.1.299 #634 filterAnthropicSendableApiKey (ose)', () => {
  const prevBaseUrl = process.env.ANTHROPIC_BASE_URL

  afterEach(() => {
    if (prevBaseUrl === undefined) {
      delete process.env.ANTHROPIC_BASE_URL
    } else {
      process.env.ANTHROPIC_BASE_URL = prevBaseUrl
    }
  })

  test('returns null for empty/nullish key', () => {
    expect(filterAnthropicSendableApiKey(null)).toBeNull()
    expect(filterAnthropicSendableApiKey(undefined)).toBeNull()
    expect(filterAnthropicSendableApiKey('')).toBeNull()
  })

  test('blocks non-Anthropic gateway key when ANTHROPIC_BASE_URL is a custom third-party host', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.internal.example.com'
    expect(filterAnthropicSendableApiKey('gw-third-party-token-123')).toBeNull()
  })

  test('still sends first-party Anthropic API key (sk-ant-...) even with custom ANTHROPIC_BASE_URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.internal.example.com'
    expect(filterAnthropicSendableApiKey('sk-ant-api03-test-key')).toBe(
      'sk-ant-api03-test-key',
    )
  })

  test('sends key normally when ANTHROPIC_BASE_URL is unset (first-party)', () => {
    delete process.env.ANTHROPIC_BASE_URL
    expect(filterAnthropicSendableApiKey('custom-key')).toBe('custom-key')
  })
})
