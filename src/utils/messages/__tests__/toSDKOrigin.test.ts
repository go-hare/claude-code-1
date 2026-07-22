import { describe, expect, test } from 'bun:test'
import { createUserMessage } from '../../messages.js'
import { toSDKMessages } from '../mappers.js'

describe('toSDKMessages densable origin on wire', () => {
  test('user with origin serializes origin field', () => {
    const msg = createUserMessage({
      content: 'from peer',
      isMeta: true,
      origin: { kind: 'peer', senderTaskId: 'a-1' } as never,
    })
    const out = toSDKMessages([msg])
    const user = out.find(m => m.type === 'user') as
      | {
          type: 'user'
          isSynthetic?: boolean
          origin?: { kind?: string; senderTaskId?: string }
        }
      | undefined
    expect(user).toBeDefined()
    expect(user?.isSynthetic).toBe(true)
    expect(user?.origin?.kind).toBe('peer')
    expect(user?.origin?.senderTaskId).toBe('a-1')
  })

  test('user without origin omits origin field', () => {
    const msg = createUserMessage({ content: 'hi' })
    const out = toSDKMessages([msg])
    const user = out.find(m => m.type === 'user') as
      | { type: 'user'; origin?: unknown }
      | undefined
    expect(user).toBeDefined()
    expect(user?.origin).toBeUndefined()
  })
})
