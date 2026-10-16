/**
 * densable 2.1.289 — SuggestBackgroundPR is d_e-removed (no BODY).
 * Never model-facing: isEnabled false; not registered in getAllBaseTools.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SuggestBackgroundPRTool } from '../SuggestBackgroundPRTool.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 SuggestBackgroundPR d_e cut', () => {
  test('isEnabled returns false (gold BODY absent)', () => {
    expect(SuggestBackgroundPRTool.isEnabled()).toBe(false)
    const src = readFileSync(
      join(__dirname, '..', 'SuggestBackgroundPRTool.ts'),
      'utf-8',
    )
    expect(src).toMatch(/isEnabled\(\)\s*\{\s*return false/)
  })

  test('getAllBaseTools does not register SuggestBackgroundPRTool', () => {
    const toolsSrc = readFileSync(
      join(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'tools.ts'),
      'utf-8',
    )
    expect(toolsSrc).not.toMatch(
      /SuggestBackgroundPRTool\s*\?\s*\[\s*SuggestBackgroundPRTool/,
    )
    expect(toolsSrc).toContain('SuggestBackgroundPR is d_e-removed')
  })

  test('call stub returns SuggestOutput only (no undeclared error)', async () => {
    const result = await SuggestBackgroundPRTool.call(
      { title: 't', description: 'd' },
      {} as never,
    )
    expect(result.data).toEqual({ suggested: false, suggestion_id: '' })
    expect(result.data).not.toHaveProperty('error')
  })
})
