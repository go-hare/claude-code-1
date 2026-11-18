import { describe, expect, test } from 'bun:test'
import { waitForSettingsReadHooksForRetentionSweep } from '../cleanup.js'

describe('cleanup v2.1.304 (#1012)', () => {
  test('#1012: waitForSettingsReadHooksForRetentionSweep awaits settings.read merge before timeout', async () => {
    let ran = false
    const res = await waitForSettingsReadHooksForRetentionSweep(
      500,
      async () => {
        await new Promise(resolve => setTimeout(resolve, 10))
        ran = true
      },
    )
    expect(ran).toBe(true)
    expect(res).toBe('asked')
  })

  test('#1012: waitForSettingsReadHooksForRetentionSweep returns timeout when merge stalls', async () => {
    const res = await waitForSettingsReadHooksForRetentionSweep(
      15,
      () => new Promise(() => {}),
    )
    expect(res).toBe('timeout')
  })
})
