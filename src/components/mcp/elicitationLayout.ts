// densable 2.1.239 #14 — IZg / xZg fullscreen elicitation windowing.
// Official names: uq ($e/clampFieldRows), pKc, mYe-style field/option windows,
// Hje=Math.max(2*Loe, 2*(Aee+Xhe)) with Loe=2, Xhe=1, Aee=2.
// Do not invent Tk/oge sanitizer, zRr rewrite, or (task …) title suffix.

import { stringWidth } from '@anthropic/ink'
import { truncateToWidth } from '../../utils/truncate.js'

/** dKc — default wrapped message lines before +1 budget. */
export const ELICITATION_MESSAGE_MAX_LINES = 3
/** Fe — dialog chrome rows (title/buttons/footer). */
export const ELICITATION_CHROME_ROWS = 5
/** Be — extra rows when more than one field. */
export const ELICITATION_MULTI_FIELD_PAD = 2
/** je — assumed rows per field. */
export const ELICITATION_LINES_PER_FIELD = 3
/** Non-clamp field overhead (U-14). */
export const ELICITATION_DIALOG_OVERHEAD = 14
/** Pje — minimum wrap/truncate width. */
export const ELICITATION_MIN_WIDTH = 20
/** HvA — keep the title suffix when this many columns remain. */
export const ELICITATION_TITLE_SUFFIX_MIN = 12
/** Hje — horizontal chrome (2*2 vs 2*(2+1) → 6). */
export const ELICITATION_H_CHROME = 6
/** UAt — prompt-row reserve outside a modal. */
export const ELICITATION_PROMPT_RESERVE = 2

export type ElicitationOptionWindow = {
  start: number
  end: number
  showAbove: boolean
  showBelow: boolean
}

export type ElicitationFieldWindow = {
  start: number
  end: number
}

/** Pd — count non-overlapping needle hits from `from`. */
export function countSubstr(
  haystack: string,
  needle: string,
  from = 0,
): number {
  let n = 0
  let o = haystack.indexOf(needle, from)
  while (o !== -1) {
    n++
    o = haystack.indexOf(needle, o + 1)
  }
  return n
}

/** fp — first line (Cs(text, "\\n")). */
export function firstLine(text: string): string {
  const i = text.indexOf('\n')
  return i === -1 ? text : text.slice(0, i)
}

/**
 * pKc — wrap/truncate an elicitation message to `maxLines` (default dKc+1).
 * r<=1 suffix has a leading space; the multi-line remainder line does not.
 */
export function wrapElicitationMessage(
  text: string,
  columns: number,
  maxLines = ELICITATION_MESSAGE_MAX_LINES + 1,
): string {
  const width = Math.max(ELICITATION_MIN_WIDTH, columns - ELICITATION_H_CHROME)
  const lines = text.split('\n').map(line => truncateToWidth(line, width))
  if (lines.length <= maxLines) {
    return lines.join('\n')
  }
  if (maxLines <= 1) {
    const suffix = ` \u2026 (+${lines.length - 1} more lines)`
    return (
      truncateToWidth(
        firstLine(text),
        Math.max(1, width - stringWidth(suffix)),
      ) + suffix
    )
  }
  const keep = maxLines - 1
  return (
    lines.slice(0, keep).join('\n') +
    `\n\u2026 (+${lines.length - keep} more lines)`
  )
}

/** Ye — available rows after fullscreen / modal / prompt chrome. */
export function computeElicitationAvailableRows(
  clampFieldRows: boolean,
  insideModal: boolean,
  rows: number,
  hasSessionChrome: boolean,
): number {
  if (!clampFieldRows) {
    return rows
  }
  if (insideModal) {
    return rows
  }
  return rows - ELICITATION_PROMPT_RESERVE - 2 - (hasSessionChrome ? 1 : 0)
}

/** ze — extra subtitle leading newline when the pane is tall enough. */
export function elicitationSubtitlePad(
  clampFieldRows: boolean,
  availableRows: number,
): number {
  return clampFieldRows ? (availableRows >= 18 ? 1 : 0) : 1
}

/** Ze — how many wrapped message lines fit. */
export function computeElicitationMessageLineBudget(
  clampFieldRows: boolean,
  availableRows: number,
  fieldCount: number,
  subtitlePad: number,
): number {
  const multiFieldPad = fieldCount > 1 ? ELICITATION_MULTI_FIELD_PAD : 0
  const roomy = Math.min(
    ELICITATION_MESSAGE_MAX_LINES + 1,
    Math.max(
      1,
      availableRows -
        ELICITATION_CHROME_ROWS -
        subtitlePad -
        multiFieldPad -
        Math.min(2, fieldCount) * ELICITATION_LINES_PER_FIELD,
    ),
  )
  const tight = Math.max(
    1,
    availableRows -
      ELICITATION_CHROME_ROWS -
      subtitlePad -
      multiFieldPad -
      Math.min(1, fieldCount) * ELICITATION_LINES_PER_FIELD,
  )
  return clampFieldRows
    ? Math.min(roomy, tight)
    : ELICITATION_MESSAGE_MAX_LINES + 1
}

