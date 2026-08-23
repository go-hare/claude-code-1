import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { GLOBAL_CONFIG_KEYS, resolveAutoScrollEnabled } from '../config.js'

describe('autoScrollEnabled (densable sp default true)', () => {
  test('resolve: settings false wins over global true', () => {
    expect(resolveAutoScrollEnabled(false, true)).toBe(false)
  })

  test('resolve: settings true wins over global false', () => {
    expect(resolveAutoScrollEnabled(true, false)).toBe(true)
  })

  test('resolve: absent settings falls back to global', () => {
    expect(resolveAutoScrollEnabled(undefined, false)).toBe(false)
    expect(resolveAutoScrollEnabled(undefined, true)).toBe(true)
  })

  test('resolve: both absent → true (SEA default !0)', () => {
    expect(resolveAutoScrollEnabled(undefined, undefined)).toBe(true)
  })

  test('GLOBAL_CONFIG_KEYS includes autoScrollEnabled after autoCompactEnabled', () => {
    const compact = GLOBAL_CONFIG_KEYS.indexOf('autoCompactEnabled')
    const scroll = GLOBAL_CONFIG_KEYS.indexOf('autoScrollEnabled')
    expect(compact).toBeGreaterThanOrEqual(0)
    expect(scroll).toBe(compact + 1)
  })

  test('settings schema describe is SEA verbatim', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../settings/types.ts'),
    ).text()
    expect(src).toContain(
      'Auto-scroll the conversation view to bottom (fullscreen mode only)',
    )
    expect(src).toMatch(/autoScrollEnabled:\s*z/)
  })

  test('Config UI dual-writes settings + global (fullscreen)', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../../components/Settings/Config.tsx'),
    ).text()
    const idx = src.indexOf("id: 'autoScroll'")
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1200)
    expect(slice).toMatch(/label: 'Auto-scroll'/)
    expect(slice).toMatch(/updateSettingsForSource\('userSettings'/)
    expect(slice).toMatch(/saveGlobalConfig/)
    expect(slice).toMatch(/autoScrollEnabled/)
  })

  test('formattedChanges emits Enabled/Disabled auto-scroll after auto-compact', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../../components/Settings/Config.tsx'),
    ).text()
    const compact = src.indexOf("Disabled'} auto-compact")
    const scroll = src.indexOf("Disabled'} auto-scroll")
    expect(compact).toBeGreaterThan(0)
    expect(scroll).toBeGreaterThan(compact)
  })

  test('ConfigTool supportedSettings lists autoScrollEnabled as global boolean', async () => {
    const src = await Bun.file(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/ConfigTool/supportedSettings.ts',
      ),
    ).text()
    expect(src).toMatch(/autoScrollEnabled:\s*\{/)
    expect(src).toMatch(/source: 'global'/)
    expect(src).toContain(
      'Auto-scroll the conversation view to bottom (fullscreen mode only)',
    )
  })
})
