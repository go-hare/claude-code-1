import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * Sticky paint must drop leftover virtual-range clamp before drawing.
 * useVirtualScroll clears clamp in useLayoutEffect; Ink can paint sticky
 * follow / alreadySticky scrollToBottom before that effect — leftover
 * [min,max] from a scrolled-up range paints into topSpacer (empty
 * transcript, logo at y=0, isSticky still true so no Jump-to-bottom pill).
 */
describe('render-node-to-output sticky virtual-range clamp skip', () => {
  test('source: liveSticky clears clamp then applyVirtualScrollRangeClamp', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../render-node-to-output.ts'),
    ).text()
    expect(src).toMatch(/applyVirtualScrollRangeClamp/)
    const idx = src.indexOf('const liveSticky = node.stickyScroll')
    expect(idx).toBeGreaterThan(0)
    const applyIdx = src.indexOf('applyVirtualScrollRangeClamp(', idx)
    expect(applyIdx).toBeGreaterThan(idx)
    const slice = src.slice(idx, applyIdx + 200)
    expect(slice).toMatch(/if \(liveSticky\)/)
    expect(slice).toMatch(/node\.scrollClampMin = undefined/)
    expect(slice).toMatch(/node\.scrollClampMax = undefined/)
    expect(slice).toMatch(/applyVirtualScrollRangeClamp\(/)
    expect(slice).toMatch(/liveSticky/)
  })
})
