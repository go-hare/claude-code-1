import { describe, expect, test } from 'bun:test'
import { getGenAiProviderName } from '../sessionTracing.js'

describe('sessionTracing GenAI semantic conventions (#760)', () => {
  test('getGenAiProviderName maps providers to OTel GenAI provider names', () => {
    expect(getGenAiProviderName('firstParty')).toBe('anthropic')
    expect(getGenAiProviderName('anthropicAws')).toBe('anthropic')
    expect(getGenAiProviderName('anthropicGoogleCloud')).toBe('anthropic')
    expect(getGenAiProviderName('foundry')).toBe('anthropic')
    expect(getGenAiProviderName('gateway')).toBe('anthropic')
    expect(getGenAiProviderName('bedrock')).toBe('aws.bedrock')
    expect(getGenAiProviderName('mantle')).toBe('aws.bedrock')
    expect(getGenAiProviderName('vertex')).toBe('gcp.vertex_ai')
  })
})
