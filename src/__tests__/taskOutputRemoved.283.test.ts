/**
 * densable 2.1.283 — TaskOutput removed from the live tool pool.
 * Residual TaskOutputTool directory may remain for legacy types; the model
 * must never see TaskOutput via getAllBaseTools() / getTools().
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { TASK_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskOutputTool/constants.js'
import { getEmptyToolPermissionContext } from '../Tool.js'
import { getAllBaseTools, getTools } from '../tools.js'

describe('densable 2.1.283 TaskOutput removal', () => {
  test('getAllBaseTools() does not include TaskOutput', () => {
    const names = getAllBaseTools().map(t => t.name)
    expect(names).not.toContain(TASK_OUTPUT_TOOL_NAME)
    expect(names).not.toContain('TaskOutput')
  })

  test('getTools() does not include TaskOutput', () => {
    const names = getTools(getEmptyToolPermissionContext()).map(t => t.name)
    expect(names).not.toContain(TASK_OUTPUT_TOOL_NAME)
    expect(names).not.toContain('TaskOutput')
  })

  test('tools.ts source does not list TaskOutputTool in getAllBaseTools', () => {
    const src = readFileSync(join(import.meta.dir, '../tools.ts'), 'utf8')
    const fn = src.slice(src.indexOf('export function getAllBaseTools'))
    const body = fn.slice(
      0,
      fn.indexOf('export function getTools') || fn.length,
    )
    expect(body).not.toMatch(/\bTaskOutputTool\b/)
    expect(src).not.toMatch(
      /import\s+\{\s*TaskOutputTool\s*\}\s+from\s+'@claude-code\/builtin-tools\/tools\/TaskOutputTool/,
    )
  })
})
