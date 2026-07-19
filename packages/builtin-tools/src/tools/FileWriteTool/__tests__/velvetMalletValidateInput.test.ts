/**
 * densable FileWrite validateInput residual — velvet_mallet +
 * tengu_write_tool_not_read_hypothetical anchors.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('FileWriteTool velvet_mallet densable nwg', () => {
  test('source anchors write_tool_not_read_hypothetical + nonconforming key', () => {
    const src = readFileSync(
      join(import.meta.dir, '../FileWriteTool.ts'),
      'utf8',
    )
    expect(src).toContain('tengu_write_tool_not_read_hypothetical')
    expect(src).toContain('modelScopedGrowthbookKey')
    expect(src).toContain('tengu_velvet_mallet')
    expect(src).toContain('guardSkipped')
    expect(src).toContain('isPartialView')
    expect(src).toContain('errorCode: 2')
    expect(src).toContain('File has not been read yet')
  })
})
