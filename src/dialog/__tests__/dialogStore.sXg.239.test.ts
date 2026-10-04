/**
 * densable sXg — enterprise managed-settings requester is product-cut.
 */
import { describe, expect, test } from 'bun:test'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable sXg product-cut', () => {
  test('managed-settings security spec and installer are gone', () => {
    expect(
      existsSync(join(import.meta.dir, '../specs/managedSettingsSecurity.ts')),
    ).toBe(false)
    const src = readFileSync(join(import.meta.dir, '../index.ts'), 'utf8')
    expect(src).not.toContain('installManagedSettingsSxg')
    expect(src).not.toContain('MANAGED_SETTINGS_SECURITY_KIND')
    expect(src).not.toContain('isManagedSettingsSecurityDialog')
  })
})
