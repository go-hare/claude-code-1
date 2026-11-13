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
import { instances, type DOMElement, type SelectionState } from '@anthropic/ink'

export type UiSelectionAnswer = {
  text: string
  /** densable engine requestId for the transcript row; product name `instance_id`. */
  instance_id?: string
}

export type UiSelection = {
  text: string
  requestId?: string
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

/** densable `Rb` — absolute top; subtract scrollTopRendered on overflow:scroll ancestors. */
export function absoluteYogaTop(node: DOMElement): number | undefined {
  let top = 0
  let cur: DOMElement | undefined = node
  while (cur !== undefined) {
    if (cur.yogaNode === undefined) return undefined
    const scrolling =
      cur !== node && (cur.style.overflowY ?? cur.style.overflow) === 'scroll'
    top +=
      cur.yogaNode.getComputedTop() -
      (scrolling ? (cur.scrollTopRendered ?? 0) : 0)
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

/** densable `iqn(e, n)` — `{ text }` or `{ text, requestId }`. */
export function toUiSelection(
  answer:
    | { text?: unknown; requestId?: unknown; instance_id?: unknown }
    | undefined,
): UiSelection | undefined {
  if (!answer || typeof answer.text !== 'string' || answer.text === '') {
    return undefined
  }
  const requestId =
    typeof answer.requestId === 'string' && answer.requestId !== ''
      ? answer.requestId
      : typeof answer.instance_id === 'string' && answer.instance_id !== ''
        ? answer.instance_id
        : undefined
  return requestId !== undefined
    ? { text: answer.text, requestId }
    : { text: answer.text }
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

/** densable `_H` — uuid prefix match length (deriveUUID keeps the first 24). */
export const UUID_PREFIX_LENGTH = 24

/** densable `dN` — message has a non-empty uuid string. */
export function messageHasUuid(message: unknown): message is { uuid: string } {
  if (typeof message !== 'object' || message === null || !('uuid' in message)) {
    return false
  }
  const uuid = (message as { uuid: unknown }).uuid
  return typeof uuid === 'string' && uuid !== ''
}

/** densable `y6` — 24-char uuid prefix, or undefined when dN fails. */
export function messageUuidPrefix(message: unknown): string | undefined {
  return messageHasUuid(message)
    ? message.uuid.slice(0, UUID_PREFIX_LENGTH)
    : undefined
}

type NestedUuidCarrier = {
  type?: unknown
  messages?: unknown
  notices?: unknown
}

/**
 * densable `fw` — find a renderable row by y6 prefix.
 * When `searchNested` is true, also match work_segment.messages / recap_fold.notices.
 */
export function findRenderableIndexByUuidPrefix(
  messages: readonly unknown[],
  searchNested: boolean,
  prefix: string,
): number {
  return messages.findIndex(message => {
    if (messageUuidPrefix(message) === prefix) return true
    if (!searchNested || typeof message !== 'object' || message === null) {
      return false
    }
    const row = message as NestedUuidCarrier
    if (row.type === 'work_segment' && Array.isArray(row.messages)) {
      return row.messages.some(inner => messageUuidPrefix(inner) === prefix)
    }
    if (row.type === 'recap_fold' && Array.isArray(row.notices)) {
      return row.notices.some(inner => messageUuidPrefix(inner) === prefix)
    }
    return false
  })
}

export type UiSelectionRowHolding = (
  selection: SelectionState,
) => string | undefined

export type UiSelectionSource = {
  selection?: SelectionState
  isAltScreenActive?: boolean
  hasTextSelection?: () => boolean
  getSelectedText?: () => string
  subscribeToSelectionTakeDown?: (cb: () => void) => () => void
  subscribeToSelectionChange?: (cb: () => void) => () => void
}

let rowHolding: UiSelectionRowHolding | undefined
let keptSelection: UiSelectionAnswer | undefined
let keptTakenAfter = 0
let selectionRuns = 0
let boundSelectionSource: UiSelectionSource | undefined
let unbindSelectionSource: (() => void) | undefined

function readSourceSelectionAnswer(
  source: UiSelectionSource | undefined,
): UiSelectionAnswer | undefined {
  if (!source || typeof source.getSelectedText !== 'function') return undefined
  const text =
    typeof source.hasTextSelection === 'function' && !source.hasTextSelection()
      ? ''
      : source.getSelectedText()
  if (typeof text !== 'string' || text === '') return undefined
  const requestId =
    rowHolding !== undefined && source.selection !== undefined
      ? rowHolding(source.selection)
      : undefined
  return selectionAnswer(text, requestId)
}

/** densable `YX` — drop snapshotted selection. */
export function clearKeptUiSelection(): void {
  keptSelection = undefined
}

/** densable `rVe` — mark start of a prompt/command run. */
export function beginKeptSelectionRun(): number {
  selectionRuns += 1
  return selectionRuns
}

/** densable `oVe` — clear kept selection once a run started after takedown finishes. */
export function endKeptSelectionRun(run: number | undefined): void {
  if (run !== undefined && run > keptTakenAfter) {
    keptSelection = undefined
  }
}

export function getKeptUiSelection(): UiSelectionAnswer | undefined {
  return keptSelection
}

/** densable `Prs` / `Cb` / `xb` — subscribe takedown + selection change on Ink instance. */
export function bindUiSelectionSource(
  source: UiSelectionSource | undefined,
): void {
  if (boundSelectionSource === source) return
  unbindSelectionSource?.()
  unbindSelectionSource = undefined
  boundSelectionSource = source
  keptSelection = undefined
  if (!source) return
  const unsubTakeDown = source.subscribeToSelectionTakeDown?.(() => {
    const answer = readSourceSelectionAnswer(source)
    if (answer === undefined) return
    keptSelection = answer
    keptTakenAfter = selectionRuns
  })
  const unsubChange = source.subscribeToSelectionChange?.(() => {
    if (
      keptSelection !== undefined &&
      source.hasTextSelection?.() === true &&
      (source.getSelectedText?.() ?? '') !== ''
    ) {
      keptSelection = undefined
    }
  })
  unbindSelectionSource = () => {
    unsubTakeDown?.()
    unsubChange?.()
  }
}

/** densable VirtualMessageList `rowHolding` registration for the FH host. */
export function setUiSelectionRowHolding(
  next: UiSelectionRowHolding | undefined,
): void {
  rowHolding = next
  if (next === undefined) {
    bindUiSelectionSource(undefined)
  } else {
    bindUiSelectionSource(instances.get(process.stdout))
  }
}

export function getUiSelectionRowHolding(): UiSelectionRowHolding | undefined {
  return rowHolding
}
