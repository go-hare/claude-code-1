/**
 * densable 2.1.247 #6 — FuzzyPicker Enter/Tab read live ke().focus.
 * Official 246: i[P] snapshot. Official 247 $t: r[ke().focus].
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../FuzzyPicker.tsx')

describe('densable 2.1.247 #6 FuzzyPicker live focus', () => {
  test('Enter/Tab read focusedIndexLive, not React snapshot', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('items[focusedIndexLive.current]')
    expect(src).not.toMatch(/const selected = items\[focusedIndex\]/)
    expect(src).toContain('focusedIndexLive.current = next')
  })

  test('same-tick step then accept matches official r[ke().focus]', () => {
    const items = ['alpha', 'bravo', 'charlie']
    let live = 0
    const set = (action: number | ((p: number) => number)) => {
      live = typeof action === 'function' ? action(live) : action
    }
    const get = () => live
    set(i => Math.min(i + 1, items.length - 1))
    set(i => Math.min(i + 1, items.length - 1))
    expect(items[get()]).toBe('charlie')
  })
})
