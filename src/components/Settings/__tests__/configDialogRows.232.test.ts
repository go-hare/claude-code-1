/**
 * densable 2.1.232 #5 — /config Dialog expiry + Messages from other sessions rows.
 * Source-level locks for labels/options (Config.tsx is React-heavy).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const configPath = join(import.meta.dir, '../Config.tsx')
const source = readFileSync(configPath, 'utf8')

describe('densable 2.1.232 #5 /config dialog rows', () => {
  test('Dialog expiry label and densable l9p options', () => {
    expect(source).toContain("label: 'Dialog expiry'")
    expect(source).toContain("id: 'dialogExpiry'")
    expect(source).toContain("['default', '60s', '5m', '10m', 'never']")
    expect(source).toContain('tengu_dialog_expiry_changed')
  })

  test('Messages from your other sessions label and densable c9p options', () => {
    expect(source).toContain("label: 'Messages from your other sessions'")
    expect(source).toContain("id: 'crossSessionInbound'")
    expect(source).toContain("['default', 'accept', 'hold', 'refuse']")
    expect(source).toContain('tengu_cross_session_inbound_changed')
  })

  test('rDa managed-outside-user hide helper present', () => {
    expect(source).toContain('isConfigSettingManagedOutsideUser')
    expect(source).toContain('policySettings')
    expect(source).toContain('flagSettings')
  })

  test('crossSessionInboxRowVisible densable ig surface', () => {
    expect(source).toContain('isCrossSessionInboxConfigRowVisible')
    expect(source).toContain('CLAUDE_CODE_HARBOR_KITE')
    expect(source).toContain('tengu_harbor_kite')
  })
})
