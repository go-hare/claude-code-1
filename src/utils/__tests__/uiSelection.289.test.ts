import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../plugins/functionHooksModules.ts')

describe('densable 2.1.289 $.ui.selection', () => {
  test('exposes selection on $ ui surface and hosts ui.selection', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain("hostOp(environmentId, 'ui.selection', [{}])")
    expect(src).toContain("op === 'ui.selection'")
    expect(src).toContain('function runUiSelection')
    expect(src).toContain('getSelectedText')
  })

  test('runUiSelection returns undefined for empty selection text', () => {
    const src = readFileSync(SRC, 'utf8')
    const start = src.indexOf('function runUiSelection')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 900)
    expect(body).toContain("text === ''")
    expect(body).toContain('return undefined')
    expect(body).toContain('selectionAnswer(text, requestId)')
    expect(body).toContain('getUiSelectionRowHolding')
  })

  test('wires densable requestId as product instance_id via rowHolding', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain("from './uiSelectionRowHolding.js'")
    expect(src).toContain('instance_id?: string')
  })
})
