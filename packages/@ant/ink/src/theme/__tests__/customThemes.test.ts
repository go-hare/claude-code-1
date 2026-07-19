import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  _resetCustomThemesCacheForTesting,
  applyThemeOverrides,
  isValidThemeColor,
  loadCustomThemes,
  parseCustomThemeRef,
  customThemeRef,
  saveCustomTheme,
  setCustomThemesConfigDir,
  slugifyThemeName,
  uniqueThemeSlug,
  getCustomThemeBase,
} from '../customThemes.js'
import { getTheme } from '../theme-types.js'

describe('isValidThemeColor (densable JOe)', () => {
  test('accepts rgb / hex / ansi256 / ansi:name', () => {
    expect(isValidThemeColor('rgb(1,2,3)')).toBe(true)
    expect(isValidThemeColor('rgb(255, 128, 0)')).toBe(true)
    expect(isValidThemeColor('#ff00aa')).toBe(true)
    expect(isValidThemeColor('#f0a')).toBe(true)
    expect(isValidThemeColor('ansi256(42)')).toBe(true)
    expect(isValidThemeColor('ansi:red')).toBe(true)
  })
  test('rejects invalid', () => {
    expect(isValidThemeColor('red')).toBe(false)
    expect(isValidThemeColor('ansi:nope')).toBe(false)
    expect(isValidThemeColor('#gg')).toBe(false)
    expect(isValidThemeColor(1)).toBe(false)
  })
})

describe('applyThemeOverrides (densable Zqi)', () => {
  test('merges only known keys with valid colors', () => {
    const base = getTheme('dark')
    const merged = applyThemeOverrides(base, {
      claude: 'rgb(1,2,3)',
      // @ts-expect-error intentional bad key
      notAKey: 'rgb(1,2,3)',
      text: 'not-a-color',
    })
    expect(merged.claude).toBe('rgb(1,2,3)')
    expect(merged.text).toBe(base.text)
  })
  test('null overrides returns base', () => {
    const base = getTheme('light')
    expect(applyThemeOverrides(base, null)).toBe(base)
  })
})

describe('slugify / uniqueThemeSlug', () => {
  test('slugifyThemeName', () => {
    expect(slugifyThemeName('My Cool Theme!')).toBe('my-cool-theme')
    expect(slugifyThemeName('@@@')).toBe('theme')
  })
  test('uniqueThemeSlug appends -2', () => {
    expect(uniqueThemeSlug('Dark', [{ slug: 'dark' }])).toBe('dark-2')
    expect(
      uniqueThemeSlug('Dark', [{ slug: 'dark' }, { slug: 'dark-2' }]),
    ).toBe('dark-3')
  })
})

describe('customThemeRef / parseCustomThemeRef', () => {
  test('roundtrip', () => {
    expect(customThemeRef('ocean')).toBe('custom:ocean')
    expect(parseCustomThemeRef('custom:ocean')).toBe('ocean')
    expect(parseCustomThemeRef('dark')).toBe(null)
  })
})

describe('saveCustomTheme / loadCustomThemes', () => {
  let dir: string

  afterEach(async () => {
    _resetCustomThemesCacheForTesting()
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('writes and reloads user theme JSON', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-themes-'))
    setCustomThemesConfigDir(() => dir)
    await saveCustomTheme({
      slug: 'ocean',
      name: 'Ocean',
      base: 'dark',
      overrides: { claude: 'rgb(10,20,30)' },
    })
    const loaded = await loadCustomThemes()
    expect(loaded).toHaveLength(1)
    expect(loaded[0]!.slug).toBe('ocean')
    expect(loaded[0]!.name).toBe('Ocean')
    expect(loaded[0]!.overrides.claude).toBe('rgb(10,20,30)')
    expect(getCustomThemeBase('ocean')).toBe('dark')
  })

  test('skips invalid JSON and oversized files', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-themes-'))
    setCustomThemesConfigDir(() => dir)
    const themes = join(dir, 'themes')
    await mkdir(themes, { recursive: true })
    await writeFile(join(themes, 'bad.json'), '{not json', 'utf8')
    await writeFile(
      join(themes, 'ok.json'),
      JSON.stringify({ name: 'Ok', base: 'light', overrides: {} }),
      'utf8',
    )
    const loaded = await loadCustomThemes()
    expect(loaded.map(t => t.slug)).toEqual(['ok'])
  })

  test('save+reload keeps overrides after preview cleared (editor finish)', async () => {
    // Regression: CustomThemeEditor used to only setPreviewOverrides on edit;
    // clearing preview on exit dropped colors until full remount.
    dir = await mkdtemp(join(tmpdir(), 'cc-themes-'))
    setCustomThemesConfigDir(() => dir)
    const overrides = {
      claude: 'rgb(10,20,30)',
      text: '#00ff00',
    } as const
    await saveCustomTheme({
      slug: 'sticky',
      name: 'Sticky',
      base: 'dark',
      overrides: { ...overrides },
    })
    const loaded = await loadCustomThemes()
    const active = loaded.find(t => t.slug === 'sticky')
    expect(active).toBeDefined()
    const previewOverrides = null
    const resolved = applyThemeOverrides(
      getTheme('dark'),
      previewOverrides ?? active?.overrides,
    )
    expect(resolved.claude).toBe('rgb(10,20,30)')
    expect(resolved.text).toBe('#00ff00')
  })

  test('rejects path-like slugs', async () => {
    dir = await mkdtemp(join(tmpdir(), 'cc-themes-'))
    setCustomThemesConfigDir(() => dir)
    await expect(
      saveCustomTheme({
        slug: 'a/b',
        name: 'Bad',
        base: 'dark',
        overrides: {},
      }),
    ).rejects.toThrow(/Invalid theme slug/)
  })
})
