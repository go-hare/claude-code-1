import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const HOOK = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../useVirtualScroll.ts',
)
const VML = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../components/VirtualMessageList.tsx',
)
const SCROLLBOX = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../../../packages/@ant/ink/src/components/ScrollBox.tsx',
)

/**
 * densable 2.1.289 `wb`/`qd`/`Ab` first-paint.
 *
 * Gold `wb` returns `onLayout:ut`. Gold `qd` mounts `e(Ab,{onLayout:Wt})`.
 * Gold `Ab`: `x(() => subscribeLayout(onLayout), [subscribeLayout, onLayout])`.
 * Gold `ut` sticky/vh=0 early-return — does not setState. Gold Ink
 * `getViewportHeight` is `scrollViewportHeight??0`. Do not invent
 * `needsViewportWake` / 32× `queueMicrotask(tryWake)` / yoga fallback as gold.
 */
describe('useVirtualScroll densable 2.1.289 onLayout (wb/Ab)', () => {
  test('source: wb returns onLayout; no analog viewport-wake microtask', async () => {
    const src = await Bun.file(HOOK).text()

    expect(src).toContain('onLayout: () => void')
    expect(src).toMatch(/const onLayout = useCallback\(\(\) => \{/)
    expect(src).toMatch(
      /if\s*\(\s*!handle\s*\|\|\s*handle\.isSticky\(\)\s*\|\|\s*vh\s*===\s*0\s*\)/,
    )
    expect(src).toMatch(/clampBoundsRef\.current/)
    expect(src).toMatch(/onLayout,/)

    expect(src).not.toMatch(/prevViewportHRef/)
    expect(src).not.toMatch(/needsViewportWakeRef/)
    expect(src).not.toMatch(/needsHeightSettleRef/)
    expect(src).not.toMatch(/queueMicrotask\(tryWake\)/)
    expect(src).not.toMatch(
      /viewportHeight is written by render-node-to-output/,
    )
  })

  test('source: subscribe retries when ScrollBox ref not yet attached', async () => {
    const src = await Bun.file(HOOK).text()
    const idx = src.indexOf('Ref may not be attached on first subscribe')
    expect(idx).toBeGreaterThan(0)
    const slice = src.slice(idx, idx + 1200)
    expect(slice).toMatch(/queueMicrotask\(tryAttach\)/)
    expect(slice).toMatch(/listener\(\)/)
    expect(slice).toMatch(/attempts\s*<\s*32/)
  })

  test('source: origin jump >1 row after first land forces a commit (gold Xt be)', async () => {
    const src = await Bun.file(HOOK).text()
    expect(src).toMatch(/if \(prev !== 0 && Math\.abs\(next - prev\) > 1\)/)
    expect(src).toMatch(/setRemeasureTick\(t => t \+ 1\)/)
  })
})

describe('VirtualMessageList densable 2.1.289 Ab LayoutPass', () => {
  test('source: mounts Ab after bottom spacer; subscribeLayout(onLayout)', async () => {
    const src = await Bun.file(VML).text()
    expect(src).toMatch(/onLayout: onVirtualLayout/)
    expect(src).toMatch(/tickReveal\(false\)/)
    expect(src).toMatch(/onVirtualLayout\(\)/)
    expect(src).toMatch(/<VirtualListLayoutPass onLayout=\{onLayout\} \/>/)
    expect(src).toMatch(/function VirtualListLayoutPass/)
    expect(src).toContain(
      'useEffect(() => subscribeLayout(onLayout), [subscribeLayout, onLayout])',
    )
    expect(src).not.toMatch(/useLayoutEffect\(\(\) => \{/)
    expect(src).not.toMatch(/needsViewportWake/)
  })
})

describe('ScrollBox densable 2.1.289 getViewportHeight', () => {
  test('source: paint cache only — no yoga fallback', async () => {
    const src = await Bun.file(SCROLLBOX).text()
    expect(src).toContain('return domRef.current?.scrollViewportHeight ?? 0')
    expect(src).not.toMatch(/yoga height−padding/)
    expect(src).not.toMatch(/getComputedPadding\('top'\)/)
  })
})
