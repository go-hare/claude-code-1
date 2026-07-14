import { describe, expect, test } from 'bun:test'
import { mock } from 'bun:test'

// Avoid loading growthbook/auth side effects — unit-test pure gate only.
mock.module('../analytics/growthbook.js', () => ({
  getFeatureValue_CACHED_MAY_BE_STALE: () => false,
}))

import {
  sanitizeVoiceKeyterms,
  shouldForwardInterimsTyped,
  VOICE_KEYTERMS_MAX_CHARS,
} from '../voiceStreamSTT.js'

describe('shouldForwardInterimsTyped (official tHp)', () => {
  test('env truthy forces on', () => {
    expect(
      shouldForwardInterimsTyped({
        CLAUDE_CODE_VOICE_FORWARD_INTERIMS_TYPED: '1',
      }),
    ).toBe(true)
  })
  test('env unset + gb false → off', () => {
    expect(shouldForwardInterimsTyped({})).toBe(false)
  })
})

describe('sanitizeVoiceKeyterms (official rHp)', () => {
  test('dedupes, strips non-ascii, joins commas', () => {
    expect(sanitizeVoiceKeyterms(['foo', 'foo', 'bar,baz', 'héllo'])).toBe(
      'foo,bar baz,hllo',
    )
  })
  test('respects max chars', () => {
    const long = 'a'.repeat(20)
    const out = sanitizeVoiceKeyterms([long, long + 'b', 'x'], 25)
    expect(out.length).toBeLessThanOrEqual(25)
    expect(out.startsWith(long)).toBe(true)
  })
  test('default max is 1024', () => {
    expect(VOICE_KEYTERMS_MAX_CHARS).toBe(1024)
  })
})
