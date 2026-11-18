import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  getBackdropRenderProps,
  getSessionTheme,
  getThemeRenderProps,
  resetSessionThemeForTests,
  retireFunctionHooksModule,
  runFunctionHookChain,
  setLoadedFunctionHooksModules,
} from '../functionHooksModules.js'

const ROOT = join(import.meta.dir, '../../../..')

async function runWithThemeHook(
  pluginName: string,
  fn: ($: any) => Promise<void>,
): Promise<void> {
  setLoadedFunctionHooksModules([
    {
      name: pluginName,
      patterns: ['session.start'],
      hooks: [
        {
          pattern: 'session.start',
          hook: async ($, event, next) => {
            await fn($)
            return next(event)
          },
        },
      ],
    },
  ])
  await runFunctionHookChain(
    'session.start',
    { source: 'startup' },
    async ev => ev,
  )
}

describe('v2.1.290 #4 $.theme.set / $.theme.clear / typings', () => {
  beforeEach(() => {
    setLoadedFunctionHooksModules([])
    resetSessionThemeForTests()
  })

  afterEach(() => {
    setLoadedFunctionHooksModules([])
    resetSessionThemeForTests()
  })

  test('claude-code.d.ts.txt exports ThemeKey, Color, theme.set, theme.clear, ThemeSetArgs', () => {
    const dts = readFileSync(
      join(
        ROOT,
        'src/skills/bundled/plugin-authoring/types/claude-code.d.ts.txt',
      ),
      'utf8',
    )
    expect(dts).toContain('export type ThemeKey =')
    expect(dts).toContain('export type Color = ThemeKey | (string & {})')
    expect(dts).toContain(
      'set: (attributes: ThemeSetArgs) => Promise<ThemeResult>',
    )
    expect(dts).toContain('clear: () => Promise<ThemeResult>')
    expect(
      existsSync(
        join(ROOT, 'src/skills/bundled/plugin-authoring/make-colors.js'),
      ),
    ).toBe(true)
    expect(
      existsSync(
        join(ROOT, 'src/skills/bundled/plugin-authoring/make-colors.d.ts'),
      ),
    ).toBe(true)
    expect(
      existsSync(
        join(ROOT, 'src/skills/bundled/plugin-authoring/examples/look.ts'),
      ),
    ).toBe(true)
    expect(
      existsSync(join(ROOT, 'src/skills/bundled/plugin-authoring/look.md')),
    ).toBe(true)
  })

  test('$.theme.set validates arguments 1:1 with official 325', async () => {
    await runWithThemeHook('theme-mod', async $ => {
      await expect($.theme.set('bad')).rejects.toThrow(
        'the argument is an object with any of backdrop, overrideColorScheme, colors',
      )
      await expect($.theme.set({})).rejects.toThrow(
        'theme.set needs at least one of backdrop, overrideColorScheme, colors; $.theme.clear() clears the theme',
      )
      await expect($.theme.set({ bogus: 1 })).rejects.toThrow(
        'theme.set does not know the attribute "bogus": this build takes backdrop, overrideColorScheme, colors',
      )
      await expect(
        $.theme.set({ overrideColorScheme: 'sepia' }),
      ).rejects.toThrow('overrideColorScheme is light or dark')
      await expect(
        $.theme.set({ colors: JSON.parse('{"__proto__": {}}') }),
      ).rejects.toThrow('colors may hold no key named')
      await expect(
        $.theme.set({ backdrop: { scene: 'bad scene!' } }),
      ).rejects.toThrow(
        'backdrop needs a scene: 1 to 64 of letters, digits, _ or -',
      )
      await expect(
        $.theme.set({ backdrop: { color: '#000', glass: { blur: 4 } } }),
      ).rejects.toThrow(
        'backdrop.glass is for a scene: a still ground has none',
      )
    })
  })

  test('$.theme.set stores theme & backdrop props, returns undrawn reason, and $.theme.clear clears', async () => {
    await runWithThemeHook('theme-mod', async $ => {
      const emptyClear = await $.theme.clear()
      expect(emptyClear).toEqual({
        isDrawn: false,
        reason: 'no theme stood, so nothing was cleared',
      })

      const setRes = await $.theme.set({
        backdrop: { scene: 'lagoon', glass: { blur: 12, opacity: 0.5 } },
        overrideColorScheme: 'dark',
      })
      expect(setRes).toEqual({
        isDrawn: false,
        requestId: 'backdrop',
        reason:
          'no attached desktop or mobile client draws themes yet; the theme stands and draws when one attaches',
      })
      expect(getSessionTheme()?.plugin).toBe('theme-mod')
      expect(getBackdropRenderProps('backdrop')).toEqual({
        scene: 'lagoon',
        plugin: 'theme-mod',
        glass: { blur: 12, opacity: 0.5 },
        overrideColorScheme: 'dark',
      })
      expect(getThemeRenderProps('theme')).toBeUndefined()

      const setColorsRes = await $.theme.set({
        colors: { label: 'Paper', light: { background: '#ffffff' } },
      })
      expect(setColorsRes.requestId).toBe('theme')
      expect(getThemeRenderProps('theme')).toEqual({
        plugin: 'theme-mod',
        colors: { label: 'Paper', light: { background: '#ffffff' } },
      })

      const clearRes = await $.theme.clear()
      expect(clearRes).toEqual({
        isDrawn: false,
        reason: 'the theme is cleared',
      })
      expect(getSessionTheme()).toBeUndefined()
    })
  })

  test('retiring owning plugin clears its session theme', async () => {
    await runWithThemeHook('theme-mod', async $ => {
      await $.theme.set({ overrideColorScheme: 'light' })
      expect(getSessionTheme()?.plugin).toBe('theme-mod')
    })

    await retireFunctionHooksModule('theme-mod')
    expect(getSessionTheme()).toBeUndefined()
  })
})
