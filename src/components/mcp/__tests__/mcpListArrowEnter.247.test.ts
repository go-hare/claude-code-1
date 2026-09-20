/**
 * densable 2.1.247 #6 — /mcp confirm:yes reads he[B()], not W[O].
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../MCPListPanel.tsx')

describe('densable 2.1.247 #6 MCP list live index', () => {
  test('handleSelect reads selectedIndexLive, not closed-over selectedIndex', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('selectableItems[selectedIndexLive.current]')
    expect(src).not.toMatch(/const item = selectableItems\[selectedIndex\]/)
  })

  test('same-tick next then accept matches official he[B()]', () => {
    const he = ['a', 'b', 'c']
    let live = 0
    const B = () => live
    const R = (fn: (s: number) => number) => {
      live = fn(live)
    }
    R(s => (s === he.length - 1 ? 0 : s + 1))
    expect(he[B()]).toBe('b')
  })
})
