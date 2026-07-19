/**
 * densable Nke/gty residual #172 — convertSDKMessage model_refusal_* stamps
 * refused_user_message_uuid. Behavior only.
 */
import { describe, expect, test } from 'bun:test'
import { convertSDKMessage } from '../sdkMessageAdapter.js'

describe('convertSDKMessage densable gty #172 model_refusal', () => {
  test('model_refusal_fallback preserves refused_user_message_uuid', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'model_refusal_fallback',
      uuid: 'sys_fb',
      session_id: 's',
      content: 'Switched models',
      trigger: 'refusal',
      direction: 'retry',
      original_model: 'a',
      fallback_model: 'b',
      request_id: 'req_1',
      api_refusal_category: 'cyber',
      refused_user_message_uuid: 'msg_user_1',
      retracted_message_uuids: ['asst_1'],
    } as any)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    const m = out.message as any
    expect(m.type).toBe('system')
    expect(m.subtype).toBe('model_refusal_fallback')
    expect(m.refusedUserMessageUuid).toBe('msg_user_1')
    expect(m.retractedMessageUuids).toEqual(['asst_1'])
    expect(m.originalModel).toBe('a')
    expect(m.fallbackModel).toBe('b')
    expect(m.level).toBe('warning')
  })

  test('model_refusal_no_fallback preserves refused uuid + null default', () => {
    const out = convertSDKMessage({
      type: 'system',
      subtype: 'model_refusal_no_fallback',
      uuid: 'sys_nf',
      session_id: 's',
      content: '',
      original_model: 'a',
      request_id: 'req_2',
      api_refusal_category: 'bio',
      refused_user_message_uuid: null,
    } as any)
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    const m = out.message as any
    expect(m.subtype).toBe('model_refusal_no_fallback')
    expect(m.refusedUserMessageUuid).toBeNull()
    expect(m.originalModel).toBe('a')
  })
})
