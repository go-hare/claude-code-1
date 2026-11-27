import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../plugins/functionHooksModules.ts')
const SRC_DIR = join(import.meta.dir, '../plugins/functionHooks')

function readModulesSource(): string {
  return [
    readFileSync(SRC, 'utf8'),
    ...readdirSync(SRC_DIR)
      .filter(f => f.endsWith('.ts'))
      .sort()
      .map(f => readFileSync(join(SRC_DIR, f), 'utf8')),
  ].join('\n')
}

describe('densable 2.1.289 $.ui.selection', () => {
  test('exposes selection on $ ui surface and hosts ui.selection', () => {
    const src = readModulesSource()
    expect(src).toContain("hostOp(environmentId, 'ui.selection', [{}])")
    expect(src).toContain("op === 'ui.selection'")
    expect(src).toContain('function runUiSelection')
    expect(src).toContain('getSelectedText')
  })

  test('runUiSelection returns undefined for empty selection text', () => {
    const src = readModulesSource()
    const start = src.indexOf('function runUiSelection')
    expect(start).toBeGreaterThan(0)
    const body = src.slice(start, start + 900)
    expect(body).toContain("text === ''")
    expect(body).toContain('return undefined')
    expect(body).toContain('selectionAnswer(text, requestId)')
    expect(body).toContain('getUiSelectionRowHolding')
  })

  test('wires densable requestId as product instance_id via rowHolding', () => {
    const src = readModulesSource()
    expect(src).toContain("from '../uiSelectionRowHolding.js'")
    expect(src).toContain('instance_id?: string')
  })
})
