import { describe, expect, test } from 'bun:test'
import {
  UDS_AUTH_FRAME_SIZE,
  assertUdsPayloadUnderLineCap,
  classifyUdsAuthToken,
  isUdsAuthFrame,
  isUdsMessageTooLargeError,
  MAX_UDS_LINE_CHARS,
  serializeUdsAuthFrame,
} from '../udsMessaging.js'

describe('densable H_a / PWd / DWd / HWd', () => {
  test('H_a serializes type=auth + token + newline', () => {
    const token = '0'.repeat(32)
    const frame = serializeUdsAuthFrame(token)
    expect(frame.endsWith('\n')).toBe(true)
    expect(JSON.parse(frame)).toEqual({ type: 'auth', token })
    expect(UDS_AUTH_FRAME_SIZE).toBe(frame.length)
  })

  test('PWd accepts only type=auth objects', () => {
    expect(isUdsAuthFrame({ type: 'auth', token: 'ab' })).toBe(true)
    expect(isUdsAuthFrame({ type: 'text', data: 'x' })).toBe(false)
    expect(isUdsAuthFrame(null)).toBe(false)
  })

  test('DWd classifies peer vs child; missing tokens is undefined', () => {
    const peer = 'a'.repeat(32)
    const child = 'b'.repeat(32)
    expect(
      classifyUdsAuthToken(peer, { peerToken: peer, childToken: child }),
    ).toBe('peer')
    expect(
      classifyUdsAuthToken(child, { peerToken: peer, childToken: child }),
    ).toBe('child')
    expect(
      classifyUdsAuthToken('c'.repeat(32), {
        peerToken: peer,
        childToken: child,
      }),
    ).toBeUndefined()
    expect(classifyUdsAuthToken(peer)).toBeUndefined()
  })

  test('lmp counts HWd + JSON + newline against X1r', () => {
    expect(() => assertUdsPayloadUnderLineCap('{"type":"ping"}')).not.toThrow()
    const huge = 'x'.repeat(MAX_UDS_LINE_CHARS)
    try {
      assertUdsPayloadUnderLineCap(huge)
      expect(true).toBe(false)
    } catch (err) {
      expect(isUdsMessageTooLargeError(err)).toBe(true)
    }
  })
})
