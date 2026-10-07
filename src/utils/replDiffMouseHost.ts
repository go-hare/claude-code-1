import { useEffect, useRef } from 'react'
import { useSelection, type DOMElement } from '@anthropic/ink'
import { logEvent } from '../services/analytics/index.js'
import type { AppState } from '../state/AppStateStore.js'

/**
 * densable `zJ` @188582380 — clamp scrollTop to content max.
 */
export function clampedScrollTop(node: DOMElement): number {
  const top = node.scrollTop ?? 0
  if (node.scrollHeight === undefined) return top
  return Math.min(
    top,
    Math.max(0, node.scrollHeight - (node.scrollViewportHeight ?? 0)),
  )
}

/**
 * densable `QSe(h,v,D)` @1512156 — screen-Y → file path via yoga ancestor tops.
 * `h` is 0-indexed screen row (gold selection `anchor.row`).
 */
export function resolveDiffFileAtY(
  y: number,
  container: DOMElement | null | undefined,
  files: Map<string, DOMElement>,
): string | undefined {
  let containerTop = 0
  for (
    let node: DOMElement | undefined = container ?? undefined;
    node;
    node = node.parentNode
  ) {
    containerTop += node.yogaNode?.getComputedTop() ?? 0
  }
  if (y < containerTop) return undefined
  for (const [path, fileNode] of files) {
    let top = 0
    for (
      let node: DOMElement | undefined = fileNode;
      node;
      node = node.parentNode
    ) {
      top += node.yogaNode?.getComputedTop() ?? 0
      if (node.scrollTop) top -= clampedScrollTop(node)
    }
    const height = fileNode.yogaNode?.getComputedHeight() ?? 0
    if (y >= top && y < top + height) return path
  }
  return undefined
}

/** densable ancestor yoga top walk used by Obe `xn` (selection max-row). */
export function yogaAncestorTop(node: DOMElement | null | undefined): number {
  let top = 0
  for (let n: DOMElement | undefined = node ?? undefined; n; n = n.parentNode) {
    top += n.yogaNode?.getComputedTop() ?? 0
  }
  return top
}

export function nodeScreenRect(node: DOMElement | null | undefined): {
  top: number
  height: number
} | null {
  if (!node?.yogaNode) return null
  return {
    top: yogaAncestorTop(node),
    height: node.yogaNode.getComputedHeight(),
  }
}

/**
 * densable SGR wheel `deltaY` + 0-indexed row. Box has no `onWheel` type
 * (`EventHandlerProps` in packages/@ant/ink); wheel arrives as InputEvent.
 */
export function parseSgrWheel(
  sequence: string | undefined,
  key: { wheelUp?: boolean; wheelDown?: boolean },
): { deltaY: number; row: number | null } | null {
  const deltaY = key.wheelUp ? -1 : key.wheelDown ? 1 : 0
  if (deltaY === 0) return null
  const payload = sequence?.startsWith('\x1b') ? sequence.slice(1) : sequence
  const match = payload?.match(/^\[<(\d+);(\d+);(\d+)[Mm]$/)
  const row = match ? Number(match[3]) - 1 : null
  return { deltaY, row: Number.isFinite(row) ? row : null }
}

/** densable `ruo` */
export function showDiffPanelLatch(state: AppState): AppState {
  return state.diffPanelVisible ? state : { ...state, diffPanelVisible: true }
}

/** densable `auo` */
export function hideDiffPanelLatch(state: AppState): AppState {
  return state.diffPanelVisible ? { ...state, diffPanelVisible: false } : state
}

/**
 * densable `WJ` / `Pte` — toast hold while Obe is mounted OR pane toast-hold
 * latch is on (`diffPanelVisible || paneHoldsToasts`).
 */
export function notificationsHoldToasts(state: {
  diffPanelVisible?: boolean
  paneHoldsToasts?: boolean
}): boolean {
  return Boolean(state.diffPanelVisible || state.paneHoldsToasts)
}

export type DiffSelectionAttach = {
  source: 'diff'
  text: string
  lineCount: number
  filePath: string | undefined
}

/**
 * densable `NSe(h,v,D,z)` @1506261 — selection-Y → file via QSe, then attach.
 * `h` is minCol; `v` is max-row getter; `D` is onAsk; `z` is QSe.
 */
export function useReplDiffSelectionAttach(
  minCol: number,
  getMaxRow: () => number | null,
  onAskAboutSelection: ((payload: DiffSelectionAttach) => void) | undefined,
  resolveFile: (y: number) => string | undefined,
): void {
  const selection = useSelection()
  const lastText = useRef('')
  const minColRef = useRef(minCol)
  minColRef.current = minCol
  const getMaxRowRef = useRef(getMaxRow)
  getMaxRowRef.current = getMaxRow
  const onAskRef = useRef(onAskAboutSelection)
  onAskRef.current = onAskAboutSelection
  const resolveFileRef = useRef(resolveFile)
  resolveFileRef.current = resolveFile

  useEffect(() => {
    return selection.subscribe(() => {
      const onAsk = onAskRef.current
      if (!onAsk) return
      const state = selection.getState()
      if (state?.isDragging || !selection.hasSelection()) {
        lastText.current = ''
        return
      }
      if (!state?.anchor || !state.focus || state.anchorSpan?.kind === 'line') {
        return
      }
      const anchorCol = state.virtualAnchorCol ?? state.anchor.col
      const focusCol = state.virtualFocusCol ?? state.focus.col
      if (anchorCol < minColRef.current || focusCol < minColRef.current) return
      const maxRow = getMaxRowRef.current()
      if (
        maxRow === null ||
        state.anchor.row > maxRow ||
        state.focus.row > maxRow
      ) {
        return
      }
      const text = selection.getSelectedText()
      if (!text.trim() || text === lastText.current) return
      lastText.current = text
      const trimmed = text.trimEnd()
      const lineCount = trimmed.length === 0 ? 1 : trimmed.split('\n').length
      const filePath = resolveFileRef.current(
        Math.min(state.anchor.row, state.focus.row),
      )
      onAsk({ source: 'diff', text, lineCount, filePath })
      logEvent('diff_selection_attach', {})
    })
  }, [selection])
}
