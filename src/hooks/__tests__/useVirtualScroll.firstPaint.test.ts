import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'

const HOOK = join(
  fileURLToPath(new URL('.', import.meta.url)),
  '../useVirtualScroll.ts',
)

/**
 * Structural gates for blank-until-scroll first-paint settle.
 * Runtime Ink e2e is heavy; these lock the dual-wake path that fixes:
 *   sticky pin to real Yoga scrollHeight while spacers still use
 *   DEFAULT_ESTIMATE + viewportH=0 cold start until user scrolls.
 */
describe('useVirtualScroll first-paint settle (blank-until-scroll)', () => {
  test('source: dual settle flags + viewport wake effect + height settle remeasure', async () => {
    const src = await Bun.file(HOOK).text()

    expect(src).toMatch(/needsViewportWakeRef\s*=\s*useRef\(true\)/)
    expect(src).toMatch(/needsHeightSettleRef\s*=\s*useRef\(true\)/)

    // Transcript swap re-arms both
    expect(src).toMatch(
      /needsViewportWakeRef\.current\s*=\s*true[\s\S]*?needsHeightSettleRef\.current\s*=\s*true/,
    )

    // Height measure: only first batch forces commit (not every streaming tweak)
    expect(src).toMatch(
      /if\s*\(needsHeightSettleRef\.current\)\s*\{[\s\S]*?setRemeasureTick/,
    )

    // Viewport wake after Ink paint (useEffect, not layout — vh written post-layout)
    const effectIdx = src.indexOf(
      'viewportHeight is written by render-node-to-output',
    )
    expect(effectIdx).toBeGreaterThan(0)
    const effectSlice = src.slice(effectIdx, effectIdx + 1400)
    expect(effectSlice).toMatch(/useEffect\s*\(/)
    expect(effectSlice).toMatch(/getViewportHeight\(\)\s*>\s*0/)
    expect(effectSlice).toMatch(/needsViewportWakeRef\.current\s*=\s*false/)
    expect(effectSlice).toMatch(/setRemeasureTick/)
    // vh=0 first paint: microtask retry until Ink layout lands
    expect(effectSlice).toMatch(/queueMicrotask\(tryWake\)/)
    expect(effectSlice).toMatch(/attempts\s*<\s*32/)
    // Must not clear height settle on viewport wake
    expect(effectSlice).not.toMatch(/needsHeightSettleRef\.current\s*=\s*false/)

    // layoutEpoch expand/collapse re-arms height settle
    expect(src).toMatch(
      /scrollHeightHwm\s*=\s*undefined[\s\S]*?needsHeightSettleRef\.current\s*=\s*true/,
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
})
