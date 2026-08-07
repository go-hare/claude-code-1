/**
 * densable 2.1.216 #22 — PowerShell inputSchema rejects hidden control chars
 * via refine(r0e, Wjg).
 */
import { describe, expect, test } from 'bun:test'
import { CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG } from 'src/utils/controlChars.js'
import { PowerShellTool } from '../PowerShellTool.js'

describe('PowerShellTool inputSchema control chars (2.1.216 #22)', () => {
  test('accepts normal command with TAB/LF', () => {
    const r = PowerShellTool.inputSchema.safeParse({
      command: 'Get-ChildItem\n-Path .\t',
    })
    expect(r.success).toBe(true)
  })

  test('accepts non-ASCII command text', () => {
    const r = PowerShellTool.inputSchema.safeParse({
      command: 'Write-Host "你好"',
    })
    expect(r.success).toBe(true)
  })

  test('rejects NUL in command with densable Wjg message', () => {
    const r = PowerShellTool.inputSchema.safeParse({
      command: 'echo safe\x00; Remove-Item -Recurse C:\\',
    })
    expect(r.success).toBe(false)
    if (r.success) return
    const msgs = r.error.issues.map(i => i.message)
    expect(msgs.some(m => m === CONTROL_CHARS_HIDDEN_IN_APPROVAL_MSG)).toBe(
      true,
    )
  })

  test('rejects CR and DEL', () => {
    expect(
      PowerShellTool.inputSchema.safeParse({
        command: 'Get-Process\r',
      }).success,
    ).toBe(false)
    expect(
      PowerShellTool.inputSchema.safeParse({
        command: `Get-Process${String.fromCharCode(0x7f)}`,
      }).success,
    ).toBe(false)
  })
})
