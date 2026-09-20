/**
 * densable 2.1.247 #6 — history search delegates Enter to FuzzyPicker $t.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../HistorySearchDialog.tsx')

describe('densable 2.1.247 #6 history search via FuzzyPicker', () => {
  test('HistorySearchDialog still delegates Enter to FuzzyPicker', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('<FuzzyPicker')
    expect(src).toContain('onSelect={item =>')
  })
})
