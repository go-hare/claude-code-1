import { describe, expect, test } from 'bun:test'
import { joinPromptValues } from '../printPromptBatch.js'

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
})
