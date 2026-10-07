/**
 * densable 2.1.289 terminal `rowHolding` / `S0` / `Ga` helpers for `$.ui.selection`.
 *
 * Gold:
 * - `Mb` selection row span from anchor/focus (incl. virtual* rows)
 * - `vb` both endpoints on the same viewport node and inside its row range
 * - `Rb` absolute yoga top (subtract scrollTop on overflow:scroll ancestors)
 * - `g0` → `{ requestId, first, last }` for a message element
 * - `Tb` find requestId whose span fully contains the selection span
 * - `iqn(text, id)` → `{ text }` or `{ text, requestId }`
 *
 * Plugin-facing host maps gold `requestId` → `instance_id` (ui_read_selection name).
 */
import type { DOMElement } from '@anthropic/ink'
import type { SelectionState } from '@anthropic/ink/src/core/selection.js'

export type UiSelectionAnswer = {
  text: string
  /** densable engine requestId for the transcript row; product name `instance_id`. */
  instance_id?: string
}

export type SelectionRowSpan = {
  requestId: string
  first: number
  last: number
}

export type SelectionViewport = {
  node: DOMElement | null
  first: number
  last: number
}

/** densable `Mb` */
export function selectionRowBounds(
  selection: SelectionState,
): { first: number; last: number } | undefined {
  if (selection.anchor === null || selection.focus === null) return undefined
  const rows = [
    selection.virtualAnchorRow ?? selection.anchor.row,
    selection.virtualFocusRow ?? selection.focus.row,
  ]
  return { first: Math.min(...rows), last: Math.max(...rows) }
}

/** densable `vb` — selection endpoints lie in the viewport's row range on its node. */
export function selectionFullyInViewport(
  selection: SelectionState,
  viewport: SelectionViewport,
): boolean {
  const inRange = (row: number | undefined) =>
    row !== undefined && viewport.first <= row && row <= viewport.last
  const anchorOk =
    selection.virtualAnchorRow !== undefined || inRange(selection.anchor?.row)
  const focusOk =
    selection.virtualFocusRow !== undefined || inRange(selection.focus?.row)
  return (
    viewport.node !== null &&
    selection.scope?.node === viewport.node &&
    anchorOk &&
    focusOk
  )
}

/** densable `Rb` — absolute top; subtract scrollTop on overflow:scroll ancestors. */
export function absoluteYogaTop(node: DOMElement): number | undefined {
  let top = 0
  let cur: DOMElement | undefined = node
  while (cur !== undefined) {
    if (cur.yogaNode === undefined) return undefined
    const scrolling =
      cur !== node && (cur.style.overflowY ?? cur.style.overflow) === 'scroll'
    top +=
      cur.yogaNode.getComputedTop() - (scrolling ? (cur.scrollTop ?? 0) : 0)
    cur = cur.parentNode
  }
  return top
}

/** densable `g0` */
export function messageRowSpan(
  requestId: string,
  element: DOMElement,
): SelectionRowSpan | undefined {
  const first = absoluteYogaTop(element)
  const height = element.yogaNode?.getComputedHeight() ?? 0
  if (first === undefined) return undefined
  if (height < 1) return undefined
  return { requestId, first, last: first + height - 1 }
}

/** densable `Tb` */
export function requestIdContainingSpan(
  span: { first: number; last: number },
  rows: readonly SelectionRowSpan[],
): string | undefined {
  return rows.find(row => row.first <= span.first && span.last <= row.last)
    ?.requestId
}

/**
 * densable `S0` — requestId of the transcript row that fully holds the
 * selection when both endpoints are on the list viewport; else undefined.
 */
export function requestIdHoldingSelection(
  selection: SelectionState,
  viewport: SelectionViewport,
  rows: readonly SelectionRowSpan[],
): string | undefined {
  const span = selectionRowBounds(selection)
  if (span === undefined) return undefined
  if (!selectionFullyInViewport(selection, viewport)) return undefined
  return requestIdContainingSpan(span, rows)
}

/** densable `iqn` with product field `instance_id` (= gold requestId). */
export function selectionAnswer(
  text: string,
  requestId: string | undefined,
): UiSelectionAnswer {
  if (requestId === undefined) return { text }
  return { text, instance_id: requestId }
}

/** densable `j0` — tool_use id / tool_use_id / else uuid. */
export function messageSelectionRequestId(message: {
  type?: string
  uuid?: string
  message?: { content?: unknown }
  sourceToolUseID?: string
}): string {
  if (message.type === 'assistant' || message.type === 'user') {
    const content = message.message?.content
    const first = Array.isArray(content) ? content[0] : undefined
    if (typeof first === 'object' && first !== null && 'type' in first) {
      const block = first as { type: string; id?: string; tool_use_id?: string }
      if (block.type === 'tool_use' && typeof block.id === 'string') {
        return block.id
      }
      if (
        block.type === 'tool_result' &&
        typeof block.tool_use_id === 'string'
      ) {
        return block.tool_use_id
      }
    }
  }
  return typeof message.uuid === 'string' ? message.uuid : ''
}

/** densable `dN` — message has a non-empty uuid string. */
export function messageHasUuid(message: unknown): message is { uuid: string } {
  if (typeof message !== 'object' || message === null || !('uuid' in message)) {
    return false
  }
  const uuid = (message as { uuid: unknown }).uuid
  return typeof uuid === 'string' && uuid !== ''
}

export type UiSelectionRowHolding = (
  selection: SelectionState,
) => string | undefined

let rowHolding: UiSelectionRowHolding | undefined

/** densable VirtualMessageList `rowHolding` registration for the FH host. */
export function setUiSelectionRowHolding(
  next: UiSelectionRowHolding | undefined,
): void {
  rowHolding = next
}

export function getUiSelectionRowHolding(): UiSelectionRowHolding | undefined {
  return rowHolding
}
