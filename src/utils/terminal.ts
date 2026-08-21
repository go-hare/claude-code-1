import chalk from 'chalk'
import { ctrlOToExpand } from '../components/CtrlOToExpand.js'
import { stringWidth } from '@anthropic/ink'
import sliceAnsi from './sliceAnsi.js'

// Text rendering utilities for terminal display
const MAX_LINES_TO_SHOW = 3
// Account for MessageResponse prefix ("  ⎿ " = 5 chars) + parent width
// reduction (columns - 5 in tool result rendering)
const PADDING_TO_PREVENT_OVERFLOW = 10

/**
 * Inserts newlines in a string to wrap it at the specified width.
 * Uses ANSI-aware slicing to avoid splitting escape sequences.
 * @param text The text to wrap.
 * @param wrapWidth The width at which to wrap lines (in visible characters).
 * @returns The wrapped text.
 */
function wrapText(
  text: string,
  wrapWidth: number,
): { aboveTheFold: string; remainingLines: number } {
  const lines = text.split('\n')
  const wrappedLines: string[] = []

  for (const line of lines) {
    const visibleWidth = stringWidth(line)
    if (visibleWidth <= wrapWidth) {
      wrappedLines.push(line.trimEnd())
    } else {
      // Break long lines into chunks of wrapWidth visible characters
      // using ANSI-aware slicing to preserve escape sequences
      let position = 0
      while (position < visibleWidth) {
        const chunk = sliceAnsi(line, position, position + wrapWidth)
        wrappedLines.push(chunk.trimEnd())
        position += wrapWidth
      }
    }
  }

  const remainingLines = wrappedLines.length - MAX_LINES_TO_SHOW

  // If there's only 1 line after the fold, show it directly
  // instead of showing "... +1 line (ctrl+o to expand)"
  if (remainingLines === 1) {
    return {
      aboveTheFold: wrappedLines
        .slice(0, MAX_LINES_TO_SHOW + 1)
        .join('\n')
        .trimEnd(),
      remainingLines: 0, // All lines are shown, nothing remaining
    }
  }

  // Otherwise show the standard MAX_LINES_TO_SHOW
  return {
    aboveTheFold: wrappedLines.slice(0, MAX_LINES_TO_SHOW).join('\n').trimEnd(),
    remainingLines: Math.max(0, remainingLines),
  }
}

/**
 * Renders the content with line-based truncation for terminal display.
 * If the content exceeds the maximum number of lines, it truncates the content
 * and adds a message indicating the number of additional lines.
 * @param content The content to render.
 * @param terminalWidth Terminal width for wrapping lines.
 * @returns The rendered content with truncation if needed.
 */
export function renderTruncatedContent(
  content: string,
  terminalWidth: number,
  suppressExpandHint = false,
): string {
  const trimmedContent = content.trimEnd()
  if (!trimmedContent) {
    return ''
  }

  const wrapWidth = Math.max(terminalWidth - PADDING_TO_PREVENT_OVERFLOW, 10)

  // Only process enough content for the visible lines. Avoids O(n) wrapping
  // on huge outputs (e.g. 64MB binary dumps that cause 382K-row screens).
  const maxChars = MAX_LINES_TO_SHOW * wrapWidth * 4
  const preTruncated = trimmedContent.length > maxChars
  const contentForWrapping = preTruncated
    ? trimmedContent.slice(0, maxChars)
    : trimmedContent

  const { aboveTheFold, remainingLines } = wrapText(
    contentForWrapping,
    wrapWidth,
  )

  const estimatedRemaining = preTruncated
    ? Math.max(
        remainingLines,
        Math.ceil(trimmedContent.length / wrapWidth) - MAX_LINES_TO_SHOW,
      )
    : remainingLines

  return [
    aboveTheFold,
    estimatedRemaining > 0
      ? chalk.dim(
          `… +${estimatedRemaining} lines${suppressExpandHint ? '' : ` ${ctrlOToExpand()}`}`,
        )
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

/**
 * densable SEA `r7`/`t7` (2.1.236+ / 2.1.237): would OutputLine truncate?
 *
 * 1. Non-string → false (MessagesBoundary / MCPTool may pass object toolUseResult).
 * 2. Raw newline count on trimEnd'd text (MAX_LINES_TO_SHOW+1 probes).
 * 3. Optional terminalWidth: wrap-aware visual-line budget (densable `t` arg).
 *    When width omitted, match SEA: only the newline probe decides.
 */
export function isOutputLineTruncated(
  content: unknown,
  terminalWidth?: number,
): boolean {
  // densable: if(typeof e!=="string")return!1
  if (typeof content !== 'string') return false

  const trimmed = content.trimEnd()
  let pos = 0
  let newlineCount = 0
  // densable: for(c=0;c<=dMt;c++) with dMt=3 — need >3 newlines to truncate
  for (let i = 0; i <= MAX_LINES_TO_SHOW; i++) {
    pos = trimmed.indexOf('\n', pos)
    if (pos === -1) break
    newlineCount++
    pos++
  }
  // densable: if(n!==-1&&n<r.length)return!0
  if (pos !== -1 && pos < trimmed.length) return true
  // densable: if(t===void 0)return!1
  if (terminalWidth === undefined) return false

  const wrapWidth = Math.max(terminalWidth - PADDING_TO_PREVENT_OVERFLOW, 10)
  // densable s=dMt+1 — wrapText shows MAX+1 when remainingLines===1
  const maxVisibleLines = MAX_LINES_TO_SHOW + 1
  const maxChars = MAX_LINES_TO_SHOW * wrapWidth * 4
  if (trimmed.length > maxChars) return true

  if (newlineCount === 0) {
    const singleLineBudget = maxVisibleLines * wrapWidth
    if (trimmed.length <= singleLineBudget) return false
    return stringWidth(trimmed) > singleLineBudget
  }

  let visualLines = 0
  for (const line of trimmed.split('\n')) {
    visualLines += Math.max(1, Math.ceil(stringWidth(line) / wrapWidth))
    if (visualLines > maxVisibleLines) return true
  }
  return false
}
