/**
 * densable 2.1.289 wwr — focus merge keeps workshop and account-memory stats.
 */
import { describe, expect, test } from 'bun:test'
import {
  collapseFocusTranscript,
  type FocusTranscriptMessage,
} from '../focusTranscript.js'

function collapsed(
  uuid: string,
  extra: Record<string, unknown>,
): FocusTranscriptMessage {
  return {
    type: 'collapsed_read_search',
    uuid,
    searchCount: 0,
    readCount: 0,
    listCount: 0,
    replCount: 0,
    memorySearchCount: 0,
    memoryReadCount: 0,
    memoryWriteCount: 0,
    messages: [],
    readFilePaths: [],
    searchArgs: [],
    ...extra,
  }
}

describe('densable 2.1.289 wwr mergeCollapsed', () => {
  test('two collapsed groups sum workshop lines and unique account keys', () => {
    const out = collapseFocusTranscript(
      [
        {
          type: 'user',
          uuid: 'u1',
          message: { content: [{ type: 'text', text: 'hi' }] },
        },
        collapsed('c1', {
          workshopWriteCount: 1,
          workshopLinesAdded: 2,
          workshopLinesRemoved: 1,
          accountMemoryReadKeys: ['/a.md'],
          accountMemorySearchCount: 1,
          accountMemoryRecalls: [{ paths: ['a.md'], content: 'one' }],
        }),
        collapsed('c2', {
          workshopWriteCount: 3,
          workshopLinesAdded: 4,
          workshopLinesRemoved: 0,
          accountMemoryReadKeys: ['/a.md', '/b.md'],
          accountMemorySearchCount: 2,
          accountMemoryRecalls: [{ paths: ['b.md'], content: 'two' }],
        }),
        {
          type: 'assistant',
          uuid: 'txt',
          message: {
            content: [{ type: 'text', text: 'done' }],
            stop_reason: 'end_turn',
          },
        },
      ],
      undefined,
      undefined,
      false,
    )
    const group = out.find(m => m.type === 'collapsed_read_search') as {
      workshopWriteCount?: number
      workshopLinesAdded?: number
      workshopLinesRemoved?: number
      accountMemoryReadKeys?: string[]
      accountMemorySearchCount?: number
      accountMemoryRecalls?: { content: unknown }[]
    }
    expect(group.workshopWriteCount).toBe(4)
    expect(group.workshopLinesAdded).toBe(6)
    expect(group.workshopLinesRemoved).toBe(1)
    expect(group.accountMemoryReadKeys).toEqual(['/a.md', '/b.md'])
    expect(group.accountMemorySearchCount).toBe(3)
    expect(group.accountMemoryRecalls?.map(r => r.content)).toEqual([
      'one',
      'two',
    ])
  })
})
