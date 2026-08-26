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
    expect(slice).toMatch(/inputValueRef\.current === ''/)
    expect(slice).toMatch(/!scrolledAwayRef\.current/)
    expect(slice).toMatch(/repinScroll\(false,\s*'typedIntoEmpty'\)/)
    expect(slice).not.toMatch(/isSticky\(\)\s*!==\s*true/)
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

  test('source: ScrollBox.scrollToBottom alreadySticky short-circuit remains', async () => {
    const src = await Bun.file(SCROLL_BOX).text()

    const idx = src.indexOf('scrollToBottom()')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 2800)
    expect(slice).toMatch(/alreadySticky/)
    expect(slice).toMatch(/stickyScroll/)
    const stickyEarlyReturn = slice.indexOf('if (alreadySticky)')
    expect(stickyEarlyReturn).toBeGreaterThan(0)
    const remountComment = slice.indexOf(
      'Drop virtual-scroll clamp + HWM BEFORE the sticky remount paints',
    )
    expect(remountComment).toBeGreaterThan(stickyEarlyReturn)
    const alreadyBlock = slice.slice(stickyEarlyReturn, remountComment)
    expect(alreadyBlock).toMatch(/hadClamp/)
    expect(alreadyBlock).toMatch(/scrollClampMin = undefined/)
    expect(alreadyBlock).toMatch(/scrollClampMax = undefined/)
    expect(alreadyBlock).toMatch(/markDirty/)
    expect(alreadyBlock).toMatch(/scheduleRenderFrom/)
    // forceRender remount is the white-flash path — must stay after this return
    expect(alreadyBlock).not.toMatch(/forceRender\(/)
  })
})
