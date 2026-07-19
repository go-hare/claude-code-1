/**
 * densable FSt residual — agentContext spread on tengu_tool_use_error sites.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable FSt agentContext residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('imports agentContextForToolAnalytics densable FSt', () => {
    expect(src).toContain('agentContextForToolAnalytics')
    expect(src).toContain("from '../../utils/agentContext.js'")
  })

  test('six densable FSt spreads on tool_use_error', () => {
    // densable: NO_SUCH_TOOL, JSON_PARSE, ZOD_VALIDATION, ValidateInputError,
    // PERMISSION_UPDATED_INPUT, catch unexpected
    const spreads = src.match(/\.\.\.agentContextForToolAnalytics\(\)/g) ?? []
    expect(spreads.length).toBeGreaterThanOrEqual(6)
  })

  function windowHasFSt(marker: string, before = 80, after = 900): void {
    const idx = src.indexOf(marker)
    expect(idx).toBeGreaterThan(-1)
    expect(src.slice(Math.max(0, idx - before), idx + after)).toContain(
      'agentContextForToolAnalytics',
    )
  }

  test('NO_SUCH_TOOL path has FSt', () => {
    windowHasFSt("'NO_SUCH_TOOL'")
  })

  test('JSON_PARSE path has FSt', () => {
    windowHasFSt("'JSON_PARSE'")
  })

  test('ZOD_VALIDATION path has FSt', () => {
    windowHasFSt("'ZOD_VALIDATION'")
  })

  test('ValidateInputError path has FSt', () => {
    windowHasFSt("'ValidateInputError'")
  })

  test('PERMISSION_UPDATED_INPUT path has FSt', () => {
    windowHasFSt("'PERMISSION_UPDATED_INPUT'")
  })

  test('catch classifyToolError path has FSt', () => {
    // first classifyToolError is the export def; use last call site
    const callSite = src.lastIndexOf('classifyToolError(')
    expect(callSite).toBeGreaterThan(-1)
    // PC field casts expand the window between classify and FSt spread
    const window = src.slice(callSite - 400, callSite + 1800)
    expect(window).toContain('tengu_tool_use_error')
    expect(window).toContain('agentContextForToolAnalytics')
  })
})
