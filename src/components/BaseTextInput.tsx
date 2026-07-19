import React from 'react';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import {
  FUNCTIONAL_KEY_NAMES,
  insertInputFromKeyboardEvent,
  keyFromKeyboardEvent,
} from '../utils/keyboardEventInput.js';
import { Ansi, Box, Text, useFocusReclaim, useInput } from '@anthropic/ink';
import type { DOMElement, KeyboardEvent, PasteEvent } from '@anthropic/ink';
import { useDeclaredCursor } from '@anthropic/ink';
import type { BaseInputState, BaseTextInputProps } from '../types/textInputTypes.js';
import type { TextHighlight } from '../utils/textHighlighting.js';
import { HighlightedInput } from './PromptInput/ShimmeredInput.js';

type BaseTextInputComponentProps = BaseTextInputProps & {
  inputState: BaseInputState;
  children?: React.ReactNode;
  terminalFocus: boolean;
  highlights?: TextHighlight[];
  invert?: (text: string) => string;
  hidePlaceholderText?: boolean;
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
  ...props
}: BaseTextInputComponentProps): React.ReactNode {
  const { onInput, renderedValue, cursorLine, cursorColumn } = inputState;
  const nodeRef = React.useRef<DOMElement | null>(null);

  const declaredCursorRef = useDeclaredCursor({
    line: cursorLine,
    column: cursorColumn,
    // Official densable rfo: active: Boolean(focus && showCursor) — not terminalFocus
    active: Boolean(props.focus && props.showCursor),
  });

  const setBoxRef = React.useCallback(
    (node: DOMElement | null) => {
      nodeRef.current = node;
      declaredCursorRef(node);
    },
    [declaredCursorRef],
  );

  // Official densable nR(ref, isActive): reclaim focus so dispatch* hits this node.
  // E = focus !== false (undefined counts as active, matching densable).
  const isActive = props.focus !== false;
  useFocusReclaim(nodeRef, isActive);

  // Official densable rfo wrap before d7r:
  //   handleKeyDown:(W)=>{if(s.onKeyDownBefore?.(W),W.defaultPrevented||
  //     W.didStopImmediatePropagation())return;a(W)}
  // Fork maps KeyboardEvent → onInput(input, Key) (legacy mapKey) instead of
  // native inputState.handleKeyDown — functional parity for insert/nav/ctrl.
  const baseHandleKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
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
    [onInput],
  );

  // Official: onKeyDownBefore → short-circuit → inner handleKeyDown (a), then
  // that whole function is wrapped by d7r/UZr paste handler as onKeyDown.
  const { onKeyDownBefore } = props;
  const handleKeyDownWithBefore = React.useCallback(
    (event: KeyboardEvent) => {
      onKeyDownBefore?.(event);
      if (event.defaultPrevented || event.didStopImmediatePropagation()) return;
      baseHandleKeyDown(event);
    },
    [onKeyDownBefore, baseHandleKeyDown],
  );

  // Official densable d7r / UZr
  const { handleKeyDown, handlePaste, isPasting } = usePasteHandler({
    onPaste: props.onPaste,
    handleKeyDown: handleKeyDownWithBefore,
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
    showCursor: props.showCursor,
    focus: props.focus,
    terminalFocus,
    invert,
    hidePlaceholderText,
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

  // Official: k = E ? { tabIndex:0, autoFocus:!0, onKeyDown:m, onPaste:g } : {}
  const focusProps = isActive
    ? ({ tabIndex: 0, autoFocus: true, onKeyDown: handleKeyDown, onPaste } as const)
    : ({} as const);

  if (hasHighlights) {
    return (
      <Box ref={setBoxRef} {...focusProps}>
        <HighlightedInput text={renderedValue} highlights={filteredHighlights} />
        {showArgumentHint && (
          <Text dimColor>
            {props.value?.endsWith(' ') ? '' : ' '}
            {props.argumentHint}
          </Text>
        )}
        {children}
      </Box>
    );
  }

  return (
    <Box ref={setBoxRef} {...focusProps}>
      <Text wrap="truncate-end" dimColor={props.dimColor}>
        {showPlaceholder && props.placeholderElement ? (
          props.placeholderElement
        ) : showPlaceholder && renderedPlaceholder ? (
          <Ansi>{renderedPlaceholder}</Ansi>
        ) : (
          <Ansi>{renderedValue}</Ansi>
        )}
        {showArgumentHint && (
          <Text dimColor>
            {props.value?.endsWith(' ') ? '' : ' '}
            {props.argumentHint}
          </Text>
        )}
        {children}
      </Text>
    </Box>
  );
}
