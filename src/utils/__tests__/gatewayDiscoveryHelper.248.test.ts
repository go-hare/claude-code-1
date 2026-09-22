/**
 * densable 2.1.248 #26 — gateway discovery when apiKeyHelper is the only cred.
 *
 * SEA su() @180224462 sha=7e88b956741cffee
 * SEA c9n() @180225763 sha=9ee3edae130850e4
 *   o=Bmn(); u=r||!o?void 0:(await Oce(De()))?.trim()
 *   skip only `apiKeyHelper requires workspace trust` when !Bmn
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { fetchAndCacheGatewayModels } from '../residualMoreEnvGates.js'

const GOLD_TRUST_SKIP = 'apiKeyHelper requires workspace trust'
const GOLD_NO_CREDENTIAL =
  'no credential (ANTHROPIC_AUTH_TOKEN, apiKeyHelper, or API key)'

const gatesSrc = readFileSync(
  join(import.meta.dir, '../residualMoreEnvGates.ts'),
  'utf8',
)

const discoveryEnv = {
  CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
  ANTHROPIC_BASE_URL: 'https://gateway.example.com',
}

function claudeModelsBody(): unknown {
  return { data: [{ id: 'claude-x', display_name: 'X' }] }
}

describe('densable 2.1.248 #26 gateway discovery helper', () => {
  test('c9n gold skip strings and Oce/Bmn callees are in residualMoreEnvGates', () => {
    expect(gatesSrc).toContain(GOLD_TRUST_SKIP)
    expect(gatesSrc).toContain(GOLD_NO_CREDENTIAL)
    expect(gatesSrc).toContain('getApiKeyFromApiKeyHelper')
    expect(gatesSrc).toContain('ANTHROPIC_AUTH_TOKEN')
    expect(gatesSrc).toContain('projectSettings')
    expect(gatesSrc).toContain('localSettings')
    expect(gatesSrc).toContain('checkHasTrustDialogAccepted')
    expect(gatesSrc).toContain(
      '!(fromProjectOrLocal && !checkHasTrustDialogAccepted())',
    )
  })

  test('helper-only credential runs discovery, not no_auth', async () => {
    let seenHeaders: Record<string, string> | undefined
    let helperCalls = 0
    const result = await fetchAndCacheGatewayModels({
      env: discoveryEnv,
      provider: 'firstParty',
      configHome: '/tmp/claude-gw-helper-248',
      canUseApiKeyHelper: () => true,
      isNonInteractiveSession: true,
      getApiKeyFromApiKeyHelper: async () => {
        helperCalls += 1
        return 'sk-helper'
      },
      getAnthropicApiKey: () => null,
      getJson: async (_url, headers) => {
        seenHeaders = headers
        return claudeModelsBody()
      },
      writeFile: () => {},
    })
    expect(helperCalls).toBe(1)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.modelCount).toBe(1)
    expect(seenHeaders?.Authorization).toBe('Bearer sk-helper')
    expect(seenHeaders?.['x-api-key']).toBe('sk-helper')
    expect(result).not.toEqual({ ok: false, reason: 'no_auth' })
  })

  test('skip only when helper requires workspace trust; Oce is not called', async () => {
    let helperCalls = 0
    let fetched = false
    const result = await fetchAndCacheGatewayModels({
      env: discoveryEnv,
      provider: 'firstParty',
      canUseApiKeyHelper: () => false,
      isNonInteractiveSession: false,
      getApiKeyFromApiKeyHelper: async () => {
        helperCalls += 1
        return 'sk-helper'
      },
      getAnthropicApiKey: () => null,
      getJson: async () => {
        fetched = true
        return claudeModelsBody()
      },
    })
    expect(helperCalls).toBe(0)
    expect(fetched).toBe(false)
    expect(result).toEqual({ ok: false, reason: GOLD_TRUST_SKIP })
    expect(result).not.toEqual({ ok: false, reason: 'no_auth' })
  })

  test('ANTHROPIC_AUTH_TOKEN skips Oce and still discovers', async () => {
    let helperCalls = 0
    let seenHeaders: Record<string, string> | undefined
    const result = await fetchAndCacheGatewayModels({
      env: {
        ...discoveryEnv,
        ANTHROPIC_AUTH_TOKEN: 'tok-env',
      },
      provider: 'firstParty',
      configHome: '/tmp/claude-gw-helper-248-token',
      canUseApiKeyHelper: () => true,
      isNonInteractiveSession: true,
      getApiKeyFromApiKeyHelper: async () => {
        helperCalls += 1
        return 'sk-helper'
      },
      getAnthropicApiKey: () => null,
      getJson: async (_url, headers) => {
        seenHeaders = headers
        return claudeModelsBody()
      },
      writeFile: () => {},
    })
    expect(helperCalls).toBe(0)
    expect(result.ok).toBe(true)
    expect(seenHeaders?.Authorization).toBe('Bearer tok-env')
    expect(seenHeaders?.['x-api-key']).toBeUndefined()
  })

  test('Bmn true with empty helper and no key is gold no-credential skip', async () => {
    const result = await fetchAndCacheGatewayModels({
      env: discoveryEnv,
      provider: 'firstParty',
      canUseApiKeyHelper: () => true,
      isNonInteractiveSession: true,
      getApiKeyFromApiKeyHelper: async () => null,
      getAnthropicApiKey: () => null,
    })
    expect(result).toEqual({ ok: false, reason: GOLD_NO_CREDENTIAL })
  })
})
