import { describe, expect, test } from 'bun:test'
import type { UUID } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { asAgentId } from '../../types/ids.js'
import {
  compactTranscriptFileAtomic,
  flushSessionStorage,
  getAgentTranscript,
  hasTranscriptMessages,
  isLoggableMessage,
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

  test('recordSidechainTranscript persists streamed assistant messages with stop_reason === null and keeps parentUuid chain intact (official 2.1.328 rft)', async () => {
    const origConfigDir = process.env.CLAUDE_CONFIG_DIR
    const origTestPersist = process.env.TEST_ENABLE_SESSION_PERSISTENCE
    const dir = mkdtempSync(join(tmpdir(), 'ss-sidechain-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    try {
      const agentId = asAgentId('a-sidechain-stream-chain')
      const u1 = '00000000-0000-0000-0000-000000000001' as UUID
      const a1 = '00000000-0000-0000-0000-000000000002' as UUID
      const u2 = '00000000-0000-0000-0000-000000000003' as UUID
      const a2 = '00000000-0000-0000-0000-000000000004' as UUID

      type SidechainMsg = Parameters<
        typeof recordSidechainTranscript
      >[0][number]

      // 1. Initial messages including trailing non-loggable deferred_tools_delta
      // attachment (matching runAgent.ts). Using findLast(isLoggableMessage) keeps
      // the first assistant message chained onto u1 instead of the dropped attachment.
      const attUuid = '00000000-0000-0000-0000-000000000099' as UUID
      const initialMessages: SidechainMsg[] = [
        {
          type: 'user',
          uuid: u1,
          message: { role: 'user', content: 'inspect codeMode sandbox' },
        } as unknown as SidechainMsg,
        {
          type: 'attachment',
          uuid: attUuid,
          attachment: {
            type: 'deferred_tools_delta',
            addedNames: ['Read'],
            removedNames: [],
          },
        } as unknown as SidechainMsg,
      ]
      await recordSidechainTranscript(initialMessages, agentId, null)
      const lastInitialUuid =
        initialMessages.findLast(isLoggableMessage)?.uuid ?? null
      expect(lastInitialUuid).toBe(u1)
      // 2. Streamed assistant tool_use block (stop_reason === null, as yielded by runAgent)
      await recordSidechainTranscript(
        [
          {
            type: 'assistant',
            uuid: a1,
            message: {
              id: 'msg_1',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-6',
              content: [
                {
                  type: 'tool_use',
                  id: 'toolu_1',
                  name: 'Read',
                  input: { file_path: '/tmp/a.ts' },
                },
              ],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 10,
                output_tokens: 5,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          } as unknown as SidechainMsg,
        ],
        agentId,
        lastInitialUuid,
      )
      // 3. Tool result user message chaining onto a1
      await recordSidechainTranscript(
        [
          {
            type: 'user',
            uuid: u2,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: 'toolu_1',
                  content: 'file contents',
                },
              ],
            },
          } as unknown as SidechainMsg,
        ],
        agentId,
        a1,
      )
      // 4. Final streamed assistant reply (also stop_reason === null at block yield time)
      await recordSidechainTranscript(
        [
          {
            type: 'assistant',
            uuid: a2,
            message: {
              id: 'msg_2',
              type: 'message',
              role: 'assistant',
              model: 'claude-sonnet-4-6',
              content: [{ type: 'text', text: 'Audit complete.' }],
              stop_reason: null,
              stop_sequence: null,
              usage: {
                input_tokens: 20,
                output_tokens: 8,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
              },
            },
          } as unknown as SidechainMsg,
        ],
        agentId,
        u2,
      )

      await flushSessionStorage()
      const loaded = await getAgentTranscript(agentId)
      expect(loaded).not.toBeNull()
      expect(loaded!.messages.map(m => [m.type, m.uuid])).toEqual([
        ['user', u1],
        ['assistant', a1],
        ['user', u2],
        ['assistant', a2],
      ])
    } finally {
      if (origConfigDir === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = origConfigDir
      }
      if (origTestPersist === undefined) {
        delete process.env.TEST_ENABLE_SESSION_PERSISTENCE
      } else {
        process.env.TEST_ENABLE_SESSION_PERSISTENCE = origTestPersist
      }
      rmSync(dir, { recursive: true, force: true })
    }
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
