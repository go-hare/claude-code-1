/**
 * densable 2.1.289 plugin list Read from: / dkt sibling plugin.json.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const HANDLERS = join(import.meta.dir, '../handlers/plugins.ts')

describe('densable 2.1.289 plugin list Read from / validate sibling', () => {
  test('human list prints Read from: for directory marketplace', () => {
    const src = readFileSync(HANDLERS, 'utf8')
    expect(src).toContain('loadKnownMarketplacesConfigSafe')
    expect(src).toContain('Read from:')
    expect(src).toContain("source?.source === 'directory'")
    expect(src).toContain("source?.source === 'file'")
    expect(src).toContain('loaded?.manifest.version')
  })

  test('plugin validate still validates sibling plugin.json at marketplace root', () => {
    const src = readFileSync(HANDLERS, 'utf8')
    expect(src).toContain('validatePluginManifest')
    expect(src).toContain("join(manifestDir, 'plugin.json')")
    expect(src).toContain('resolve(manifestPath) === marketplaceRoot')
    expect(src).toContain('dirty')
  })
})
