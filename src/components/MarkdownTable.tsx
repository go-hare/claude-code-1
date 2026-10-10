import type { Token, Tokens } from 'marked';
import React from 'react';
import stripAnsi from 'strip-ansi';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { Ansi, stringWidth, useTheme, wrapAnsi } from '@anthropic/ink';
import type { CliHighlight } from '../utils/cliHighlight.js';
import { formatToken, padAligned } from '../utils/markdown.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { plural } from '../utils/stringUtils.js';

/** densable 2.1.289 `be` — parent indent + resize-race margin. */
const SAFETY_MARGIN = 4;

/** densable 2.1.289 `we` — minimum column width. */
const MIN_COLUMN_WIDTH = 3;

/**
 * densable 2.1.289 `Ao` — max wrapped lines per row before vertical
 * (key-value) format. Gold HAS this fallback; unique English is minify-hidden.
 */
const MAX_ROW_LINES = 4;

/** densable 2.1.289 `cr` — cap rendered table body rows. */
export const MAX_TABLE_ROWS = 200;

/** ANSI escape codes for text formatting */
const ANSI_BOLD_START = '\x1b[1m';
const ANSI_BOLD_END = '\x1b[22m';

const SENTENCE_END_RE = /[.!?…]["')\]]*$/;

type Props = {
  token: Tokens.Table;
  highlight: CliHighlight | null;
  /** Override terminal width (useful for testing) */
  forceWidth?: number;
};

/**
 * densable 2.1.289 `Be` — truncation footer after `cr` body rows.
 */
export function markdownTableTruncationFooter(hidden: number): string {
  return `… ${hidden.toLocaleString()} more ${plural(hidden, 'row')} not shown`;
}

/**
 * densable 2.1.289 `xhr` — screen-reader table: "Header: value." sentences.
 */
export function formatScreenReaderTable(headers: string[], rows: string[][]): string {
  function clean(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }
  function withSentenceEnd(text: string): string {
    return SENTENCE_END_RE.test(text) ? text : `${text}.`;
  }
  function formatRow(row: string[]): string {
    return row
      .map((cell, colIndex) => {
        const label = clean(headers[colIndex] ?? '');
        const value = clean(cell);
        if (!label && !value) return null;
        return withSentenceEnd(label ? `${label}: ${value}` : value);
      })
      .filter((part): part is string => part !== null)
      .join(' ');
  }
  const lines =
    rows.length > 0 ? rows.map(formatRow) : [headers.map(clean).filter(Boolean).map(withSentenceEnd).join(' ')];
  return lines.filter(line => line.length > 0).join('\n');
}

/**
 * Wrap text to fit within a given width, returning array of lines.
 * ANSI-aware: preserves styling across line breaks.
 *
 * @param hard - If true, break words that exceed width (needed when columns
 *               are narrower than the longest word). Default false.
 */
function wrapText(text: string, width: number, options?: { hard?: boolean }): string[] {
  if (width <= 0) return [text];
  // Strip trailing whitespace/newlines before wrapping.
  // formatToken() adds EOL to paragraphs and other token types,
  // which would otherwise create extra blank lines in table cells.
  const trimmedText = text.trimEnd();
  const wrapped = wrapAnsi(trimmedText, width, {
    hard: options?.hard ?? false,
    trim: false,
    wordWrap: true,
  });
  // Filter out empty lines that result from trailing newlines or
  // multiple consecutive newlines in the source content.
  const lines = wrapped.split('\n').filter(line => line.length > 0);
  // Ensure we always return at least one line (empty string for empty cells)
  return lines.length > 0 ? lines : [''];
}

/**
 * Renders a markdown table using Ink's Box layout.
 * Handles terminal width by:
 * 1. Calculating minimum column widths based on longest word
 * 2. Distributing available space proportionally
 * 3. Wrapping text within cells (no truncation)
 * 4. Properly aligning multi-line rows with borders
 *
 * Performance: uses per-render caches (formatCache, plainTextCache, wrapCache)
 * to avoid redundant formatCell/wrapText calls across the multiple passes
 * (width calculation, row line counting, rendering). Wrapped in React.memo
 * to skip re-renders when props are unchanged.
 */
export const MarkdownTable = React.memo(function MarkdownTable({
  token,
  highlight,
  forceWidth,
}: Props): React.ReactNode {
  const [theme] = useTheme();
  const { columns: actualTerminalWidth } = useTerminalSize();
  const terminalWidth = forceWidth ?? actualTerminalWidth;
  const screenReader = isScreenReaderModeEnabled();

  // densable wr `u` / `d` — slice body to cr before measuring or drawing.
  const truncatedCount = Math.max(0, token.rows.length - MAX_TABLE_ROWS);
  const rows = truncatedCount > 0 ? token.rows.slice(0, MAX_TABLE_ROWS) : token.rows;

  // Per-render caches — Token[] references are stable within a single token
  // prop (from LRU cache in Markdown.tsx), so reference equality is sufficient.
  const formatCache = new Map<Token[] | undefined, string>();
  const plainTextCache = new Map<Token[] | undefined, string>();

  function formatCell(tokens: Token[] | undefined): string {
    const cached = formatCache.get(tokens);
    if (cached !== undefined) return cached;
    const result = tokens?.map(_ => formatToken(_, theme, 0, null, null, highlight)).join('') ?? '';
    formatCache.set(tokens, result);
    return result;
  }

  function getPlainText(tokens: Token[] | undefined): string {
    const cached = plainTextCache.get(tokens);
    if (cached !== undefined) return cached;
    const result = stripAnsi(formatCell(tokens));
    plainTextCache.set(tokens, result);
    return result;
  }

  if (screenReader) {
    let text = formatScreenReaderTable(
      token.header.map(h => getPlainText(h.tokens)),
      rows.map(row => row.map(cell => getPlainText(cell?.tokens))),
    );
    if (truncatedCount > 0) {
      text += `\n${markdownTableTruncationFooter(truncatedCount)}`;
    }
    return <Ansi>{text}</Ansi>;
  }

  // Get the longest word width in a cell (minimum width to avoid breaking words)
  function getMinWidth(tokens: Token[] | undefined): number {
    const text = getPlainText(tokens);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    if (words.length === 0) return MIN_COLUMN_WIDTH;
    return Math.max(...words.map(w => stringWidth(w)), MIN_COLUMN_WIDTH);
  }

  // Get ideal width (full content without wrapping)
  function getIdealWidth(tokens: Token[] | undefined): number {
    return Math.max(stringWidth(getPlainText(tokens)), MIN_COLUMN_WIDTH);
  }

  // Calculate column widths
  // Step 1: Get minimum (longest word) and ideal (full content) widths
  const minWidths = token.header.map((header, colIndex) => {
    let maxMinWidth = getMinWidth(header.tokens);
    for (const row of rows) {
      maxMinWidth = Math.max(maxMinWidth, getMinWidth(row[colIndex]?.tokens));
    }
    return maxMinWidth;
  });

  const idealWidths = token.header.map((header, colIndex) => {
    let maxIdeal = getIdealWidth(header.tokens);
    for (const row of rows) {
      maxIdeal = Math.max(maxIdeal, getIdealWidth(row[colIndex]?.tokens));
    }
    return maxIdeal;
  });

  // Step 2: Calculate available space
  // Border overhead: │ content │ content │ = 1 + (width + 3) per column
  const numCols = token.header.length;
  const borderOverhead = 1 + numCols * 3; // │ + (2 padding + 1 border) per col
  // Account for SAFETY_MARGIN to avoid triggering the fallback safety check
  const availableWidth = Math.max(terminalWidth - borderOverhead - SAFETY_MARGIN, numCols * MIN_COLUMN_WIDTH);

  // Step 3: Calculate column widths that fit available space
  const totalMin = minWidths.reduce((sum, w) => sum + w, 0);
  const totalIdeal = idealWidths.reduce((sum, w) => sum + w, 0);

  // Track whether columns are narrower than longest words (needs hard wrap)
  let needsHardWrap = false;

  let columnWidths: number[];
  if (totalIdeal <= availableWidth) {
    // Everything fits - use ideal widths
    columnWidths = idealWidths;
  } else if (totalMin <= availableWidth) {
    // Need to shrink - give each column its min, distribute remaining space
    const extraSpace = availableWidth - totalMin;
    const overflows = idealWidths.map((ideal, i) => ideal - minWidths[i]!);
    const totalOverflow = overflows.reduce((sum, o) => sum + o, 0);

    columnWidths = minWidths.map((min, i) => {
      if (totalOverflow === 0) return min;
      const extra = Math.floor((overflows[i]! / totalOverflow) * extraSpace);
      return min + extra;
    });
  } else {
    // Table wider than terminal at minimum widths
    // Shrink columns proportionally to fit, allowing word breaks
    needsHardWrap = true;
    const scaleFactor = availableWidth / totalMin;
    columnWidths = minWidths.map(w => Math.max(Math.floor(w * scaleFactor), MIN_COLUMN_WIDTH));
  }

  // Step 4: Single-pass cell preparation — wraps each cell once, caches results
  // for reuse by both row-line counting and rendering.
  const wrapCache = new Map<Token[] | undefined, string[]>();

  function getWrappedLines(tokens: Token[] | undefined, colIndex: number): string[] {
    const cached = wrapCache.get(tokens);
    if (cached !== undefined) return cached;
    const formatted = formatCell(tokens);
    const lines = wrapText(formatted, columnWidths[colIndex]!, {
      hard: needsHardWrap,
    });
    wrapCache.set(tokens, lines);
    return lines;
  }

  // Step 5: Calculate max row lines using cached wrapped results
  let maxRowLines = 1;
  for (let i = 0; i < token.header.length; i++) {
    maxRowLines = Math.max(maxRowLines, getWrappedLines(token.header[i]!.tokens, i).length);
  }
  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      maxRowLines = Math.max(maxRowLines, getWrappedLines(row[i]?.tokens, i).length);
    }
  }

  const useVerticalFormat = maxRowLines > MAX_ROW_LINES;

  // Render a single row with potential multi-line cells
  // Returns an array of strings, one per line of the row
  function renderRowLines(cells: Array<{ tokens?: Token[] }>, isHeader: boolean): string[] {
    // Reuse cached wrapped lines — no redundant formatCell/wrapText
    const cellLines = cells.map((cell, colIndex) => getWrappedLines(cell.tokens, colIndex));

    // Find max number of lines in this row
    const maxLines = Math.max(...cellLines.map(lines => lines.length), 1);

    // Calculate vertical offset for each cell (to center vertically)
    const verticalOffsets = cellLines.map(lines => Math.floor((maxLines - lines.length) / 2));

    // Build each line of the row as a single string
    const result: string[] = [];
    for (let lineIdx = 0; lineIdx < maxLines; lineIdx++) {
      let line = '│';
      for (let colIndex = 0; colIndex < cells.length; colIndex++) {
        const lines = cellLines[colIndex]!;
        const offset = verticalOffsets[colIndex]!;
        const contentLineIdx = lineIdx - offset;
        const lineText = contentLineIdx >= 0 && contentLineIdx < lines.length ? lines[contentLineIdx]! : '';
        const width = columnWidths[colIndex]!;
        // Headers always centered; data uses table alignment
        const align = isHeader ? 'center' : (token.align?.[colIndex] ?? 'left');

        line += ' ' + padAligned(lineText, stringWidth(lineText), width, align) + ' │';
      }
      result.push(line);
    }

    return result;
  }

  // Render horizontal border as a single string
  function renderBorderLine(type: 'top' | 'middle' | 'bottom'): string {
    const [left, mid, cross, right] = {
      top: ['┌', '─', '┬', '┐'],
      middle: ['├', '─', '┼', '┤'],
      bottom: ['└', '─', '┴', '┘'],
    }[type] as [string, string, string, string];

    let line = left;
    columnWidths.forEach((width, colIndex) => {
      // densable 2.1.229 #8: never pass negative counts to String.repeat
      line += mid.repeat(Math.max(0, width + 2));
      line += colIndex < columnWidths.length - 1 ? cross : right;
    });
    return line;
  }

  // densable 2.1.289 `ct` — vertical (key-value) format for extra-narrow /
  // tall-wrap tables. Gold HAS this; CJK unspaced cells trip Ao=4 easily.
  function renderVerticalFormat(): string {
    const lines: string[] = [];
    const headers = token.header.map(h => getPlainText(h.tokens));
    // densable 2.1.229 #8: terminalWidth 0/1 → Math.min(width-1,40) is negative and
    // '─'.repeat throws RangeError (also on --continue/--resume at startup).
    const separatorWidth = Math.max(0, Math.min(terminalWidth - 1, 40));
    const separator = '─'.repeat(separatorWidth);

    rows.forEach((row, rowIndex) => {
      const rowLines: string[] = [];
      row.forEach((cell, colIndex) => {
        const label = headers[colIndex] || '';
        // Clean value: trim, remove extra internal whitespace/newlines
        const rawValue = formatCell(cell.tokens).trimEnd();
        const value = rawValue.replace(/\n+/g, ' ').replace(/\s+/g, ' ').trim();
        if (!label && !value) return;

        // Wrap value to fit terminal, accounting for label on first line
        const firstLineWidth = label ? terminalWidth - stringWidth(label) - 3 : terminalWidth - 1;
        const subsequentLineWidth = terminalWidth - 3;

        // Two-pass wrap: first line is narrower (label takes space),
        // continuation lines get the full width minus indent.
        const firstPassLines = wrapText(value, Math.max(firstLineWidth, 10));
        const firstLine = firstPassLines[0] || '';

        let wrappedValue: string[];
        if (firstPassLines.length <= 1 || subsequentLineWidth <= firstLineWidth) {
          wrappedValue = firstPassLines;
        } else {
          // Re-join remaining text and re-wrap to the wider continuation width
          const remainingText = firstPassLines
            .slice(1)
            .map(l => l.trim())
            .join(' ');
          const rewrapped = wrapText(remainingText, subsequentLineWidth);
          wrappedValue = [firstLine, ...rewrapped];
        }

        // First line: bold label + value (gold omits "Column N" fallback)
        rowLines.push(
          label ? `${ANSI_BOLD_START}${label}:${ANSI_BOLD_END} ${wrappedValue[0] || ''}` : wrappedValue[0] || '',
        );

        // Subsequent lines (gold ct: no wrap indent)
        for (let i = 1; i < wrappedValue.length; i++) {
          const line = wrappedValue[i]!;
          if (!line.trim()) continue;
          rowLines.push(line);
        }
      });
      if (rowLines.length === 0) return;
      if (rowIndex > 0 || lines.length > 0) {
        lines.push(separator);
      }
      lines.push(...rowLines);
    });

    if (truncatedCount > 0) {
      if (lines.length > 0) lines.push(separator);
      lines.push(markdownTableTruncationFooter(truncatedCount));
    }

    return lines.join('\n');
  }

  // Choose format based on available width
  if (useVerticalFormat) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  // Build the complete horizontal table as an array of strings
  const tableLines: string[] = [];
  tableLines.push(renderBorderLine('top'));
  tableLines.push(...renderRowLines(token.header, true));
  tableLines.push(renderBorderLine('middle'));
  rows.forEach((row, rowIndex) => {
    tableLines.push(...renderRowLines(row, false));
    if (rowIndex < rows.length - 1) {
      tableLines.push(renderBorderLine('middle'));
    }
  });
  tableLines.push(renderBorderLine('bottom'));

  // Safety check: verify no line exceeds terminal width.
  // This catches edge cases during terminal resize where calculations
  // were based on a different width than the current render target.
  const maxLineWidth = Math.max(...tableLines.map(line => stringWidth(stripAnsi(line))));

  // If we're within SAFETY_MARGIN characters of the edge, use vertical format
  // to account for terminal resize race conditions.
  if (maxLineWidth > terminalWidth - SAFETY_MARGIN) {
    return <Ansi>{renderVerticalFormat()}</Ansi>;
  }

  if (truncatedCount > 0) {
    tableLines.push(markdownTableTruncationFooter(truncatedCount));
  }

  // Render as a single Ansi block to prevent Ink from wrapping mid-row
  return <Ansi>{tableLines.join('\n')}</Ansi>;
});
