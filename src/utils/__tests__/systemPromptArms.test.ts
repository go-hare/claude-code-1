import { describe, expect, test } from 'bun:test'
import {
  ACT_DONT_REDERIVE_BODY,
  getActDontRederiveSection,
  getInvestigateFirstSection,
  getOwnershipFrameSection,
  isActDontRederiveEnabled,
  isBasaltCoveEnabled,
  isInvestigateFirstEnabled,
  isOwnershipFrameEnabled,
  isPewterOwlEnabled,
  isSkillDescReframeEnabled,
  OWNERSHIP_FRAME_BODY,
  resolveInvestigateFirstMode,
} from '../systemPromptArms.js'

describe('systemPromptArms', () => {
  test('defaults off', () => {
    expect(isActDontRederiveEnabled({})).toBe(false)
    expect(isOwnershipFrameEnabled({})).toBe(false)
    expect(isInvestigateFirstEnabled({})).toBe(false)
    expect(isSkillDescReframeEnabled({})).toBe(false)
    expect(isBasaltCoveEnabled({})).toBe(false)
    expect(isPewterOwlEnabled({})).toBe(false)
    expect(getActDontRederiveSection({})).toBeNull()
    expect(getOwnershipFrameSection({})).toBeNull()
    expect(getInvestigateFirstSection({})).toBeNull()
  })
  test('env on', () => {
    expect(
      isActDontRederiveEnabled({ CLAUDE_CODE_ACT_DONT_REDERIVE: '1' }),
    ).toBe(true)
    expect(isPewterOwlEnabled({ CLAUDE_CODE_PEWTER_OWL_TOOL: 'true' })).toBe(
      true,
    )
    expect(
      getActDontRederiveSection({ CLAUDE_CODE_ACT_DONT_REDERIVE: '1' }),
    ).toBe(ACT_DONT_REDERIVE_BODY)
    expect(getOwnershipFrameSection({ CLAUDE_CODE_OWNERSHIP_FRAME: '1' })).toBe(
      OWNERSHIP_FRAME_BODY,
    )
    expect(
      getInvestigateFirstSection({ CLAUDE_CODE_INVESTIGATE_FIRST: '1' }),
    ).toContain('read-only investigation')
    expect(
      isSkillDescReframeEnabled({ CLAUDE_CODE_SKILL_DESC_REFRAME: '1' }),
    ).toBe(true)
  })
  test('GB inject densable when env unset', () => {
    // Official Arg: env unset → GB tengu_cedar_lantern (default true)
    expect(isActDontRederiveEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(isActDontRederiveEnabled({ env: {}, gbValue: false })).toBe(false)
    expect(isOwnershipFrameEnabled({ env: {}, gbValue: true })).toBe(true)
    expect(
      isActDontRederiveEnabled({
        env: { CLAUDE_CODE_ACT_DONT_REDERIVE: '0' },
        gbValue: true,
      }),
    ).toBe(false)
  })
})

describe('resolveInvestigateFirstMode (official p5i)', () => {
  test('non-opus-4-7 → off', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-sonnet-4-6',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBe('off')
  })
  test('opus-4-7 env additive', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBe('additive')
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: 'compact' },
      }),
    ).toBe('compact')
  })
  test('simple system prompt forces off when env unset', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: {},
        simpleSystemPrompt: true,
        slateHarrier: 'additive',
      }),
    ).toBe('off')
  })
  test('slate harrier when env unset and not simple', () => {
    expect(
      resolveInvestigateFirstMode({
        model: 'claude-opus-4-7',
        env: {},
        simpleSystemPrompt: false,
        slateHarrier: 'compact',
      }),
    ).toBe('compact')
  })
  test('getInvestigateFirstSection with model input', () => {
    expect(
      getInvestigateFirstSection({
        model: 'claude-opus-4-7',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: 'additive' },
      }),
    ).toContain('read-only investigation')
    expect(
      getInvestigateFirstSection({
        model: 'claude-sonnet-4-6',
        env: { CLAUDE_CODE_INVESTIGATE_FIRST: '1' },
      }),
    ).toBeNull()
  })
})
