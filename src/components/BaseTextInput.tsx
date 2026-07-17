import React from 'react';
import { renderPlaceholder } from '../hooks/renderPlaceholder.js';
import { usePasteHandler } from '../hooks/usePasteHandler.js';
import {
  FUNCTIONAL_KEY_NAMES,
  insertInputFromKeyboardEvent,
  keyFromKeyboardEvent,
} from '../utils/keyboardEventInput.js';
import { Ansi, Box, Text, useInput } from '@anthropic/ink';
import type { KeyboardEvent } from '@anthropic/ink';
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
 * A base component for text inputs that handles rendering and basic input.
 *
 * Official densable 2.1.210 architecture:
 * - Typed keys arrive via focused Box onKeyDown (KeyboardEvent / fag)
 * - Insert path: `if (q.key.length >= 1 && !tS_.has(q.name)) insert(q.key)`
 * - useInput is retained only for raw-mode enable + bracketed paste
 *   (fork still emits InputEvent for paste; official uses dispatchPasteEvent)
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

  // Park the native terminal cursor at the input caret. Terminal emulators
  // position IME preedit text at the physical cursor, and screen readers /
  // screen magnifiers track it — so parking here makes CJK input appear
  // inline and lets accessibility tools follow the input. The Box ref below
  // is the yoga layout origin; (cursorLine, cursorColumn) is relative to it.
  // Only active when the input is focused, showing its cursor, and the
  // terminal itself has focus.
  const cursorRef = useDeclaredCursor({
    line: cursorLine,
    column: cursorColumn,
    active: Boolean(props.focus && props.showCursor && terminalFocus),
  });

  const { wrappedOnInput, isPasting } = usePasteHandler({
    onPaste: props.onPaste,
    onInput: (input, key, event) => {
      // Prevent Enter key from triggering submission during paste
      if (isPasting && key.return) {
        return;
      }
      onInput(input, key, event);
    },
    onImagePaste: props.onImagePaste,
  });

  // Notify parent when paste state changes
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

  // Official main path: KeyboardEvent on focused element.
  // Keep useInput solely for (1) setRawMode and (2) bracketed paste isPasted
  // chunks — non-paste keys are ignored here so we never double-insert and
  // never re-inflate multi-char residue via sji/sequence recovery.
  useInput(
    (input, key, event) => {
      if (!event.keypress.isPasted) {
        return;
      }
      wrappedOnInput(input, key, event);
    },
    { isActive: props.focus },
  );

  const handleKeyDown = React.useCallback(
    (event: KeyboardEvent) => {
      if (!props.focus) return;
      // Match paste-handler: ignore Enter while paste is still accumulating.
      if (isPasting && event.name === 'return') {
        return;
      }
      // Official densable preventDefault on handled keys so FocusManager
      // does not Tab-cycle away (ink Tab default action on keydown).
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
    [props.focus, isPasting, onInput],
  );

  // Show argument hint only when we have a value and the hint is provided
  // Only show the argument hint when:
  // 1. We have a hint to show
  // 2. We have a command typed (value is not empty)
  // 3. The command doesn't have arguments yet (no text after the space)
  // 4. We're actually typing a command (the value starts with /)
  const commandWithoutArgs =
    (props.value && props.value.trim().indexOf(' ') === -1) || (props.value && props.value.endsWith(' '));

  const showArgumentHint = Boolean(
    props.argumentHint && props.value && commandWithoutArgs && props.value.startsWith('/'),
  );

  // Filter out highlights that contain the cursor position
  const cursorFiltered =
    props.showCursor && props.highlights
      ? props.highlights.filter(h => h.dimColor || props.cursorOffset < h.start || props.cursorOffset >= h.end)
      : props.highlights;

  // Adjust highlights for viewport windowing: highlight positions reference the
  // full input text, but renderedValue only contains the windowed subset.
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

  // tabIndex + autoFocus so FocusManager targets this node for KeyboardEvent
  // dispatch (official densable: focused Box onKeyDown).
  const focusProps = props.focus
    ? ({ tabIndex: 0, autoFocus: true, onKeyDown: handleKeyDown } as const)
    : ({ onKeyDown: handleKeyDown } as const);

  if (hasHighlights) {
    return (
      <Box ref={cursorRef} {...focusProps}>
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
    <Box ref={cursorRef} {...focusProps}>
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
