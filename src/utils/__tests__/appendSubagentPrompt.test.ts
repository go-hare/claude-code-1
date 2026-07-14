import { describe, expect, test } from 'bun:test'
import {
  implyAppendSubagentPromptEnv,
  isAppendSubagentPromptEnabled,
  mergeAppendSubagentSystemPrompt,
} from '../appendSubagentPrompt.js'

describe('isAppendSubagentPromptEnabled', () => {
  test('truthy env', () => {
    expect(
      isAppendSubagentPromptEnabled({
        CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: '1',
      }),
    ).toBe(true)
  })
  test('unset', () => {
    expect(isAppendSubagentPromptEnabled({})).toBe(false)
  })
})

describe('mergeAppendSubagentSystemPrompt', () => {
  test('appends when enabled', () => {
    expect(
      mergeAppendSubagentSystemPrompt({
        basePrompt: ['base'],
        appendSubagentSystemPrompt: 'extra',
        env: { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: '1' },
      }),
    ).toEqual(['base', 'extra'])
  })

  test('skips when useExactTools (fork)', () => {
    expect(
      mergeAppendSubagentSystemPrompt({
        basePrompt: ['base'],
        appendSubagentSystemPrompt: 'extra',
        useExactTools: true,
        env: { CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: '1' },
      }),
    ).toEqual(['base'])
  })

  test('skips when env off', () => {
    expect(
      mergeAppendSubagentSystemPrompt({
        basePrompt: ['base'],
        appendSubagentSystemPrompt: 'extra',
        env: {},
      }),
    ).toEqual(['base'])
  })
})

describe('implyAppendSubagentPromptEnv', () => {
  test('sets enable when prompt provided', () => {
    const env: NodeJS.ProcessEnv = {}
    implyAppendSubagentPromptEnv('hello', env)
    expect(env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT).toBe('1')
  })

  test('does not overwrite existing', () => {
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT: '0',
    }
    implyAppendSubagentPromptEnv('hello', env)
    expect(env.CLAUDE_CODE_ENABLE_APPEND_SUBAGENT_PROMPT).toBe('0')
  })
})
