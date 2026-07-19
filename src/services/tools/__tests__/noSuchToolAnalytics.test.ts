/**
 * densable unknown-tool analytics residual (#106):
 *   me(SIt(i),"tool_not_found") → tengu_feature_bad
 *   errorCode:Ie("NO_SUCH_TOOL") on tengu_tool_use_error
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('unknown-tool analytics densable NO_SUCH_TOOL', () => {
  const toolExecutionSrc = readFileSync(
    join(import.meta.dir, '../toolExecution.ts'),
    'utf8',
  )

  test('runToolUse unknown path logs tengu_feature_bad tool_not_found', () => {
    expect(toolExecutionSrc).toContain("logEvent('tengu_feature_bad'")
    expect(toolExecutionSrc).toContain('toolFeatureNameForAnalytics')
    expect(toolExecutionSrc).toContain(
      "'tool_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS",
    )
  })

  test('runToolUse unknown path logs errorCode NO_SUCH_TOOL', () => {
    // densable: errorCode:Ie("NO_SUCH_TOOL")
    expect(toolExecutionSrc).toMatch(
      /errorCode:\s*\n?\s*'NO_SUCH_TOOL' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS/,
    )
    // Must appear on the No such tool available branch
    const idx = toolExecutionSrc.indexOf('No such tool available:')
    expect(idx).toBeGreaterThan(-1)
    const window = toolExecutionSrc.slice(idx - 400, idx + 200)
    expect(window).toContain('NO_SUCH_TOOL')
    expect(window).toContain('tengu_feature_bad')
  })

  test('order: feature_bad before tool_use_error (densable me then M)', () => {
    const bad = toolExecutionSrc.indexOf("logEvent('tengu_feature_bad'")
    const err = toolExecutionSrc.indexOf(
      "logEvent('tengu_tool_use_error', {\n      error:\n        `No such tool available:",
    )
    expect(bad).toBeGreaterThan(-1)
    expect(err).toBeGreaterThan(-1)
    expect(bad).toBeLessThan(err)
  })
})
