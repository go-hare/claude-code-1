/**
 * densable `xxc` frameSink install + resize — shared by AxcStickyHost and
 * tip FullscreenLayout bridge (keeps tip Yoga tree, installs Axc sink).
 *
 * Gold: docs/upstream-extraction/v2.1.239/snippets/gold-project-c-xxc-host.txt
 */

import {
  type RefObject,
  useInsertionEffect,
  useLayoutEffect,
  useRef,
} from 'react'
import { Axc } from '../core/axc.js'
import {
  serializeGapBackfill,
  serializeNodeRows,
  serializeScreenRow,
  transcriptEndOffset,
} from '../core/axcScreenSerialize.js'
import type { DOMElement } from '../core/dom.js'
import type { Frame } from '../core/frame.js'
import instances from '../core/instances.js'
import { nodeCache } from '../core/node-cache.js'
import type { StylePool } from '../core/screen.js'
import type { ScrollBoxHandle } from '../components/ScrollBox.js'
import { useTerminalSize } from '../hooks/useTerminalSize.js'

export type AxcFrameSinkRefs = {
  scrollRef: RefObject<ScrollBoxHandle | null>
  bottomRef?: RefObject<DOMElement | null>
  overlayRef?: RefObject<DOMElement | null>
  anchorRef?: RefObject<DOMElement | null>
}

/**
 * densable xxc insertion-effect + layout-effect. Returns nothing — side
 * effects only. Call from a component that stays mounted for the sticky
 * session.
 */
export function useAxcFrameSink(refs: AxcFrameSinkRefs): void {
  const { columns, rows } = useTerminalSize()
  const axcRef = useRef<Axc | null>(null)
  const refsRef = useRef(refs)
  refsRef.current = refs

  useInsertionEffect(() => {
    const ink = instances.get(process.stdout)
    if (!ink) return
    const axc = new Axc(
      process.stdout,
      columns,
      rows,
      ink.recordContentWrite.bind(ink),
    )
    axc.setup()
    axcRef.current = axc
    let suspendedForAlt = false

    ink.frameSink = (frame: Frame, stylePool: StylePool) => {
      const S = axcRef.current
      if (!S) return false
      if (ink.isAltScreenActive) {
        if (!suspendedForAlt) {
          S.suspend()
          suspendedForAlt = true
        }
        return false
      }
      if (suspendedForAlt) {
        suspendedForAlt = false
        S.resume(S.cols, S.rows)
      }
      const { scrollRef, bottomRef, overlayRef, anchorRef } = refsRef.current
      const stillPumping = S.tickPump()
      const bottomLines = serializeNodeRows(
        frame,
        stylePool,
        bottomRef?.current,
      )
      const overlayLines = serializeNodeRows(
        frame,
        stylePool,
        overlayRef?.current,
      )
      const layout = S.computeLayout(bottomLines, overlayLines)
      const scrollEl = scrollRef.current?.getDomElement() ?? null
      if (scrollEl) {
        // densable xxc: I = x.cachedLayout. Tip maps cachedLayout ↔ nodeCache.
        // No Yoga fallback — missing cache or height<=0 yields empty lines.
        const layoutBox = nodeCache.get(scrollEl)
        const lines: string[] = []
        if (layoutBox && layoutBox.height > 0) {
          const end = Math.min(
            layoutBox.y + layoutBox.height,
            frame.screen.height,
          )
          for (let B = Math.max(0, layoutBox.y); B < end; B++) {
            lines.push(serializeScreenRow(frame.screen, stylePool, B))
          }
        }
        const scrollHeight = scrollEl.scrollHeight ?? 0
        const transcriptEnd =
          transcriptEndOffset(anchorRef?.current ?? null, scrollEl) ??
          scrollHeight
        S.syncViewport(
          {
            lines,
            scrollTop: scrollEl.scrollTop ?? 0,
            scrollHeight,
            transcriptEnd,
          },
          layout.contentHeight,
        )
      }
      let primed = false
      if (scrollEl) {
        const gap = S.consumeGapRange()
        const needBackfill = S.consumeBackfillNeeded()
        if (gap || needBackfill) {
          // densable J$0(scroll, from, to, cols, stylePool) → primeBackfill
          const from = gap ? gap.from : 0
          const to = gap ? gap.to : (scrollEl.scrollTop ?? 0)
          const lines = serializeGapBackfill(
            scrollEl,
            from,
            to,
            S.cols,
            stylePool,
          )
          if (lines.length > 0) {
            S.primeBackfill(lines)
            primed = true
          }
        }
      }
      S.draw(layout)
      return stillPumping || primed ? 'tick' : true
    }

    return () => {
      ink.frameSink = null
      axc.restore()
      axcRef.current = null
    }
    // densable: rebuild only on mount/unmount; size → handleResize below
  }, [])

  const prevSize = useRef({ cols: columns, rows })
  useLayoutEffect(() => {
    if (columns === prevSize.current.cols && rows === prevSize.current.rows) {
      return
    }
    prevSize.current = { cols: columns, rows }
    axcRef.current?.handleResize(columns, rows)
  }, [columns, rows])
}
