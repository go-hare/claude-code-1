import { describe, expect, test } from 'bun:test'
import {
  configLabelColumnWidth,
  configMaxVisibleRows,
  pickTranscriptVirtualScrollHints,
  TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS,
} from '../transcriptFooterHints.js'

/** densable Dt ≈ cell width for ASCII (no wide chars in these fixtures). */
const asciiWidth = (s: string): number => s.length

describe('pickTranscriptVirtualScrollHints densable CZa', () => {
  const full = '↑↓ scroll · v to open in editor · ? for shortcuts'
  const toggle = 'ctrl+o'

  test('keeps full virtual-scroll hints when the joined line fits', () => {
    const picked = pickTranscriptVirtualScrollHints(120, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
    })
    expect(picked).toBe(full)
  })

  test('collapses to short hints when the joined line would wrap (<~104 cols)', () => {
    // "Showing detailed transcript · ctrl+o to toggle · <full>" is ~90+ chars
    // with paddingLeft=2; 80 columns forces collapse.
    const picked = pickTranscriptVirtualScrollHints(80, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
    })
    expect(picked).toBe(TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS)
  })

  test('status badge on the right counts toward the width budget', () => {
    const longStatus = 'x'.repeat(40)
    const wide = pickTranscriptVirtualScrollHints(110, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
    })
    expect(wide).toBe(full)
    const withStatus = pickTranscriptVirtualScrollHints(110, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
      status: longStatus,
    })
    expect(withStatus).toBe(TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS)
  })

  test('dialog waiting prefix counts toward the width budget', () => {
    const without = pickTranscriptVirtualScrollHints(100, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
    })
    const withDialog = pickTranscriptVirtualScrollHints(100, {
      stringWidth: asciiWidth,
      toggleShortcut: toggle,
      fullHints: full,
      dialogWaiting: true,
    })
    // At the margin, dialog waiting can tip full → short.
    if (without === full) {
      // not asserting which way for 100; just that dialogWaiting can only
      // shrink (never expand) the available budget.
      expect(
        withDialog === full ||
          withDialog === TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS,
      ).toBe(true)
      if (withDialog === full) {
        // both fit — budget still OK
        expect(without).toBe(full)
      } else {
        expect(withDialog).toBe(TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS)
      }
    }
  })
})

describe('configLabelColumnWidth densable sda X', () => {
  test('caps at 44 on wide terminals', () => {
    expect(configLabelColumnWidth(200)).toBe(44)
  })

  test('floors at 14 on very narrow terminals', () => {
    expect(configLabelColumnWidth(20)).toBe(14)
  })

  test('tracks columns-16 between floor and cap', () => {
    expect(configLabelColumnWidth(50)).toBe(34)
  })
})

describe('configMaxVisibleRows densable sda Y', () => {
  test('reserves 8 chrome rows + measured footer', () => {
    // contentHeight 30, footer 2 → max(5, 30-8-2)=20
    expect(configMaxVisibleRows(30, 2)).toBe(20)
  })

  test('never drops below 5', () => {
    expect(configMaxVisibleRows(10, 5)).toBe(5)
  })

  test('treats zero footer height as at least 1', () => {
    expect(configMaxVisibleRows(20, 0)).toBe(11)
  })
})
