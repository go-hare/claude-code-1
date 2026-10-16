import { describe, expect, test } from 'bun:test'
import { collectLastThinkingIdsPerTurn } from '../Messages.js'

describe('collectLastThinkingIdsPerTurn', () => {
  test('two human turns keep each turn last thinking id', () => {
    const ids = collectLastThinkingIdsPerTurn([
      { type: 'user', uuid: 'u1', message: { content: [{ type: 'text' }] } },
      {
        type: 'assistant',
        uuid: 'a1',
        message: { content: [{ type: 'thinking' }] },
      },
      {
        type: 'assistant',
        uuid: 'a1t',
        message: { content: [{ type: 'text' }] },
      },
      { type: 'user', uuid: 'u2', message: { content: [{ type: 'text' }] } },
      {
        type: 'assistant',
        uuid: 'a2',
        message: { content: [{ type: 'thinking' }] },
      },
      {
        type: 'assistant',
        uuid: 'a2t',
        message: { content: [{ type: 'text' }] },
      },
    ])
    expect(ids).toBeInstanceOf(Set)
    expect([...(ids as Set<string>)].sort()).toEqual(['a1:0', 'a2:0'])
  })

  test('no thinking returns no-thinking sentinel', () => {
    expect(
      collectLastThinkingIdsPerTurn([
        { type: 'user', uuid: 'u1', message: { content: [{ type: 'text' }] } },
        {
          type: 'assistant',
          uuid: 'a1',
          message: { content: [{ type: 'text' }] },
        },
      ]),
    ).toBe('no-thinking')
  })
})
