import { describe, expect, test } from 'bun:test'
import type { SDKUserMessage } from '../../entrypoints/agentSdkTypes.js'
import { convertSDKMessage } from '../sdkMessageAdapter.js'

function userSdk(
  opts: {
    content?: string
    isSynthetic?: boolean
    origin?: { kind?: string; senderTaskId?: string }
  } = {},
): SDKUserMessage {
  return {
    type: 'user',
    uuid: '00000000-0000-4000-8000-000000000001',
    message: {
      role: 'user',
      content: opts.content ?? 'hello',
    },
    ...(opts.isSynthetic !== undefined
      ? { isSynthetic: opts.isSynthetic }
      : {}),
    ...(opts.origin !== undefined ? { origin: opts.origin } : {}),
  } as SDKUserMessage
}

describe('sdkMessageAdapter densable Nke/Ace', () => {
  test('synthetic without Ace origin is ignored', () => {
    const out = convertSDKMessage(userSdk({ isSynthetic: true }), {
      convertUserTextMessages: true,
    })
    expect(out.type).toBe('ignored')
  })

  test('synthetic peer with senderTaskId converts when convertUserTextMessages', () => {
    const out = convertSDKMessage(
      userSdk({
        isSynthetic: true,
        content: 'from peer',
        origin: { kind: 'peer', senderTaskId: 'a-1' },
      }),
      { convertUserTextMessages: true },
    )
    expect(out.type).toBe('message')
    if (out.type !== 'message') return
    expect(out.message.type).toBe('user')
    expect(out.message.isMeta).toBe(true)
    expect((out.message as { origin?: { kind?: string } }).origin?.kind).toBe(
      'peer',
    )
  })

  test('synthetic channel converts', () => {
    const out = convertSDKMessage(
      userSdk({
        isSynthetic: true,
        origin: { kind: 'channel' },
      }),
      { convertUserTextMessages: true },
    )
    expect(out.type).toBe('message')
  })

  test('non-synthetic without convertUserTextMessages is ignored (local echo path)', () => {
    const out = convertSDKMessage(userSdk({ content: 'typed' }), {})
    expect(out.type).toBe('ignored')
  })

  test('non-synthetic with convertUserTextMessages converts', () => {
    const out = convertSDKMessage(userSdk({ content: 'typed' }), {
      convertUserTextMessages: true,
    })
    expect(out.type).toBe('message')
  })
})
