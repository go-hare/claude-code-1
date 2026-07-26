import { afterEach, describe, expect, test } from 'bun:test'
import { setClaudeInChromeSessionPromptActive } from '../../../bootstrap/state.js'
import {
  BASE_CHROME_PROMPT,
  CLAUDE_IN_CHROME_SKILL_HINT,
  CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
  resolveChromeAppendSystemPrompt,
} from '../prompt.js'

afterEach(() => {
  setClaudeInChromeSessionPromptActive(false)
})

describe('resolveChromeAppendSystemPrompt', () => {
  test('inactive leaves non-chrome append unchanged', () => {
    expect(resolveChromeAppendSystemPrompt('extra')).toBe('extra')
    expect(resolveChromeAppendSystemPrompt(undefined)).toBeUndefined()
  })

  test('active injects full chrome prompt when missing', () => {
    setClaudeInChromeSessionPromptActive(true)
    expect(resolveChromeAppendSystemPrompt(undefined)).toBe(BASE_CHROME_PROMPT)
    expect(resolveChromeAppendSystemPrompt('extra')).toBe(
      `${BASE_CHROME_PROMPT}\n\nextra`,
    )
  })

  test('active keeps launch-baked chrome prompt once', () => {
    setClaudeInChromeSessionPromptActive(true)
    const baked = `${BASE_CHROME_PROMPT}\n\nuser-extra`
    expect(resolveChromeAppendSystemPrompt(baked)).toBe(baked)
  })

  test('inactive strips launch-baked chrome prompt', () => {
    setClaudeInChromeSessionPromptActive(false)
    expect(
      resolveChromeAppendSystemPrompt(`${BASE_CHROME_PROMPT}\n\nuser-extra`),
    ).toBe('user-extra')
    expect(resolveChromeAppendSystemPrompt(BASE_CHROME_PROMPT)).toBeUndefined()
  })

  test('inactive keeps auto-enable skill hint', () => {
    setClaudeInChromeSessionPromptActive(false)
    expect(resolveChromeAppendSystemPrompt(CLAUDE_IN_CHROME_SKILL_HINT)).toBe(
      CLAUDE_IN_CHROME_SKILL_HINT,
    )
  })

  test('active strips skill hint instead of stacking full chrome + skill', () => {
    setClaudeInChromeSessionPromptActive(true)
    expect(resolveChromeAppendSystemPrompt(CLAUDE_IN_CHROME_SKILL_HINT)).toBe(
      BASE_CHROME_PROMPT,
    )
    expect(
      resolveChromeAppendSystemPrompt(
        `${CLAUDE_IN_CHROME_SKILL_HINT}\n\nuser-extra`,
      ),
    ).toBe(`${BASE_CHROME_PROMPT}\n\nuser-extra`)
    expect(
      resolveChromeAppendSystemPrompt(
        CLAUDE_IN_CHROME_SKILL_HINT_WITH_WEBBROWSER,
      ),
    ).toBe(BASE_CHROME_PROMPT)
  })

  test('active with baked chrome + skill hint drops skill only', () => {
    setClaudeInChromeSessionPromptActive(true)
    const stacked = `${BASE_CHROME_PROMPT}\n\n${CLAUDE_IN_CHROME_SKILL_HINT}`
    expect(resolveChromeAppendSystemPrompt(stacked)).toBe(BASE_CHROME_PROMPT)
  })
})
