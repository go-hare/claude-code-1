import React from 'react';
import stripAnsi from 'strip-ansi';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import type { LeadingPill } from '../hooks/useTextInput.js';
import {
  FUNCTIONAL_KEY_NAMES,
  insertInputFromKeyboardEvent,
  keyFromKeyboardEvent,
} from '../utils/keyboardEventInput.js';
import { Ansi, Box, Input, stringWidth, Text, isNativeCursorEnabled, useFocusReclaim, useInput } from '@anthropic/ink';
import type { DOMElement, KeyboardEvent, PasteEvent } from '@anthropic/ink';
import type { BaseInputState, BaseTextInputProps, PromptInputMode } from '../types/textInputTypes.js';
import { leftoverXy } from '../utils/leftoverXy.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';

type RenderedRowMapping = {
  textStart: number;
  renderedStart: number;
  length: number;
};

function mapOffsetToRendered(rows: RenderedRowMapping[], offset: number, isEnd: boolean): number {
  let lo = 0;
  let hi = rows.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const textStart = rows[mid]!.textStart;
    if (isEnd ? textStart < offset : textStart <= offset) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  const row = rows[lo - 1];
  return row ? row.renderedStart + Math.min(offset - row.textStart, row.length) : 0;
}

/**
 * Remap highlight `[start, end]` from full-text code-unit offsets into
 * `renderedValue` offsets across soft-wrapped / viewport-sliced rows.
 */
export function remapHighlightsToRenderedText(
  highlights: TextHighlight[],
  renderedValue: string,
  renderedRowStartOffsets: number[],
): TextHighlight[] {
  const lineLengths = stripAnsi(renderedValue)
    .split('\n')
    .map(line => line.length);
  const rows: RenderedRowMapping[] = [];
  let renderedStart = 0;
  for (const [index, textStart] of renderedRowStartOffsets.entries()) {
    const length = lineLengths[index] ?? 0;
    rows.push({ textStart, renderedStart, length });
    renderedStart += length + 1;
  }
  return highlights
    .map(h => ({
      ...h,
      start: mapOffsetToRendered(rows, h.start, false),
      end: mapOffsetToRendered(rows, h.end, true),
    }))
    .filter(h => h.end > h.start);
}

type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState & { renderedRowStartOffsets?: number[] };
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
  /** densable UTt `cursorCellPainted` — voice hex already painted the caret cell. */
  cursorCellPainted?: boolean;
  leadingPill?: LeadingPill;
  allowPrintableKeybindings?: boolean;
  getInputMode?: () => PromptInputMode;
};

/**
 * Official densable 2.1.210 BaseTextInput (`rfo`):
 * - tabIndex + autoFocus + onKeyDown + onPaste when focused
 * - nR focus reclaim (useFocusReclaim) so KeyboardEvent/PasteEvent target this node
 * - d7r paste wrapper (usePasteHandler) around handleKeyDown
 * - useInput only enables raw mode (fork keybindings still listen on EventEmitter)
 */
/**
 * Official 2.1.327 (#464): detect when a text field clips long pasted text
 * outside its visible viewport or single-line column width so callers can show
 * a subtle overflow indicator instead of hiding text with no sign.
 */
export function computeTextOverflowIndicator(params: {
  value: string;
  columns: number;
  multiline?: boolean;
  maxVisibleLines?: number;
  viewportCharOffset: number;
  viewportCharEnd: number;
}): { above: boolean; below: boolean; indicator: string | null } {
  const { value, columns, multiline, maxVisibleLines, viewportCharOffset, viewportCharEnd } = params;
  if (!value) return { above: false, below: false, indicator: null };
  const above = viewportCharOffset > 0;
  const below = viewportCharEnd > 0 && viewportCharEnd < value.length;
  if (above || below) {
    const hiddenBefore = above ? value.slice(0, viewportCharOffset).split('\n').length : 0;
    const hiddenAfter = below ? value.slice(viewportCharEnd).split('\n').length : 0;
    const parts: string[] = [];
    if (hiddenBefore > 0) parts.push(`↑ +${hiddenBefore} ${hiddenBefore === 1 ? 'line' : 'lines'}`);
    if (hiddenAfter > 0) parts.push(`↓ +${hiddenAfter} ${hiddenAfter === 1 ? 'line' : 'lines'}`);
    return { above, below, indicator: `… (${parts.join(', ')} hidden)` };
  }
  if (!multiline && maxVisibleLines === 1 && columns > 0 && stringWidth(value) > columns) {
    const hiddenChars = [...value].length - Math.max(0, columns);
    if (hiddenChars > 0) {
      return { above: false, below: true, indicator: `… (+${hiddenChars} more chars)` };
    }
  }
  return { above: false, below: false, indicator: null };
}

