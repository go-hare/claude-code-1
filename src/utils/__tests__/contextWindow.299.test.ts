import { afterEach, describe, expect, test } from 'bun:test'
import { getContextWindowForModel } from '../context.js'

const savedBaseUrl = process.env.ANTHROPIC_BASE_URL
const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
const savedMaxCtx = process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS

afterEach(() => {
  if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = savedBaseUrl
  if (savedDisable1m === undefined)
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  else process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  if (savedMaxCtx === undefined)
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
  else process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = savedMaxCtx
})

describe('getContextWindowForModel gateway unknown model (#583)', () => {
  test('unrecognized gateway model behind custom ANTHROPIC_BASE_URL defaults to 1M', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/v1'
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    expect(getContextWindowForModel('gateway-custom-model-v1')).toBe(1_000_000)
  })

  test('respects CLAUDE_CODE_MAX_CONTEXT_TOKENS behind custom ANTHROPIC_BASE_URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/v1'
    process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS = '500000'
    expect(getContextWindowForModel('gateway-custom-model-v1')).toBe(500_000)
  })

  test('respects CLAUDE_CODE_DISABLE_1M_CONTEXT behind custom ANTHROPIC_BASE_URL', () => {
    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com/v1'
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    delete process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS
    expect(getContextWindowForModel('gateway-custom-model-v1')).toBe(200_000)
  })
})
