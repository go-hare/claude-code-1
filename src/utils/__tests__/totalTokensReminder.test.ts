import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildTotalTokensReminderAttachments,
  buildTotalTokensSystemPromptSection,
  formatTotalTokensReminderText,
  peakTaskUsedSinceAnchor,
  reanchorTotalTokensReminder,
  resetTotalTokensReminderStateForTests,
  resolveTotalTokensReminderAfterUserTurn,
  resolveTotalTokensReminderBudget,
  resolveTotalTokensReminderMode,
  TOTAL_TOKENS_REMINDER_BUDGET_DEFAULT,
  TOTAL_TOKENS_REMINDER_FIXED,
} from '../totalTokensReminder.js'

afterEach(() => {
  resetTotalTokensReminderStateForTests()
})

describe('resolveTotalTokensReminderMode', () => {
  test('env wins over settings/gb', () => {
    expect(
      resolveTotalTokensReminderMode(
        { CLAUDE_CODE_TOTAL_TOKENS_REMINDER: 'fixed' },
        'countdown',
        'infinite',
      ),
    ).toBe('fixed')
  })
  test('settings then gb then off', () => {
    expect(resolveTotalTokensReminderMode({}, 'countdown', 'infinite')).toBe(
      'countdown',
    )
    expect(resolveTotalTokensReminderMode({}, undefined, 'infinite')).toBe(
      'infinite',
    )
    expect(resolveTotalTokensReminderMode({}, undefined, undefined)).toBe('off')
  })
})

describe('resolveTotalTokensReminderBudget', () => {
  test('env > settings > gb > default', () => {
    expect(
      resolveTotalTokensReminderBudget(
        { CLAUDE_CODE_TOTAL_TOKENS_REMINDER_BUDGET: '12345' },
        999,
        888,
      ),
    ).toBe(12345)
    expect(resolveTotalTokensReminderBudget({}, 999, 888)).toBe(999)
    expect(resolveTotalTokensReminderBudget({}, undefined, 888)).toBe(888)
    expect(resolveTotalTokensReminderBudget({}, undefined, undefined)).toBe(
      TOTAL_TOKENS_REMINDER_BUDGET_DEFAULT,
    )
  })
})

describe('resolveTotalTokensReminderAfterUserTurn', () => {
  test('env truthy/falsy', () => {
    expect(
      resolveTotalTokensReminderAfterUserTurn(
        { CLAUDE_CODE_TOTAL_TOKENS_REMINDER_AFTER_USER_TURN: '1' },
        false,
        false,
      ),
    ).toBe(true)
    expect(
      resolveTotalTokensReminderAfterUserTurn(
        { CLAUDE_CODE_TOTAL_TOKENS_REMINDER_AFTER_USER_TURN: '0' },
        true,
        true,
      ),
    ).toBe(false)
  })
})

describe('formatTotalTokensReminderText (AVn)', () => {
  test('infinite / fixed / countdown', () => {
    expect(formatTotalTokensReminderText('infinite')).toBe(
      '<total_tokens>Infinite tokens left</total_tokens>',
    )
    expect(formatTotalTokensReminderText('fixed')).toBe(
      `<total_tokens>${TOTAL_TOKENS_REMINDER_FIXED} tokens left</total_tokens>`,
    )
    expect(formatTotalTokensReminderText('countdown', 42)).toBe(
      '<total_tokens>42 tokens left</total_tokens>',
    )
    expect(formatTotalTokensReminderText('countdown', -3)).toBe(
      '<total_tokens>0 tokens left</total_tokens>',
    )
  })
})

describe('padded-countdown re-anchor (HZc/DZc)', () => {
  test('peak task used since re-anchor', () => {
    reanchorTotalTokensReminder('main', 1000)
    expect(peakTaskUsedSinceAnchor('main', 1100)).toBe(100)
    expect(peakTaskUsedSinceAnchor('main', 1050)).toBe(100) // peak holds
    expect(peakTaskUsedSinceAnchor('main', 1300)).toBe(300)
  })
})

describe('buildTotalTokensReminderAttachments', () => {
  test('off → empty', () => {
    expect(
      buildTotalTokensReminderAttachments({
        mode: 'off',
        sessionUsedTokens: 1,
        contextWindowTokens: 10,
      }),
    ).toEqual([])
  })
  test('countdown remaining', () => {
    const out = buildTotalTokensReminderAttachments({
      mode: 'countdown',
      sessionUsedTokens: 30,
      contextWindowTokens: 100,
    })
    expect(out).toEqual([
      {
        type: 'total_tokens_reminder',
        text: '<total_tokens>70 tokens left</total_tokens>',
      },
    ])
  })
  test('padded-countdown with reanchor', () => {
    const out = buildTotalTokensReminderAttachments({
      mode: 'padded-countdown',
      sessionUsedTokens: 100,
      contextWindowTokens: 200,
      budget: 1000,
      reanchor: true,
      scopeId: 's1',
    })
    // reanchor at 100 → peak task 0 → remaining 1000
    expect(out[0]?.text).toBe('<total_tokens>1000 tokens left</total_tokens>')
    const later = buildTotalTokensReminderAttachments({
      mode: 'padded-countdown',
      sessionUsedTokens: 250,
      contextWindowTokens: 200,
      budget: 1000,
      scopeId: 's1',
    })
    // peak task used = 150 → remaining 850
    expect(later[0]?.text).toBe('<total_tokens>850 tokens left</total_tokens>')
  })
})

describe('buildTotalTokensSystemPromptSection', () => {
  test('null when off or simple', () => {
    expect(
      buildTotalTokensSystemPromptSection({
        mode: 'off',
        contextWindowTokens: 100,
      }),
    ).toBeNull()
    expect(
      buildTotalTokensSystemPromptSection({
        mode: 'fixed',
        contextWindowTokens: 100,
        simpleMode: true,
      }),
    ).toBeNull()
  })
  test('fixed section', () => {
    expect(
      buildTotalTokensSystemPromptSection({
        mode: 'fixed',
        contextWindowTokens: 100,
      }),
    ).toBe(
      `<total_tokens>${TOTAL_TOKENS_REMINDER_FIXED} tokens left</total_tokens>`,
    )
  })
})
