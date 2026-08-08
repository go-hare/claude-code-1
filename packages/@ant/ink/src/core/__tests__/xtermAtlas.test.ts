import { afterEach, describe, expect, test } from 'bun:test'
import {
  ATLAS_KEY_THRESHOLD,
  ATLAS_RESET_OSC,
  _resetXtermAtlasForTesting,
  bootstrapXtermAtlas,
  clearAtlasKeys,
  getAtlasKeyStats,
  getAtlasResetStats,
  isAtlasResetEnabled,
  isAtlasTrackingEnabled,
  recordAtlasReset,
  setAtlasResetEnabled,
  setAtlasTrackingEnabled,
  trackAtlasKey,
} from '../xtermAtlas.js'

afterEach(() => {
  _resetXtermAtlasForTesting()
})

describe('xtermAtlas densable 2.1.217', () => {
  test('ATLAS_RESET_OSC is densable LWu OSC 104;255 BEL', () => {
    expect(ATLAS_RESET_OSC).toBe('\x1b]104;255\x07')
  })

  test('trackAtlasKey ignores charId < 2 (empty/space slots)', () => {
    trackAtlasKey(0, 1)
    trackAtlasKey(1, 1)
    expect(getAtlasKeyStats().atlasKeys).toBe(0)
  })

  test('trackAtlasKey counts unique (char,style) pairs', () => {
    trackAtlasKey(2, 1)
    trackAtlasKey(2, 1)
    trackAtlasKey(2, 2)
    trackAtlasKey(3, 1)
    expect(getAtlasKeyStats()).toEqual({ atlasKeys: 3, saturated: false })
  })

  test('clearAtlasKeys resets set and saturated', () => {
    trackAtlasKey(2, 1)
    clearAtlasKeys()
    expect(getAtlasKeyStats()).toEqual({ atlasKeys: 0, saturated: false })
  })

  test('bootstrapXtermAtlas defaults enable reset+tracking', () => {
    setAtlasResetEnabled(false)
    setAtlasTrackingEnabled(false)
    bootstrapXtermAtlas()
    expect(isAtlasResetEnabled()).toBe(true)
    expect(isAtlasTrackingEnabled()).toBe(true)
  })

  test('bootstrapXtermAtlas respects false atlas reset without basalt', () => {
    bootstrapXtermAtlas({ xtermAtlasReset: false, basaltMeadow: false })
    expect(isAtlasResetEnabled()).toBe(false)
    // densable: if(e||t)RDt(!0) — neither true → tracking not forced on;
    // we only call setAtlasTrackingEnabled(true) when e||t, so leave as-is.
    // After _reset it's true; after set false + bootstrap false/false stays false.
  })

  test('recordAtlasReset increments stats', () => {
    recordAtlasReset('focus')
    recordAtlasReset('delta')
    const s = getAtlasResetStats()
    expect(s.count).toBe(2)
    expect(s.lastReason).toBe('delta')
  })

  test('ATLAS_KEY_THRESHOLD is densable tiy=2000', () => {
    expect(ATLAS_KEY_THRESHOLD).toBe(2000)
  })
})
