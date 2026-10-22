import { stringWidth } from './stringWidth.js'
import type { Styles } from './styles.js'
import { expandTabsForWrap } from './tabstops.js'
import { wrapAnsi } from './wrapAnsi.js'
import sliceAnsiFallback from './utils/sliceAnsi.js'

const ELLIPSIS = '…'

/** densable `Sr` — Bun.sliceAnsi when present; Node falls back to sliceAnsi. */
function sliceAnsi(text: string, start: number, end?: number): string {
  const bunSlice =
    typeof Bun !== 'undefined' && typeof Bun.sliceAnsi === 'function'
      ? Bun.sliceAnsi
      : undefined
  return bunSlice
    ? bunSlice(text, start, end)
    : sliceAnsiFallback(text, start, end)
}

function sliceFit(text: string, start: number, end: number): string {
  let sliced = sliceAnsi(text, start, end)
  while (end > start && stringWidth(sliced) > end - start) {
    end--
    sliced = sliceAnsi(text, start, end)
  }
  return sliced
}

/**
 * densable `YTt` — null when the (r7) text already fits. columns===1 is
 * `{head:"",tail:""}` so `p0` becomes just the ellipsis.
 */
function truncateParts(
  text: string,
  columns: number,
  position: 'start' | 'middle' | 'end',
): { head: string; tail: string } | null {
  const sanitized = expandTabsForWrap(text)
  const length = stringWidth(sanitized)
  if (length <= columns) return null
  if (columns === 1) return { head: '', tail: '' }
  if (position === 'start') {
    return { head: '', tail: sliceFit(sanitized, length - columns + 1, length) }
  }
  if (position === 'middle') {
    const half = Math.floor(columns / 2)
    return {
      head: sliceFit(sanitized, 0, half),
      tail: sliceFit(sanitized, length - (columns - half) + 1, length),
    }
  }
  return { head: sliceFit(sanitized, 0, columns - 1), tail: '' }
}

/** densable `p0`. */
function truncate(
  text: string,
  columns: number,
  position: 'start' | 'middle' | 'end',
): string {
  if (columns < 1) return ''
  const sanitized = expandTabsForWrap(text)
  const parts = truncateParts(sanitized, columns, position)
  return parts === null ? sanitized : parts.head + ELLIPSIS + parts.tail
}

export default function wrapText(
  text: string,
  maxWidth: number,
  wrapType: Styles['textWrap'] = 'wrap',
): string {
  // densable cm: wrap and wrap-stream share the same hard wrap path
  if (wrapType === 'wrap' || wrapType === 'wrap-stream') {
    return wrapAnsi(text, maxWidth, {
      trim: false,
      hard: true,
    })
  }

  if (wrapType === 'wrap-trim') {
    return wrapAnsi(text, maxWidth, {
      trim: true,
      hard: true,
    })
  }

  // densable uy: end/middle are truncate aliases (same as truncate / truncate-middle).
  if (
    wrapType === 'end' ||
    wrapType === 'middle' ||
    wrapType.startsWith('truncate')
  ) {
    let position: 'end' | 'middle' | 'start' = 'end'

    if (wrapType === 'truncate-middle' || wrapType === 'middle') {
      position = 'middle'
    }

    if (wrapType === 'truncate-start') {
      position = 'start'
    }

    return truncate(text, maxWidth, position)
  }

  return text
}
