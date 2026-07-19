/**
 * densable eee wire residual — call sites strip outer fences before JSON parse.
 * Behavior only (no analytics).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { stripOuterMarkdownFences } from '../stripFencedCode.js'
import { safeParseJSON } from '../json.js'

describe('densable eee call-site wire', () => {
  test('teleport generateTitleAndBranch uses stripOuterMarkdownFences', () => {
    const src = readFileSync(join(import.meta.dir, '../teleport.tsx'), 'utf8')
    expect(src).toContain('stripOuterMarkdownFences')
    expect(src).toContain('safeParseJSON(stripOuterMarkdownFences')
  })

  test('sessionTitle generateSessionTitle uses stripOuterMarkdownFences', () => {
    const src = readFileSync(
      join(import.meta.dir, '../sessionTitle.ts'),
      'utf8',
    )
    expect(src).toContain('stripOuterMarkdownFences')
    expect(src).toContain('safeParseJSON(stripOuterMarkdownFences')
  })

  test('execPromptHook uses stripOuterMarkdownFences', () => {
    const src = readFileSync(
      join(import.meta.dir, '../hooks/execPromptHook.ts'),
      'utf8',
    )
    expect(src).toContain('stripOuterMarkdownFences')
    expect(src).toContain(
      'safeParseJSON(stripOuterMarkdownFences(fullResponse))',
    )
  })

  test('cli/up extractUpSection uses stripOuterMarkdownFences', () => {
    const src = readFileSync(join(import.meta.dir, '../../cli/up.ts'), 'utf8')
    expect(src).toContain('stripOuterMarkdownFences')
  })

  test('fenced JSON object parses after eee', () => {
    const fenced = '```json\n{"title":"hello","branch":"feat/x"}\n```'
    const parsed = safeParseJSON(stripOuterMarkdownFences(fenced))
    expect(parsed).toEqual({ title: 'hello', branch: 'feat/x' })
  })

  test('fenced bare JSON still works', () => {
    const fenced = '```\n{"ok":true}\n```'
    expect(safeParseJSON(stripOuterMarkdownFences(fenced))).toEqual({
      ok: true,
    })
  })
})
