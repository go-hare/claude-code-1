/**
 * densable adversarial: VML transcript.reveal concurrency + height===0 +
 * paint tick must not thrash every React render.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('densable 2.1.289 VML reveal host', () => {
  test('reveal releases prior pending; height===0 skips scrollToElement; rAF tick', () => {
    const src = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(src).toContain('releaseReveal()')
    expect(src).toContain('setRevealEpoch')
    expect(src).toContain('requestAnimationFrame(loop)')
    expect(src).toContain(
      'scroll.scrollToElement(el, 0, { block: pending.block })',
    )
    expect(src).toMatch(
      /if \(height === 0\) \{\s*scroll\.scrollToElement\(el, 0, \{ block: pending\.block \}\);\s*return;\s*\}/,
    )
    // Must not keep bare useEffect(() => { tickReveal }) with no deps.
    expect(src).not.toMatch(
      /useEffect\(\(\) => \{\s*if \(revealPendingRef\.current\) tickReveal\(true\);\s*\}\);/,
    )
  })

  test('qd mounts Ab LayoutPass after bottom spacer (subscribeLayout)', () => {
    const src = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    expect(src).toContain('<VirtualListLayoutPass onLayout={onLayout} />')
    expect(src).toContain(
      'useEffect(() => subscribeLayout(onLayout), [subscribeLayout, onLayout])',
    )
    expect(src).toContain('tickReveal(false)')
    expect(src).not.toContain('useLayoutEffect(() => {')
  })

  test('VirtualItem is gold W0 hoverIgnoresBlankCells + hyperlink allowDefault', () => {
    const src = readFileSync(
      join(import.meta.dir, '../VirtualMessageList.tsx'),
      'utf8',
    )
    const start = src.indexOf('function VirtualItem')
    const end = src.indexOf('export function VirtualMessageList')
    expect(start).toBeGreaterThan(0)
    expect(end).toBeGreaterThan(start)
    const item = src.slice(start, end)
    expect(item).toContain('hoverIgnoresBlankCells={!expanded}')
    expect(item).toContain('e.hyperlinkUrl')
    expect(item).toContain('e.allowDefault()')
    expect(item).toContain('onClickK(msg, e.cellIsBlank)')
    expect(src).toContain('if (!cellIsBlank) h.onItemClick?.(msg)')
  })
})
