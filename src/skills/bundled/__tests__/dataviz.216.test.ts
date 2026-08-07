/**
 * densable 2.1.216 #38 — dataviz default categorical palette reorder +
 * four-series direct-label / all-pairs cap guidance.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(import.meta.dir, '../datavizContent')

function read(rel: string): string {
  return readFileSync(join(root, rel), 'utf8')
}

/** densable 216 categorical light hex order (slot 1..8). */
const DENSABLE_LIGHT_ORDER = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const

const DENSABLE_CSV = DENSABLE_LIGHT_ORDER.join(',')

describe('dataviz 2.1.216 palette + series ladder', () => {
  test('palette.md categorical table uses densable slot order', () => {
    const md = read('references/palette.md')
    // Extract light hexes from the Slot table in document order
    const lights: string[] = []
    for (const line of md.split('\n')) {
      const m = line.match(
        /^\|\s*\d+\s*\|\s*\w+\s*\|\s*`?(#[0-9a-fA-F]{6})`?\s*\|/,
      )
      if (m) lights.push(m[1]!.toLowerCase())
    }
    expect(lights.slice(0, 8)).toEqual([...DENSABLE_LIGHT_ORDER])
    // orange is slot 2, not last
    expect(lights[1]).toBe('#eb6834')
    expect(lights[7]).toBe('#e34948')
  })

  test('palette.md four-series / all-pairs guidance', () => {
    const md = read('references/palette.md')
    expect(md).toContain('first three slots validate all-pairs')
    expect(md).toContain('yellow and orange')
    expect(md).toContain("next categorical slot's hue (orange)")
  })

  test('choosing-a-form series ladder row 4 is densable 216 copy', () => {
    const md = read('references/choosing-a-form.md')
    expect(md).toContain(
      'adjacent forms (stacks, bars, lines) stay gate-safe, but direct labels become mandatory',
    )
    expect(md).toContain('yellow and orange now share the screen')
    expect(md).toContain('cap at **three**')
    expect(md).not.toContain(
      'the CVD floor enters — direct labels become mandatory, not a courtesy',
    )
  })

  test('validator examples use densable hex CSV order', () => {
    const formula = read('references/color-formula.md')
    const js = read('scripts/validate_palette.js.txt')
    const py = read('scripts/validate_palette.py.txt')
    for (const body of [formula, js, py]) {
      expect(body).toContain(DENSABLE_CSV)
      expect(body).not.toContain(
        '#2a78d6,#1baf7a,#eda100,#008300,#4a3aa7,#e34948,#e87ba4,#eb6834',
      )
    }
  })
})
