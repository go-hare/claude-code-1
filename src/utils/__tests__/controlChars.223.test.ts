/**
 * densable 2.1.223 #5 — tab / invisible Unicode cannot hide commands in
 * approval dialogs.
 *
 * SEA: schema `eHe` = C0/C1 only (TAB/LF allowed); display `Jg`/`DRd` replaces
 * bidi + controls (+ local TAB→⇥ / zero-width) so the prompt cannot hide text.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG,
  hasNoHiddenControlChars,
  isApprovalHidingCode,
  isBidiControlCode,
  isInvisibleFormatCode,
  replaceHiddenControlChars,
} from '../controlChars.js'

describe('densable 2.1.223 #5 invisible Unicode + TAB display', () => {
  test('schema eHe still allows TAB/LF and printable text', () => {
    expect(hasNoHiddenControlChars('echo\thi\nthere')).toBe(true)
    expect(hasNoHiddenControlChars('echo 中文 café')).toBe(true)
  })

  test('schema eHe does not reject zero-width / bidi (display-only in densable)', () => {
    const zwsp = `echo${String.fromCharCode(0x200b)}safe`
    const rlo = `echo${String.fromCharCode(0x202e)}saf`
    // densable: eHe only uses xRd (C0/C1). Invisible format is Jg display path.
    expect(hasNoHiddenControlChars(zwsp)).toBe(true)
    expect(hasNoHiddenControlChars(rlo)).toBe(true)
    expect(hasNoHiddenControlChars('echo safe\x00; rm')).toBe(false)
  })

  test('IRd / invisible format classifiers', () => {
    expect(isBidiControlCode(0x202e)).toBe(true)
    expect(isBidiControlCode(0x2066)).toBe(true)
    expect(isBidiControlCode(0x061c)).toBe(true)
    expect(isInvisibleFormatCode(0x200b)).toBe(true)
    expect(isInvisibleFormatCode(0xfeff)).toBe(true)
    expect(isApprovalHidingCode(9)).toBe(true) // display TAB
    expect(isApprovalHidingCode(10)).toBe(false)
  })

  test('display maps TAB to U+21E5 and invisibles/bidi to U+FFFD', () => {
    expect(replaceHiddenControlChars('a\tb')).toBe('a⇥b')
    expect(replaceHiddenControlChars(`a${String.fromCharCode(0x200b)}b`)).toBe(
      'a�b',
    )
    expect(replaceHiddenControlChars(`a${String.fromCharCode(0x202e)}b`)).toBe(
      'a�b',
    )
    expect(replaceHiddenControlChars(`${String.fromCharCode(0xfeff)}x`)).toBe(
      '�x',
    )
    expect(replaceHiddenControlChars('a\x00b')).toBe('a�b')
    // LF preserved for multi-line commands
    expect(replaceHiddenControlChars('line1\nline2')).toBe('line1\nline2')
  })

  test('display preserves non-BMP emoji (code-point walk like densable DRd)', () => {
    // SEA DRd: for-of + codePointAt — paired surrogates are not tgy.
    expect(replaceHiddenControlChars('echo 😀 safe')).toBe('echo 😀 safe')
    expect(replaceHiddenControlChars('中文 café')).toBe('中文 café')
    // True lone high surrogate still → U+FFFD
    expect(replaceHiddenControlChars(`x${String.fromCharCode(0xd800)}y`)).toBe(
      'x�y',
    )
  })

  test('gold approval-dialog message unchanged', () => {
    expect(CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG).toBe(
      'command contains control characters that would be hidden in the approval dialog',
    )
  })

  test('Bash/PowerShell UI wire replaceHiddenControlChars for permission display', () => {
    const bashUi = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/BashTool/UI.tsx',
      ),
      'utf8',
    )
    const psUi = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/PowerShellTool/UI.tsx',
      ),
      'utf8',
    )
    expect(bashUi).toContain('replaceHiddenControlChars')
    expect(psUi).toContain('replaceHiddenControlChars')
  })

  test('Monitor schema eHe + permission UI Jg display (densable gold)', () => {
    const monitor = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/MonitorTool/MonitorTool.tsx',
      ),
      'utf8',
    )
    const monitorUi = readFileSync(
      join(
        import.meta.dir,
        '../../components/permissions/MonitorPermissionRequest/MonitorPermissionRequest.tsx',
      ),
      'utf8',
    )
    expect(monitor).toContain('hasNoHiddenControlChars')
    expect(monitor).toContain('CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG')
    expect(monitorUi).toContain('replaceHiddenControlChars')
  })
})
