/**
 * densable 2.1.246 #21 — plugin.json with a UTF-8 BOM must parse.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadPluginManifest } from '../pluginLoader.js'
import { validatePluginManifest } from '../validatePlugin.js'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function bomPluginJson(dir: string): string {
  const pluginDir = join(dir, '.claude-plugin')
  const { mkdirSync } = require('fs') as typeof import('fs')
  mkdirSync(pluginDir, { recursive: true })
  const path = join(pluginDir, 'plugin.json')
  writeFileSync(
    path,
    `\uFEFF${JSON.stringify({ name: 'bom-plugin', description: 'bom' })}`,
    'utf8',
  )
  return path
}

describe('plugin.json UTF-8 BOM (2.1.246 #21)', () => {
  test('loadPluginManifest parses a BOM-prefixed plugin.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-bom-246-'))
    dirs.push(dir)
    const manifestPath = bomPluginJson(dir)
    const manifest = await loadPluginManifest(
      manifestPath,
      'fallback',
      'test@marketplace',
    )
    expect(manifest.name).toBe('bom-plugin')
  })

  test('validatePluginManifest accepts a BOM-prefixed plugin.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'plugin-bom-val-246-'))
    dirs.push(dir)
    const manifestPath = bomPluginJson(dir)
    const result = await validatePluginManifest(manifestPath)
    expect(result.success).toBe(true)
  })
})
