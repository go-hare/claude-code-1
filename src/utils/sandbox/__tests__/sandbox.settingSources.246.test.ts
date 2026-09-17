import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getAllowedSettingSources,
  setAllowedSettingSources,
} from '../../../bootstrap/state.js'
import { resetSettingsCache } from '../../settings/settingsCache.js'
import type { SettingSource } from '../../settings/constants.js'
import { convertToSandboxRuntimeConfig } from '../sandbox-adapter.js'

const MARKER = '/cc246-disabled-fs-marker'
const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
let dir: string
let savedSources: SettingSource[]

describe('sandbox filesystem --setting-sources (official #61)', () => {
  beforeEach(() => {
    savedSources = [...getAllowedSettingSources()]
    dir = join(
      tmpdir(),
      `sbx-src-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    )
    mkdirSync(dir, { recursive: true })
    process.env.CLAUDE_CONFIG_DIR = dir
    writeFileSync(
      join(dir, 'settings.json'),
      JSON.stringify({
        sandbox: { filesystem: { denyRead: [MARKER] } },
      }),
    )
    resetSettingsCache()
  })

  afterEach(() => {
    setAllowedSettingSources(savedSources)
    if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    resetSettingsCache()
    rmSync(dir, { recursive: true, force: true })
  })

  test('skips filesystem entries from a disabled userSettings source', () => {
    setAllowedSettingSources([])
    resetSettingsCache()
    const cfg = convertToSandboxRuntimeConfig({})
    expect(
      cfg.filesystem.denyRead.some(p => p.includes('cc246-disabled-fs-marker')),
    ).toBe(false)
  })

  test('keeps filesystem entries when the source is enabled', () => {
    setAllowedSettingSources([
      'userSettings',
      'projectSettings',
      'localSettings',
    ])
    resetSettingsCache()
    const cfg = convertToSandboxRuntimeConfig({})
    expect(
      cfg.filesystem.denyRead.some(p => p.includes('cc246-disabled-fs-marker')),
    ).toBe(true)
  })
})
