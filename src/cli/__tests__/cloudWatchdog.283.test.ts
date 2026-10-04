/**
 * densable 2.1.283 leftover gold `HWt` @202291265 wrap.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED,
  HEADLESS_CLOUD_WATCHDOG_MS_UNATTACHED,
  headlessCloudWatchdogMs,
} from '../cloudWatchdog.js'

const src = readFileSync(join(import.meta.dir, '../cloudWatchdog.ts'), 'utf8')

describe('cloudWatchdog 283 leftover gold HWt wrap', () => {
  test('source-locks gold HWt; no minify public API; no warning duplicate', () => {
    expect(src).toContain('gold `HWt` @202291265')
    expect(src).toContain('function HWt(e){return e?180000:60000}')
    expect(src).not.toMatch(/^export (async )?function HWt\b/m)
    expect(src).not.toContain('HEADLESS_CLOUD_WATCHDOG_WARNING')
    expect(src).not.toContain('settings.set(')
    expect(src).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(src).not.toContain('tengu_violin_amati')
    expect(src).not.toContain('new WebSocket')
  })

  test('HWt attached 180s / unattached 60s', () => {
    expect(HEADLESS_CLOUD_WATCHDOG_MS_ATTACHED).toBe(180_000)
    expect(HEADLESS_CLOUD_WATCHDOG_MS_UNATTACHED).toBe(60_000)
    expect(headlessCloudWatchdogMs(true)).toBe(180_000)
    expect(headlessCloudWatchdogMs(false)).toBe(60_000)
  })
})
