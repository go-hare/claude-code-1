import { describe, expect, test } from 'bun:test'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import { canBatchWith, joinPromptValues } from '../printPromptBatch.js'

describe('2.1.299 #657 joinPromptValues content block separator', () => {
  test('inserts newline on trailing text block when merging content-block prompts', () => {
    const merged = joinPromptValues([
      [{ type: 'text', text: 'first prompt' }],
      [{ type: 'text', text: 'second prompt' }],
    ])
    expect(merged).toEqual([
      { type: 'text', text: 'first prompt\n' },
      { type: 'text', text: 'second prompt' },
    ])
  })

  test('inserts newline between string prompt and content-block prompt', () => {
    const merged = joinPromptValues([
      'first line',
      [{ type: 'text', text: 'second line' }],
    ])
    expect(merged).toEqual([
      { type: 'text', text: 'first line\n' },
      { type: 'text', text: 'second line' },
    ])
  })

  test('does not insert newline when boundary is non-text block', () => {
    const img = {
      type: 'image' as const,
      source: {
        type: 'base64' as const,
        media_type: 'image/png' as const,
        data: 'abc',
      },
    }
    const merged = joinPromptValues([
      [img],
      [{ type: 'text', text: 'caption' }],
    ])
    expect(merged).toEqual([img, { type: 'text', text: 'caption' }])
  })

  test('E-P1-2: canBatchWith refuses to merge mismatched skipSubmissionHooks prompts', () => {
    const makePrompt = (opts: Partial<QueuedCommand> = {}): QueuedCommand => ({
      value: 'hi',
      mode: 'prompt',
      isMeta: false,
      ...opts,
    })
    expect(
      canBatchWith(makePrompt({ skipSubmissionHooks: true }), makePrompt()),
    ).toBe(false)
    expect(
      canBatchWith(makePrompt(), makePrompt({ skipSubmissionHooks: true })),
    ).toBe(false)
    expect(
      canBatchWith(
        makePrompt({ skipSubmissionHooks: true }),
        makePrompt({ skipSubmissionHooks: false }),
      ),
    ).toBe(false)
    expect(
      canBatchWith(
        makePrompt({ skipSubmissionHooks: true }),
        makePrompt({ skipSubmissionHooks: true }),
      ),
    ).toBe(true)
    expect(
      canBatchWith(makePrompt({ skipSubmissionHooks: false }), makePrompt()),
    ).toBe(true)
  })
})
