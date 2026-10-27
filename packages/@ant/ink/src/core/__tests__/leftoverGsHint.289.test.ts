/**
 * densable 2.1.289 Gs DECSTBM hint.
 * Gold: Yt full-width, hn viewport-shrink, pe===0.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { createNode } from '../dom.js'
import {
  leftoverGsAbsIsDescendant,
  leftoverGsAbsPrevInContent,
  leftoverGsBlitWindow,
  leftoverGsClipNest,
  leftoverGsDecstbmOk,
  leftoverGsFastPathClipOk,
  leftoverGsFollowCapture,
  leftoverGsFollowDelta,
  leftoverGsHint,
  leftoverGsJr,
  leftoverGsOverlayActive,
  leftoverGsRewriteRawAnsiBg,
  leftoverGsSkipBlitMiss,
  leftoverGsStaleWipe,
  leftoverGsZl,
} from '../render-node-to-output.js'

const full = {
  contentCachedY: 10,
  contentY: 8,
  containerCached: { y: 0, height: 20 },
  containerX: 0,
  containerY: 0,
  containerWidth: 80,
  containerHeight: 20,
  outputWidth: 80,
  innerHeight: 20,
  prevInnerHeight: 20,
  padBottom: 0,
  clipTop: 0,
  viewportTop: 0,
}

describe('leftoverGsHint gold Yt/hn/pe', () => {
  test('pure sticky scroll, same container height, full width', () => {
    const { hint, hn } = leftoverGsHint(full)
    expect(hn).toBe(false)
    expect(hint).toEqual({ top: 0, bottom: 19, delta: 2 })
  })

  test('hn: prompt grew, viewport shrunk, delta === -innerDelta', () => {
    const { hint, hn } = leftoverGsHint({
      ...full,
      contentCachedY: 10,
      contentY: 8,
      containerCached: { y: 0, height: 20 },
      containerHeight: 18,
      innerHeight: 18,
      prevInnerHeight: 20,
    })
    expect(hn).toBe(true)
    expect(hint).toEqual({ top: 0, bottom: 19, delta: 2 })
  })

  test('container y moved is not a hint', () => {
    const { hint } = leftoverGsHint({
      ...full,
      containerCached: { y: 1, height: 20 },
    })
    expect(hint).toBeNull()
  })

  test('Yt miss when not full terminal width (sidebar)', () => {
    const { hint } = leftoverGsHint({
      ...full,
      containerWidth: 60,
      outputWidth: 80,
    })
    expect(hint).toBeNull()
  })

  test('pe!==0 bottom pad misses', () => {
    const { hint } = leftoverGsHint({ ...full, padBottom: 1 })
    expect(hint).toBeNull()
  })

  test('abs(delta) >= innerHeight misses', () => {
    const { hint } = leftoverGsHint({
      ...full,
      contentCachedY: 40,
      contentY: 8,
    })
    expect(hint).toBeNull()
  })

  test('jr is 0 unless scrolling down across pad', () => {
    expect(
      leftoverGsJr({
        delta: 2,
        viewportTop: 0,
        hintTop: 0,
        scrollTop: 10,
        firstChildTop: 8,
      }),
    ).toBe(0)
    expect(
      leftoverGsJr({
        delta: 2,
        viewportTop: 1,
        hintTop: 0,
        scrollTop: 10,
        firstChildTop: 8,
      }),
    ).toBe(1)
  })

  test('hn blit window is Wr=prevInner, unclipped when Vo>Wo', () => {
    const hint = leftoverGsHint({
      ...full,
      contentCachedY: 10,
      contentY: 8,
      containerCached: { y: 0, height: 20 },
      containerHeight: 18,
      innerHeight: 18,
      prevInnerHeight: 20,
    }).hint
    expect(hint).not.toBeNull()
    const win = leftoverGsBlitWindow({
      hint: hint!,
      hn: true,
      viewportTop: 0,
      innerHeight: 18,
      prevInnerHeight: 20,
      jr: 0,
    })
    expect(win.unclipped).toBe(true)
    expect(win.blitY).toBe(2)
    expect(win.blitHeight).toBe(18)
    expect(win.edgeTop).toBe(18)
    expect(win.edgeBottom).toBe(17)
    expect(win.paintEdge).toBe(false)
  })

  test('pure sticky blit window is full inner, clipped', () => {
    const hint = leftoverGsHint(full).hint
    expect(hint).not.toBeNull()
    const win = leftoverGsBlitWindow({
      hint: hint!,
      hn: false,
      viewportTop: 0,
      innerHeight: 20,
      prevInnerHeight: 20,
      jr: 0,
    })
    expect(win.unclipped).toBe(false)
    expect(win.blitY).toBe(2)
    expect(win.blitHeight).toBe(18)
    expect(win.edgeTop).toBe(18)
    expect(win.edgeBottom).toBe(19)
  })

  test('stale wipe is [max(shifted,hintTop), min(shifted+h, firstRepaint??hintBottom+1))', () => {
    expect(
      leftoverGsStaleWipe({
        shiftedY: 4,
        cachedHeight: 10,
        hintTop: 0,
        hintBottom: 19,
        firstRepaintY: undefined,
      }),
    ).toEqual({ y: 4, height: 10 })
    expect(
      leftoverGsStaleWipe({
        shiftedY: 4,
        cachedHeight: 10,
        hintTop: 0,
        hintBottom: 19,
        firstRepaintY: 8,
      }),
    ).toEqual({ y: 4, height: 4 })
    expect(
      leftoverGsStaleWipe({
        shiftedY: 8,
        cachedHeight: 2,
        hintTop: 0,
        hintBottom: 19,
        firstRepaintY: 8,
      }),
    ).toBeNull()
  })
})

describe('leftoverGs yC/gC/Zl', () => {
  test('Zl: undefined container is true; empty intersection is true', () => {
    expect(leftoverGsZl({ x1: 0, x2: 10, y1: 0, y2: 10 }, undefined)).toBe(true)
    expect(
      leftoverGsZl(
        { x1: 0, x2: 2, y1: 0, y2: 2 },
        { x1: 0, x2: 10, y1: 0, y2: 10 },
        { x: 5, y: 5, width: 3, height: 3 },
      ),
    ).toBe(true)
  })

  test('yC: unpainted cached is a skip-blit miss', () => {
    expect(
      leftoverGsSkipBlitMiss(
        {},
        { unpainted: true, x: 0, y: 0, width: 4, height: 2 },
        undefined,
      ),
    ).toBe(true)
  })

  test('yC: clip grew + abs descendant misses skip-blit', () => {
    const nest = leftoverGsClipNest(
      undefined,
      { x1: 0, x2: 80, y1: 0, y2: 24 },
      { x1: 0, x2: 80, y1: 0, y2: 20 },
    )
    expect(nest?.grew).toBe(true)
    expect(
      leftoverGsSkipBlitMiss(
        { hasAbsoluteDescendant: true },
        { x: 0, y: 0, width: 80, height: 20 },
        nest,
      ),
    ).toBe(true)
  })

  test('gC: unpainted cached is not fast-path ok', () => {
    expect(
      leftoverGsFastPathClipOk(
        undefined,
        { unpainted: true, x: 0, y: 0, width: 4, height: 2 },
        { x: 0, y: 0, width: 4, height: 2 },
      ),
    ).toBe(false)
  })
})

describe('leftoverGs followScroll kn / capture', () => {
  test('kn is at - (scrollTopRendered ?? at), signed', () => {
    expect(leftoverGsFollowDelta(12, 10)).toBe(2)
    expect(leftoverGsFollowDelta(8, 10)).toBe(-2)
    expect(leftoverGsFollowDelta(10, undefined)).toBe(0)
    expect(leftoverGsFollowDelta(10, 10)).toBe(0)
  })

  test('ue>0 captures above; ue<0 captures below', () => {
    expect(leftoverGsFollowCapture(2, 0, 19)).toEqual({
      firstRow: 0,
      lastRow: 1,
      side: 'above',
    })
    expect(leftoverGsFollowCapture(-2, 0, 19)).toEqual({
      firstRow: 18,
      lastRow: 19,
      side: 'below',
    })
  })
})

describe('leftoverGs Kt overlayActive / Ze', () => {
  test('M is selection&&!sqe or search query or searchPositions', () => {
    expect(
      leftoverGsOverlayActive({
        anchor: { row: 1, col: 0 },
        focus: { row: 2, col: 0 },
        selectionBothEndsOff: false,
        searchHighlightQuery: '',
        searchPositions: null,
      }),
    ).toBe(true)
    expect(
      leftoverGsOverlayActive({
        anchor: { row: 1, col: 0 },
        focus: { row: 2, col: 0 },
        selectionBothEndsOff: true,
        searchHighlightQuery: '',
        searchPositions: null,
      }),
    ).toBe(false)
    expect(
      leftoverGsOverlayActive({
        anchor: null,
        focus: null,
        selectionBothEndsOff: false,
        searchHighlightQuery: 'foo',
        searchPositions: null,
      }),
    ).toBe(true)
    expect(
      leftoverGsOverlayActive({
        anchor: null,
        focus: null,
        selectionBothEndsOff: false,
        searchHighlightQuery: '',
        searchPositions: { currentIdx: 0 },
      }),
    ).toBe(true)
  })

  test('nC walks parentNode, not the node itself', () => {
    const content = createNode('ink-box')
    const abs = createNode('ink-box')
    abs.parentNode = content
    expect(leftoverGsAbsIsDescendant(abs, content)).toBe(true)
    expect(leftoverGsAbsIsDescendant(content, content)).toBe(false)
    expect(leftoverGsAbsIsDescendant(undefined, content)).toBe(false)
  })

  test('Ze is true when a prev abs node is under the scroll content', () => {
    const content = createNode('ink-box')
    const abs = createNode('ink-box')
    abs.parentNode = content
    const outsider = createNode('ink-box')
    expect(
      leftoverGsAbsPrevInContent(
        [
          {
            node: outsider,
            x: 0,
            y: 0,
            width: 2,
            height: 1,
            withinParent: false,
          },
        ],
        content,
      ),
    ).toBe(false)
    expect(
      leftoverGsAbsPrevInContent(
        [
          {
            node: abs,
            x: 0,
            y: 0,
            width: 2,
            height: 1,
            withinParent: false,
          },
        ],
        content,
      ),
    ).toBe(true)
  })

  test('Kt misses overlayActive or Ze even when background/gC/Bi ok', () => {
    const ok = {
      prevScreen: true,
      heightDeltaOk: true,
      overlayActive: false,
      absPrevInContent: false,
      backgroundOk: true,
    }
    expect(leftoverGsDecstbmOk(ok)).toBe(true)
    expect(leftoverGsDecstbmOk({ ...ok, overlayActive: true })).toBe(false)
    expect(leftoverGsDecstbmOk({ ...ok, absPrevInContent: true })).toBe(false)
    expect(leftoverGsDecstbmOk({ ...ok, prevScreen: false })).toBe(false)
    expect(leftoverGsDecstbmOk({ ...ok, heightDeltaOk: false })).toBe(false)
    expect(leftoverGsDecstbmOk({ ...ok, backgroundOk: false })).toBe(false)
  })
})

describe('leftoverGs EC / xjo raw-ansi bg rewrite', () => {
  test('xjo prefixes bg SGR and re-injects after reset, 49m, newline', () => {
    const prev = chalk.level
    chalk.level = 3
    try {
      const color = 'rgb(10,20,30)' as const
      const out = leftoverGsRewriteRawAnsiBg('A\x1b[0mB\x1b[49mC\nD', color)
      expect(out.startsWith('\x1b[')).toBe(true)
      expect(out).toContain('\x1b[0m')
      expect(out).toContain('\n')
      expect(out).not.toContain('\x1b[49m')
      const seqEnd = out.indexOf('A')
      expect(seqEnd).toBeGreaterThan(0)
      const seq = out.slice(0, seqEnd)
      expect(out).toContain(`\x1b[0m${seq}`)
      expect(out).toContain(`\n${seq}`)
    } finally {
      chalk.level = prev
    }
  })

  test('chalk.level 0 is identity (gold sequenceFor empty)', () => {
    const prev = chalk.level
    chalk.level = 0
    try {
      expect(leftoverGsRewriteRawAnsiBg('A\x1b[0mB', 'rgb(10,20,30)')).toBe(
        'A\x1b[0mB',
      )
    } finally {
      chalk.level = prev
    }
  })
})

describe('gold log-update DECSTBM xe=Math.max(top,1)', () => {
  test('scrollHint top 0 is clamped to 1 before setScrollRegion', () => {
    const src = readFileSync(join(import.meta.dir, '../log-update.ts'), 'utf8')
    expect(src).toContain('const xe = Math.max(next.scrollHint.top, 1)')
    expect(src).toContain('xe < bottom')
    expect(src).toContain('shiftRows(prev.screen, xe, bottom, delta)')
    expect(src).toContain('setScrollRegion(xe + 1, bottom + 1)')
    expect(src).not.toContain('setScrollRegion(top + 1, bottom + 1)')
  })
})
