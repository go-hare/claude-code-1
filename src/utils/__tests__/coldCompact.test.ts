import { describe, expect, test } from 'bun:test'
import {
  COLD_COMPACT_BUFFER_SCALE,
  isColdCompactEnabled,
  resolveColdCompactBufferScale,
  scaleAutocompactBufferForColdCompact,
} from '../coldCompact.js'

describe('isColdCompactEnabled', () => {
  test('default off', () => {
    expect(isColdCompactEnabled({})).toBe(false)
  })
  test('env on', () => {
    expect(isColdCompactEnabled({ CLAUDE_CODE_COLD_COMPACT: '1' })).toBe(true)
  })
  test('buffer scale densable', () => {
    expect(resolveColdCompactBufferScale({})).toBe(1)
    expect(
      resolveColdCompactBufferScale({ CLAUDE_CODE_COLD_COMPACT: '1' }),
    ).toBe(COLD_COMPACT_BUFFER_SCALE)
    expect(scaleAutocompactBufferForColdCompact(10_000, {})).toBe(10_000)
    expect(
      scaleAutocompactBufferForColdCompact(10_000, {
        CLAUDE_CODE_COLD_COMPACT: '1',
      }),
    ).toBe(Math.floor(10_000 * COLD_COMPACT_BUFFER_SCALE))
  })
})
