import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * densable typedIntoEmpty (SEA uT / Hi latch):
 * empty→non-empty only when still sticky (`!scrolledAwayRef`).
 * No 3s window. autoScrollEnabled gates non-force repin.
 */
describe('REPL type-into-empty Hi latch (SEA typedIntoEmpty)', () => {
  test('source: typedIntoEmpty fires only when !scrolledAwayRef (no 3s window)', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()

    expect(src).not.toMatch(/RECENT_SCROLL_REPIN_WINDOW_MS/)
    expect(src).not.toMatch(/lastUserScrollTsRef/)

    const idx = src.indexOf('densable typedIntoEmpty')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 900)
    expect(slice).toMatch(/inputValueRef\.current === ''/)
    expect(slice).toMatch(/!scrolledAwayRef\.current/)
    expect(slice).toMatch(/repinScroll\(false,\s*'typedIntoEmpty'\)/)
    expect(slice).not.toMatch(/isSticky\(\)\s*!==\s*true/)
  })

  test('source: composedOnScroll latches scrolledAwayRef = !sticky', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()
    const idx = src.indexOf('scrolledAwayRef.current = !sticky')
    expect(idx).toBeGreaterThan(0)
  })

  test('source: uT skips when !force && !getAutoScrollEnabled()', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()
    const idx = src.indexOf('const repinScroll = useCallback')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 900)
    expect(slice).toMatch(/if \(!force && !getAutoScrollEnabled\(\)\) return/)
    expect(slice).toMatch(/scrolledAwayRef\.current = false/)
  })

  test('source: lastMsgIsHuman / agent-view / overlay / submit force flags', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()
    expect(src).toMatch(/repinScroll\(false,\s*'lastMsgIsHuman'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'agent-view-change'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'overlay'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'submit'\)/)
  })

  test('source: ScrollBox.scrollToBottom alreadySticky short-circuit remains', async () => {
    const scrollBoxPath = join(
      import.meta.dir,
      '../../../packages/@ant/ink/src/components/ScrollBox.tsx',
    )
    const src = await Bun.file(scrollBoxPath).text()

    const idx = src.indexOf('scrollToBottom()')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 2200)
    expect(slice).toMatch(/alreadySticky/)
    expect(slice).toMatch(/stickyScroll/)
    const stickyEarlyReturn = slice.indexOf('if (alreadySticky)')
    const clearClamp = slice.indexOf('scrollClampMin = undefined')
    expect(stickyEarlyReturn).toBeGreaterThan(0)
    expect(clearClamp).toBeGreaterThan(stickyEarlyReturn)
  })
})
