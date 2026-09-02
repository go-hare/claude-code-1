/**
 * densable 2.1.239 Jr / maple-sundial pointer:
 *   Jr = Pe && managedEnum && id==="showExternalIncludesDialog" && w
 *   toggle Jr → phn(false, "config_toggle") + T(false)
 *   pointer: Pe && (enum+pickToCommit || managedEnum && !Jr && autoUpdates exception)
 * U_c catalog sort is `sortConfigCatalog` on settingsItems.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')

describe('densable 2.1.239 maple-sundial Jr', () => {
  test('Jr is maple + managedEnum showExternalIncludesDialog + approved', () => {
    expect(source).toContain('isMapleJrExternalIncludes')
    expect(source).toContain("setting.type === 'managedEnum'")
    expect(source).toContain("setting.id === 'showExternalIncludesDialog'")
    expect(source).toContain('externalIncludesApproved')
    expect(source).toContain('hasClaudeMdExternalIncludesApproved === true')
  })

  test('Jr toggle records decline then clears w (no ExternalIncludes submenu)', () => {
    const jr = source.indexOf('isMapleJrExternalIncludes(setting)')
    const submenu = source.indexOf("setShowSubmenu('ExternalIncludes')")
    expect(jr).toBeGreaterThan(-1)
    expect(submenu).toBeGreaterThan(jr)
    expect(source).toContain(
      "recordExternalIncludesDecision(false, 'config_toggle', context)",
    )
    expect(source).toContain('setExternalIncludesApproved(false)')
  })

  test('pointer covers pickToCommit enums and non-Jr managedEnums', () => {
    expect(source).toContain(
      "setting.type === 'enum' && setting.pickToCommit === true",
    )
    expect(source).toContain("setting.type === 'managedEnum'")
    expect(source).toContain('!isMapleJrExternalIncludes(setting)')
    expect(source).toContain("setting.id !== 'autoUpdatesChannel'")
    expect(source).toContain('autoUpdaterDisabledReason !== null')
    expect(source).toContain("autoUpdatesChannel ?? 'latest') === 'latest'")
  })

  test('U_c sorts the existing settingsItems list', () => {
    expect(source).toContain('sortConfigCatalog')
    expect(source).toContain(
      'const settingsItems: Setting[] = sortConfigCatalog([',
    )
    expect(source).toContain('function F(patch: SettingsJson)')
    expect(source).toContain('function B<K extends keyof SettingsJson>')
    expect(source).toContain('function W(updater: (current: GlobalConfig)')
  })
})
