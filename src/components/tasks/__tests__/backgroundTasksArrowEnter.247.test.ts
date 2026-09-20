/**
 * densable 2.1.247 #6 — background list confirm:yes reads Ie[ce()], not Ce[N].
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const SRC = join(import.meta.dir, '../BackgroundTasksDialog.tsx')

describe('densable 2.1.247 #6 background tasks live index', () => {
  test('confirm:yes and keydown read selectedIndexLive', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('allSelectableItems[selectedIndexLive.current]')
    expect(src).not.toMatch(
      /const current = allSelectableItems\[selectedIndex\]/,
    )
  })

  test('same-tick next then accept matches official Ie[ce()]', () => {
    const Ie = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    let live = 0
    const ce = () => live
    const ue = (fn: (s: number) => number) => {
      live = fn(live)
    }
    ue(s => Math.min(Ie.length - 1, s + 1))
    expect(Ie[ce()]?.id).toBe('b')
  })
})
