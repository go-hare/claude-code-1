/**
 * OpenAI / Grok-style max prompt length → densable PTL path.
 * Without this, reactive compact never withholds and the UI shows raw 400.
 */
import { describe, expect, test } from 'bun:test'
import {
  getAssistantMessageFromError,
  getPromptTooLongTokenGap,
  isPromptTooLongErrorMessage,
  isPromptTooLongMessage,
  parsePromptTooLongTokenCounts,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
} from '../errors.js'

const OPENAI_STYLE =
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"{\\"code\\":\\"invalid_argument\\",\\"error\\":\\"This model\'s maximum prompt length is 500000 but the request contains 500193 tokens.\\"}"}}'

const ANTHROPIC_STYLE = 'prompt is too long: 137500 tokens > 135000 maximum'

describe('isPromptTooLongErrorMessage', () => {
  test('Anthropic / Vertex classic', () => {
    expect(isPromptTooLongErrorMessage(ANTHROPIC_STYLE)).toBe(true)
    expect(isPromptTooLongErrorMessage('Prompt is too long')).toBe(true)
  })

  test('OpenAI / Grok maximum prompt length', () => {
    expect(isPromptTooLongErrorMessage(OPENAI_STYLE)).toBe(true)
    expect(
      isPromptTooLongErrorMessage(
        "This model's maximum prompt length is 500000 but the request contains 501727 tokens.",
      ),
    ).toBe(true)
  })

  test('unrelated 400 is not PTL', () => {
    expect(
      isPromptTooLongErrorMessage('invalid_request: bad tool schema'),
    ).toBe(false)
  })
})

describe('parsePromptTooLongTokenCounts OpenAI shape', () => {
  test('parses limit + actual from maximum prompt length wording', () => {
    const { actualTokens, limitTokens } =
      parsePromptTooLongTokenCounts(OPENAI_STYLE)
    expect(limitTokens).toBe(500000)
    expect(actualTokens).toBe(500193)
  })

  test('still parses Anthropic gap form', () => {
    const { actualTokens, limitTokens } =
      parsePromptTooLongTokenCounts(ANTHROPIC_STYLE)
    expect(actualTokens).toBe(137500)
    expect(limitTokens).toBe(135000)
  })
})

describe('getAssistantMessageFromError OpenAI PTL → reactive path', () => {
  test('normalizes to Prompt is too long + errorDetails', () => {
    const err = new Error(OPENAI_STYLE)
    const assistant = getAssistantMessageFromError(err, 'grok-4.5')
    expect(assistant.isApiErrorMessage).toBe(true)
    expect(isPromptTooLongMessage(assistant)).toBe(true)
    const text = (
      assistant.message.content as { type: string; text: string }[]
    ).find(b => b.type === 'text')?.text
    expect(text).toBe(PROMPT_TOO_LONG_ERROR_MESSAGE)
    expect(String(assistant.errorDetails)).toContain('maximum prompt length')
    const gap = getPromptTooLongTokenGap(assistant)
    expect(gap).toBe(500193 - 500000)
  })
})

describe('compat adapter catch uses getAssistantMessageFromError (product path)', () => {
  test('OpenAI/Grok/Gemini index import getAssistantMessageFromError', async () => {
    // Source lock: catch must not yield raw `API Error: ${msg}` for PTL.
    const openaiSrc = await Bun.file(
      new URL('../openai/index.ts', import.meta.url),
    ).text()
    const grokSrc = await Bun.file(
      new URL('../grok/index.ts', import.meta.url),
    ).text()
    const geminiSrc = await Bun.file(
      new URL('../gemini/index.ts', import.meta.url),
    ).text()
    for (const [name, src] of [
      ['openai', openaiSrc],
      ['grok', grokSrc],
      ['gemini', geminiSrc],
    ] as const) {
      expect(src.includes('getAssistantMessageFromError'), name).toBe(true)
      expect(src.includes("await import('../errors.js')"), name).toBe(true)
      // Old catch yielded raw `API Error: ${errorMessage}` — must stay gone.
      expect(src.includes('API Error: ${' + 'errorMessage}'), name).toBe(false)
    }
  })
})
