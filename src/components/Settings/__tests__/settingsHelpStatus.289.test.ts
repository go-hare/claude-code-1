import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const settingsSrc = readFileSync(
  join(import.meta.dir, '../Settings.tsx'),
  'utf8',
)
const configSrc = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')
const statusSrc = readFileSync(join(import.meta.dir, '../Status.tsx'), 'utf8')
const statusUtilSrc = readFileSync(
  join(import.meta.dir, '../../../utils/status.tsx'),
  'utf8',
)

describe('densable 2.1.289 Settings pane', () => {
  test('tabs are Status / Config / Usage / Stats with Settings title', () => {
    expect(settingsSrc).toContain('title="Settings"')
    expect(settingsSrc).toContain('title="Status"')
    expect(settingsSrc).toContain('title="Config"')
    expect(settingsSrc).toContain('title="Usage"')
    expect(settingsSrc).toContain('title="Stats"')
    expect(settingsSrc).toContain('<Stats onClose={onClose} />')
  })

  test('ceded Esc while Config content owns it and while Stats is selected', () => {
    expect(settingsSrc).toContain("selectedTab === 'Config' && configOwnsEsc")
    expect(settingsSrc).toContain("selectedTab !== 'Stats'")
    expect(settingsSrc).toContain('Settings dialog dismissed')
  })
})

describe('densable 2.1.289 Config Esc/search', () => {
  test('owns Esc while header is unfocused (not only in search)', () => {
    expect(configSrc).toContain('const ownsEsc = !headerFocused')
    expect(configSrc).not.toContain(
      'const ownsEsc = isSearchMode && !headerFocused',
    )
  })

  test('first Esc in search clears then exits without closing the pane', () => {
    expect(configSrc).toContain("if (e.key === 'escape')")
    expect(configSrc).toContain('setSearchQuery')
    expect(configSrc).toContain('setIsSearchMode(false)')
    expect(configSrc).toContain("e.key === '/' ? '' : e.key")
  })
})

describe('densable 2.1.289 Status rows', () => {
  test('Auto mode server + System diagnostics heading', () => {
    expect(statusSrc).toContain('buildAutoModeServerProperties')
    expect(statusSrc).toContain('System diagnostics')
    expect(statusSrc).not.toContain('System Diagnostics')
  })

  test('status util has gold Dfo/Mfo labels', () => {
    expect(statusUtilSrc).toContain("label: 'Auto mode server'")
    expect(statusUtilSrc).toContain("label: 'Managed settings (remote)'")
    expect(statusUtilSrc).toContain("label: 'Organization policy'")
    expect(statusUtilSrc).toContain("'Enabled'")
    expect(statusUtilSrc).toContain("'Disabled'")
  })
})
