/**
 * densable residual — jkc call site before tengu_feature_ok / success.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable jkc file activity residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('imports emitFileActivityForToolSuccess', () => {
    expect(src).toContain('emitFileActivityForToolSuccess')
  })

  test('jkc call precedes feature_ok and tool_use_success', () => {
    const jkc = src.indexOf('emitFileActivityForToolSuccess(')
    const ok = src.indexOf("logEvent('tengu_feature_ok'")
    // prefer success near jkc (there may be multiple feature_ok)
    const success = src.indexOf("logEvent('tengu_tool_use_success'")
    expect(jkc).toBeGreaterThan(-1)
    expect(ok).toBeGreaterThan(-1)
    expect(success).toBeGreaterThan(-1)
    // find feature_ok after jkc
    const okAfter = src.indexOf("logEvent('tengu_feature_ok'", jkc)
    const successAfter = src.indexOf("logEvent('tengu_tool_use_success'", jkc)
    expect(okAfter).toBeGreaterThan(jkc)
    expect(successAfter).toBeGreaterThan(okAfter)
  })

  test('passes Edit/Write/NotebookEdit/Bash/PowerShell tool name map', () => {
    const jkc = src.indexOf('emitFileActivityForToolSuccess(')
    const window = src.slice(jkc, jkc + 700)
    for (const name of [
      'FILE_EDIT_TOOL_NAME',
      'FILE_WRITE_TOOL_NAME',
      'NOTEBOOK_EDIT_TOOL_NAME',
      'BASH_TOOL_NAME',
      'POWERSHELL_TOOL_NAME',
    ]) {
      expect(window).toContain(name)
    }
  })
})
