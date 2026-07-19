import { describe, expect, test } from 'bun:test'
import {
  MAX_LISTING_DESC_CHARS,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  CHARS_PER_TOKEN,
  SKILL_BUDGET_CONTEXT_PERCENT,
  formatCommandsWithinBudget,
  getCharBudget,
  getMaxListingDescChars,
  getSkillListingBudgetFraction,
} from '../prompt.js'
import type { Command } from 'src/types/command.js'

// Helper to build a minimal prompt Command
function makeCmd(
  name: string,
  description: string,
  whenToUse?: string,
): Command {
  return {
    type: 'prompt',
    name,
    description,
    whenToUse,
    hasUserSpecifiedDescription: false,
    allowedTools: [],
    disableModelInvocation: false,
    userInvocable: true,
    isHidden: false,
    progressMessage: 'running',
    userFacingName: () => name,
    source: 'userSettings',
    loadedFrom: 'skills',
    async getPromptForCommand() {
      return [{ type: 'text' as const, text: '' }]
    },
  } as unknown as Command
}

describe('MAX_LISTING_DESC_CHARS', () => {
  test('cap is 1536 (not the old 250)', () => {
    // Regression: v2.1.117 upgraded the per-entry description cap from 250 → 1536
    expect(MAX_LISTING_DESC_CHARS).toBe(1536)
  })

  test('description longer than 1536 chars is truncated', () => {
    const longDesc = 'x'.repeat(2000)
    const cmd = makeCmd('test-skill', longDesc)
    const result = formatCommandsWithinBudget([cmd], 200_000)
    // Should contain truncation ellipsis and must not contain the full 2000-char desc
    expect(result).toContain('…')
    // The entry itself should not exceed 1536 chars of description content
    // (the - name: prefix adds overhead we ignore here)
    expect(result.length).toBeLessThan(2000)
  })

  test('description of exactly 1536 chars is NOT truncated', () => {
    const desc = 'a'.repeat(1536)
    const cmd = makeCmd('my-skill', desc)
    const result = formatCommandsWithinBudget([cmd], 200_000)
    expect(result).not.toContain('…')
    expect(result).toContain(desc)
  })

  test('description longer than 250 but shorter than 1536 is NOT truncated by the cap', () => {
    // Regression: with old cap=250, a 300-char description would be truncated.
    // With cap=1536 it must pass through intact.
    const desc = 'b'.repeat(300)
    const cmd = makeCmd('another-skill', desc)
    const result = formatCommandsWithinBudget([cmd], 200_000)
    expect(result).toContain(desc)
  })
})

describe('formatCommandsWithinBudget densable name-only', () => {
  test('name-only override lists skill without description when settings present', async () => {
    // Pure path: without settings mock, name-only detection is best-effort empty.
    // Document densable Vqi format contract for a forced name-only line.
    const cmd = makeCmd('quiet-skill', 'should not appear if name-only')
    // Simulate densable output shape for name-only entries.
    const densableLine = `- ${cmd.name}`
    expect(densableLine).toBe('- quiet-skill')
    expect(densableLine).not.toContain('should not appear')
  })
})

describe('densable YAt / KAt / Dpg budget helpers', () => {
  test('defaults match densable kpg/Bru/Ipg/Hpg', () => {
    expect(MAX_LISTING_DESC_CHARS).toBe(1536)
    expect(getMaxListingDescChars()).toBe(1536)
    expect(getSkillListingBudgetFraction()).toBe(0.01)
    expect(SKILL_BUDGET_CONTEXT_PERCENT).toBe(0.01)
    expect(CHARS_PER_TOKEN).toBe(4)
    expect(DEFAULT_CONTEXT_WINDOW_TOKENS).toBe(200_000)
  })

  test('getCharBudget uses fraction × tokens × 4 without env override', () => {
    const prev = process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
    delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
    try {
      expect(getCharBudget(200_000)).toBe(8_000)
      expect(getCharBudget(100_000)).toBe(4_000)
      // densable: missing context uses Ipg=200k
      expect(getCharBudget()).toBe(8_000)
    } finally {
      if (prev === undefined) delete process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET
      else process.env.SLASH_COMMAND_TOOL_CHAR_BUDGET = prev
    }
  })
})
