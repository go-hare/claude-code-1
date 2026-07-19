/**
 * densable Nke residual #163 — convertSDKMessage user path Ace + parent_tool_use_id.
 * Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
} from '../../utils/messages.js'
import { convertSDKMessage } from '../sdkMessageAdapter.js'
import type { SDKMessage } from '../../entrypoints/agentSdkTypes.js'

const srcPath = join(import.meta.dir, '../sdkMessageAdapter.ts')

function sdkUser(partial: Record<string, unknown> = {}): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content: 'hello' },
    uuid: 'u1',
    session_id: 's1',
    parent_tool_use_id: null,
    ...partial,
  } as SDKMessage
}

describe('convertSDKMessage densable Nke user path', () => {
  test('live mode ignores plain user (already local)', () => {
    expect(convertSDKMessage(sdkUser()).type).toBe('ignored')
  })

  test('convertUserTextMessages converts plain user', () => {
    const out = convertSDKMessage(sdkUser(), {
      convertUserTextMessages: true,
    })
    expect(out.type).toBe('message')
  })

  test('parent_tool_use_id ignored even with convertUserTextMessages', () => {
    expect(
      convertSDKMessage(sdkUser({ parent_tool_use_id: 'tu_1' }), {
        convertUserTextMessages: true,
      }).type,
    ).toBe('ignored')
  })

  test('isSynthetic without Ace origin ignored under convertUserTextMessages', () => {
    expect(
      convertSDKMessage(sdkUser({ isSynthetic: true }), {
        convertUserTextMessages: true,
      }).type,
    ).toBe('ignored')
    expect(
      convertSDKMessage(
        sdkUser({ isSynthetic: true, origin: { kind: 'human' } }),
        { convertUserTextMessages: true },
      ).type,
    ).toBe('ignored')
  })

  test('isSynthetic + Ace origin converts under convertUserTextMessages', () => {
    for (const origin of [
      { kind: 'channel' },
      { kind: 'observer' },
      { kind: 'peer', senderTaskId: 'a1' },
    ]) {
      const out = convertSDKMessage(
        sdkUser({ isSynthetic: true, origin, content: undefined }),
        { convertUserTextMessages: true },
      )
      // content still hello from default
      expect(out.type).toBe('message')
    }
  })

  test('interrupt text converts without convertUserTextMessages (densable DV/kH)', () => {
    expect(
      convertSDKMessage(
        sdkUser({
          message: { role: 'user', content: INTERRUPT_MESSAGE },
        }),
      ).type,
    ).toBe('message')
    expect(
      convertSDKMessage(
        sdkUser({
          message: {
            role: 'user',
            content: [
              { type: 'text', text: INTERRUPT_MESSAGE_FOR_TOOL_USE },
            ],
          },
        }),
      ).type,
    ).toBe('message')
  })

  test('convertToolResults still converts tool_result before parent check', () => {
    const out = convertSDKMessage(
      sdkUser({
        parent_tool_use_id: 'tu_1',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: 'ok' },
          ],
        },
        tool_use_result: { ok: true },
      }),
      { convertToolResults: true },
    )
    expect(out.type).toBe('message')
  })

  test('source anchors densable Nke Ace gate', () => {
    const src = readFileSync(srcPath, 'utf8')
    expect(src).toContain('isSystemVisibleOrigin')
    expect(src).toContain('parent_tool_use_id')
    expect(src).toContain('INTERRUPT_MESSAGE')
    expect(src).toContain('densable Nke')
  })
})
