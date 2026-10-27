import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (rel: string) =>
  readFileSync(join(import.meta.dir, '..', '..', rel), 'utf8')

describe('densable 2.1.289 Yo("theme","dark") / W2("theme")', () => {
  test('settings win, legacy GlobalConfig.theme only when non-default', () => {
    const src = read('utils/themeSetting.ts')
    const fn = src.slice(src.indexOf('export function getThemeSetting'))
    expect(fn.indexOf('getInitialSettings().theme')).toBeLessThan(
      fn.indexOf('getGlobalConfig().theme'),
    )
    expect(fn).toContain('if (legacy !== DEFAULT_THEME_SETTING)')
    expect(src).toContain("const DEFAULT_THEME_SETTING: ThemeSetting = 'dark'")
    expect(src).toContain(
      "updateSettingsForSource('userSettings', { theme: setting })",
    )
  })

  test('no theme read/write goes straight to GlobalConfig', () => {
    for (const rel of [
      'components/App.tsx',
      'interactiveHelpers.tsx',
      'screens/AgentView.tsx',
      'entrypoints/init.ts',
      'QueryEngine.ts',
      'components/LogoV2/LogoV2.tsx',
      'components/Stats.tsx',
      'components/FastIcon.tsx',
      'components/PromptInput/PromptInput.tsx',
    ]) {
      const src = read(rel)
      expect(src).not.toContain('getGlobalConfig().theme')
      expect(src).not.toContain('...current, theme: setting')
    }
  })
})
