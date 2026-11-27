/**
 * densable 2.1.289 — ui.render remount of the same Image key replaces
 * the mount; blit must not treat a later stub as success.
 */
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const HOOKS = join(import.meta.dir, '../functionHooksModules.ts')
const HOOKS_DIR = join(import.meta.dir, '../functionHooks')

describe('densable 2.1.289 Image mount replace', () => {
  test('walkUiMounts updates existing Image instead of adding another', () => {
    const src = [
      readFileSync(HOOKS, 'utf8'),
      ...readdirSync(HOOKS_DIR)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(HOOKS_DIR, f), 'utf8')),
    ].join('\n')
    expect(src).toContain('existingImageMount')
    expect(src).toContain('existingRasterMount')
    const walk = src.indexOf("if (type === 'Image' && key && req)")
    expect(walk).toBeGreaterThan(0)
    const body = src.slice(walk, walk + 900)
    expect(body).toContain('existingImageMount(owner, req, key)')
    expect(body).toContain('existing.columns = cols')
    expect(body).toContain('KITTY_PLACEHOLDER_MAX')
  })
})
