import { describe, expect, test } from 'bun:test'
import { idleReturnContextTokens } from '../idleReturnHint.js'

describe('idleReturnContextTokens', () => {
  test('uses last API usage including cache tokens, not billed input only', () => {
    const messages = [
      {
        type: 'assistant',
        message: {
          model: 'claude-opus-4-6',
          content: [{ type: 'text', text: 'hi' }],
          usage: {
            input_tokens: 20_000,
            output_tokens: 500,
            cache_creation_input_tokens: 10_000,
            cache_read_input_tokens: 90_000,
          },
        },
      },
    ]
    expect(idleReturnContextTokens(messages as never)).toBe(120_500)
  })

  test('returns 0 when the transcript has no usage', () => {
    expect(
      idleReturnContextTokens([
        { type: 'user', message: { content: 'hi' } },
      ] as never),
    ).toBe(0)
  })
})
