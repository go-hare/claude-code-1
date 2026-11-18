import type { ReactNode, Ref } from 'react';
import { useCallback, useContext, useMemo, useRef } from 'react';
import AccessibilityContext from '../components/AccessibilityContext.js';
import { Input } from '../components/Input.js';
import type { DOMElement } from '../core/dom.js';
import type { KeyboardEvent } from '../core/events/keyboard-event.js';
import type { PasteEvent } from '../core/events/paste-event.js';
import { getFocusManager } from '../core/focus.js';
import { stringWidth } from '../core/stringWidth.js';
import { isNativeCursorEnabled } from '../core/terminal.js';
import { firstGrapheme } from '../core/utils/grapheme.js';
import { wrapAnsi } from '../core/wrapAnsi.js';
import { useIsFocused } from '../hooks/use-is-focused.js';
import { useDeclaredCursor } from '../hooks/use-declared-cursor.js';
import { Box, Text } from '../index.js';
import type { Props as ThemedTextProps } from './ThemedText.js';

type WrappedLine = {
  readonly text: string;
  readonly startOffset: number;
  readonly isPrecededByNewline: boolean;
  readonly endsWithNewline: boolean;
};

type WrappedSearchLayout = {
  readonly text: string;
  readonly columns: number;
  readonly lines: readonly WrappedLine[];
};

function clampNum(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function isPrecededByNewline(text: string, offset: number, isFirstLine: boolean): boolean {
  if (isFirstLine) return true;
  return offset > 0 && text[offset - 1] === '\n';
}

function layoutWrappedSearchText(text: string, wrapColumns: number): WrappedSearchLayout {
  const columns = Math.max(1, Math.floor(wrapColumns) || 1);
  const wrapped = wrapColumns > 0 ? wrapAnsi(text, columns, { hard: true, trim: false }) : text;
  const lines: WrappedLine[] = [];
  let searchFrom = 0;
  let lastNewline = -1;
  const parts = wrapped.split('\n');
  for (let i = 0; i < parts.length; i++) {
    const lineText = parts[i] ?? '';
    if (lineText.length === 0) {
      lastNewline = text.indexOf('\n', lastNewline + 1);
      if (lastNewline !== -1) {
        const startOffset = lastNewline;
        lines.push(
          Object.freeze({
            text: lineText,
            startOffset,
            isPrecededByNewline: isPrecededByNewline(text, startOffset, i === 0),
            endsWithNewline: true,
          }),
        );
      } else {
        const startOffset = text.length;
        lines.push(
          Object.freeze({
            text: lineText,
            startOffset,
            isPrecededByNewline: isPrecededByNewline(text, startOffset, i === 0),
            endsWithNewline: false,
          }),
        );
      }
      continue;
    }
    const found = text.indexOf(lineText, searchFrom);
    if (found === -1) {
      const startOffset = searchFrom;
      lines.push(
        Object.freeze({
          text: lineText,
          startOffset,
          isPrecededByNewline: isPrecededByNewline(text, startOffset, i === 0),
          endsWithNewline: false,
        }),
      );
      searchFrom = startOffset + lineText.length;
      continue;
    }
    searchFrom = found + lineText.length;
    const afterIdx = found + lineText.length;
    const endsWithNewline = afterIdx < text.length && text[afterIdx] === '\n';
    if (endsWithNewline) lastNewline = afterIdx;
    lines.push(
      Object.freeze({
        text: lineText,
        startOffset: found,
        isPrecededByNewline: isPrecededByNewline(text, found, i === 0),
        endsWithNewline,
      }),
    );
  }
  return Object.freeze({ text, columns, lines: Object.freeze(lines) });
}

function widthUpToOffset(lineText: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= lineText.length) return stringWidth(lineText);
  return stringWidth(lineText.slice(0, offset));
}

function offsetAtColumn(lineText: string, targetCol: number): number {
  if (targetCol <= 0 || lineText.length === 0) return 0;
  let usedCols = 0;
  let offset = 0;
  for (const ch of lineText) {
    const chWidth = stringWidth(ch);
    if (usedCols + chWidth > targetCol) break;
    usedCols += chWidth;
    offset += ch.length;
  }
  return offset;
}

function offsetToLineColumn(layout: WrappedSearchLayout, rawOffset: number): { line: number; column: number } {
  if (layout.lines.length === 0) return { line: 0, column: 0 };
  const offset = clampNum(rawOffset, 0, layout.text.length);
  for (let i = 0; i < layout.lines.length; i++) {
    const cur = layout.lines[i]!;
    const next = layout.lines[i + 1];
    if (offset >= cur.startOffset && (!next || offset < next.startOffset)) {
      const rel = offset - cur.startOffset;
      let column: number;
      if (cur.isPrecededByNewline) {
        column = widthUpToOffset(cur.text, rel);
      } else {
        const leadingTrim = cur.text.length - cur.text.trimStart().length;
        column = rel < leadingTrim ? 0 : widthUpToOffset(cur.text.slice(leadingTrim), rel - leadingTrim);
      }
      return { line: i, column };
    }
  }
  const lastIdx = layout.lines.length - 1;
  const last = layout.lines[lastIdx]!;
  return { line: lastIdx, column: stringWidth(last.text) };
}

