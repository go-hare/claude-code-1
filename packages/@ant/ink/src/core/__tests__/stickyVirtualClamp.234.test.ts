import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * Gold densable 2.1.251: `cn = un && !yt ? clamp(et) : et`.
 * Sticky skips APPLY of leftover virtual-range clamp (so sticky follow
 * does not paint into topSpacer) but MUST NOT delete scrollClampMin/Max —
 * the next unsticky wheel frame still needs those bounds until React
 * rewrites them in useLayoutEffect.
 */
describe('render-node-to-output sticky virtual-range clamp skip', () => {
  test('source: liveSticky skips apply, does not clear clamp fields', async () => {
    const src = await Bun.file(
      join(import.meta.dir, '../render-node-to-output.ts'),
    ).text()
    expect(src).toMatch(/applyVirtualScrollRangeClamp/)
    const idx = src.indexOf('const liveSticky = node.stickyScroll')
    expect(idx).toBeGreaterThan(0)
    const applyIdx = src.indexOf('applyVirtualScrollRangeClamp(', idx)
    expect(applyIdx).toBeGreaterThan(idx)
    const slice = src.slice(idx, applyIdx + 250)
    expect(slice).not.toMatch(/node\.scrollClampMin = undefined/)
    expect(slice).not.toMatch(/node\.scrollClampMax = undefined/)
    expect(slice).toMatch(/applyVirtualScrollRangeClamp\(/)
    expect(slice).toMatch(/liveSticky/)
  })
})
