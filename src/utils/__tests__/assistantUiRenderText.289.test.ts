import { describe, expect, test } from 'bun:test'
import { assistantUiRenderText } from '../emptyMessageText.js'

describe('densable 2.1.289 HJ AssistantMessage HAS text', () => {
  test('strips JRr tags and leading newlines, not trailing space', () => {
    expect(assistantUiRenderText('\n\nhello  ')).toBe('hello  ')
    expect(assistantUiRenderText('<context>hidden</context>\nvisible')).toBe(
      'visible',
    )
  })

  test('Jg peels cc-memory tags, not generic memory', () => {
    expect(assistantUiRenderText('<cc-memory foo="a">keep')).toBe('keep')
    expect(assistantUiRenderText('a</CC-MEMORY>b')).toBe('ab')
    expect(assistantUiRenderText('<memory foo="a">keep')).toBe(
      '<memory foo="a">keep',
    )
  })
})
