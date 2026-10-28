import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../ThemePicker.tsx'), 'utf8')
const themeCmd = readFileSync(
  join(import.meta.dir, '../../commands/theme/theme.tsx'),
  'utf8',
)

describe('densable 2.1.289 ThemePicker', () => {
  test('options are unnumbered and current theme is marked before the name', () => {
    expect(src).toContain('hideIndexes')
    expect(src).toContain('figures.tick')
    expect(src).toContain('value === themeSetting ? `${figures.tick} ${label}`')
  })

  test('lists New custom theme… when onCustomTheme is set', () => {
    expect(src).toContain('New custom theme…')
    expect(src).toContain('onCustomTheme')
    expect(themeCmd).toContain('onCustomTheme=')
  })

  test('gold labels including Auto and ANSI / colorblind variants', () => {
    expect(src).toContain("label: 'Auto (match terminal)'")
    expect(src).toContain("label: 'Dark mode'")
    expect(src).toContain("label: 'Light mode'")
    expect(src).toContain("label: 'Dark mode (colorblind-friendly)'")
    expect(src).toContain("label: 'Light mode (colorblind-friendly)'")
    expect(src).toContain("label: 'Dark mode (ANSI colors only)'")
    expect(src).toContain("label: 'Light mode (ANSI colors only)'")
  })
})
