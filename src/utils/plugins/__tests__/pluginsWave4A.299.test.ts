import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getPluginsSyncState,
  markSyncedDirsLoaded,
  resetSyncedLaneState,
} from '../syncedPluginCloudSync.js'
import { validatePluginContents } from '../validatePlugin.js'

describe('plugins Wave 4A (#587/#610/#628, #646, #684, #781)', () => {
  test('#587/#610/#628 markSyncedDirsLoaded updates lastSyncedLaneLoad and clears awaiting dirs', () => {
    resetSyncedLaneState()
    const state = getPluginsSyncState()
    expect(state.lastSyncedLaneLoad).toBeNull()
    markSyncedDirsLoaded(['/tmp/synced-a'])
    expect(state.syncedLaneOpened).toBe(true)
    expect(state.lastSyncedLaneLoad).not.toBeNull()
    expect(state.syncedDirsLoadedHere.has('/tmp/synced-a')).toBe(true)
    resetSyncedLaneState()
  })

  test('#646 reload-plugins does not pass applyStagedInstalls: false to refreshActivePlugins', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/commands/reload-plugins/reload-plugins.ts'),
      'utf8',
    )
    expect(src).toContain('await refreshActivePlugins(context.setAppState)')
    expect(src).not.toContain('applyStagedInstalls: false')
  })

  test('#684 validatePluginContents accepts $.state when plugin.json omits types and ./types/index.d.ts declares it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-684-'))
    try {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      mkdirSync(join(dir, 'types'), { recursive: true })
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      writeFileSync(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-mod' }),
        'utf8',
      )
      writeFileSync(
        join(dir, 'types', 'index.d.ts'),
        'export interface PluginState { "my-mod": { count: number } }\n',
        'utf8',
      )
      writeFileSync(
        join(dir, 'hooks', 'hooks.json'),
        JSON.stringify({ hooks: {} }),
        'utf8',
      )
      writeFileSync(
        join(dir, 'hooks', 'register.ts'),
        `export default function(_on: any, $: any) {\n  void $.state.get({ plugin: 'my-mod', key: 'count' })\n}\n`,
        'utf8',
      )
      const results = await validatePluginContents(dir)
      const hooksRes = results.find(r => r.fileType === 'hooks')
      expect(hooksRes?.success).toBe(true)
      expect(hooksRes?.errors).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#684 validatePluginContents rejects undeclared $.state key when ./types/index.d.ts does not declare it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vp-684-err-'))
    try {
      mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
      mkdirSync(join(dir, 'types'), { recursive: true })
      mkdirSync(join(dir, 'hooks'), { recursive: true })
      writeFileSync(
        join(dir, '.claude-plugin', 'plugin.json'),
        JSON.stringify({ name: 'my-mod' }),
        'utf8',
      )
      writeFileSync(
        join(dir, 'types', 'index.d.ts'),
        'export interface PluginState { "my-mod": { other: number } }\n',
        'utf8',
      )
      writeFileSync(
        join(dir, 'hooks', 'hooks.json'),
        JSON.stringify({ hooks: {} }),
        'utf8',
      )
      writeFileSync(
        join(dir, 'hooks', 'register.ts'),
        `export default function(_on: any, $: any) {\n  void $.state.get({ plugin: 'my-mod', key: 'missingKey' })\n}\n`,
        'utf8',
      )
      const results = await validatePluginContents(dir)
      const hooksRes = results.find(r => r.fileType === 'hooks')
      expect(hooksRes?.success).toBe(false)
      expect(
        hooksRes?.errors.some(e =>
          e.message.includes('my-mod.missingKey is not declared'),
        ),
      ).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('#781 notePluginDevMods explicitly passes isMeta: true', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/utils/plugins/pluginDevMods.ts'),
      'utf8',
    )
    expect(src).toContain("mode: 'task-notification'")
    expect(src).toContain('isMeta: true')
  })
})