function lineColumnToOffset(layout: WrappedSearchLayout, row: number, col: number): number {
  if (layout.lines.length === 0) return 0;
  const clampedRow = clampNum(row, 0, Math.max(0, layout.lines.length - 1));
  const line = layout.lines[clampedRow] ?? {
    text: '',
    startOffset: 0,
    isPrecededByNewline: true,
    endsWithNewline: false,
  };
  if (line.text.length === 0 && line.endsWithNewline) return line.startOffset;
  const leadingTrim = line.isPrecededByNewline ? 0 : line.text.length - line.text.trimStart().length;
  const rel = offsetAtColumn(line.text.slice(leadingTrim), Math.max(0, col)) + leadingTrim;
  return line.startOffset + rel;
}

function renderQuerySegments(
  text: string,
  highlights: ReadonlyArray<readonly [number, number]>,
  dimRange: readonly [number, number] | undefined,
  cursorOffset: number,
  cursorChar: ReactNode | undefined,
): ReactNode[] {
  const isHighlighted = (idx: number): boolean => highlights.some(([start, end]) => idx >= start && idx < end);
  const isDimmed = (idx: number): boolean => Boolean(dimRange && idx >= dimRange[0] && idx < dimRange[1]);
  const boundaries = new Set<number>([0, text.length]);
  for (const [start, end] of highlights) {
    boundaries.add(clampNum(start, 0, text.length));
    boundaries.add(clampNum(end, 0, text.length));
  }
  if (dimRange) {
    boundaries.add(clampNum(dimRange[0], 0, text.length));
    boundaries.add(clampNum(dimRange[1], 0, text.length));
  }
  if (cursorOffset >= 0 && cursorOffset < text.length) {
    const graphemeLen = Math.max(1, firstGrapheme(text.slice(cursorOffset)).length);
    boundaries.add(cursorOffset);
    boundaries.add(Math.min(text.length, cursorOffset + graphemeLen));
  }
  const sorted = [...boundaries].sort((a, b) => a - b);
  const nodes: ReactNode[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i]!;
    const end = sorted[i + 1]!;
    const slice = text.slice(start, end);
    if (!slice) continue;
    const atCursor = start === cursorOffset;
    const isCursorNewline = atCursor && slice === '\n';
    if (atCursor && cursorChar !== undefined) {
      nodes.push(
        <Text key={start}>
          {cursorChar}
          {isCursorNewline ? '\n' : null}
        </Text>,
      );
    } else {
      nodes.push(
        <Text
          key={start}
          color={isHighlighted(start) ? 'suggestion' : undefined}
          dimColor={isDimmed(start)}
          inverse={atCursor}
        >
          {isCursorNewline ? ' \n' : slice}
        </Text>,
      );
    }
  }
  if (cursorOffset >= text.length) {
    nodes.push(
      cursorChar !== undefined ? (
        <Text key="cursor-end">{cursorChar}</Text>
      ) : (
        <Text key="cursor-end" inverse>
          {' '}
        </Text>
      ),
    );
  }
  return nodes;
}

type Props = {
  query: string;
  placeholder?: string;
  isFocused?: boolean;
  ref?: Ref<DOMElement>;
  onFocus?: () => void;
  isTerminalFocused: boolean;
  prefix?: string;
  width?: number | string;
  cursorOffset?: number;
  borderless?: boolean;
  autoFocus?: boolean;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPaste?: (event: PasteEvent) => void;
  highlights?: ReadonlyArray<readonly [number, number]>;
  dimRange?: readonly [number, number];
  cursorChar?: ReactNode;
  prefixDim?: boolean;
  prefixColor?: ThemedTextProps['color'];
  onCursorOffsetChange?: (offset: number) => void;
  wrapColumns?: number;
  mask?: string;
};

