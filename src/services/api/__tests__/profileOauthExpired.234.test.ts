import { describe, expect, test } from 'bun:test'
import {
  getAssistantMessageFromError,
  PROFILE_LOGIN_EXPIRED_IMPLICIT_MESSAGE,
  PROFILE_LOGIN_EXPIRED_MESSAGE,
} from '../errors.js'
import {
  AnthropicProfileOauthError,
  clearAnthropicProfileCaches,
} from '../../../utils/anthropicProfile.js'

function textOf(
  assistant: ReturnType<typeof getAssistantMessageFromError>,
): string {
  const c = assistant.message.content?.[0]
  if (c && typeof c === 'object' && 'type' in c && c.type === 'text') {
    return c.text
  }
  return ''
}

describe('leftover 239 DUr → getAssistantMessageFromError', () => {
  test('oRr maps to invalid_request + IbE', () => {
    clearAnthropicProfileCaches()
    const err = new AnthropicProfileOauthError(
      'Access token at /tmp/x.json has expired and no refresh is available (client_id empty, refresh_token empty)',
    )
    const assistant = getAssistantMessageFromError(err, 'claude-sonnet-4-6')
    expect(assistant.error).toBe('invalid_request')
    expect(textOf(assistant)).toBe(PROFILE_LOGIN_EXPIRED_MESSAGE)
  })

  test('hNn implicit copy is HbE', () => {
    expect(PROFILE_LOGIN_EXPIRED_IMPLICIT_MESSAGE).toContain('Run /login')
    expect(PROFILE_LOGIN_EXPIRED_MESSAGE).toContain(
      'Re-authenticate your Anthropic profile',
    )
  })
})
