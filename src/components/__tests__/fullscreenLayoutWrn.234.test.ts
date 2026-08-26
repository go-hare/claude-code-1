import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const LAYOUT = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../FullscreenLayout.tsx',
)

/**
 * densable 2.1.234 Wrn (gold-layout) — fullscreen bottom chrome + pill + follow.
 *
 * Screenshot bug: CondensedLogo at y=0, empty middle, TaskListV2 only,
 * no Jump-to-bottom, PromptInput clipped. Local gaps vs Wrn:
 *   pill Ddw isSticky() short-circuit
 *   followGrowth from autoScrollEnabled
 *   bottom maxHeight = rows-zrn (zrn=2), not "50%"
 *   inner bottom flexShrink:0
 */
describe('FullscreenLayout Wrn 2.1.234 (empty-transcript chrome)', () => {
  test('source: pill snapshot matches gold Ddw', async () => {
    const src = await Bun.file(LAYOUT).text()
    const idx = src.indexOf('const pillVisible = useSyncExternalStore')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1200)
    expect(slice).toMatch(/if \(s\.isSticky\(\)\) return false/)
    expect(slice).toMatch(/dividerY/)
    expect(slice).toMatch(
      /viewportBottom < dividerY && viewportBottom < s\.getScrollHeight\(\)/,
    )
    expect(slice).toMatch(
      /!getAutoScrollEnabled\(\) && viewportBottom < s\.getScrollHeight\(\)/,
    )
  })

  test('source: ScrollBox followGrowth from getAutoScrollEnabled', async () => {
    const src = await Bun.file(LAYOUT).text()
    expect(src).toMatch(/followGrowth=\{getAutoScrollEnabled\(\)\}/)
    expect(src).toMatch(/stickyScroll/)
  })

  test('source: bottom maxHeight is rows-zrn not 50%, inner flexShrink 0', async () => {
    const src = await Bun.file(LAYOUT).text()
    expect(src).toMatch(/const FULLSCREEN_BOTTOM_CHROME_ROWS = 2/)
    expect(src).toMatch(
      /maxHeight=\{Math\.max\(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS\)\}/,
    )
    expect(src).toMatch(/flexGrow=\{1\} flexShrink=\{0\} overflowY="hidden"/)
    expect(src).not.toMatch(/maxHeight=["']50%["']/)
  })
})
