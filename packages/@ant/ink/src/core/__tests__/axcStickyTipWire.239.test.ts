/**
 * Tip Project C wire: sticky main uses MainScreenShell + AxcStickyHost
 * (gold xxc). Gold Tyn: Vs() alt first; Qvt is the sibling AFTER.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const repl = readFileSync(
  join(import.meta.dir, '../../../../../../src/screens/REPL.tsx'),
  'utf8',
)
const layout = readFileSync(
  join(
    import.meta.dir,
    '../../../../../../src/components/FullscreenLayout.tsx',
  ),
  'utf8',
)
const host = readFileSync(
  join(import.meta.dir, '../../components/AxcStickyHost.tsx'),
  'utf8',
)
const shell = readFileSync(
  join(import.meta.dir, '../../components/MainScreenShell.tsx'),
  'utf8',
)
const sink = readFileSync(
  join(import.meta.dir, '../../hooks/useAxcFrameSink.ts'),
  'utf8',
)

describe('Axc sticky tip wire (Project C)', () => {
  test('REPL wraps sticky-main with MainScreenShell (height + mouse)', () => {
    expect(repl).toContain('MainScreenShell')
    expect(repl).toContain('isAxcStickyMainEnabled()')
    expect(repl).toContain(
      '<MainScreenShell mouseTracking={mouseTrackingProp()}>',
    )
    // Gold Tyn: Vs() alt first; Qvt/MainScreenShell is the non-Vs sibling.
    const altWrap = repl.indexOf(
      'return <AlternateScreen mouseTracking={mouseTrackingProp()}>{mainReturn}</AlternateScreen>',
    )
    const axcWrap = repl.indexOf('if (isAxcStickyMainEnabled())', altWrap)
    expect(altWrap).toBeGreaterThan(-1)
    expect(axcWrap).toBeGreaterThan(altWrap)
    // Must not bare-return mainReturn without height shell
    expect(repl).not.toMatch(
      /if \(isAxcStickyMainEnabled\(\)\) \{\s*return mainReturn;\s*\}/,
    )
  })

  test('FullscreenLayout Qvt arm mounts AxcStickyHost (gold xxc)', () => {
    expect(layout).toContain('<AxcStickyHost')
    expect(layout).toContain('scrollRef={scrollRef}')
    expect(layout).toContain('overlay={overlayNode}')
    // RPs suppressed (modal.visible false) must not mount opaque cover
    expect(layout).toContain('modal != null && modal.visible')
    expect(layout).not.toContain('AxcFrameSinkBridge')
    expect(layout).not.toContain('axcOverlayRef')
    expect(layout).not.toContain('axcBottomRef')
  })

  test('Axc path: densable xxc slots — AxcStickyHost + kxc anchor, no Tyn Wrn', () => {
    expect(layout).toContain('AxcScrollAnchor')
    expect(layout).toContain('AxcStickyHost')
    expect(host).toContain('NATIVE_HISTORY_BOTTOM_CHROME')
    expect(layout).not.toContain('showWrnStickyHeader')
    expect(layout).not.toContain('axcSticky && pillNode')
    const qvt = layout.slice(
      layout.indexOf('if (axcSticky)'),
      layout.indexOf('// Gold else:'),
    )
    expect(qvt).toContain('<AxcScrollAnchor />')
    expect(qvt).not.toContain('{overlay}')
    const tynStart = layout.indexOf('{/* $xc — scroll + sidebar row */}')
    const tynSticky = layout.indexOf('const sticky = hideSticky')
    const tynEnd = layout.indexOf('</PromptOverlayProvider>', tynStart)
    const tyn = layout.slice(tynSticky, tynEnd)
    expect(tyn).toContain('<AxcScrollAnchor />')
    expect(tyn).not.toContain('{overlay}')
    expect(tyn).not.toContain('&& overlay == null')
  })

  test('xxc viewport uses cachedLayout (nodeCache) not Yoga-sum first', () => {
    expect(sink).toContain('nodeCache.get(scrollEl)')
    expect(sink).not.toContain('absoluteYogaLayout(scrollEl)')
  })

  test('wTg serializeNodeRows reads nodeCache, no Yoga fallback', () => {
    const ser = readFileSync(
      join(import.meta.dir, '../axcScreenSerialize.ts'),
      'utf8',
    )
    const start = ser.indexOf('export function serializeNodeRows')
    const end = ser.indexOf('export function serializeGapBackfill')
    const fn = ser.slice(start, end)
    expect(fn).toContain('nodeCache.get(node)')
    expect(fn).not.toContain('absoluteYogaLayout')
  })

  test('handleResume and reassertTerminalModes re-assert mouse on main screen', () => {
    const inkSrc = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    const resumeStart = inkSrc.indexOf('private handleResume')
    const resumeEnd = inkSrc.indexOf('resetScreenReaderDiffState():')
    const resume = inkSrc.slice(resumeStart, resumeEnd)
    expect(resume).toContain('enableMouseTracking(this.altScreenMouseTracking)')
    expect(resume).toContain("altScreenMouseTracking !== 'off'")

    const reassertStart = inkSrc.indexOf('reassertTerminalModes =')
    const reassertEnd = inkSrc.indexOf('Mark this instance as unmounted')
    const reassert = inkSrc.slice(reassertStart, reassertEnd)
    const mouseIdx = reassert.indexOf(
      'enableMouseTracking(this.altScreenMouseTracking)',
    )
    const altReturnIdx = reassert.indexOf('if (!this.altScreenActive) return')
    expect(mouseIdx).toBeGreaterThan(-1)
    expect(altReturnIdx).toBeGreaterThan(-1)
    expect(mouseIdx).toBeLessThan(altReturnIdx)
  })

  test('AxcFrameSinkBridge forwards bottom/overlay refs to useAxcFrameSink', () => {
    expect(host).toContain('bottomRef')
    expect(host).toContain('overlayRef')
    expect(host).toContain(
      'useAxcFrameSink({ scrollRef, bottomRef, overlayRef, anchorRef })',
    )
    expect(host).toContain('AxcScrollAnchorContext.Provider')
  })

  test('MainScreenShell enables mouse without setAltScreenActive', () => {
    expect(shell).toContain('setMouseTracking')
    expect(shell).toContain('enableMouseTracking')
    expect(shell).not.toContain('enterAltScreenSequence')
    expect(shell).not.toContain('ink?.setAltScreenActive')
    expect(shell).toContain('height={size?.rows ?? 24}')
  })

  test('hard-exit glue unmounts frameSink; CSI r is restore/catch only', () => {
    const shutdown = readFileSync(
      join(import.meta.dir, '../../../../../../src/utils/gracefulShutdown.ts'),
      'utf8',
    )
    expect(shutdown).toMatch(/isAltScreenActive \|\| inst\?\.frameSink/)
    expect(shutdown).toContain('RESET_SCROLL_REGION')
    expect(shutdown).toContain('cursorPosition(contentHeight + 1, 1)')
    // CSI r homes the cursor — must not follow SHOW_CURSOR unconditionally
    // after Axc.restore() already positioned below content.
    expect(shutdown).not.toMatch(
      /writeSync\(1, SHOW_CURSOR\)\s*\n\s*writeSync\(1, RESET_SCROLL_REGION\)/,
    )
    const index = readFileSync(join(import.meta.dir, '../../index.ts'), 'utf8')
    expect(index).toContain('RESET_SCROLL_REGION')
    expect(index).toContain('cursorPosition')
    const inkSrc = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    expect(inkSrc).not.toMatch(/writeSync\(1, RESET_SCROLL_REGION\)/)
    const axcSrc = readFileSync(join(import.meta.dir, '../axc.ts'), 'utf8')
    expect(axcSrc).toMatch(/writeSync\(fd, payload\)/)
  })
})
