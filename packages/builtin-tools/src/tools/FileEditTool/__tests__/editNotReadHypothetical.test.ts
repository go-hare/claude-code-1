/**
 * densable residual anchors — Edit not_read / stale_read analytics.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('FileEditTool densable not_read / stale_read residual', () => {
  const src = readFileSync(join(import.meta.dir, '../FileEditTool.ts'), 'utf8')

  test('logs tengu_edit_tool_not_read_hypothetical with densable fields', () => {
    expect(src).toContain("logEvent('tengu_edit_tool_not_read_hypothetical'")
    for (const field of [
      'wouldHaveResult',
      'isPartialView',
      'isFilePathAbsolute',
      'guardSkipped',
      'modelBucket',
    ]) {
      expect(src).toContain(field)
    }
    expect(src).toContain('errorCode: 6')
    expect(src).toContain('File has not been read yet')
  })

  test('logs tengu_edit_tool_stale_read with wouldHaveResult + recovered', () => {
    expect(src).toContain("logEvent('tengu_edit_tool_stale_read'")
    expect(src).toContain('recovered')
    expect(src).toContain('errorCode: 7')
  })

  test('uses classifyEditApplyOutcome / Fyu helpers', () => {
    expect(src).toContain('classifyEditApplyOutcome')
    expect(src).toContain('editWouldHaveResultForAnalytics')
  })
})
