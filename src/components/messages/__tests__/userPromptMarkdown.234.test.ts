import { describe, expect, test } from 'bun:test'
import {
  formatHiddenLinesTitle,
  isTruncatedUserPromptText,
  shouldRenderUserPromptMarkdown,
  truncateUserPromptForDisplay,
  USER_PROMPT_MARKDOWN_MAX_CHARS,
  USER_PROMPT_MAX_DISPLAY_CHARS,
} from '../userPromptDisplay.js'

function countCharInString(
  haystack: string,
  needle: string,
  fromIndex = 0,
): number {
  let n = 0
  for (let i = fromIndex; i < haystack.length; i++) {
    if (haystack[i] === needle) n++
  }
  return n
}

describe('user prompt markdown densable 2.1.234 (#36)', () => {
  test('V3i truncate returns {head,hiddenLines,tail} past 10k', () => {
    const text = `${'a'.repeat(3000)}\n${'b'.repeat(5000)}\n${'c'.repeat(3000)}`
    expect(text.length).toBeGreaterThan(USER_PROMPT_MAX_DISPLAY_CHARS)
    const out = truncateUserPromptForDisplay(text, countCharInString)
    expect(isTruncatedUserPromptText(out)).toBe(true)
    if (!isTruncatedUserPromptText(out)) return
    expect(out.head.length).toBe(2500)
    expect(out.tail.length).toBe(2500)
    expect(out.hiddenLines).toBeGreaterThan(0)
    expect(formatHiddenLinesTitle(1)).toBe('(1 line hidden)')
    expect(formatHiddenLinesTitle(3)).toBe('(3 lines hidden)')
  })

  test('short prompts stay strings', () => {
    expect(truncateUserPromptForDisplay('hello', countCharInString)).toBe(
      'hello',
    )
  })

  test('j3i Bto markdown gate: length / queued / ultrathink / truncated', () => {
    expect(
      shouldRenderUserPromptMarkdown('hi `code`', {
        isQueued: false,
        hasUltrathinkTrigger: false,
      }),
    ).toBe(true)
    expect(
      shouldRenderUserPromptMarkdown(
        'x'.repeat(USER_PROMPT_MARKDOWN_MAX_CHARS + 1),
        {
          isQueued: false,
          hasUltrathinkTrigger: false,
        },
      ),
    ).toBe(false)
    expect(
      shouldRenderUserPromptMarkdown('hi', {
        isQueued: true,
        hasUltrathinkTrigger: false,
      }),
    ).toBe(false)
    expect(
      shouldRenderUserPromptMarkdown('please ultrathink this', {
        isQueued: false,
        hasUltrathinkTrigger: true,
      }),
    ).toBe(false)
    expect(
      shouldRenderUserPromptMarkdown(
        { head: 'a', hiddenLines: 2, tail: 'b' },
        { isQueued: false, hasUltrathinkTrigger: false },
      ),
    ).toBe(false)
  })
})
