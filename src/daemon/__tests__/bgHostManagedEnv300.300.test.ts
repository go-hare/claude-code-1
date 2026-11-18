import { describe, expect, test } from 'bun:test'
import {
  applyHostManagedWorkerEnv,
  BG_CHILD_ENDPOINT_KEYS,
  BG_PROVIDER_GATEWAY_ENV_PAIRS,
  copyProviderGatewayEnv,
} from '../bgHostManagedEnv.js'

describe('bgHostManagedEnv 1:1 SEA alignment (#665 / #815)', () => {
  test('BG_PROVIDER_GATEWAY_ENV_PAIRS and BG_CHILD_ENDPOINT_KEYS include Google Cloud and Mantle', () => {
    const endpoints = BG_PROVIDER_GATEWAY_ENV_PAIRS.map(p => p.endpoint)
    expect(endpoints).toContain('ANTHROPIC_GOOGLE_CLOUD_BASE_URL')
    expect(endpoints).toContain('ANTHROPIC_BEDROCK_MANTLE_BASE_URL')
    expect(BG_CHILD_ENDPOINT_KEYS).toContain('ANTHROPIC_GOOGLE_CLOUD_BASE_URL')
    expect(BG_CHILD_ENDPOINT_KEYS).toContain('CLAUDE_CODE_SKIP_MANTLE_AUTH')
  })

  test('copyProviderGatewayEnv copies Mantle endpoint + companions when selected', () => {
    const copied = copyProviderGatewayEnv(
      { CLAUDE_CODE_USE_MANTLE: '1' },
      {
        ANTHROPIC_BEDROCK_MANTLE_BASE_URL: 'https://mantle.example',
        CLAUDE_CODE_SKIP_MANTLE_AUTH: 'true',
        ANTHROPIC_CUSTOM_HEADERS: 'x-test: 1',
      },
    )
    expect(copied).toEqual({
      ANTHROPIC_BEDROCK_MANTLE_BASE_URL: 'https://mantle.example',
      CLAUDE_CODE_SKIP_MANTLE_AUTH: 'true',
      ANTHROPIC_CUSTOM_HEADERS: 'x-test: 1',
    })
  })

  test('applyHostManagedWorkerEnv drops overridden gateway endpoint and ANTHROPIC_AUTH_TOKEN when parent gateway differs', () => {
    const env: Record<string, string | undefined> = {
      ANTHROPIC_BEDROCK_BASE_URL: 'https://override.example',
      CLAUDE_CODE_USE_BEDROCK: '1',
      ANTHROPIC_AUTH_TOKEN: 'tok',
    }
    applyHostManagedWorkerEnv(
      env,
      {
        ANTHROPIC_BEDROCK_BASE_URL: 'https://parent.example',
        CLAUDE_CODE_USE_BEDROCK: '1',
      },
      undefined,
    )
    expect(env.ANTHROPIC_BEDROCK_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
  })
})
