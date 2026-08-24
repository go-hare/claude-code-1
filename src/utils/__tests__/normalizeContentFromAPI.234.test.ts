/**
 * densable 2.1.234 #9 — KKn content-block heal for missing text/thinking.
 */
import { describe, expect, test } from 'bun:test'
import { normalizeContentFromAPI } from '../messages.js'

describe('densable 2.1.234 #9 normalizeContentFromAPI / KKn', () => {
  test('drops text blocks with non-string text', () => {
    const out = normalizeContentFromAPI(
      [
        { type: 'text', text: 123 as unknown as string },
        { type: 'text', text: 'ok' },
      ] as never,
      [],
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'text', text: 'ok' })
  })

  test('heals thinking blocks missing thinking/signature', () => {
    const out = normalizeContentFromAPI(
      [
        {
          type: 'thinking',
          // missing both fields
        } as never,
      ],
      [],
      undefined,
      { requestId: 'req_1', messageId: 'msg_1' },
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      type: 'thinking',
      thinking: '',
      signature: '',
    })
  })

  test('passes through complete thinking blocks', () => {
    const block = {
      type: 'thinking' as const,
      thinking: 'hi',
      signature: 'sig',
    }
    const out = normalizeContentFromAPI([block] as never, [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject(block)
  })
})
