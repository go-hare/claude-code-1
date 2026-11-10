import * as React from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import stripAnsi from 'strip-ansi';
import { useSettings } from '../hooks/useSettings.js';
import { Ansi, Box, type DOMElement, measureElement, NoSelect, Text, useTheme } from '@anthropic/ink';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import sliceAnsi from '../utils/sliceAnsi.js';
import { countCharInString } from '../utils/stringUtils.js';
import { HighlightedCodeFallback } from './HighlightedCode/Fallback.js';
import { expectColorFile } from './StructuredDiff/colorDiff.js';
import type { ColorFile as ColorFileType } from 'color-diff-napi';

function convertLeadingTabsToSpaces(content: string): string {
  if (!content.includes('\t')) return content;
  return content.replace(/^\t+/gm, _ => '  '.repeat(_.length));
}

// Module-level LRU cache for ColorFile instances to avoid recreating
// them for the same (filePath, code) across component instances.
const colorFileCache = new Map<string, { colorFile: ColorFileType; code: string }>();
const COLOR_FILE_CACHE_MAX = 50;

type Props = {
  code: string;
  filePath: string;
  width?: number;
  dim?: boolean;
  startLine?: number;
  lineNumbers?: boolean;
};

export function HighlightedCode({
  code,
  filePath,
  width,
  dim = false,
  startLine = 1,
  lineNumbers = true,
}: Props): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const [measuredWidth, setMeasuredWidth] = useState(width ?? 0);
  const [theme] = useTheme();
  const settings = useSettings();
  const syntaxHighlightingDisabled = settings.syntaxHighlightingDisabled ?? false;

  const colorFile = useMemo(() => {
    if (syntaxHighlightingDisabled) {
      return null;
    }
    const ColorFile = expectColorFile();
    if (!ColorFile) {
      return null;
    }
    const normalized = convertLeadingTabsToSpaces(code);
    const cacheKey = `${filePath}\0${normalized.length}`;
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
  }, [code, filePath, syntaxHighlightingDisabled]);

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

  const lineCount = useMemo(() => countCodeLines(code), [code]);
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
    const rawLines = colorFile.render(theme, renderWidth, dim) ?? [];
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
            code={code}
            filePath={filePath}
            dim={dim}
            skipColoring={syntaxHighlightingDisabled}
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
