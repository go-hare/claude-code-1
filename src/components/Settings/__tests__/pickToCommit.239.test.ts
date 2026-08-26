/**
 * densable 2.1.239: pickToCommit enums open EnumPicker; left/right/tab call Mr
 * (toggle) and do not cycle onChange. Stream-level gold:
 *   if(Rn.type==="enum"&&Rn.pickToCommit){Fe(Rn.id),$e("EnumPicker"),r(!0);return}
 *   if(Rn.type==="enum"){ cycle Jt }
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const source = readFileSync(join(import.meta.dir, '../Config.tsx'), 'utf8')

describe('densable 2.1.239 pickToCommit EnumPicker', () => {
  test('only crossSessionInbound is pickToCommit', () => {
    expect([...source.matchAll(/pickToCommit:\s*true/g)]).toHaveLength(1)
    const inboundAt = source.indexOf("id: 'crossSessionInbound'")
    const expiryAt = source.indexOf("id: 'dialogExpiry'")
    expect(source.slice(inboundAt, inboundAt + 400)).toContain(
      'pickToCommit: true',
    )
    expect(source.slice(expiryAt, inboundAt)).not.toContain('pickToCommit')
  })

  test('toggle opens EnumPicker instead of cycling', () => {
    expect(source).toContain("setting.type === 'enum' && setting.pickToCommit")
    expect(source).toContain("setShowSubmenu('EnumPicker')")
    expect(source).toContain('setEnumPickerId(setting.id)')
  })

  test('EnumPicker commits via onChange after close (Nn then Jt)', () => {
    expect(source).toContain(
      "showSubmenu === 'EnumPicker' && enumPickerSetting",
    )
    expect(source).toContain('closeEnumPicker()')
    expect(source).toContain('enumPickerSetting.onChange(value)')
  })

  test('left/right/tab still call toggleSetting (official Dn → Mr)', () => {
    expect(source).toContain(
      "e.key === 'left' || e.key === 'right' || e.key === 'tab'",
    )
    const keys = source.indexOf(
      "e.key === 'left' || e.key === 'right' || e.key === 'tab'",
    )
    const toggle = source.indexOf('toggleSetting()', keys)
    expect(toggle).toBeGreaterThan(keys)
    expect(toggle - keys).toBeLessThan(200)
  })
})
