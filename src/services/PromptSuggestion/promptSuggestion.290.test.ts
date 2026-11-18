import { afterEach, describe, expect, test } from 'bun:test'
import { shouldAllowPromptSuggestionInSdk } from './promptSuggestion.js'

describe('#175 shouldAllowPromptSuggestionInSdk honors CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION', () => {
  const orig = process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION

  afterEach(() => {
    if (orig === undefined) {
      delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
    } else {
      process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = orig
    }
  })

  test('returns false when CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=false', () => {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'false'
    expect(shouldAllowPromptSuggestionInSdk()).toBe(false)
  })

  test('returns true when CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION=true', () => {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION = 'true'
    expect(shouldAllowPromptSuggestionInSdk()).toBe(true)
  })
})