/** Gold 289 Jy: an Input host when editable, otherwise a declared display cursor. */
export function SearchBox({
  query,
  placeholder = 'Search…',
  isFocused: focusedProp,
  ref,
  onFocus,
  isTerminalFocused,
  prefix = '⌕',
  width,
  cursorOffset,
  borderless = false,
  autoFocus,
  onKeyDown,
  onPaste,
  highlights,
  dimRange,
  cursorChar,
  prefixDim = false,
  prefixColor,
  onCursorOffsetChange,
  wrapColumns,
  mask,
}: Props): ReactNode {
  const rawOffset = clampNum(cursorOffset ?? query.length, 0, query.length);
  const displayQuery = useMemo(() => {
    if (!mask) return query;
    return mask.repeat(Array.from(query).length);
  }, [query, mask]);
  const offset = useMemo(() => {
    if (!mask) return rawOffset;
    return mask.length * Array.from(query.slice(0, rawOffset)).length;
  }, [query, rawOffset, mask]);

  const hasKeyDown = onKeyDown !== undefined;
  const isScreenReader = useContext(AccessibilityContext);
  const hasBorder = !borderless && !isScreenReader;
  const inputRef = useRef<DOMElement | null>(null);
  const focused = useIsFocused(inputRef);
  const isFocused = focusedProp ?? (hasKeyDown && focused);
  const setInputRef = useCallback(
    (node: DOMElement | null) => {
      inputRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  const borderCols = hasBorder ? 2 : 0;
  const borderRows = hasBorder ? 1 : 0;
  const displayPrefix = isScreenReader && prefix === '⌕' ? (displayQuery ? 'Search:' : null) : prefix;
  const prefixAndQuery = displayPrefix === null ? displayQuery : `${displayPrefix} ${displayQuery}`;
  const prefixOffset = displayPrefix === null ? 0 : displayPrefix.length + 1;
  const layout = useMemo(
    () => layoutWrappedSearchText(prefixAndQuery, wrapColumns ?? 0),
    [prefixAndQuery, wrapColumns],
  );
  const nativeCursor = useMemo(isNativeCursorEnabled, []);
  const fullRepaint =
    Boolean(process.env.CLAUDE_CODE_ALT_SCREEN_FULL_REPAINT) && process.env.CLAUDE_CODE_SESSION_KIND !== 'bg';
  const caretPos = offsetToLineColumn(layout, prefixOffset + offset);
  const nativeCaretVisible = cursorChar === undefined && !fullRepaint && !mask;
  const declaredCursor = useDeclaredCursor({
    line: borderRows + caretPos.line,
    column: borderCols + caretPos.column,
    active: isFocused && !hasKeyDown,
    visible: nativeCaretVisible,
  });
  const showPaintedCursor = isTerminalFocused && !(nativeCursor && !mask && !fullRepaint && cursorChar === undefined);
  const content = (
    <Text dimColor={!isFocused}>
      {displayPrefix !== null ? (
        <>
          <Text dimColor={prefixDim} color={prefixColor}>
            {displayPrefix}
          </Text>{' '}
        </>
      ) : null}
      {isFocused ? (
        displayQuery ? (
          renderQuerySegments(displayQuery, highlights ?? [], dimRange, showPaintedCursor ? offset : -1, cursorChar)
        ) : showPaintedCursor ? (
          <>
            {cursorChar ?? <Text inverse>{placeholder.charAt(0)}</Text>}
            <Text dimColor>{cursorChar !== undefined ? placeholder : placeholder.slice(1)}</Text>
          </>
        ) : (
          <Text dimColor>{placeholder}</Text>
        )
      ) : displayQuery ? (
        <Text>{displayQuery}</Text>
      ) : (
        <Text>{placeholder}</Text>
      )}
    </Text>
  );
  const handleClick =
    onCursorOffsetChange || onFocus || hasKeyDown
      ? (event: Parameters<NonNullable<Parameters<typeof Box>[0]['onClick']>>[0]) => {
          if (!isFocused && event.isWindowActivation) {
            event.dropAsStray();
            return;
          }
          const node = inputRef.current;
          if (node && !onFocus) getFocusManager(node).focus(node);
          if (!isFocused) {
            onFocus?.();
            return;
          }
          if (!displayQuery || !onCursorOffsetChange) return;
          const localRow = event.localRow - borderRows;
          if (localRow < 0) return;
          const localCol = Math.max(0, event.localCol - borderCols);
          const hitOffset = lineColumnToOffset(layout, localRow, localCol);
          const clampedDisplayOffset = clampNum(hitOffset - prefixOffset, 0, displayQuery.length);
          if (!mask) {
            onCursorOffsetChange(clampedDisplayOffset);
          } else {
            const charCount = mask.length > 0 ? Math.floor(clampedDisplayOffset / mask.length) : 0;
            const target = Array.from(query).slice(0, charCount).join('').length;
            onCursorOffsetChange(clampNum(target, 0, query.length));
          }
        }
      : undefined;
  return (
    <Box
      ref={hasKeyDown ? undefined : declaredCursor}
      flexShrink={0}
      borderStyle={hasBorder ? 'round' : undefined}
      borderColor={isFocused ? 'suggestion' : undefined}
      borderDimColor={!isFocused}
      paddingX={hasBorder ? 1 : 0}
      width={width}
      onClick={handleClick}
    >
      {hasKeyDown ? (
        <Input
          ref={setInputRef}
          autoFocus={autoFocus}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          caret={isFocused ? { line: caretPos.line, column: caretPos.column, visible: nativeCaretVisible } : undefined}
          flexGrow={1}
        >
          {content}
        </Input>
      ) : (
        content
      )}
    </Box>
  );
}
