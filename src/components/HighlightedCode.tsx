import chalk from 'chalk';
import * as React from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import stripAnsi from 'strip-ansi';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, type DOMElement, measureElement, NoSelect, RawAnsi, Text, useTheme } from '@anthropic/ink';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js';
import sliceAnsi from '../utils/sliceAnsi.js';
import { countCharInString } from '../utils/stringUtils.js';
import { HighlightedCodeFallback } from './HighlightedCode/Fallback.js';
import { expectColorFile } from './StructuredDiff/colorDiff.js';
import type { ColorFile as ColorFileType } from 'color-diff-napi';

/**
 * Official 2.1.326 (#141): cap expensive syntax highlighting on very long newly
 * created files in permission prompts and Ctrl+O transcripts so the UI does not
 * freeze for seconds.
 */
export const HIGHLIGHTED_CODE_MAX_LINES = 1500;
export const HIGHLIGHTED_CODE_MAX_CHARS = 150_000;
export const HIGHLIGHTED_CODE_MAX_LINE_CHARS = 2000;

export function truncateLongCodeLines(code: string): string {
  if (code.length <= HIGHLIGHTED_CODE_MAX_LINE_CHARS) return code;
  return code
    .split('\n')
    .map(line => {
      if (line.length <= HIGHLIGHTED_CODE_MAX_LINE_CHARS) return line;
      const truncated = line.length - HIGHLIGHTED_CODE_MAX_LINE_CHARS;
      return `${line.slice(0, HIGHLIGHTED_CODE_MAX_LINE_CHARS)} … [+${truncated} chars]`;
    })
    .join('\n');
}

export function exceedsHighlightCodeCap(code: string, lineCount?: number): boolean {
  if (code.length > HIGHLIGHTED_CODE_MAX_CHARS) return true;
  const lines = lineCount ?? countCodeLines(code);
  return lines > HIGHLIGHTED_CODE_MAX_LINES;
}

