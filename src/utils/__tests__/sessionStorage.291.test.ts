import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  compactTranscriptJsonl,
  flushSessionStorageAtExit,
  getProject,
  getTranscriptWriterDegraded,
  isLowYieldCompact,
  loadTranscriptFile,
  noteTranscriptWriterDegraded,
  resetProjectFlushStateForTesting,
  resetProjectForTesting,
  setLocalGcEnabled,
  setLowYieldCompactSkipEnabled,
  shouldSkipLowYieldCompact,
  splitTranscriptJsonlLines,
  syncExitReStamp,
} from '../sessionStorage.js'

describe('v2.1.291-296 sessionStorage alignment (#192, #437, #530, #543)', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'session-storage-291-'))
    resetProjectForTesting()
  })

  afterEach(() => {
    resetProjectForTesting()
    setLocalGcEnabled(false)
    setLowYieldCompactSkipEnabled(false)
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('#192: getProject registers process exit listener and flushSessionStorageAtExit runs syncExitReStamp once', async () => {
    getProject()
    expect(process.listeners('exit')).toContain(syncExitReStamp)

    noteTranscriptWriterDegraded('ENOSPC', 'append')
    expect(getTranscriptWriterDegraded()).toEqual({
      code: 'ENOSPC',
      source: 'append',
    })

    await flushSessionStorageAtExit()
    // Calling syncExitReStamp a second time is a safe no-op
    syncExitReStamp()
    resetProjectFlushStateForTesting()
    expect(getTranscriptWriterDegraded()).toBeNull()
  })

  test('#437: loadTranscriptFile honors last-prompt rewound checkpoint and preserves new prompt past rewind', async () => {
    const file = join(tempDir, 'transcript.jsonl')
    const sid = '11111111-1111-4111-8111-111111111111'
    const u1 = '22222222-2222-4222-8222-222222222222'
    const a1 = '33333333-3333-4333-8333-333333333333'
    const u2Removed = '44444444-4444-4444-8444-444444444444'
    const a2Removed = '55555555-5555-4555-8555-555555555555'
    const u3AfterRewind = '66666666-6666-4666-8666-666666666666'

    const rows = [
      {
        type: 'user',
        uuid: u1,
        parentUuid: null,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'first' },
      },
      {
        type: 'assistant',
        uuid: a1,
        parentUuid: u1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'r1' }] },
      },
      {
        type: 'user',
        uuid: u2Removed,
        parentUuid: a1,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:02.000Z',
        message: { role: 'user', content: 'removed turn' },
      },
      {
        type: 'assistant',
        uuid: a2Removed,
        parentUuid: u2Removed,
        sessionId: sid,
        timestamp: '2026-01-01T00:00:03.000Z',
        message: { role: 'assistant', content: [{ type: 'text', text: 'r2' }] },
      },
      {
        type: 'last-prompt',
        sessionId: sid,
        leafUuid: a1,
        explicit: true,
        rewound: true,
        cutUuid: u2Removed,
        timestamp: '2026-01-01T00:00:04.000Z',
      },
    ]

    writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n')

    // Case 1: Resumed immediately after rewind — removed turns must NOT come back
    const res1 = await loadTranscriptFile(file)
    expect([...res1.leafUuids]).toEqual([a1])

    // Case 2: New prompt sent after rewind — must be preserved, not lost
    const rowsWithNewPrompt = [
      ...rows,
      {
        type: 'user',
        uuid: u3AfterRewind,
        parentUuid: a1,
        sessionId: sid,
        promptSource: 'repl',
        timestamp: '2026-01-01T00:00:05.000Z',
        message: { role: 'user', content: 'new prompt after rewind' },
      },
    ]
    writeFileSync(
      file,
      rowsWithNewPrompt.map(r => JSON.stringify(r)).join('\n') + '\n',
    )
    const res2 = await loadTranscriptFile(file)
    expect([...res2.leafUuids]).toEqual([u3AfterRewind])

    // Case 3: Rewound to before first message (leafUuid: null, explicit: true)
    const rowsEmpty = [
      ...rows.slice(0, 2),
      {
        type: 'last-prompt',
        sessionId: sid,
        leafUuid: null,
        explicit: true,
        rewound: true,
        timestamp: '2026-01-01T00:00:06.000Z',
      },
    ]
    writeFileSync(file, rowsEmpty.map(r => JSON.stringify(r)).join('\n') + '\n')
    const res3 = await loadTranscriptFile(file)
    expect([...res3.leafUuids]).toEqual([])
  })

  test('#530: splitTranscriptJsonlLines & compactTranscriptJsonl preserve U+2028 and U+2029', () => {
    const msg1 = JSON.stringify({ id: 1, text: 'hello\u2028world\u2029end' })
    const msg2 = JSON.stringify({ id: 2, text: 'second' })
    const jsonl = `${msg1}\n${msg2}\n`

    const lines = splitTranscriptJsonlLines(jsonl)
    expect(lines).toEqual([msg1, msg2])

    const { compacted, skippedLowYield } = compactTranscriptJsonl(
      jsonl,
      () => true,
    )
    expect(skippedLowYield).toBe(false)
    expect(compacted).toBe(jsonl)
  })

  test('#543: shouldSkipLowYieldCompact skips rewrite when reclaimable < 10% and lowYieldCompactSkipEnabled is true', () => {
    expect(isLowYieldCompact(1000, 99)).toBe(true)
    expect(isLowYieldCompact(1000, 100)).toBe(false)

    setLowYieldCompactSkipEnabled(true)
    expect(shouldSkipLowYieldCompact(1000, 50)).toBe(true)
    expect(shouldSkipLowYieldCompact(1000, 150)).toBe(false)

    const bigKeep = 'x'.repeat(200)
    const smallDrop = 'y'.repeat(10)
    const jsonl = `${bigKeep}\n${smallDrop}\n`
    const res = compactTranscriptJsonl(jsonl, line => line === bigKeep)
    expect(res.skippedLowYield).toBe(true)
    expect(res.compacted).toBe(jsonl)
  })
})