/** at — rows left for fields + expanded options. */
export function elicitationRemainingRows(
  availableRows: number,
  subtitlePad: number,
  wrappedMessage: string,
  fieldCount: number,
): number {
  const multiFieldPad = fieldCount > 1 ? ELICITATION_MULTI_FIELD_PAD : 0
  const messageRows = wrappedMessage
    ? subtitlePad + countSubstr(wrappedMessage, '\n') + 1
    : 0
  return availableRows - ELICITATION_CHROME_ROWS - messageRows - multiFieldPad
}

/** xt — accordion option window. null = show every option. */
export function computeElicitationOptionWindow(
  clampFieldRows: boolean,
  optionCount: number,
  optionBudget: number,
  focusedOptionIndex: number,
): ElicitationOptionWindow | null {
  if (!clampFieldRows || optionCount <= optionBudget) {
    return null
  }
  const budget = Math.max(1, optionBudget)
  const inner = Math.max(1, budget - 2)
  let start = Math.max(0, focusedOptionIndex - Math.floor(inner / 2))
  let end = Math.min(start + inner, optionCount)
  start = Math.max(0, end - inner)
  let showAbove = start > 0
  let showBelow = end < optionCount
  let overflow =
    end - start + (showAbove ? 1 : 0) + (showBelow ? 1 : 0) - budget
  if (overflow > 0 && showAbove) {
    showAbove = false
    overflow--
  }
  if (overflow > 0) {
    showBelow = false
  }
  return { start, end, showAbove, showBelow }
}

/** lt — rows consumed by the expanded option list (or hints). */
export function elicitationOptionWindowRows(
  clampFieldRows: boolean,
  optionCount: number,
  optionWindow: ElicitationOptionWindow | null,
): number {
  if (!clampFieldRows || optionCount === 0) {
    return 0
  }
  if (optionWindow === null) {
    return optionCount
  }
  return (
    optionWindow.end -
    optionWindow.start +
    (optionWindow.showAbove ? 1 : 0) +
    (optionWindow.showBelow ? 1 : 0)
  )
}

/** Mt — visible field count. */
export function elicitationMaxVisibleFields(
  clampFieldRows: boolean,
  remainingRows: number,
  optionWindowRows: number,
  terminalRows: number,
): number {
  if (clampFieldRows) {
    return Math.max(
      1,
      Math.floor(
        (remainingRows - optionWindowRows) / ELICITATION_LINES_PER_FIELD,
      ),
    )
  }
  return Math.max(
    2,
    Math.floor(
      (terminalRows - ELICITATION_DIALOG_OVERHEAD) /
        ELICITATION_LINES_PER_FIELD,
    ),
  )
}

/** Bt — field scroll window, focus-centered. */
export function computeElicitationFieldWindow(
  total: number,
  maxVisible: number,
  currentFieldIndex: number | undefined,
): ElicitationFieldWindow {
  if (total <= maxVisible) {
    return { start: 0, end: total }
  }
  const focus = currentFieldIndex ?? total - 1
  let start = Math.max(0, focus - Math.floor(maxVisible / 2))
  const end = Math.min(start + maxVisible, total)
  start = Math.max(0, end - maxVisible)
  return { start, end }
}

export function elicitationLabelWidth(columns: number): number {
  return Math.max(8, columns - ELICITATION_H_CHROME - 8 - ELICITATION_MIN_WIDTH)
}

export function elicitationValueWidth(columns: number, label: string): number {
  return Math.max(
    ELICITATION_MIN_WIDTH,
    columns - ELICITATION_H_CHROME - 8 - stringWidth(label),
  )
}

export function elicitationOptionLabelWidth(columns: number): number {
  return Math.max(ELICITATION_MIN_WIDTH, columns - ELICITATION_H_CHROME - 6 - 4)
}

export function elicitationDescriptionWidth(columns: number): number {
  return Math.max(ELICITATION_MIN_WIDTH, columns - 6 - ELICITATION_H_CHROME)
}

/**
 * Title: `MCP server “name” requests your input`.
 * When clampFieldRows, nest Hi() so the server name yields first.
 * `taskSuffix` is official ` (task …)` — tip does not invent that parser.
 */
export function formatElicitationTitle(
  serverName: string,
  columns: number,
  clampFieldRows: boolean,
  taskSuffix = '',
): string {
  const prefix = 'MCP server \u201C'
  const suffix = '\u201D requests your input'
  const width = Math.max(ELICITATION_MIN_WIDTH, columns - ELICITATION_H_CHROME)
  const keepSuffix =
    width - stringWidth(prefix) - stringWidth(`${suffix}${taskSuffix}`) >=
    ELICITATION_TITLE_SUFFIX_MIN
      ? `${suffix}${taskSuffix}`
      : suffix
  if (!clampFieldRows) {
    return `${prefix}${serverName}${suffix}${taskSuffix}`
  }
  return truncateToWidth(
    prefix +
      truncateToWidth(
        serverName,
        Math.max(1, width - stringWidth(prefix) - stringWidth(keepSuffix)),
      ) +
      keepSuffix,
    width,
  )
}

export function clampElicitationText(
  text: string,
  width: number,
  clampFieldRows: boolean,
): string {
  return clampFieldRows ? truncateToWidth(text, width) : text
}
