import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseCustomThemeJson,
  parseCustomThemeRef,
  resolveCustomThemeSetting,
} from '../customThemes.js'
import {
  CUSTOM_THEME_PREFIX,
  getTheme,
  isValidThemeColor,
  mergeThemeOverrides,
  setCustomThemeOverrides,
} from '../theme.js'

describe('densable 2.1.239 #27 ZGn custom theme', () => {
  afterEach(() => {
    setCustomThemeOverrides(undefined)
  })

  test('wNe accepts rgb / hex / ansi256 / ansi:name', () => {
    expect(isValidThemeColor('rgb(135,0,255)')).toBe(true)
    expect(isValidThemeColor('#8800ff')).toBe(true)
    expect(isValidThemeColor('#80f')).toBe(true)
    expect(isValidThemeColor('ansi256(93)')).toBe(true)
    expect(isValidThemeColor('ansi:magenta')).toBe(true)
    expect(isValidThemeColor('not-a-color')).toBe(false)
    expect(isValidThemeColor('ansi:nope')).toBe(false)
  })

  test('ZGn merges effortUltra onto the base theme', () => {
    const base = getTheme('dark')
    const merged = mergeThemeOverrides(base, {
      effortUltra: 'rgb(1,2,3)',
      notAKey: 'rgb(1,2,3)',
      claude: 'bad',
    })
    expect(merged.effortUltra).toBe('rgb(1,2,3)')
    expect(merged.claude).toBe(base.claude)
    expect(merged).not.toHaveProperty('notAKey')
  })

  test('e5 / HKa parse custom: slug and overrides', () => {
    expect(parseCustomThemeRef(`${CUSTOM_THEME_PREFIX}ocean`)).toBe('ocean')
    expect(parseCustomThemeRef('dark')).toBe(null)
    const parsed = parseCustomThemeJson(
      'ocean',
      JSON.stringify({
        name: 'Ocean',
        base: 'dark',
        overrides: { effortUltra: 'rgb(10,20,30)' },
      }),
    )
    expect(parsed?.slug).toBe('ocean')
    expect(parsed?.overrides.effortUltra).toBe('rgb(10,20,30)')
  })

  test('getTheme applies injected custom overrides (d$e)', () => {
    setCustomThemeOverrides({ effortUltra: 'rgb(9,9,9)' })
    expect(getTheme('dark').effortUltra).toBe('rgb(9,9,9)')
    setCustomThemeOverrides(undefined)
    expect(getTheme('dark').effortUltra).toBe('rgb(175,135,255)')
  })

  test('init awaits I8r loadCustomThemes before first d$e', () => {
    const init = readFileSync(
      join(import.meta.dir, '../../entrypoints/init.ts'),
      'utf8',
    )
    expect(init).toContain('await loadCustomThemes()')
    expect(init).toContain('setCustomThemeOverrides')
    expect(init).toContain('resolveCustomThemeSetting(getGlobalConfig().theme)')
  })

  test('resolveCustomThemeSetting falls back to dark for unknown slug', () => {
    expect(resolveCustomThemeSetting('custom:missing')).toEqual({
      base: 'dark',
    })
    expect(resolveCustomThemeSetting('light')).toEqual({ base: 'light' })
  })
})
