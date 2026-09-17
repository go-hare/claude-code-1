/**
 * densable 2.1.246 #4/#6 — resize freeze abort (official `rg`).
 *
 * Holding the pre-resize mid-list range through jump-to-bottom or a
 * tail-identity change blanks the transcript until the next keypress
 * and can leave jump-to-bottom stuck mid-list via slide-cap.
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const HOOK = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../useVirtualScroll.ts',
)

describe('densable 2.1.246 #4/#6 rg freeze abort', () => {
  test('source: item-tail F aborts freeze and drops pinned range', async () => {
    const src = await Bun.file(HOOK).text()
    expect(src).toMatch(/itemTailRef\s*=\s*useRef/)
    expect(src).toMatch(/itemTailRef\.current\.count\s*!==\s*itemKeys\.length/)
    expect(src).toMatch(
      /itemTailRef\.current\.lastKey\s*!==\s*itemKeys\.at\(-1\)/,
    )
    expect(src).toMatch(
      /if\s*\(\s*freezeRendersRef\.current\s*>\s*0\s*&&\s*itemTailChanged\s*\)/,
    )
    expect(src).toMatch(
      /if\s*\(\s*itemTailChanged\s*\)\s*\{\s*prevRangeRef\.current\s*=\s*null/,
    )
  })

  test('source: sticky flip or large unpinned scroll aborts freeze', async () => {
    const src = await Bun.file(HOOK).text()
    expect(src).toMatch(/freezeAnchorRef\s*=\s*useRef/)
    expect(src).toMatch(
      /freezeAnchorRef\.current\s*=\s*lastRangeAnchorRef\.current/,
    )
    expect(src).toMatch(/freezeAnchor\.sticky\s*!==\s*isSticky/)
    expect(src).toMatch(/Math\.max\(\s*1\s*,\s*viewportH\s*\)/)
    const stickyAbort = src.slice(
      src.indexOf('freezeAnchor.sticky !== isSticky'),
      src.indexOf('const frozenRange'),
    )
    expect(stickyAbort).toContain('freezeRendersRef.current = 0')
    expect(stickyAbort).not.toContain('prevRangeRef.current = null')
    expect(src).toMatch(
      /const frozenRange\s*=\s*freezeRendersRef\.current\s*>\s*0\s*\?\s*prevRangeRef\.current\s*:\s*null/,
    )
  })

  test('source: non-freeze commit stores tail + sticky/scroll anchor', async () => {
    const src = await Bun.file(HOOK).text()
    expect(src).toMatch(
      /itemTailRef\.current\s*=\s*\{\s*count:\s*n\s*,\s*lastKey:\s*itemKeys\.at\(-1\)\s*\}/,
    )
    expect(src).toMatch(
      /lastRangeAnchorRef\.current\s*=\s*\{\s*sticky:\s*isSticky\s*,\s*scrollTop\s*\}/,
    )
  })
})
