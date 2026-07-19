/**
 * densable Nke residual #164 — pIb/fIb/mIb + status requesting.
 * Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { convertSDKMessage } from '../sdkMessageAdapter.js'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'

const srcPath = join(import.meta.dir, '../sdkMessageAdapter.ts')

describe('convertSDKMessage densable Nke #164 pIb/fIb/mIb', () => {
  test('assistant stamps isApiErrorMessage from is_api_error_message (pIb)', () => {
    const out = convertSDKMessage({
      type: 'assistant',
      message: {
        id: 'a1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'err' }],
        model: 'claude',
        stop_reason: null,
        stop_sequence: null,
        usage: {} as any,
      },
      uuid: 'a1',
      session_id: 's1',
      parent_tool_use_id: null,
      is_api_error_message: true,
      timestamp: '2020-01-01T00:00:00.000Z',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect((out.message as any).isApiErrorMessage).toBe(true)
    expect(out.message.timestamp).toBe('2020-01-01T00:00:00.000Z')
  })

  test('assistant omits isApiErrorMessage when flag absent', () => {
    const out = convertSDKMessage({
      type: 'assistant',
      message: {
        id: 'a2',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        model: 'claude',
        stop_reason: null,
        stop_sequence: null,
        usage: {} as any,
      },
      uuid: 'a2',
      session_id: 's1',
      parent_tool_use_id: null,
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect((out.message as any).isApiErrorMessage).toBeUndefined()
  })

  test('stream_event passes ttftMs from ttft_ms (fIb)', () => {
    const out = convertSDKMessage({
      type: 'stream_event',
      event: { type: 'message_start' },
      uuid: 's1',
      session_id: 's1',
      parent_tool_use_id: null,
      ttft_ms: 42,
    } as SDKMessage)
    expect(out.type).toBe('stream_event')
    if (out.type !== 'stream_event') return
    // densable fIb nests: ConvertedMessage.event is the StreamEvent shape
    expect((out.event as any).ttftMs).toBe(42)
    expect((out.event as any).event).toEqual({ type: 'message_start' })
  })

  test('stream_event without ttft_ms omits ttftMs', () => {
    const out = convertSDKMessage({
      type: 'stream_event',
      event: { type: 'content_block_delta' },
      uuid: 's2',
      session_id: 's1',
      parent_tool_use_id: null,
    } as SDKMessage)
    expect(out.type).toBe('stream_event')
    if (out.type !== 'stream_event') return
    expect((out.event as any).ttftMs).toBeUndefined()
  })

  test('result error filters [ede_diagnostic] (mIb)', () => {
    const out = convertSDKMessage({
      type: 'result',
      subtype: 'error_during_execution',
      errors: ['[ede_diagnostic] noise', 'real fail', '[ede_diagnostic] more'],
      uuid: 'r1',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect((out.message as any).content).toBe('real fail')
    expect((out.message as any).level).toBe('warning')
  })

  test('result only ede_diagnostic → ignored (mIb null)', () => {
    expect(
      convertSDKMessage({
        type: 'result',
        subtype: 'error_during_execution',
        errors: ['[ede_diagnostic] only'],
        uuid: 'r2',
        session_id: 's1',
      } as SDKMessage).type,
    ).toBe('ignored')
  })

  test('result success still ignored', () => {
    expect(
      convertSDKMessage({
        type: 'result',
        subtype: 'success',
        uuid: 'r3',
        session_id: 's1',
      } as SDKMessage).type,
    ).toBe('ignored')
  })

  test('status requesting → stream_request_start', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'status',
      status: 'requesting',
      uuid: 'st1',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('stream_event')
    if (out.type !== 'stream_event') return
    expect(out.event).toEqual({ type: 'stream_request_start' })
  })

  test('status compacting still informational message', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'status',
      status: 'compacting',
      uuid: 'st2',
      session_id: 's1',
    } as SDKMessage)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect((out.message as any).content).toContain('Compacting')
  })

  test('source anchors densable Nke pIb/fIb/mIb/requesting', () => {
    const src = readFileSync(srcPath, 'utf8')
    expect(src).toContain('is_api_error_message')
    expect(src).toContain('isApiErrorMessage')
    expect(src).toContain('ttft_ms')
    expect(src).toContain('ttftMs')
    expect(src).toContain('[ede_diagnostic]')
    expect(src).toContain('stream_request_start')
    expect(src).toContain('requesting')
  })
})
