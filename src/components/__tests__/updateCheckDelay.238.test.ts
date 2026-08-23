import { describe, expect, test } from 'bun:test'
import {
  getUpdateCheckStartupDelayMs,
  UPDATE_CHECK_STARTUP_DELAY_MS,
} from '../AutoUpdaterWrapper.js'

describe('update check startup delay densable 2.1.238 DGT/kOl', () => {
  test('DGT is 10s', () => {
    expect(UPDATE_CHECK_STARTUP_DELAY_MS).toBe(10_000)
  })

  test('kOl remaining when uptime is low', () => {
    expect(getUpdateCheckStartupDelayMs(0)).toBe(10_000)
    expect(getUpdateCheckStartupDelayMs(3)).toBe(7_000)
  })

  test('kOl is 0 once uptime >= 10s', () => {
    expect(getUpdateCheckStartupDelayMs(10)).toBe(0)
    expect(getUpdateCheckStartupDelayMs(30)).toBe(0)
  })
})
