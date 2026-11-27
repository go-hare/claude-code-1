import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { SDKPartialAssistantMessageSchema } from '../entrypoints/sdk/coreSchemas.js'
import {
  buildStreamEventOut,
  createPartialStreamRetractionCloser,
} from '../QueryEngine.js'

describe('v2.1.290 #121 outer abandoned_blocks / api_message_id', () => {
  test('SDKPartialAssistantMessageSchema accepts api_message_id and abandoned_blocks', () => {
    const schema = SDKPartialAssistantMessageSchema()
    const valid = schema.safeParse({
      type: 'stream_event',
      event: { type: 'message_stop' },
      parent_tool_use_id: null,
      uuid: '00000000-0000-0000-0000-000000000000',
      session_id: 'sess-1',
      api_message_id: 'msg_123',
      abandoned_blocks: {
        api_message_id: 'msg_123',
        from_block_index: 2,
      },
    })
    expect(valid.success).toBe(true)

    const negativeIdx = schema.safeParse({
      type: 'stream_event',
      event: { type: 'message_stop' },
      parent_tool_use_id: null,
      uuid: '00000000-0000-0000-0000-000000000000',
      session_id: 'sess-1',
      abandoned_blocks: {
        api_message_id: 'msg_123',
        from_block_index: -1,
      },
    })
    expect(negativeIdx.success).toBe(false)
  })

  test('buildStreamEventOut forwards apiMessageId and abandonedBlocks', () => {
    const out = buildStreamEventOut(
      {
        event: { type: 'message_stop' },
        apiMessageId: 'msg_abc',
        abandonedBlocks: { apiMessageId: 'msg_abc', fromBlockIndex: 1 },
        ttftMs: 42,
        textRunsJoined: true,
      },
      { session_id: 's1', uuid: 'u1' },
    )
    expect(out.api_message_id).toBe('msg_abc')
    expect(out.abandoned_blocks).toEqual({
      api_message_id: 'msg_abc',
      from_block_index: 1,
    })
    expect(out.ttft_ms).toBe(42)
    expect(out.text_runs_joined).toBe(true)
  })

  test('createPartialStreamRetractionCloser emits synthetic block_stop/message_delta/message_stop with abandoned_blocks at turn end', () => {
    const closer = createPartialStreamRetractionCloser(true)
    const emptyUsage = {
      input_tokens: 1,
      output_tokens: 2,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation: null,
      server_tool_use: null,
    } as never

    expect(
      closer.onStreamEvent(
        { type: 'message_start', message: { id: 'msg_99' } },
        emptyUsage,
      ),
    ).toEqual([])
    expect(
      closer.onStreamEvent(
        {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text' },
        },
        emptyUsage,
      ),
    ).toEqual([])

    const closed = closer.closeAtTurnEnd(emptyUsage)
    expect(closed.map(e => e.event.type)).toEqual([
      'content_block_stop',
      'message_delta',
      'message_stop',
    ])
    expect(closed[0]!.api_message_id).toBe('msg_99')
    expect(closed[2]!.api_message_id).toBe('msg_99')
    expect(closed[2]!.abandoned_blocks).toEqual({
      api_message_id: 'msg_99',
      from_block_index: 0,
    })
  })
})

describe('v2.1.290 #21 --json-schema retraction & print.ts error formatting', () => {
  test('QueryEngine tracks tombstoned StructuredOutput calls and retraction exhaustion', () => {
    const qeSrc = readFileSync(
      join(import.meta.dir, '../QueryEngine.ts'),
      'utf8',
    )
    expect(qeSrc).toContain('tengu_structured_output_retracted')
    expect(qeSrc).toContain('tengu_structured_output_late_retraction_drop')
    expect(qeSrc).toContain('tengu_structured_output_retraction_exhausted')
    expect(qeSrc).toContain(
      'Structured output was retracted by a model fallback and no retry produced a valid result',
    )
  })

  test('print.ts uses result errors[0] for error_max_structured_output_retries', () => {
    const printDir = join(import.meta.dir, '../cli/print')
    const printSrc = [
      readFileSync(join(import.meta.dir, '../cli/print.ts'), 'utf8'),
      ...readdirSync(printDir)
        .filter(f => /\.(ts|tsx)$/.test(f) && !f.includes('.test.'))
        .sort()
        .map(f => readFileSync(join(printDir, f), 'utf8')),
    ].join('\n')
    expect(printSrc).toContain(
      "errors?.[0] ?? 'Failed to provide valid structured output after maximum retries'",
    )
  })
})
