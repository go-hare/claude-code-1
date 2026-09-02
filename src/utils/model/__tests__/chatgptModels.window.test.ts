import { afterEach, describe, expect, test } from 'bun:test'
import {
  getContextWindowForModel,
  isRecognizedModelForWindowEnforcement,
} from '../../context.js'
import {
  CHATGPT_API_CONTEXT_WINDOW,
  CHATGPT_GPT55_API_CONTEXT_WINDOW,
  CHATGPT_GPT55_OAUTH_CONTEXT_WINDOW,
  CHATGPT_OAUTH_CONTEXT_WINDOW,
  getChatGPTModelContextWindow,
} from '../chatgptModels.js'

const savedDisable1m = process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
const savedAuth = process.env.OPENAI_AUTH_MODE

afterEach(() => {
  if (savedDisable1m === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
  } else {
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = savedDisable1m
  }
  if (savedAuth === undefined) {
    delete process.env.OPENAI_AUTH_MODE
  } else {
    process.env.OPENAI_AUTH_MODE = savedAuth
  }
})

describe('getChatGPTModelContextWindow GPT-5.6', () => {
  test('API key path is 1.05M', () => {
    delete process.env.OPENAI_AUTH_MODE
    expect(getChatGPTModelContextWindow('gpt-5.6')).toBe(
      CHATGPT_API_CONTEXT_WINDOW,
    )
    expect(getChatGPTModelContextWindow('gpt-5.6-sol')).toBe(
      CHATGPT_API_CONTEXT_WINDOW,
    )
  })

  test('ChatGPT OAuth path is 272k', () => {
    process.env.OPENAI_AUTH_MODE = 'chatgpt'
    expect(getChatGPTModelContextWindow('gpt-5.6-sol')).toBe(
      CHATGPT_OAUTH_CONTEXT_WINDOW,
    )
  })
})

describe('getChatGPTModelContextWindow GPT-5.5', () => {
  test('API key path is 1M', () => {
    delete process.env.OPENAI_AUTH_MODE
    expect(getChatGPTModelContextWindow('gpt-5.5')).toBe(
      CHATGPT_GPT55_API_CONTEXT_WINDOW,
    )
    expect(getChatGPTModelContextWindow('gpt-5.5-pro')).toBe(
      CHATGPT_GPT55_API_CONTEXT_WINDOW,
    )
  })

  test('Codex OAuth path is 400k', () => {
    process.env.OPENAI_AUTH_MODE = 'chatgpt'
    expect(getChatGPTModelContextWindow('gpt-5.5')).toBe(
      CHATGPT_GPT55_OAUTH_CONTEXT_WINDOW,
    )
  })
})

describe('getChatGPTModelContextWindow GPT-5.4', () => {
  test('API key path is 1.05M for gpt-5.4 and gpt-5.4-pro', () => {
    delete process.env.OPENAI_AUTH_MODE
    expect(getChatGPTModelContextWindow('gpt-5.4')).toBe(
      CHATGPT_API_CONTEXT_WINDOW,
    )
    expect(getChatGPTModelContextWindow('gpt-5.4-pro')).toBe(
      CHATGPT_API_CONTEXT_WINDOW,
    )
  })

  test('gpt-5.4-mini has no invented window', () => {
    expect(getChatGPTModelContextWindow('gpt-5.4-mini')).toBeUndefined()
  })
})

describe('getChatGPTModelContextWindow unlisted GPT-5.x', () => {
  test('gpt-5.3 / gpt-5.2 stay undefined (no first-party window pinned)', () => {
    expect(getChatGPTModelContextWindow('gpt-5.3-codex')).toBeUndefined()
    expect(getChatGPTModelContextWindow('gpt-5.3-codex-spark')).toBeUndefined()
    expect(getChatGPTModelContextWindow('gpt-5.2')).toBeUndefined()
    expect(getChatGPTModelContextWindow('gpt-5.2-pro')).toBeUndefined()
    expect(getChatGPTModelContextWindow('gpt-5.2-codex')).toBeUndefined()
  })
})

describe('GPT window wiring through getContextWindowForModel', () => {
  test('gpt-5.5 is recognized at 1M on API path', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.OPENAI_AUTH_MODE
    expect(isRecognizedModelForWindowEnforcement('gpt-5.5')).toBe(true)
    expect(getContextWindowForModel('gpt-5.5')).toBe(
      CHATGPT_GPT55_API_CONTEXT_WINDOW,
    )
  })

  test('gpt-5.4 is recognized at 1.05M on API path', () => {
    delete process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT
    delete process.env.OPENAI_AUTH_MODE
    expect(isRecognizedModelForWindowEnforcement('gpt-5.4')).toBe(true)
    expect(getContextWindowForModel('gpt-5.4')).toBe(CHATGPT_API_CONTEXT_WINDOW)
  })

  test('gpt-5.4-mini stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('gpt-5.4-mini')).toBe(false)
    expect(getContextWindowForModel('gpt-5.4-mini')).toBe(200_000)
  })

  test('gpt-5.2 stays unknown 200k', () => {
    expect(isRecognizedModelForWindowEnforcement('gpt-5.2')).toBe(false)
    expect(getContextWindowForModel('gpt-5.2')).toBe(200_000)
  })

  test('DISABLE_1M clamps gpt-5.5 1M to 200k', () => {
    delete process.env.OPENAI_AUTH_MODE
    process.env.CLAUDE_CODE_DISABLE_1M_CONTEXT = '1'
    expect(getContextWindowForModel('gpt-5.5')).toBe(200_000)
  })
})
