/**
 * densable 2.1.223 #16/#17 — DISABLE_1M every native 1M + unknown model window
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { CONTEXT_1M_BETA_HEADER } from '../../constants/betas.js'
import {
  clearContextWindowEnforcementNoticesLatchForTests,
  getContextWindowForModel,
  getDisable1mContextNotEnforcedWarning,
  getUnknownModelWindowEnforcementNotice,
  isRecognizedModelForWindowEnforcement,
  modelSupports1M,
} from '../context.js'
import {
  formatDisable1mContextNotEnforcedWarning,
  formatUnknownModelWindowEnforcementNotice,
  isUnknownModelWindowEnforcementDisabled,
} from '../residualFinalEnvGates.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
const savedUnknown =
  process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT

afterEach(() => {
  clearContextWindowEnforcementNoticesLatchForTests()
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
  if (savedUnknown === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
  } else {
    process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT =
      savedUnknown
  }
})

describe('densable 2.1.223 #16 DISABLE_1M all native 1M', () => {
  test('fixed-list model + beta clamps to 200K under DISABLE_1M', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(modelSupports1M('claude-opus-4-8')).toBe(false)
    expect(
      getContextWindowForModel('claude-opus-4-8', [CONTEXT_1M_BETA_HEADER]),
    ).toBe(200_000)
  })

  test('[1m] suffix clamps under DISABLE_1M', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('claude-opus-4-8[1m]')).toBe(200_000)
  })

  test('Claude family + beta still 1M when DISABLE_1M off (beyond fixed list)', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    // opus-5 family is on modelSupports1M after 223 expansion
    expect(modelSupports1M('claude-opus-5')).toBe(true)
    expect(
      getContextWindowForModel('claude-opus-5', [CONTEXT_1M_BETA_HEADER]),
    ).toBe(1_000_000)
  })

  test('gold DISABLE_1M not-enforced warning string', () => {
    const s = formatDisable1mContextNotEnforcedWarning('custom-model', 200_000)
    expect(s).toContain(
      "CLAUDE_CODE_DISABLE_1M_CONTEXT is set, but the 200K limit isn't enforced for custom-model",
    )
    expect(s).toContain('CLAUDE_CODE_AUTO_COMPACT_WINDOW=200000')
    expect(s).toContain('autoCompactWindow setting')
  })
})

describe('densable 2.1.223 #17 unknown model window enforcement', () => {
  test('unrecognized id is held to 200K', () => {
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    expect(isRecognizedModelForWindowEnforcement('totally-unknown-xyz')).toBe(
      false,
    )
    expect(getContextWindowForModel('totally-unknown-xyz')).toBe(200_000)
  })

  test('DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT restores wait-for-API window', () => {
    process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
    expect(isUnknownModelWindowEnforcementDisabled()).toBe(true)
    expect(getContextWindowForModel('totally-unknown-xyz')).toBe(100_000_000)
  })

  test('provider-prefixed Claude ids are recognized', () => {
    expect(
      isRecognizedModelForWindowEnforcement('vertex_ai/claude-sonnet-4'),
    ).toBe(true)
    expect(
      isRecognizedModelForWindowEnforcement(
        'bedrock/anthropic.claude-sonnet-4',
      ),
    ).toBe(true)
  })

  test('gold unknown-model notice string', () => {
    const s = formatUnknownModelWindowEnforcementNotice('foo-bar', 200_000)
    expect(s).toContain(
      '"foo-bar" is not a model this version of Claude Code recognizes',
    )
    expect(s).toContain('200000 tokens')
    expect(s).toContain(
      'CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT=1',
    )
    expect(s).toContain('wait-for-the-API behavior')
  })

  test('notice null when recognized or env disables enforcement', () => {
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    expect(getUnknownModelWindowEnforcementNotice('claude-opus-4-8')).toBeNull()
    process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT = '1'
    expect(
      getUnknownModelWindowEnforcementNotice('totally-unknown-xyz'),
    ).toBeNull()
  })

  test('notice present for unknown when enforcement on', () => {
    delete process.env.CLAUDE_CODE_DISABLE_UNKNOWN_MODEL_WINDOW_ENFORCEMENT
    const n = getUnknownModelWindowEnforcementNotice('totally-unknown-xyz')
    expect(n).toContain('totally-unknown-xyz')
    expect(n).toContain('auto-compact will keep this session within')
  })
})

describe('densable 2.1.223 #16 clamp warning helper', () => {
  test('no warning when DISABLE_1M off', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    expect(getDisable1mContextNotEnforcedWarning('claude-opus-4-8')).toBeNull()
  })

  test('no warning when DISABLE_1M clamps successfully', () => {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    // clamp holds to 200K → no "isn't enforced" warning
    expect(
      getDisable1mContextNotEnforcedWarning('claude-opus-4-8[1m]'),
    ).toBeNull()
  })
})