export function BaseTextInput({
  inputState,
  children,
  terminalFocus,
  invert,
  hidePlaceholderText,
  cursorCellPainted = false,
  ...props
}: BaseTextInputComponentProps): React.ReactNode {
  const { onInput, renderedValue, cursorLine, cursorColumn } = inputState;
  const nodeRef = React.useRef<DOMElement | null>(null);
  // densable UTt: Ie=eD(); Ye showCursor:o.showCursor&&!Ie; hidePlaceholderText:u||Xe().
  const nativeCursor = isNativeCursorEnabled();
  const screenReader = isScreenReaderModeEnabled();
  // densable UTt caret `O=focus&&showCursor?{line,column,visible:!c}:void 0`.
  // c is the painted invert cell (voice waveform). Screen reader and the
  // native-cursor vim path draw no cell — the hardware cursor must show.
  const caret =
    props.focus && props.showCursor
      ? { line: cursorLine, column: cursorColumn, visible: !cursorCellPainted }
      : undefined;

  const setBoxRef = React.useCallback((node: DOMElement | null) => {
    nodeRef.current = node;
  }, []);

  // Official densable nR(ref, isActive): reclaim focus so dispatch* hits this node.
  // E = focus !== false (undefined counts as active, matching densable).
  const isActive = props.focus !== false;
  useFocusReclaim(nodeRef, isActive);

  // Official densable rfo wrap before d7r:
  //   if (onKeyDownBefore?.(B), B.defaultPrevented || B.didStopImmediatePropagation()) return
  //   inputState.handleKeyDown(B)
  // Fork maps KeyboardEvent → onInput(input, Key) (legacy mapKey) instead of
  // native inputState.handleKeyDown — functional parity for insert/nav/ctrl.
  const onKeyDownBefore = props.onKeyDownBefore;
  const baseHandleKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      // densable: typeahead/history first — preventDefault skips insert+submit.
      onKeyDownBefore?.(event);
      if (event.defaultPrevented || event.didStopImmediatePropagation()) return;

      if (
        event.name === 'tab' ||
        event.name === 'return' ||
        event.name === 'enter' ||
        event.name === 'backspace' ||
        event.name === 'delete' ||
        event.name === 'escape' ||
        event.name === 'up' ||
        event.name === 'down' ||
        event.name === 'left' ||
        event.name === 'right' ||
        event.name === 'home' ||
        event.name === 'end' ||
        event.ctrl ||
        event.meta ||
        (event.key.length >= 1 && !FUNCTIONAL_KEY_NAMES.has(event.name))
      ) {
        event.preventDefault();
      }
      const key = keyFromKeyboardEvent(event);
      const input = insertInputFromKeyboardEvent(event);
      onInput(input, key);
    },
    [onInput, onKeyDownBefore],
  );

  // Official densable d7r + 2.1.328 #601 (`keepsImagePaths`)
  const { handleKeyDown, handlePaste, isPasting } = usePasteHandler({
    keepsImagePaths: () => props.getInputMode?.() === 'bash',
    onPaste: props.onPaste,
    handleKeyDown: baseHandleKeyDown,
    onImagePaste: props.onImagePaste,
  });

  const { onIsPastingChange } = props;
  React.useEffect(() => {
    if (onIsPastingChange) {
      onIsPastingChange(isPasting);
    }
  }, [isPasting, onIsPastingChange]);

  const { showPlaceholder, renderedPlaceholder } = renderPlaceholder({
    placeholder: props.placeholder,
    value: props.value,
    showCursor: Boolean(props.showCursor) && !nativeCursor,
    focus: props.focus,
    terminalFocus,
    invert: invert ?? leftoverXy,
    hidePlaceholderText: Boolean(hidePlaceholderText) || screenReader,
  });

  // Raw mode only for stdin/bracketed paste enablement. Typed keys and paste
  // go through onKeyDown / onPaste (official). useKeybindings still use the
  // InputEvent emitter (App still emits after dispatchKeyboardEvent).
  useInput(() => {}, { isActive: Boolean(props.focus) });

  const onPaste = React.useCallback(
    (event: PasteEvent) => {
      handlePaste(event);
    },
    [handlePaste],
  );

  const commandWithoutArgs =
    (props.value && props.value.trim().indexOf(' ') === -1) || (props.value && props.value.endsWith(' '));

  const showArgumentHint = Boolean(
    props.argumentHint && props.value && commandWithoutArgs && props.value.startsWith('/'),
  );

  const cursorFiltered =
    props.showCursor && props.highlights
      ? props.highlights.filter(h => h.dimColor || props.cursorOffset < h.start || props.cursorOffset >= h.end)
      : props.highlights;

  const leadingPillText = props.leadingPill?.text ?? '';
  const pillAdjustedHighlights: TextHighlight[] | undefined = leadingPillText
    ? [
        {
          start: 0,
          end: leadingPillText.length - 1,
          color: 'ide',
          priority: 30,
        },
        ...(cursorFiltered ?? []).map(h => ({
          ...h,
          start: h.start + leadingPillText.length,
          end: h.end + leadingPillText.length,
        })),
      ]
    : cursorFiltered;

  const { viewportCharOffset, viewportCharEnd, renderedRowStartOffsets } = inputState;
  const filteredHighlights =
    pillAdjustedHighlights && pillAdjustedHighlights.length > 0 && renderedRowStartOffsets
      ? remapHighlightsToRenderedText(pillAdjustedHighlights, renderedValue, renderedRowStartOffsets)
      : pillAdjustedHighlights && viewportCharOffset > 0
        ? pillAdjustedHighlights
            .filter(h => h.end > viewportCharOffset && h.start < viewportCharEnd)
            .map(h => ({
              ...h,
              start: Math.max(0, h.start - viewportCharOffset),
              end: h.end - viewportCharOffset,
            }))
        : pillAdjustedHighlights;

  const hasPlaceholderContent = showPlaceholder && Boolean(props.placeholderElement || renderedPlaceholder);
  const hasHighlights = Boolean(filteredHighlights && filteredHighlights.length > 0 && !hasPlaceholderContent);
  const overflowInfo = hasPlaceholderContent
    ? { above: false, below: false, indicator: null }
    : computeTextOverflowIndicator({
        value: props.value,
        columns: props.columns,
        multiline: props.multiline,
        maxVisibleLines: props.maxVisibleLines,
        viewportCharOffset,
        viewportCharEnd,
      });

  const inputProps = {
    ref: setBoxRef,
    autoFocus: isActive,
    disabled: !isActive,
    allowPrintableKeybindings: props.allowPrintableKeybindings,
    caret,
    onKeyDown: isActive ? handleKeyDown : undefined,
    onPaste: isActive ? onPaste : undefined,
  };

  const overflowBadge = overflowInfo.indicator ? (
    <Box flexShrink={0}>
      <Text dimColor>{overflowInfo.indicator}</Text>
    </Box>
  ) : null;

  // densable UTt @202724600:
  //   highlight: n7 children = [preserve Box(Z), se, i]
  //   normal:    we = Text(wrap, [X, se, i]); n7 children = we
  // argumentHint / children are siblings of the value node — not nested inside it,
  // and not bare Input/Box row siblings (that flexes hint into a second column).
  // densable 2.1.218 #13: aria-preserve-whitespace on the input value so
  // trailing spaces (including the cursor cell) are not trimEnd'd in SR mode.
  if (hasHighlights && filteredHighlights) {
    // Gold highlight: se has wrap:"truncate-end".
    const highlightHint = showArgumentHint ? (
      <Text dimColor wrap="truncate-end">
        {props.value?.endsWith(' ') ? '' : ' '}
        {props.argumentHint}
      </Text>
    ) : null;
    const highlightContent = (
      <>
        <Box flexShrink={0} accessibility={{ preserveWhitespace: true }}>
          <HighlightedInput text={renderedValue} highlights={filteredHighlights} />
        </Box>
        {highlightHint}
        {children}
      </>
    );
    return (
      <Input {...inputProps}>
        {overflowBadge ? (
          <Box flexDirection="column" flexGrow={1}>
            <Box flexDirection="row">{highlightContent}</Box>
            {overflowBadge}
          </Box>
        ) : (
          highlightContent
        )}
      </Input>
    );
  }

  // Gold normal: se has dimColor only (no wrap); wrap lives on the outer Text.
  const argumentHint = showArgumentHint ? (
    <Text dimColor>
      {props.value?.endsWith(' ') ? '' : ' '}
      {props.argumentHint}
    </Text>
  ) : null;

  const valueNode = hasPlaceholderContent ? (
    <>
      {leadingPillText ? <Text color="ide">{leadingPillText}</Text> : null}
      {props.placeholderElement ?? <Ansi>{renderedPlaceholder ?? ''}</Ansi>}
    </>
  ) : (
    <Text aria-preserve-whitespace>
      <Ansi>{renderedValue}</Ansi>
    </Text>
  );

  const textNode = (
    <Text wrap="truncate-end" dimColor={props.dimColor}>
      {valueNode}
      {argumentHint}
      {children}
    </Text>
  );

  return (
    <Input {...inputProps}>
      {overflowBadge ? (
        <Box flexDirection="column" flexGrow={1}>
          {textNode}
          {overflowBadge}
        </Box>
      ) : (
        textNode
      )}
    </Input>
  );
}
