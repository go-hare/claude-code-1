/**
 * densable 2.1.234 #11 — SendMessage `to` unicode max Agf=300 + single-line.
 */
import { describe, expect, test } from 'bun:test'
import {
  SEND_MESSAGE_TO_MAX_CHARS,
  SEND_MESSAGE_TO_MAX_RE,
  SEND_MESSAGE_TO_SINGLE_LINE_RE,
} from '../constants.js'

describe('densable 2.1.234 #11 SendMessage to max', () => {
  test('Agf constants', () => {
    expect(SEND_MESSAGE_TO_MAX_CHARS).toBe(300)
    expect(SEND_MESSAGE_TO_SINGLE_LINE_RE.test('a\nb')).toBe(false)
    expect(SEND_MESSAGE_TO_SINGLE_LINE_RE.test('ok')).toBe(true)
  })

  test('unicode length allows 200 emoji-heavy names under 300', () => {
    // 200 emoji (each may be multi-code-unit) still within unicode {0,300}
    const emoji = '🙂'.repeat(200)
    expect(SEND_MESSAGE_TO_MAX_RE.test(emoji)).toBe(true)
    const tooLong = 'a'.repeat(301)
    expect(SEND_MESSAGE_TO_MAX_RE.test(tooLong)).toBe(false)
  })
})
