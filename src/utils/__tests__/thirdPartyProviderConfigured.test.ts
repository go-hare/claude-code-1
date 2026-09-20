/**
 * `isThirdPartyProviderConfigured` must rank provider signals the same way
 * `getAPIProvider()` does. The subtle rule: `/login` leaves
 * CLAUDE_CODE_USE_OPENAI / OPENAI_BASE_URL behind in settings.env (which is
 * merged into process.env), so that residue must not outrank a later Anthropic
 * login — otherwise a logged-in Anthropic user loses OAuth, voice mode and the
 * GitHub app.
 *
 * Pure: the helper takes settings + env explicitly, so no module mocks.
 */
import { describe, expect, test } from 'bun:test'
import { isThirdPartyProviderConfigured as is3P } from '../auth.js'

const NONE: NodeJS.ProcessEnv = {}

describe('isThirdPartyProviderConfigured', () => {
  test('no provider signals at all', () => {
    expect(is3P({}, NONE)).toBe(false)
    expect(is3P({ modelType: 'anthropic' }, NONE)).toBe(false)
  })

  test('explicit third-party modelType pins regardless of env', () => {
    for (const modelType of ['openai', 'gemini', 'grok'] as const) {
      expect(is3P({ modelType }, NONE)).toBe(true)
    }
  })

  test('cloud USE_* outranks modelType anthropic, matching getAPIProvider', () => {
    for (const key of [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
    ]) {
      expect(is3P({ modelType: 'anthropic' }, { [key]: '1' })).toBe(true)
    }
  })

  test('CLAUDE_CODE_USE_* alone is enough for the OpenAI-style providers', () => {
    // gemini and grok default their base URL, so there is no *_BASE_URL to read.
    for (const key of [
      'CLAUDE_CODE_USE_OPENAI',
      'CLAUDE_CODE_USE_GEMINI',
      'CLAUDE_CODE_USE_GROK',
    ]) {
      expect(is3P({}, { [key]: '1' })).toBe(true)
    }
  })

  test('*_BASE_URL alone is enough', () => {
    for (const key of ['OPENAI_BASE_URL', 'GEMINI_BASE_URL', 'GROK_BASE_URL']) {
      expect(is3P({}, { [key]: 'http://localhost:11434/v1' })).toBe(true)
    }
  })

  test('modelType anthropic beats leftover OpenAI-style residue', () => {
    const residue: NodeJS.ProcessEnv = {
      CLAUDE_CODE_USE_OPENAI: '1',
      OPENAI_BASE_URL: 'http://localhost:11434/v1',
      CLAUDE_CODE_USE_GEMINI: '1',
      GEMINI_BASE_URL: 'https://example.invalid',
      CLAUDE_CODE_USE_GROK: '1',
      GROK_BASE_URL: 'https://example.invalid',
    }
    expect(is3P({ modelType: 'anthropic' }, residue)).toBe(false)
    // Without the anthropic pin the same residue does count.
    expect(is3P({}, residue)).toBe(true)
  })

  test('falsy env values are not signals', () => {
    expect(is3P({}, { CLAUDE_CODE_USE_GEMINI: '0' })).toBe(false)
    expect(is3P({}, { CLAUDE_CODE_USE_GROK: '' })).toBe(false)
    expect(is3P({}, { GROK_BASE_URL: '' })).toBe(false)
  })
})
