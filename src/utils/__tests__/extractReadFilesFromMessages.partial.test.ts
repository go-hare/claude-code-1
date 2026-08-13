import { describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import type { Message } from 'src/types/message.js'
import { extractReadFilesFromMessages } from '../queryHelpers.js'

function assistantRead(
  toolUseId: string,
  filePath: string,
  opts?: { offset?: number | string; limit?: number | string },
): Message {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      role: 'assistant',
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Read',
          input: {
            file_path: filePath,
            ...(opts?.offset !== undefined ? { offset: opts.offset } : {}),
            ...(opts?.limit !== undefined ? { limit: opts.limit } : {}),
          },
        },
      ],
    },
  } as Message
}

function userToolResult(
  toolUseId: string,
  body: string,
  extra?: {
    truncatedByTokenCap?: boolean
    is_error?: boolean
  },
): Message {
  return {
    type: 'user',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    toolUseResult: extra?.truncatedByTokenCap
      ? { file: { truncatedByTokenCap: true } }
      : undefined,
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: body,
          is_error: extra?.is_error,
        },
      ],
    },
  } as Message
}

/**
 * Use POSIX absolute paths so cache keys match expandPath on darwin/linux.
 * Windows `D:/…` spellings are relative there (drive letter is not absolute),
 * so `.get('D:/…')` misses the expanded key and flaked the suite on mac.
 */
const FIXTURE_ROOT = '/tmp/extract-read-files-partial'
const base = (name: string) => `${FIXTURE_ROOT}/${name}`

describe('extractReadFilesFromMessages densable Woo #20', () => {
  test('rehydrates ranged Read with offset/limit (not dropped)', () => {
    const id = 'toolu_ranged'
    const abs = base('partial-read-fixture.ts')
    const messages = [
      assistantRead(id, abs, { offset: 10, limit: 20 }),
      userToolResult(id, '    10\tline ten\n    11\tline eleven'),
    ]
    const cache = extractReadFilesFromMessages(messages, FIXTURE_ROOT)
    const entry = cache.get(abs)
    expect(entry).toBeDefined()
    expect(entry!.offset).toBe(10)
    expect(entry!.limit).toBe(20)
    expect(entry!.isPartialView).toBeUndefined()
    expect(entry!.content).toContain('line ten')
  })

  test('offset defaults to 1 when tool_use omitted offset', () => {
    const id = 'toolu_full'
    const abs = base('full.ts')
    const messages = [
      assistantRead(id, abs),
      userToolResult(id, '     1\thello'),
    ]
    const entry = extractReadFilesFromMessages(messages, FIXTURE_ROOT).get(abs)
    expect(entry!.offset).toBe(1)
    expect(entry!.limit).toBeUndefined()
  })

  test('marks isPartialView when truncatedByTokenCap', () => {
    const id = 'toolu_cap'
    const abs = base('big.ts')
    const messages = [
      assistantRead(id, abs),
      userToolResult(id, '     1\tbody', { truncatedByTokenCap: true }),
    ]
    const entry = extractReadFilesFromMessages(messages, FIXTURE_ROOT).get(abs)
    expect(entry!.isPartialView).toBe(true)
  })

  test('marks isPartialView for PARTIAL view system-reminder prefix', () => {
    const id = 'toolu_partial_prefix'
    const abs = base('cap2.ts')
    const body =
      '<system-reminder>[Truncated: PARTIAL view — foo.ts: showing lines 1-5 of 100 total]</system-reminder>\n     1\tx'
    const messages = [assistantRead(id, abs), userToolResult(id, body)]
    const entry = extractReadFilesFromMessages(messages, FIXTURE_ROOT).get(abs)
    expect(entry!.isPartialView).toBe(true)
  })

  test('coerces string offset/limit (densable yZt)', () => {
    const id = 'toolu_str'
    const abs = base('str.ts')
    const messages = [
      assistantRead(id, abs, { offset: '5', limit: '15' }),
      userToolResult(id, '     5\trow'),
    ]
    const entry = extractReadFilesFromMessages(messages, FIXTURE_ROOT).get(abs)
    expect(entry!.offset).toBe(5)
    expect(entry!.limit).toBe(15)
  })

  test('skips error tool_results', () => {
    const id = 'toolu_err'
    const abs = base('err.ts')
    const messages = [
      assistantRead(id, abs, { offset: 1, limit: 5 }),
      userToolResult(id, 'boom', { is_error: true }),
    ]
    expect(
      extractReadFilesFromMessages(messages, FIXTURE_ROOT).get(abs),
    ).toBeUndefined()
  })
})