/**
 * Official 2.1.326 (#219): ColorFile renders on a transparent background, so
 * hardcoded theme-default foregrounds (`rgb(248,248,242)` / `rgb(51,51,51)`)
 * become invisible when the theme and terminal background differ. Rewrite them
 * to `\x1b[39m` (terminal default foreground).
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional ANSI SGR match
const TRANSPARENT_CODE_DEFAULT_FG_RE = /\x1b\[(?:38;2;248;248;242|38;2;51;51;51)m/g;

export function normalizeTransparentCodeForeground(line: string): string {
  return line.replace(TRANSPARENT_CODE_DEFAULT_FG_RE, '\x1b[39m');
}

function convertLeadingTabsToSpaces(content: string): string {
  if (!content.includes('\t')) return content;
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length));
}

// Host-scoped LRU cache for ColorFile instances to avoid recreating
// them for the same (filePath, code) across component instances.
const colorFileCacheByHost = new HostSlot<Map<string, { colorFile: ColorFileType; code: string }>>(() => new Map());
const COLOR_FILE_CACHE_MAX = 50;

function getColorFileCache(): Map<string, { colorFile: ColorFileType; code: string }> {
  return colorFileCacheByHost.of(getBootstrapSessionHost());
}

type Props = {
  code: string;
  filePath: string;
  width?: number;
  isWidthFixed?: boolean;
  dim?: boolean;
  startLine?: number;
  lineNumbers?: boolean;
};

export function HighlightedCode({
  code,
  filePath,
  width,
  isWidthFixed = false,
  dim = false,
  startLine = 1,
  lineNumbers = true,
}: Props): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(width ?? 0);
  const [theme] = useTheme();
  const settings = useSettings();
  const syntaxHighlightingDisabled = settings.syntaxHighlightingDisabled ?? false;
  const lineCount = useMemo(() => countCodeLines(code), [code]);
  const exceedsCap = useMemo(() => exceedsHighlightCodeCap(code, lineCount), [code, lineCount]);

  const colorFile = useMemo(() => {
    if (syntaxHighlightingDisabled || exceedsCap) {
      return null;
    }
    const ColorFile = expectColorFile();
    if (!ColorFile) {
      return null;
    }
    const normalized = convertLeadingTabsToSpaces(code);
    const cacheKey = `${filePath}\0${normalized.length}`;
    const colorFileCache = getColorFileCache();
    const cached = colorFileCache.get(cacheKey);
    if (cached && cached.code === normalized) {
      // Move to end (most recently used)
      colorFileCache.delete(cacheKey);
      colorFileCache.set(cacheKey, cached);
      return cached.colorFile;
    }
    const instance = new ColorFile(normalized, filePath);
    // Evict oldest entry if cache is full
    if (colorFileCache.size >= COLOR_FILE_CACHE_MAX) {
      const oldest = colorFileCache.keys().next().value;
      if (oldest !== undefined) colorFileCache.delete(oldest);
    }
    colorFileCache.set(cacheKey, { colorFile: instance, code: normalized });
    return instance;
  }, [code, filePath, syntaxHighlightingDisabled, exceedsCap]);

  useLayoutEffect(() => {
    if (width) {
      setMeasuredWidth(width);
      return;
    }
    if (ref.current) {
      const { width: elementWidth } = measureElement(ref.current);
      if (elementWidth > 0) {
        setMeasuredWidth(elementWidth - 2);
        return;
      }
    }
    setMeasuredWidth(width ?? 80);
  }, [width]);

  const baseGutterWidth = String(lineCount).length + 2;

  const shiftedGutter = useMemo(() => {
    if (!lineNumbers || startLine === 1) {
      return null;
    }
    const digits = String(startLine + lineCount - 1).length;
    const extraCols = Math.max(0, digits - String(lineCount).length);
    return { digits, extraCols };
  }, [lineNumbers, startLine, lineCount]);

  const shouldSplit = isFullscreenEnvEnabled() || startLine !== 1 || !lineNumbers;

  const rendered = useMemo(() => {
    if (colorFile === null || measuredWidth <= 0) {
      return null;
    }
    const renderWidth = measuredWidth - (shiftedGutter?.extraCols ?? 0) + (lineNumbers ? 0 : baseGutterWidth);
    const rawLines = (colorFile.render(theme, renderWidth, dim) ?? []).map(normalizeTransparentCodeForeground);
    if (lineNumbers && !shouldSplit) {
      return { split: false as const, lines: rawLines };
    }
    const gutters = rawLines.map(line => sliceAnsi(line, 0, baseGutterWidth));
    const contents = rawLines.map(line => sliceAnsi(line, baseGutterWidth));
    return { split: true as const, gutters, contents };
  }, [colorFile, theme, measuredWidth, dim, shiftedGutter, lineNumbers, baseGutterWidth, shouldSplit]);

  const displayGutters = useMemo(() => {
    if (shiftedGutter === null || rendered === null || !rendered.split) {
      return null;
    }
    const { digits } = shiftedGutter;
    let nextLine = startLine;
    return rendered.gutters.map(gutter => {
      if (stripAnsi(gutter).trim() === '') {
        return ' '.repeat(digits + 2);
      }
      const lineNumber = nextLine;
      nextLine += 1;
      return ` ${String(lineNumber).padStart(digits)} `;
    });
  }, [shiftedGutter, rendered, startLine]);

  // Official 2.1.326 (#141): O(1)-Yoga-leaf RawAnsi fast path when rendering
  // a fixed-width file preview (e.g. Write tool permission prompt / Ctrl+O).
  const isScreenReader = isScreenReaderModeEnabled();
  if (
    rendered &&
    (isWidthFixed || (width !== undefined && lineCount > 100)) &&
    width !== undefined &&
    width > baseGutterWidth &&
    lineNumbers &&
    startLine === 1 &&
    !isScreenReader &&
    chalk.level >= 2
  ) {
    if (rendered.split) {
      return (
        <Box flexDirection="row">
          <NoSelect fromLeftEdge flexShrink={0}>
            <RawAnsi lines={rendered.gutters} width={baseGutterWidth} />
          </NoSelect>
          <RawAnsi lines={rendered.contents} width={width - baseGutterWidth} />
        </Box>
      );
    }
    return (
      <Box>
        <RawAnsi lines={rendered.lines} width={width} />
      </Box>
    );
  }

  return (
    <Box ref={ref}>
      {rendered ? (
        <Box flexDirection="column">
          {rendered.split
            ? rendered.contents.map((content, i) =>
                !lineNumbers ? (
                  <Text key={i}>
                    <Ansi>{content}</Ansi>
                  </Text>
                ) : (
                  <CodeLine
                    key={i}
                    gutter={rendered.gutters[i]!}
                    content={content}
                    displayGutter={displayGutters?.[i]}
                  />
                ),
              )
            : rendered.lines.map((line, i) => (
                <Text key={i}>
                  <Ansi>{line}</Ansi>
                </Text>
              ))}
        </Box>
      ) : (
        <Box flexDirection="column">
          {lineNumbers && startLine !== 1 && <Text dimColor>… from line {startLine}</Text>}
          <HighlightedCodeFallback
            code={truncateLongCodeLines(code)}
            filePath={filePath}
            dim={dim}
            skipColoring={syntaxHighlightingDisabled || exceedsCap}
          />
        </Box>
      )}
    </Box>
  );
}

function countCodeLines(code: string): number {
  const n = countCharInString(code, '\n') + 1;
  return code.endsWith('\n') ? n - 1 : n;
}

function CodeLine({
  gutter,
  content,
  displayGutter,
}: {
  gutter: string;
  content: string;
  displayGutter?: string;
}): React.ReactNode {
  return (
    <Box flexDirection="row">
      <NoSelect fromLeftEdge>
        {displayGutter === undefined ? (
          <Text>
            <Ansi>{gutter}</Ansi>
          </Text>
        ) : (
          <Text dimColor>{displayGutter}</Text>
        )}
      </NoSelect>
      <Text>
        <Ansi>{content}</Ansi>
      </Text>
    </Box>
  );
}
