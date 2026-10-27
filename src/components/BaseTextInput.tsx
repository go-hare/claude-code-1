import React from 'react';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import {
  FUNCTIONAL_KEY_NAMES,
  insertInputFromKeyboardEvent,
  keyFromKeyboardEvent,
} from '../utils/keyboardEventInput.js';
import { Ansi, Box, Input, Text, isNativeCursorEnabled, useFocusReclaim, useInput } from '@anthropic/ink';
import type { DOMElement, KeyboardEvent, PasteEvent } from '@anthropic/ink';
import type { BaseInputState, BaseTextInputProps } from '../types/textInputTypes.js';
import { leftoverXy } from '../utils/leftoverXy.js';
import { isScreenReaderModeEnabled } from '../utils/screenReaderGate.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';

type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
  /** densable UTt `cursorCellPainted` — voice hex already painted the caret cell. */
  cursorCellPainted?: boolean;
};

/**
 * Official densable 2.1.210 BaseTextInput (`rfo`):
 * - tabIndex + autoFocus + onKeyDown + onPaste when focused
 * - nR focus reclaim (useFocusReclaim) so KeyboardEvent/PasteEvent target this node
 * - d7r paste wrapper (usePasteHandler) around handleKeyDown
 * - useInput only enables raw mode (fork keybindings still listen on EventEmitter)
 */
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

  // Official densable d7r
  const { handleKeyDown, handlePaste, isPasting } = usePasteHandler({
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

  const { viewportCharOffset, viewportCharEnd } = inputState;
  const filteredHighlights =
    cursorFiltered && viewportCharOffset > 0
      ? cursorFiltered
          .filter(h => h.end > viewportCharOffset && h.start < viewportCharEnd)
          .map(h => ({
            ...h,
            start: Math.max(0, h.start - viewportCharOffset),
            end: h.end - viewportCharOffset,
          }))
      : cursorFiltered;

  const hasHighlights = filteredHighlights && filteredHighlights.length > 0;

  // densable UTt @202724600:
  //   highlight: n7 children = [preserve Box(Z), se, i]
  //   normal:    we = Text(wrap, [X, se, i]); n7 children = we
  // argumentHint / children are siblings of the value node — not nested inside it,
  // and not bare Input/Box row siblings (that flexes hint into a second column).
  // densable 2.1.218 #13: aria-preserve-whitespace on the input value so
  // trailing spaces (including the cursor cell) are not trimEnd'd in SR mode.
  if (hasHighlights) {
    // Gold highlight: se has wrap:"truncate-end".
    const highlightHint = showArgumentHint ? (
      <Text dimColor wrap="truncate-end">
        {props.value?.endsWith(' ') ? '' : ' '}
        {props.argumentHint}
      </Text>
    ) : null;
    return (
      <Input
        ref={setBoxRef}
        autoFocus={isActive}
        disabled={!isActive}
        caret={caret}
        onKeyDown={isActive ? handleKeyDown : undefined}
        onPaste={isActive ? onPaste : undefined}
      >
        <Box flexShrink={0} accessibility={{ preserveWhitespace: true }}>
          <HighlightedInput text={renderedValue} highlights={filteredHighlights} />
        </Box>
        {highlightHint}
        {children}
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

  const valueNode = (
    <Text aria-preserve-whitespace>
      {showPlaceholder && props.placeholderElement ? (
        props.placeholderElement
      ) : showPlaceholder && renderedPlaceholder ? (
        <Ansi>{renderedPlaceholder}</Ansi>
      ) : (
        <Ansi>{renderedValue}</Ansi>
      )}
    </Text>
  );

  return (
    <Input
      ref={setBoxRef}
      autoFocus={isActive}
      disabled={!isActive}
      caret={caret}
      onKeyDown={isActive ? handleKeyDown : undefined}
      onPaste={isActive ? onPaste : undefined}
    >
      <Text wrap="truncate-end" dimColor={props.dimColor}>
        {valueNode}
        {argumentHint}
        {children}
      </Text>
    </Input>
  );
}
