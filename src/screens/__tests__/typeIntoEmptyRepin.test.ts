import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPL = join(fileURLToPath(new URL('.', import.meta.url)), '../REPL.tsx')
const SCROLL_BOX = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/@ant/ink/src/components/ScrollBox.tsx',
)

/**
 * densable typedIntoEmpty (SEA uT / Hi latch):
 * empty→non-empty only when still sticky (`!scrolledAwayRef`).
 * No 3s window. autoScrollEnabled gates non-force repin.
 */
describe('REPL type-into-empty Hi latch (SEA typedIntoEmpty)', () => {
  test('source: typedIntoEmpty fires only when !scrolledAwayRef (no 3s window)', async () => {
    const src = await Bun.file(REPL).text()

    expect(src).not.toMatch(/RECENT_SCROLL_REPIN_WINDOW_MS/)
    expect(src).not.toMatch(/lastUserScrollTsRef/)

    const idx = src.indexOf('densable typedIntoEmpty')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 900)
    // densable onEdit(next, prev): empty→nonempty while sticky.
    // Gate uses `prev === ''` (pre-write); inputValueRef may already be next.
    expect(slice).toMatch(/prev === ''/)
    expect(slice).toMatch(/next !== ''/)
    expect(slice).toMatch(/!scrolledAwayRef\.current/)
    // onEdit closes over repinScrollRef so P$ is not recreated each render.
    expect(slice).toMatch(
      /repinScrollRef\.current\(false,\s*'typedIntoEmpty'\)/,
    )
    expect(slice).not.toMatch(/isSticky\(\)\s*!==\s*true/)
    expect(src).not.toMatch(/useState\(\(\)\s*=>\s*consumeEarlyInput\(\)\)/)
  })

  test('source: composedOnScroll latches scrolledAwayRef = !sticky', async () => {
    const src = await Bun.file(REPL).text()
    const idx = src.indexOf('scrolledAwayRef.current = !sticky')
    expect(idx).toBeGreaterThan(0)
  })

  test('source: uT skips when !force && !getAutoScrollEnabled()', async () => {
    const src = await Bun.file(REPL).text()
    const idx = src.indexOf('const repinScroll = useCallback')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 900)
    expect(slice).toMatch(/if \(!force && !getAutoScrollEnabled\(\)\) return/)
    expect(slice).toMatch(/scrolledAwayRef\.current = false/)
  })

  test('source: lastMsgIsHuman / agent-view / overlay / submit force flags', async () => {
    const src = await Bun.file(REPL).text()
    expect(src).toMatch(/repinScroll\(false,\s*'lastMsgIsHuman'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'agent-view-change'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'overlay'\)/)
    expect(src).toMatch(/repinScroll\(true,\s*'submit'\)/)
  })

  test('source: ScrollBox.scrollToBottom is gold stickyScroll+jR+notify+forceRender', async () => {
    const src = await Bun.file(SCROLL_BOX).text()

    const idx = src.indexOf('scrollToBottom()')
    expect(idx).toBeGreaterThan(0)
    const end = src.indexOf('getScrollTop()', idx)
    expect(end).toBeGreaterThan(idx)
    const slice = src.slice(idx, end)
    expect(slice).not.toMatch(/\balreadySticky\b/)
    expect(slice).toMatch(/pendingScrollDelta = undefined/)
    expect(slice).toMatch(/stickyScroll === false/)
    expect(slice).toMatch(/scrollMutated\(el\)/)
    const stickyAssign = slice.indexOf('el.stickyScroll = true')
    expect(stickyAssign).toBeGreaterThan(0)
    const stickyPath = slice.slice(stickyAssign)
    expect(stickyPath).toMatch(/markDirty\(el\)/)
    expect(stickyPath).toMatch(/notify\(\)/)
    expect(stickyPath).toMatch(/forceRender\(/)
    expect(stickyPath).not.toMatch(/scrollTop/)
    expect(stickyPath).not.toMatch(/scheduleRenderFrom/)
  })
})
