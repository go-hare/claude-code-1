/**
 * densable 2.1.216 #22 — XAu / r0e control-char gate for tool inputs
 * (PowerShell + Bash schema refine).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG,
  hasNoHiddenControlChars,
  isHiddenControlCode,
  replaceHiddenControlChars,
} from '../controlChars.js'

describe('controlChars densable XAu/r0e (2.1.216 #22)', () => {
  test('XAu allows TAB and LF', () => {
    expect(isHiddenControlCode(9)).toBe(false)
    expect(isHiddenControlCode(10)).toBe(false)
    expect(hasNoHiddenControlChars('echo\thi\nthere')).toBe(true)
  })

  test('XAu blocks C0 except TAB/LF (NUL, CR, BEL, ESC)', () => {
    expect(isHiddenControlCode(0)).toBe(true)
    expect(isHiddenControlCode(7)).toBe(true)
    expect(isHiddenControlCode(13)).toBe(true) // CR
    expect(isHiddenControlCode(27)).toBe(true) // ESC
    expect(hasNoHiddenControlChars('echo safe\x00; rm -rf /')).toBe(false)
    expect(hasNoHiddenControlChars('Write-Host hi\r\n')).toBe(false)
  })

  test('XAu blocks DEL and C1 (0x7F-0x9F)', () => {
    expect(isHiddenControlCode(0x7f)).toBe(true)
    expect(isHiddenControlCode(0x80)).toBe(true)
    expect(isHiddenControlCode(0x9f)).toBe(true)
    expect(hasNoHiddenControlChars(`x${String.fromCharCode(0x7f)}y`)).toBe(
      false,
    )
    expect(hasNoHiddenControlChars(`x${String.fromCharCode(0x9f)}y`)).toBe(
      false,
    )
  })

  test('XAu allows printable ASCII and non-ASCII text', () => {
    expect(isHiddenControlCode(0x20)).toBe(false)
    expect(isHiddenControlCode(0x7e)).toBe(false)
    expect(isHiddenControlCode(0xa0)).toBe(false)
    expect(hasNoHiddenControlChars('Get-ChildItem C:\\Users')).toBe(true)
    expect(hasNoHiddenControlChars('echo 中文 café')).toBe(true)
  })

  test('K_ replaces hidden controls with U+FFFD; 223 #5 TAB display', () => {
    expect(replaceHiddenControlChars('a\x00b\rc')).toBe('a\uFFFDb\uFFFDc')
    // densable 2.1.223 #5 — TAB visible so padding cannot hide command parts
    expect(replaceHiddenControlChars('ok\tline\n')).toBe('ok\u21E5line\n')
  })

  test('Wjg message string is densable gold', () => {
    expect(CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG).toBe(
      'command contains control characters that would be hidden in the approval dialog',
    )
  })

  test('PowerShell schema refine(r0e, Wjg) is wired', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/PowerShellTool/PowerShellTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('hasNoHiddenControlChars')
    expect(src).toContain('CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG')
    expect(src).toContain('refine(hasNoHiddenControlChars')
  })

  test('Bash schema refine(r0e, Ya_) is wired (densable parity)', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/BashTool/BashTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('hasNoHiddenControlChars')
    expect(src).toContain('CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG')
  })
})
