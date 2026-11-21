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
  test('source: pill snapshots follow 2.1.328 pdn Uo/Wo and ScrollPin count selector', async () => {
    const src = await Bun.file(LAYOUT).text()
    const idx = src.indexOf('const getPillVisible = useCallback')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1800)
    expect(slice).toContain('if (!s || s.isSticky()) return false')
    expect(slice).toContain('unseen?.getSnapshot().dividerY')
    expect(slice).toContain(
      '(hasDivider || !getAutoScrollEnabled()) && viewportBottom < s.getScrollHeight()',
    )
    expect(slice).toContain(
      'useSyncExternalStore(subscribe, getIsBeforeUnseenDivider)',
    )
    expect(slice).toContain('return viewportBottom < dividerY')
    expect(slice).toContain('isBeforeUnseenDivider ? unseenMessageCount : 0')
  })

  test('source: ScrollBox followGrowth from getAutoScrollEnabled', async () => {
    const src = await Bun.file(LAYOUT).text()
    expect(src).toMatch(/followGrowth=\{getAutoScrollEnabled\(\)\}/)
    expect(src).toMatch(/stickyScroll/)
  })

  test('source: bottom maxHeight is tot Ne — half screen idle, rows-VCe on overlay', async () => {
    const src = await Bun.file(LAYOUT).text()
    expect(src).toMatch(/const FULLSCREEN_BOTTOM_CHROME_ROWS = 2/)
    expect(src).toMatch(/Math\.floor\(terminalRows \/ 2\)/)
    expect(src).toMatch(
      /Math\.max\(1, terminalRows - FULLSCREEN_BOTTOM_CHROME_ROWS\)/,
    )
    expect(src).toMatch(/maxHeight=\{bottomMaxHeight\}/)
    expect(src).toMatch(/maxHeight=\{promptMaxHeight\}/)
    expect(src).not.toMatch(
      /maxHeight=\{abovePrompt != null \? promptMaxHeight : bottomMaxHeight\}/,
    )
    expect(src).toMatch(/flexGrow=\{1\}/)
    expect(src).toMatch(/flexShrink=\{0\}/)
    expect(src).toMatch(/overflowY="hidden"/)
    expect(src).not.toMatch(/maxHeight=["']50%["']/)
    expect(src).toContain('id === HISTORY_SEARCH_OVERLAY')
    expect(src).toContain('elicitation-url')
  })
})
