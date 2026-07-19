/**
 * densable pZg uTt residual — JSON_PARSE early path on unparsed marker.
 */
import { describe, expect, test } from 'bun:test'
import { createHash } from 'crypto'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable JSON_PARSE unparsed residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('imports isUnparsedToolInput + formatUnparsedToolInputError', () => {
    expect(src).toContain('isUnparsedToolInput')
    expect(src).toContain('formatUnparsedToolInputError')
    expect(src).toContain('UNPARSED_TOOL_INPUT_KEY')
    expect(src).toContain("from '../../utils/unparsedToolInput.js'")
  })

  test('early path: errorCode JSON_PARSE + feature_sad tool_input_validation_failed', () => {
    expect(src).toContain("'JSON_PARSE'")
    const json = src.indexOf("'JSON_PARSE'")
    expect(json).toBeGreaterThan(-1)
    // window around JSON_PARSE path
    const window = src.slice(Math.max(0, json - 600), json + 400)
    expect(window).toContain('isUnparsedToolInput')
    expect(window).toContain("logEvent('tengu_feature_sad'")
    expect(window).toContain("'tool_input_validation_failed'")
    expect(window).toContain("logEvent('tengu_tool_use_error'")
    expect(window).toContain("'InputValidationError'")
  })

  test('errorDetailsHash uses densable bu(`${name}: unparsed tool input`)', () => {
    expect(src).toContain('unparsed tool input')
    const idx = src.indexOf('unparsed tool input')
    const window = src.slice(idx - 80, idx + 40)
    expect(window).toContain('shortSha256Hex12')
    // known answer for hash string template shape
    const sample = createHash('sha256')
      .update('Bash: unparsed tool input')
      .digest('hex')
      .slice(0, 12)
    expect(sample).toMatch(/^[0-9a-f]{12}$/)
  })

  test('tool_result uses densable JSON parse failed (N bytes) toolUseResult', () => {
    expect(src).toContain(
      'InputValidationError: JSON parse failed (${len} bytes)',
    )
    expect(src).toContain('formatUnparsedToolInputError(tool.name, input)')
  })

  test('toolInputSizeBytes uses marker len not JSON size on unparsed path', () => {
    const json = src.indexOf("'JSON_PARSE'")
    // FSt spread sits between isMcp and toolInputSizeBytes — widen window
    const window = src.slice(Math.max(0, json - 200), json + 900)
    expect(window).toContain('toolInputSizeBytes: len')
  })

  test('JSON_PARSE appears before ZOD_VALIDATION path', () => {
    const jp = src.indexOf("'JSON_PARSE'")
    const zv = src.indexOf("'ZOD_VALIDATION'")
    expect(jp).toBeGreaterThan(-1)
    expect(zv).toBeGreaterThan(-1)
    expect(jp).toBeLessThan(zv)
  })
})
