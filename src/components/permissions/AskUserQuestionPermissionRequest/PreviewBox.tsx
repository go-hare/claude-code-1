import React, { Suspense, use, useMemo } from 'react';
import { useSettings } from '../../../hooks/useSettings.js';
import { useTerminalSize } from '../../../hooks/useTerminalSize.js';
import { Ansi, Box, Text, stringWidth, useTheme, wrapAnsi } from '@anthropic/ink';
import { type CliHighlight, getCliHighlightPromise } from '../../../utils/cliHighlight.js';
import { applyMarkdown } from '../../../utils/markdown.js';

type PreviewBoxProps = {
  /** The preview content to display. Markdown is rendered with syntax highlighting
   * for code blocks (```ts, ```py, etc.). Also supports plain multi-line text. */
  content: string;
  /** Maximum number of lines to display before truncating. @default 20 */
  maxLines?: number;
  /** Minimum height (in lines) for the preview box. Content will be padded if shorter. */
  minHeight?: number;
  /** Minimum width for the preview box. @default 40 */
  minWidth?: number;
  /** Maximum width available for this box (e.g., the container width). */
  maxWidth?: number;
};

const BOX_CHARS = {
  topLeft: '┌',
  topRight: '┐',
  bottomLeft: '└',
  bottomRight: '┘',
  horizontal: '─',
  vertical: '│',
  teeLeft: '├',
  teeRight: '┤',
};

/**
 * A bordered monospace box for displaying preview content.
 * Truncates content that exceeds maxLines with an indicator.
 * The parent component should pass maxLines based on its available height budget.
 */
export function PreviewBox(props: PreviewBoxProps): React.ReactNode {
  const settings = useSettings();
  if (settings.syntaxHighlightingDisabled) {
    return <PreviewBoxBody {...props} highlight={null} />;
  }
  return (
    <Suspense fallback={<PreviewBoxBody {...props} highlight={null} />}>
      <PreviewBoxWithHighlight {...props} />
    </Suspense>
  );
}

function PreviewBoxWithHighlight(props: PreviewBoxProps): React.ReactNode {
  const highlight = use(getCliHighlightPromise());
  return <PreviewBoxBody {...props} highlight={highlight} />;
}

function PreviewBoxBody({
  content,
  maxLines,
  minHeight,
  minWidth = 40,
  maxWidth,
  highlight,
}: PreviewBoxProps & { highlight: CliHighlight | null }): React.ReactNode {
  const { columns: terminalWidth } = useTerminalSize();
  const [theme] = useTheme();
  const effectiveMaxWidth = maxWidth ?? terminalWidth - 4;

  // Use provided maxLines, or a reasonable default
  const effectiveMaxLines = maxLines ?? 20;

  // Render markdown with syntax highlighting for code blocks. applyMarkdown
  // returns an ANSI-styled string (bold, colors, etc.) that we split into
  // lines and wrap to fit the available inner width before truncating.
  const rendered = useMemo(() => applyMarkdown(content, theme, highlight), [content, theme, highlight]);
  const innerWidth = Math.max(1, effectiveMaxWidth - 4);
  const contentLines = rendered
    .split('\n')
    .flatMap(line =>
      stringWidth(line) > innerWidth ? wrapAnsi(line, innerWidth, { hard: true, trim: false }).split('\n') : line,
    );
  const isTruncated = contentLines.length > effectiveMaxLines;

  // Truncate to effectiveMaxLines
  const truncatedLines = isTruncated ? contentLines.slice(0, effectiveMaxLines) : contentLines;

  // Pad content with empty lines if shorter than minHeight, but never exceed
  // the truncation limit — otherwise padding undoes the truncation
  const effectiveMinHeight = Math.min(minHeight ?? 0, effectiveMaxLines);
  const paddingNeeded = Math.max(0, effectiveMinHeight - truncatedLines.length - (isTruncated ? 1 : 0));
  const lines = paddingNeeded > 0 ? [...truncatedLines, ...Array<string>(paddingNeeded).fill('')] : truncatedLines;

  // Calculate content width (max visual line width, handling unicode/emoji/CJK)
  const contentWidth = Math.max(minWidth, ...lines.map(line => stringWidth(line)));
  // Add 4 for borders and padding, cap at the container width to prevent line wrapping
  const boxWidth = Math.max(4, Math.min(contentWidth + 4, effectiveMaxWidth));
  const boxInnerWidth = boxWidth - 4; // Account for borders and padding

  // Render top border
  const topBorder = `${BOX_CHARS.topLeft}${BOX_CHARS.horizontal.repeat(boxWidth - 2)}${BOX_CHARS.topRight}`;

  // Render bottom border
  const bottomBorder = `${BOX_CHARS.bottomLeft}${BOX_CHARS.horizontal.repeat(boxWidth - 2)}${BOX_CHARS.bottomRight}`;

  // Build the truncation separator bar (e.g. ├─── ✂ ─── 42 lines hidden ──────┤)
  const truncationBar = isTruncated
    ? (() => {
        const hiddenCount = contentLines.length - effectiveMaxLines;
        const label = `${BOX_CHARS.horizontal.repeat(3)} \u2702 ${BOX_CHARS.horizontal.repeat(3)} ${hiddenCount} lines hidden `;
        const labelWidth = stringWidth(label);
        const fillWidth = Math.max(0, boxWidth - 2 - labelWidth);
        return `${BOX_CHARS.teeLeft}${label}${BOX_CHARS.horizontal.repeat(fillWidth)}${BOX_CHARS.teeRight}`;
      })()
    : null;

  return (
    <Box flexDirection="column">
      <Text dimColor>{topBorder}</Text>

      {lines.map((line, index) => {
        const displayLine = boxInnerWidth < 1 ? '' : line;
        const padding = ' '.repeat(Math.max(0, boxInnerWidth - stringWidth(displayLine)));

        return (
          <Box key={index} flexDirection="row">
            <Text dimColor>{BOX_CHARS.vertical} </Text>
            <Ansi>{displayLine}</Ansi>
            <Text dimColor>
              {padding} {BOX_CHARS.vertical}
            </Text>
          </Box>
        );
      })}

      {truncationBar && <Text color="warning">{truncationBar}</Text>}

      <Text dimColor>{bottomBorder}</Text>
    </Box>
  );
}
