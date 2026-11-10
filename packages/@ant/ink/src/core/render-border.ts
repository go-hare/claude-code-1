import chalk from 'chalk'
import cliBoxes, { type Boxes, type BoxStyle } from 'cli-boxes'
import { logForDebugging } from '../utils/debug.js'
import { applyColor, applyTextStyles } from './colorize.js'
import type { DOMNode } from './dom.js'
import type Output from './output.js'
import { stringWidth } from './stringWidth.js'
import type { Color } from './styles.js'
import { expandTabsForWrap } from './tabstops.js'
import sliceAnsiFallback from './utils/sliceAnsi.js'

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

export type BorderTextOptions = {
  content: string // Pre-rendered string with ANSI color codes
  position: 'top' | 'bottom'
  align: 'start' | 'end' | 'center'
  offset?: number // Only used with 'start' or 'end' alignment. Number of characters from the edge.
}

export const CUSTOM_BORDER_STYLES = {
  dashed: {
    top: '╌',
    left: '╎',
    right: '╎',
    bottom: '╌',
    // there aren't any line-drawing characters for dashes unfortunately
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
  quote: {
    top: ' ',
    left: '▎',
    right: ' ',
    bottom: ' ',
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
} as const

export type BorderStyle =
  | keyof Boxes
  | keyof typeof CUSTOM_BORDER_STYLES
  | BoxStyle

function embedTextInBorder(
  borderLine: string,
  text: string,
  align: 'start' | 'end' | 'center',
  offset: number = 0,
  borderChar: string,
): [before: string, text: string, after: string] {
  text = expandTabsForWrap(text)
  const textLength = stringWidth(text)
  const borderLength = borderLine.length

  if (textLength >= borderLength - 2) {
    const truncated = sliceFit(text, 0, borderLength)
    const pad = borderChar.repeat(
      Math.max(0, borderLength - stringWidth(truncated)),
    )
    return ['', truncated, pad]
  }

  let position: number
  if (align === 'center') {
    position = Math.floor((borderLength - textLength) / 2)
  } else if (align === 'start') {
    position = offset + 1 // +1 to account for corner character
  } else {
    // align === 'end'
    position = borderLength - textLength - offset - 1 // -1 for corner character
  }

  // Ensure position is valid
  position = Math.max(1, Math.min(position, borderLength - textLength - 1))

  const before =
    borderLine.substring(0, 1) + borderChar.repeat(Math.max(0, position - 1))
  const after =
    borderChar.repeat(Math.max(0, borderLength - position - textLength - 1)) +
    borderLine.substring(borderLength - 1)

  return [before, text, after]
}

function styleBorderLine(
  line: string,
  color: Color | undefined,
  dim: boolean | undefined,
): string {
  let styled = applyColor(line, color)
  if (dim) {
    styled = chalk.dim(styled)
  }
  return styled
}

function applyBorderBackground(
  segment: string,
  backgroundColor: Color | undefined,
): string {
  return backgroundColor
    ? applyTextStyles(segment, { backgroundColor })
    : segment
}

const renderBorder = (
  x: number,
  y: number,
  node: DOMNode,
  output: Output,
  boxBackgroundColor?: Color,
): void => {
  if (node.style.borderStyle) {
    const width = Math.floor(node.yogaNode!.getComputedWidth())
    const height = Math.floor(node.yogaNode!.getComputedHeight())
    const box =
      typeof node.style.borderStyle === 'string'
        ? (CUSTOM_BORDER_STYLES[
            node.style.borderStyle as keyof typeof CUSTOM_BORDER_STYLES
          ] ?? cliBoxes[node.style.borderStyle as keyof Boxes])
        : node.style.borderStyle

    // densable Zmn: unknown borderStyle → no border + log, not throw at paint.
    if (box === undefined || typeof box.top !== 'string') {
      const style = node.style.borderStyle
      logForDebugging(
        typeof style === 'string'
          ? `Box borderStyle "${style}" is not a border style; the Box is drawn with no border`
          : `Box borderStyle is ${typeof style}, not a style name; the Box is drawn with no border`,
      )
      return
    }

    const topBorderColor = node.style.borderTopColor ?? node.style.borderColor
    const bottomBorderColor =
      node.style.borderBottomColor ?? node.style.borderColor
    const leftBorderColor = node.style.borderLeftColor ?? node.style.borderColor
    const rightBorderColor =
      node.style.borderRightColor ?? node.style.borderColor

    const dimTopBorderColor =
      node.style.borderTopDimColor ?? node.style.borderDimColor

    const dimBottomBorderColor =
      node.style.borderBottomDimColor ?? node.style.borderDimColor

    const dimLeftBorderColor =
      node.style.borderLeftDimColor ?? node.style.borderDimColor

    const dimRightBorderColor =
      node.style.borderRightDimColor ?? node.style.borderDimColor

    const showTopBorder = node.style.borderTop !== false
    const showBottomBorder = node.style.borderBottom !== false
    const showLeftBorder = node.style.borderLeft !== false
    const showRightBorder = node.style.borderRight !== false

    const contentWidth = Math.max(
      0,
      width - (showLeftBorder ? 1 : 0) - (showRightBorder ? 1 : 0),
    )

    const topBorderLine = showTopBorder
      ? (showLeftBorder ? box.topLeft : '') +
        box.top.repeat(contentWidth) +
        (showRightBorder ? box.topRight : '')
      : ''

    // Handle text in top border
    let topBorder: string | undefined
    if (showTopBorder && node.style.borderText?.position === 'top') {
      const [before, text, after] = embedTextInBorder(
        topBorderLine,
        node.style.borderText.content,
        node.style.borderText.align,
        node.style.borderText.offset,
        box.top,
      )
      topBorder =
        styleBorderLine(before, topBorderColor, dimTopBorderColor) +
        text +
        styleBorderLine(after, topBorderColor, dimTopBorderColor)
    } else if (showTopBorder) {
      topBorder = styleBorderLine(
        topBorderLine,
        topBorderColor,
        dimTopBorderColor,
      )
    }

    let verticalBorderHeight = height

    if (showTopBorder) {
      verticalBorderHeight -= 1
    }

    if (showBottomBorder) {
      verticalBorderHeight -= 1
    }

    verticalBorderHeight = Math.max(0, verticalBorderHeight)

    let leftBorder = (applyColor(box.left, leftBorderColor) + '\n').repeat(
      verticalBorderHeight,
    )

    if (dimLeftBorderColor) {
      leftBorder = chalk.dim(leftBorder)
    }

    let rightBorder = (applyColor(box.right, rightBorderColor) + '\n').repeat(
      verticalBorderHeight,
    )

    if (dimRightBorderColor) {
      rightBorder = chalk.dim(rightBorder)
    }

    const bottomBorderLine = showBottomBorder
      ? (showLeftBorder ? box.bottomLeft : '') +
        box.bottom.repeat(contentWidth) +
        (showRightBorder ? box.bottomRight : '')
      : ''

    // Handle text in bottom border
    let bottomBorder: string | undefined
    if (showBottomBorder && node.style.borderText?.position === 'bottom') {
      const [before, text, after] = embedTextInBorder(
        bottomBorderLine,
        node.style.borderText.content,
        node.style.borderText.align,
        node.style.borderText.offset,
        box.bottom,
      )
      bottomBorder =
        styleBorderLine(before, bottomBorderColor, dimBottomBorderColor) +
        text +
        styleBorderLine(after, bottomBorderColor, dimBottomBorderColor)
    } else if (showBottomBorder) {
      bottomBorder = styleBorderLine(
        bottomBorderLine,
        bottomBorderColor,
        dimBottomBorderColor,
      )
    }

    const offsetY = showTopBorder ? 1 : 0

    if (topBorder) {
      output.write(x, y, applyBorderBackground(topBorder, boxBackgroundColor))
    }

    if (showLeftBorder) {
      output.write(
        x,
        y + offsetY,
        applyBorderBackground(leftBorder, boxBackgroundColor),
      )
    }

    if (showRightBorder) {
      output.write(
        x + width - 1,
        y + offsetY,
        applyBorderBackground(rightBorder, boxBackgroundColor),
      )
    }

    if (bottomBorder) {
      output.write(
        x,
        y + height - 1,
        applyBorderBackground(bottomBorder, boxBackgroundColor),
      )
    }
  }
}

export default renderBorder
