/**
 * densable 2.1.216 CZa — transcript-mode footer width gate.
 *
 * Long virtual-scroll hints (`↑↓ scroll · v to open in editor · ? for
 * shortcuts`) wrap under ~104 columns. densable keeps the sticky parts
 * ("Showing detailed transcript · <toggle> to toggle") and collapses only
 * the virtual-scroll segment when
 * `paddingLeft + stringWidth(left · fullHints) + stringWidth(right) >= columns`.
 */

export const TRANSCRIPT_FOOTER_PADDING_LEFT = 2
export const TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS = '? for shortcuts'

export function pickTranscriptVirtualScrollHints(
  columns: number,
  opts: {
    stringWidth: (s: string) => number
    toggleShortcut: string
    fullHints: string
    shortHints?: string
    dialogWaiting?: boolean
    status?: string
    /** densable right-side default badge when no status/search ("verbose "). */
    rightBadge?: string
    paddingLeft?: number
  },
): string {
  const short = opts.shortHints ?? TRANSCRIPT_VIRTUAL_SCROLL_SHORT_HINTS
  const paddingLeft = opts.paddingLeft ?? TRANSCRIPT_FOOTER_PADDING_LEFT
  const leftParts = [
    opts.dialogWaiting ? 'dialog waiting' : '',
    'Showing detailed transcript',
    `${opts.toggleShortcut} to toggle`,
    opts.fullHints,
  ].filter(part => part !== '')
  const left = leftParts.join(' · ')
  const right =
    opts.status !== undefined && opts.status !== ''
      ? `${opts.status} `
      : (opts.rightBadge ?? '')
  const used = paddingLeft + opts.stringWidth(left) + opts.stringWidth(right)
  return used < columns ? opts.fullHints : short
}

/**
 * densable sda label column: `Math.min(44, Math.max(14, columns - 16))`.
 * Prevents fixed-width=44 labels from pushing values past the panel edge
 * inside the fullscreen modal (columns = terminal - 4).
 */
export function configLabelColumnWidth(columns: number): number {
  return Math.min(44, Math.max(14, columns - 16))
}

/**
 * densable sda maxVisible rows: `Math.max(5, contentHeight - 8 - footerHeight)`.
 * Footer is measured (flexShrink:0) so keyboard hints are never clipped by the
 * paginated list eating residual height.
 */
export function configMaxVisibleRows(
  contentHeight: number,
  footerHeight: number,
): number {
  return Math.max(5, contentHeight - 8 - Math.max(1, footerHeight))
}
