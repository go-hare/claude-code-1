/**
 * densable 2.1.247 #6 — /model uses CustomSelect getFocusedValue (235/246).
 * 247 Zr stores live focus on Qr() 3-tuple; getter is still ri(live, options).
 * CustomSelect was not rewritten (invent-ban / same getFocusedValue contract).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../ModelPicker.tsx')

describe('densable 2.1.247 #6 /model via CustomSelect', () => {
  test('ModelPicker still uses CustomSelect onChange', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('<Select')
    expect(src).toContain('onChange={handleSelect}')
  })
})
