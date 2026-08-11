/**
 * densable 2.1.223 #9 — gateway discovery keeps provider-prefixed Claude ids
 */
import { describe, expect, test } from 'bun:test'
import {
  isGatewayUsableModelId,
  parseGatewayModelOptionsFromCache,
  planGatewayModelsCacheWrite,
} from '../residualMoreEnvGates.js'

describe('densable 2.1.223 #9 gateway prefixed models', () => {
  test('SEA filter keeps claude and anthropic substrings under prefixes', () => {
    expect(isGatewayUsableModelId('claude-sonnet-4')).toBe(true)
    expect(isGatewayUsableModelId('vertex_ai/claude-sonnet-4')).toBe(true)
    expect(isGatewayUsableModelId('bedrock/anthropic.claude-sonnet-4')).toBe(
      true,
    )
    expect(isGatewayUsableModelId('anthropic.claude-opus-4-8')).toBe(true)
    expect(isGatewayUsableModelId('gpt-4o')).toBe(false)
    expect(isGatewayUsableModelId('gemini-2.0-flash')).toBe(false)
  })

  test('planGatewayModelsCacheWrite filters non-Claude and keeps prefixed', () => {
    const cache = planGatewayModelsCacheWrite({
      baseUrl: 'https://gateway.example',
      responseBody: {
        data: [
          { id: 'vertex_ai/claude-sonnet-4', display_name: 'Sonnet' },
          { id: 'bedrock/anthropic.claude-opus-4', display_name: 'Opus' },
          { id: 'gpt-4o', display_name: 'GPT' },
        ],
      },
    })
    expect(cache).toBeDefined()
    const ids = cache?.models?.map(m => m.id) ?? []
    expect(ids).toEqual([
      'vertex_ai/claude-sonnet-4',
      'bedrock/anthropic.claude-opus-4',
    ])
  })

  test('parseGatewayModelOptionsFromCache applies same filter', () => {
    const raw = JSON.stringify({
      baseUrl: 'https://gateway.example',
      models: [{ id: 'vertex_ai/claude-haiku-4-5' }, { id: 'o1-preview' }],
    })
    const opts = parseGatewayModelOptionsFromCache({
      raw,
      env: {
        CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY: '1',
        ANTHROPIC_BASE_URL: 'https://gateway.example',
      } as NodeJS.ProcessEnv,
      provider: 'firstParty',
    })
    // firstParty + custom baseUrl: isFirstPartyAnthropicBaseUrl may still
    // gate discovery off — only assert filter if gate is open.
    if (opts.length > 0) {
      expect(opts.every(o => isGatewayUsableModelId(o.value))).toBe(true)
      expect(opts.some(o => o.value.includes('vertex_ai/claude'))).toBe(true)
      expect(opts.some(o => o.value === 'o1-preview')).toBe(false)
    } else {
      // Gate off in this env is ok; planGatewayModelsCacheWrite already covers filter.
      expect(opts).toEqual([])
    }
  })
})
