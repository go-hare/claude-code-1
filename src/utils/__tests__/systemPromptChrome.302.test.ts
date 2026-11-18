import { afterEach, describe, expect, test } from 'bun:test'
import {
  getClaudeInChromeSessionPromptActive,
  setClaudeInChromeSessionPromptActive,
} from '../../bootstrap/state.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../../constants/prompts.js'
import { BASE_CHROME_PROMPT } from '../claudeInChrome/prompt.js'
import { buildEffectiveSystemPrompt } from '../systemPrompt.js'

describe('#927 Chrome instructions before SYSTEM_PROMPT_DYNAMIC_BOUNDARY', () => {
  const prevActive = getClaudeInChromeSessionPromptActive()

  afterEach(() => {
    setClaudeInChromeSessionPromptActive(prevActive)
  })

  test('places BASE_CHROME_PROMPT before SYSTEM_PROMPT_DYNAMIC_BOUNDARY for shared prompt cache', () => {
    setClaudeInChromeSessionPromptActive(true)
    const prompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition: undefined,
      toolUseContext: { options: {} as never },
      customSystemPrompt: undefined,
      defaultSystemPrompt: [
        'Static prefix',
        SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
        'Dynamic suffix',
      ],
      appendSystemPrompt: 'Session extra',
    })

    const chromeIdx = prompt.indexOf(BASE_CHROME_PROMPT)
    const boundaryIdx = prompt.indexOf(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
    const extraIdx = prompt.indexOf('Session extra')

    expect(chromeIdx).toBeGreaterThan(-1)
    expect(boundaryIdx).toBeGreaterThan(-1)
    expect(chromeIdx).toBeLessThan(boundaryIdx)
    expect(extraIdx).toBeGreaterThan(boundaryIdx)
  })

  test('falls back to appending at end when no dynamic boundary is present', () => {
    setClaudeInChromeSessionPromptActive(true)
    const prompt = buildEffectiveSystemPrompt({
      mainThreadAgentDefinition: undefined,
      toolUseContext: { options: {} as never },
      customSystemPrompt: 'Custom static prompt',
      defaultSystemPrompt: [],
      appendSystemPrompt: 'Session extra',
    })

    expect(prompt.length).toBe(2)
    expect(prompt[0]).toBe('Custom static prompt')
    expect(prompt[1]).toContain(BASE_CHROME_PROMPT)
    expect(prompt[1]).toContain('Session extra')
  })
})
