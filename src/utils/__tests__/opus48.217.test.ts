/**
 * densable 2.1.217 #6 — Opus 4.8 1M / Bedrock auto-compact window
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CONTEXT_1M_BETA_HEADER } from '../../constants/betas.js'
import {
  getContextWindowForModel,
  getModelMaxOutputTokens,
  modelSupports1M,
} from '../context.js'
import { ALL_MODEL_CONFIGS } from '../model/configs.js'
import {
  firstPartyNameToCanonical,
  getCanonicalName,
  getMarketingNameForModel,
} from '../model/model.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT

afterEach(() => {
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
})

describe('Opus 4.8 densable 2.1.217 #6', () => {
  test('modelSupports1M includes opus-4-8', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(modelSupports1M('claude-opus-4-8')).toBe(true)
    expect(modelSupports1M(ALL_MODEL_CONFIGS.opus48.bedrock)).toBe(true)
    expect(modelSupports1M('us.anthropic.claude-opus-4-8')).toBe(true)
  })

  test('Bedrock opus-4-8 + 1m beta → 1M context window (auto-compact basis)', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    const window = getContextWindowForModel(ALL_MODEL_CONFIGS.opus48.bedrock, [
      CONTEXT_1M_BETA_HEADER,
    ])
    expect(window).toBe(1_000_000)
  })

  test('firstPartyNameToCanonical does not collapse opus-4-8 to opus-4', () => {
    expect(firstPartyNameToCanonical('claude-opus-4-8')).toBe('claude-opus-4-8')
    expect(getCanonicalName('us.anthropic.claude-opus-4-8')).toBe(
      'claude-opus-4-8',
    )
    expect(getCanonicalName('anthropic.claude-opus-4-8')).toBe(
      'claude-opus-4-8',
    )
  })

  test('max output tokens match densable catalog (64k/128k)', () => {
    const t = getModelMaxOutputTokens('claude-opus-4-8')
    expect(t.default).toBe(64_000)
    expect(t.upperLimit).toBe(128_000)
  })

  test('marketing / config registration', () => {
    expect(ALL_MODEL_CONFIGS.opus48.firstParty).toBe('claude-opus-4-8')
    expect(ALL_MODEL_CONFIGS.opus48.bedrock).toBe(
      'us.anthropic.claude-opus-4-8',
    )
    expect(getMarketingNameForModel('claude-opus-4-8')).toBe('Opus 4.8')
  })

  test('DISABLE_1M still blocks', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(modelSupports1M('claude-opus-4-8')).toBe(false)
    expect(
      getContextWindowForModel('claude-opus-4-8', [CONTEXT_1M_BETA_HEADER]),
    ).toBe(200_000)
  })
})
