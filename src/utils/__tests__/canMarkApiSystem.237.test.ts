/**
 * densable SEA 2.1.237 eDT canMarkApiSystem — api_system cache_control eligibility.
 * Gold: docs/upstream-extraction/v2.1.237/snippets/gold-canMarkApiSystem-eDT.txt
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { setMidConvCachePromotionRejected } from '../../bootstrap/state.js'
import {
  isApiSystemCacheControlEligible,
  shouldCacheControlOnApiSystem,
} from '../midConversationSystem.js'
import type { APIProvider } from '../model/providers.js'

const cleanFirstParty: NodeJS.ProcessEnv = {
  ...process.env,
  ANTHROPIC_BASE_URL: undefined,
  ANTHROPIC_AWS_BASE_URL: undefined,
  ANTHROPIC_BEDROCK_BASE_URL: undefined,
  ANTHROPIC_VERTEX_BASE_URL: undefined,
  ANTHROPIC_BEDROCK_MANTLE_BASE_URL: undefined,
  ANTHROPIC_FOUNDRY_BASE_URL: undefined,
  CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: undefined,
  CLAUDE_CODE_HIPAA: undefined,
  CLAUDE_CODE_HIPAA_COMPLIANCE: undefined,
  _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: undefined,
  CLAUDE_CODE_USE_BEDROCK: undefined,
  CLAUDE_CODE_USE_VERTEX: undefined,
  CLAUDE_CODE_USE_FOUNDRY: undefined,
  CLAUDE_CODE_USE_GATEWAY: undefined,
}

afterEach(() => {
  setMidConvCachePromotionRejected(false)
})

describe('densable canMarkApiSystem eDT 237', () => {
  test('firstParty default BASE_URL: eligible', () => {
    expect(isApiSystemCacheControlEligible('firstParty', cleanFirstParty)).toBe(
      true,
    )
    expect(shouldCacheControlOnApiSystem('firstParty', cleanFirstParty)).toBe(
      true,
    )
  })

  test('firstParty custom ANTHROPIC_BASE_URL: NOT eligible (changelog fix)', () => {
    const env = {
      ...cleanFirstParty,
      ANTHROPIC_BASE_URL: 'https://llm-gateway.example/v1',
    }
    expect(isApiSystemCacheControlEligible('firstParty', env)).toBe(false)
    expect(shouldCacheControlOnApiSystem('firstParty', env)).toBe(false)
  })

  test('firstParty api.anthropic.com: eligible', () => {
    const env = {
      ...cleanFirstParty,
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
    }
    expect(isApiSystemCacheControlEligible('firstParty', env)).toBe(true)
  })

  test('gateway: NOT eligible', () => {
    expect(isApiSystemCacheControlEligible('gateway', cleanFirstParty)).toBe(
      false,
    )
    expect(shouldCacheControlOnApiSystem('gateway', cleanFirstParty)).toBe(
      false,
    )
  })

  test('openai/gemini/grok: NOT eligible', () => {
    for (const p of ['openai', 'gemini', 'grok'] as APIProvider[]) {
      expect(isApiSystemCacheControlEligible(p, cleanFirstParty)).toBe(false)
    }
  })

  test('bedrock default base unset: eligible; custom base: not', () => {
    expect(isApiSystemCacheControlEligible('bedrock', cleanFirstParty)).toBe(
      true,
    )
    expect(
      isApiSystemCacheControlEligible('bedrock', {
        ...cleanFirstParty,
        ANTHROPIC_BEDROCK_BASE_URL: 'https://custom.bedrock.example',
      }),
    ).toBe(false)
  })

  test('foundry default unset / azure hostname: eligible; other host: not', () => {
    expect(isApiSystemCacheControlEligible('foundry', cleanFirstParty)).toBe(
      true,
    )
    expect(
      isApiSystemCacheControlEligible('foundry', {
        ...cleanFirstParty,
        ANTHROPIC_FOUNDRY_BASE_URL:
          'https://my-resource.services.ai.azure.com/anthropic',
      }),
    ).toBe(true)
    expect(
      isApiSystemCacheControlEligible('foundry', {
        ...cleanFirstParty,
        ANTHROPIC_FOUNDRY_BASE_URL: 'https://evil.example.com',
      }),
    ).toBe(false)
  })

  test('anthropicAws: eligible only when ANTHROPIC_AWS_BASE_URL unset', () => {
    expect(
      isApiSystemCacheControlEligible('anthropicAws', cleanFirstParty),
    ).toBe(true)
    expect(
      isApiSystemCacheControlEligible('anthropicAws', {
        ...cleanFirstParty,
        ANTHROPIC_AWS_BASE_URL: 'https://aws-proxy.example',
      }),
    ).toBe(false)
  })

  test('DISABLE_EXPERIMENTAL_BETAS / demote still block', () => {
    expect(
      shouldCacheControlOnApiSystem('firstParty', {
        ...cleanFirstParty,
        CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1',
      }),
    ).toBe(false)
    setMidConvCachePromotionRejected(true)
    expect(shouldCacheControlOnApiSystem('firstParty', cleanFirstParty)).toBe(
      false,
    )
  })

  test('ASSUME_FIRST_PARTY with custom URL: eligible via om()', () => {
    const env = {
      ...cleanFirstParty,
      ANTHROPIC_BASE_URL: 'https://llm-gateway.example/v1',
      _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
    }
    expect(isApiSystemCacheControlEligible('firstParty', env)).toBe(true)
  })
})
