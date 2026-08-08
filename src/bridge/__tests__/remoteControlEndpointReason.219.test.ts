/**
 * densable 2.1.219 #16 — x4_ / dWr RC endpoint reason names the setting.
 */
import { describe, expect, test } from 'bun:test'
import {
  getRemoteControlEndpointDisabledReason,
  isRemoteControlApiEndpointOk,
  isRemoteControlBlockedByEndpoint,
  isRemoteControlFirstPartyBaseUrl,
  RC_ONLY_API_ANTHROPIC_PREFIX,
  RC_UNSET_IT_SUFFIX,
  RC_UNSET_THEM_SUFFIX,
} from '../remoteControlEndpointReason.js'

describe('densable 2.1.219 dWr isRemoteControlFirstPartyBaseUrl', () => {
  test('true when unset', () => {
    expect(isRemoteControlFirstPartyBaseUrl({})).toBe(true)
  })
  test('true for api.anthropic.com', () => {
    expect(
      isRemoteControlFirstPartyBaseUrl({
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toBe(true)
  })
  test('false for custom host', () => {
    expect(
      isRemoteControlFirstPartyBaseUrl({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
      }),
    ).toBe(false)
  })
  test('RC ignores assume-first-party env for host check', () => {
    // dWr does not short-circuit on ASSUME; only A1e host check.
    expect(
      isRemoteControlFirstPartyBaseUrl({
        ANTHROPIC_BASE_URL: 'https://proxy.example.com',
        _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
      }),
    ).toBe(false)
  })
})

describe('densable 2.1.219 L8e isRemoteControlApiEndpointOk', () => {
  test('firstParty + default base ok', () => {
    expect(isRemoteControlApiEndpointOk({}, 'firstParty')).toBe(true)
  })
  test('bedrock not ok', () => {
    expect(isRemoteControlApiEndpointOk({}, 'bedrock')).toBe(false)
  })
  test('firstParty + custom base not ok', () => {
    expect(
      isRemoteControlApiEndpointOk(
        { ANTHROPIC_BASE_URL: 'https://other.example' },
        'firstParty',
      ),
    ).toBe(false)
  })
})

describe('densable 2.1.219 x4_ getRemoteControlEndpointDisabledReason', () => {
  test('names CLAUDE_CODE_USE_BEDROCK', () => {
    const msg = getRemoteControlEndpointDisabledReason({}, 'bedrock')
    expect(msg.startsWith(RC_ONLY_API_ANTHROPIC_PREFIX)).toBe(true)
    expect(msg).toContain('CLAUDE_CODE_USE_BEDROCK')
    expect(msg).toContain('Amazon Bedrock')
    expect(msg).toContain(RC_UNSET_IT_SUFFIX)
  })

  test('names CLAUDE_CODE_USE_VERTEX', () => {
    const msg = getRemoteControlEndpointDisabledReason({}, 'vertex')
    expect(msg).toContain('CLAUDE_CODE_USE_VERTEX')
    expect(msg).toContain('Google Vertex AI')
  })

  test('names ANTHROPIC_BASE_URL custom endpoint', () => {
    const msg = getRemoteControlEndpointDisabledReason(
      { ANTHROPIC_BASE_URL: 'https://custom.example/v1' },
      'firstParty',
    )
    expect(msg).toContain('ANTHROPIC_BASE_URL')
    expect(msg).toContain('api.anthropic.com')
    expect(msg).toContain(RC_UNSET_IT_SUFFIX)
  })

  test('notes assume-first-party does not apply to RC', () => {
    const msg = getRemoteControlEndpointDisabledReason(
      {
        ANTHROPIC_BASE_URL: 'https://custom.example',
        _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
      },
      'firstParty',
    )
    expect(msg).toContain(
      '_CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL does not apply to Remote Control',
    )
  })

  test('gateway env path uses plural unset', () => {
    const msg = getRemoteControlEndpointDisabledReason({}, 'gateway')
    expect(msg).toContain('CLAUDE_CODE_USE_GATEWAY')
    expect(msg).toContain(RC_UNSET_THEM_SUFFIX)
  })

  test('bedrock+mantle compound when mantle env on', () => {
    const msg = getRemoteControlEndpointDisabledReason(
      { CLAUDE_CODE_USE_MANTLE: '1' },
      'bedrock',
    )
    expect(msg).toContain('CLAUDE_CODE_USE_BEDROCK')
    expect(msg).toContain('CLAUDE_CODE_USE_MANTLE')
    expect(msg).toContain(RC_UNSET_THEM_SUFFIX)
  })

  test('isRemoteControlBlockedByEndpoint mirrors L8e', () => {
    expect(isRemoteControlBlockedByEndpoint({}, 'bedrock')).toBe(true)
    expect(isRemoteControlBlockedByEndpoint({}, 'firstParty')).toBe(false)
  })
})
