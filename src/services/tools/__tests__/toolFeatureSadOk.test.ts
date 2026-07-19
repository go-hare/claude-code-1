/**
 * densable #109 residual — We/Ee feature events on tool validation/success/catch:
 *   We(f,"tool_input_validation_failed") / We(f,"tool_validate_input_rejected")
 *   Ee(f) before tengu_tool_use_success
 *   me(_,"tool_unexpected_error") on non-abort catch
 *   errorCode ZOD_VALIDATION on zod fail path
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable feature_sad/ok residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('zod fail: feature_sad tool_input_validation_failed + ZOD_VALIDATION', () => {
    expect(src).toContain("logEvent('tengu_feature_sad'")
    expect(src).toContain("'tool_input_validation_failed'")
    expect(src).toContain("'ZOD_VALIDATION'")
    // order: sad before tool_use_error InputValidationError
    const sad = src.indexOf("'tool_input_validation_failed'")
    const err = src.indexOf("'InputValidationError'")
    expect(sad).toBeGreaterThan(-1)
    expect(err).toBeGreaterThan(-1)
    expect(sad).toBeLessThan(err)
  })

  test('validateInput reject: feature_sad tool_validate_input_rejected', () => {
    expect(src).toContain("'tool_validate_input_rejected'")
    const idx = src.indexOf("'tool_validate_input_rejected'")
    const window = src.slice(idx - 200, idx + 200)
    expect(window).toContain("logEvent('tengu_feature_sad'")
  })

  test('success: feature_ok before tengu_tool_use_success', () => {
    expect(src).toContain("logEvent('tengu_feature_ok'")
    const ok = src.indexOf("logEvent('tengu_feature_ok'")
    const success = src.indexOf("logEvent('tengu_tool_use_success'")
    expect(ok).toBeGreaterThan(-1)
    expect(success).toBeGreaterThan(-1)
    expect(ok).toBeLessThan(success)
  })

  test('catch non-abort: feature_bad tool_unexpected_error + isAbortError guard', () => {
    expect(src).toContain("'tool_unexpected_error'")
    expect(src).toContain('isAbortError')
    const idx = src.indexOf("'tool_unexpected_error'")
    const window = src.slice(idx - 250, idx + 80)
    expect(window).toContain("logEvent('tengu_feature_bad'")
    expect(window).toContain('!isAbortError')
  })

  test('uses toolFeatureNameForAnalytics (densable SIt/f)', () => {
    // densable: f=SIt(e.name) once early, reused for We/Ee; outer catch may
    // recompute. Local: featureName const in checkPermissionsAndCallTool +
    // outer unexpected-error path.
    expect(src).toContain('toolFeatureNameForAnalytics(')
    expect(src).toContain(
      'const featureName = toolFeatureNameForAnalytics(tool.name)',
    )
    expect(src).toContain('feature_name: featureName')
    const count = (
      src.match(/toolFeatureNameForAnalytics\(/g) ?? []
    ).length
    expect(count).toBeGreaterThanOrEqual(2)
  })

  test('ZOD_VALIDATION path includes densable zodIssueCodes + errorDetailsHash', () => {
    expect(src).toContain('zodIssueCodes')
    expect(src).toContain('errorDetailsHash')
    expect(src).toContain('uniqueJoin')
    expect(src).toContain('shortSha256Hex12')
    const zod = src.indexOf("'ZOD_VALIDATION'")
    const window = src.slice(zod, zod + 500)
    expect(window).toContain('zodIssueCodes')
    expect(window).toContain('errorDetailsHash')
  })

  test('validateInput path uses ValidateInputError + error_message_hash', () => {
    expect(src).toContain("'ValidateInputError'")
    expect(src).toContain('error_message_hash')
    expect(src).toContain('hashErrorMessageForAnalytics')
    const idx = src.indexOf("'ValidateInputError'")
    const window = src.slice(idx - 120, idx + 280)
    expect(window).toContain('error_message_hash')
    // free-text message stays on tool_result content, not error field
    expect(window).not.toContain('isValidCall.message as AnalyticsMetadata')
  })
})
