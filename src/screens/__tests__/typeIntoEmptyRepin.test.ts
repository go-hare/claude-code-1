import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

/**
 * Structural gate: empty→non-empty typing must not force-remount when already
 * sticky. scrollToBottom while sticky clears clamp/HWM and forceRenders the
 * virtual list → one-frame topSpacer white flash until Enter repins.
 */
describe('REPL type-into-empty repin sticky skip', () => {
  test('source: type-into-empty skips repinScroll when isSticky()', async () => {
    const src = await Bun.file(
      new URL('../REPL.tsx', import.meta.url).pathname,
    ).text()

    const idx = src.indexOf('typing into an empty prompt re-pins')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1400)
    expect(slice).toMatch(/inputValueRef\.current === ''/)
    expect(slice).toMatch(/RECENT_SCROLL_REPIN_WINDOW_MS/)
    expect(slice).toMatch(/scrollRef\.current\?\.isSticky\(\)\s*!==\s*true/)
    expect(slice).toMatch(/repinScroll\s*\(\s*\)/)
  })

  test('source: ScrollBox.scrollToBottom short-circuits when already sticky', async () => {
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
    // Must not clear clamp/HWM on the already-sticky path before return.
    const stickyEarlyReturn = slice.indexOf('if (alreadySticky)')
    const clearClamp = slice.indexOf('scrollClampMin = undefined')
    expect(stickyEarlyReturn).toBeGreaterThan(0)
    expect(clearClamp).toBeGreaterThan(stickyEarlyReturn)
  })
})
