import { describe, expect, test } from 'bun:test'
import {
  resolveTodoReminderMode,
  isTodoReminderEnabled,
} from '../todoReminderMode.js'

describe('resolveTodoReminderMode', () => {
  test('env wins', () => {
    expect(
      resolveTodoReminderMode(
        { CLAUDE_CODE_TODO_REMINDER_MODE: 'off' },
        'baseline',
      ),
    ).toBe('off')
  })
  test('gb off', () => {
    expect(resolveTodoReminderMode({}, 'off')).toBe('off')
  })
  test('default baseline', () => {
    expect(resolveTodoReminderMode({}, undefined)).toBe('baseline')
  })
})

describe('isTodoReminderEnabled', () => {
  test('off disables', () => {
    expect(
      isTodoReminderEnabled({ CLAUDE_CODE_TODO_REMINDER_MODE: 'off' }),
    ).toBe(false)
  })
})
