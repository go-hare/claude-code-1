import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SAFE_ENV_VARS } from '../managedEnvConstants.js'
import { isStructuredOutputsDisabled } from '../residualFinalEnvGates.js'

const ENV_KEY = 'CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS'

describe('densable 2.1.289 CLAUDE_CODE_DISABLE_STRUCTURED_OUTPUTS', () => {
  const saved = process.env[ENV_KEY]

  beforeEach(() => {
    delete process.env[ENV_KEY]
    delete process.env.CLAUDE_CODE_USE_BEDROCK
    delete process.env.CLAUDE_CODE_USE_VERTEX
    delete process.env.CLAUDE_CODE_USE_FOUNDRY
    delete process.env.CLAUDE_CODE_USE_MANTLE
    delete process.env.CLAUDE_CODE_USE_GATEWAY
    delete process.env.CLAUDE_CODE_USE_OPENAI
    delete process.env.CLAUDE_CODE_USE_GEMINI
    delete process.env.CLAUDE_CODE_USE_GROK
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
    delete process.env.CLAUDE_CODE_HIPAA
    delete process.env.CLAUDE_CODE_HIPAA_COMPLIANCE
  })

  afterEach(() => {
    if (saved === undefined) delete process.env[ENV_KEY]
    else process.env[ENV_KEY] = saved
  })

  test('residual gate reads env', () => {
    expect(isStructuredOutputsDisabled({})).toBe(false)
    expect(isStructuredOutputsDisabled({ [ENV_KEY]: '1' })).toBe(true)
    expect(isStructuredOutputsDisabled({ [ENV_KEY]: 'true' })).toBe(true)
    expect(isStructuredOutputsDisabled({ [ENV_KEY]: '0' })).toBe(false)
  })

  test('SAFE_ENV_VARS allows settings.env override', () => {
    expect(SAFE_ENV_VARS.has(ENV_KEY)).toBe(true)
  })

  test('modelSupportsStructuredOutputs returns false when env set', async () => {
    const { modelSupportsStructuredOutputs } = await import('../betas.js')
    expect(modelSupportsStructuredOutputs('claude-haiku-4-5')).toBe(true)
    process.env[ENV_KEY] = '1'
    expect(modelSupportsStructuredOutputs('claude-haiku-4-5')).toBe(false)
    expect(modelSupportsStructuredOutputs('claude-sonnet-4-5')).toBe(false)
  })

  test('modelSupportsStructuredOutputs admits sonnet-5-5 / opus-5 / fable-5', async () => {
    const { modelSupportsStructuredOutputs } = await import('../betas.js')
    expect(modelSupportsStructuredOutputs('claude-sonnet-5-5')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-opus-5')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-opus-5-1')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-fable-5')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-fable-5-1')).toBe(true)
    // Prior 4.x still admitted
    expect(modelSupportsStructuredOutputs('claude-opus-4-1')).toBe(true)
    expect(modelSupportsStructuredOutputs('claude-sonnet-4-5')).toBe(true)
  })
})
