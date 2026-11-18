import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cleanupOldSessionFiles,
  getCutoffDate,
  getRetentionCutoff,
} from '../cleanup.js'
import { getSettings_DEPRECATED } from '../settings/settings.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

describe('v2.1.310 cleanup (#1199)', () => {
  let tempDir: string
  let prevConfigDir: string | undefined

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cleanup-310-'))
    prevConfigDir = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = tempDir
    resetSettingsCache()
  })

  afterEach(() => {
    if (prevConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
    resetSettingsCache()
    rmSync(tempDir, { recursive: true, force: true })
  })

  test('getCutoffDate and getRetentionCutoff return null when cleanupPeriodDays overflows Date', () => {
    // 1e15 days overflows JS Date (+/- 8.64e15 ms) into Invalid Date
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ cleanupPeriodDays: 1e15 }),
    )
    resetSettingsCache()
    expect(getSettings_DEPRECATED()?.cleanupPeriodDays).toBe(1e15)
    expect(getCutoffDate()).toBeNull()
    expect(getRetentionCutoff()).toBeNull()
  })

  test('cleanupOldSessionFiles is a no-op when cleanupPeriodDays overflows Date', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ cleanupPeriodDays: 1e15 }),
    )
    resetSettingsCache()
    const res = await cleanupOldSessionFiles()
    expect(res.messages).toBe(0)
    expect(res.errors).toBe(0)
  })
})
