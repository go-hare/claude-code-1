import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  compactTranscriptFileAtomic,
  hasTranscriptMessages,
  readCustomTitleSidecar,
  recordSidechainTranscript,
} from '../sessionStorage.js'

describe('2.1.304-309 SessionStorage alignment (#968, #1045, #1089, #1139)', () => {
  test('#968 compactTranscriptFileAtomic rewrites atomically and preserves original on error', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-gc-'))
    try {
      const file = join(dir, 'transcript.jsonl')
      const original = '{"a":1}\n{"drop":true}\n{"b":2}\n'
      writeFileSync(file, original, 'utf8')

      const res = await compactTranscriptFileAtomic(
        file,
        line => !line.includes('"drop":true'),
      )
      expect(res.compacted).toBe(true)
      expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n{"b":2}\n')

      // If predicate throws mid-compact, original file remains untouched
      await expect(
        compactTranscriptFileAtomic(file, () => {
          throw new Error('ENOSPC simulated')
        }),
      ).rejects.toThrow('ENOSPC simulated')
      expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n{"b":2}\n')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1045 hasTranscriptMessages detects bookkeeping-only transcripts without parentUuid', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-bk-'))
    try {
      const file = join(dir, 'bookkeeping.jsonl')
      const content = '{"type":"custom-title","customTitle":"t"}\n'
      writeFileSync(file, content, 'utf8')
      expect(
        await hasTranscriptMessages(file, content, content, content.length),
      ).toBe(false)

      const withMsg = content + '{"type":"user","parentUuid":null}\n'
      expect(
        await hasTranscriptMessages(file, withMsg, withMsg, withMsg.length),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#1089 recordSidechainTranscript skips streaming assistant chunks with stop_reason === null', async () => {
    // Should resolve immediately without throwing or writing when only null-stop_reason chunk is passed
    await expect(
      recordSidechainTranscript(
        [
          {
            type: 'assistant',
            uuid: '00000000-0000-0000-0000-000000000001' as `${string}-${string}-${string}-${string}-${string}`,
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-6',
              content: [{ type: 'text', text: 'partial' }],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 0,
                output_tokens: 0,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          } as unknown as Parameters<
            typeof recordSidechainTranscript
          >[0][number],
        ],
        'agent-test-1089',
      ),
    ).resolves.toBeUndefined()
  })

  test('#1139 readCustomTitleSidecar reads <dir>/<sessionId>/custom-title.json fallback', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ss-title-'))
    try {
      const sessionId = '11111111-1111-1111-1111-111111111111'
      const transcriptPath = join(dir, `${sessionId}.jsonl`)
      const sidecarDir = join(dir, sessionId)
      const { mkdirSync } = await import('fs')
      mkdirSync(sidecarDir, { recursive: true })
      writeFileSync(
        join(sidecarDir, 'custom-title.json'),
        JSON.stringify({ customTitle: 'My Renamed Session' }),
        'utf8',
      )

      const title = await readCustomTitleSidecar(transcriptPath, sessionId)
      expect(title).toBe('My Renamed Session')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
