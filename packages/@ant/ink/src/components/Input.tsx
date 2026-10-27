import type { ReactNode, Ref } from 'react';
import { useCallback } from 'react';
import type { DOMElement } from '../core/dom.js';
import type { KeyboardEvent } from '../core/events/keyboard-event.js';
import type { PasteEvent } from '../core/events/paste-event.js';
import { useDeclaredCursor } from '../hooks/use-declared-cursor.js';
import Box from './Box.js';

export type InputCaret = {
  line: number;
  column: number;
  /** densable UTt caret `visible:!c`. */
  visible?: boolean;
};

type Props = {
  ref?: Ref<DOMElement>;
  autoFocus?: boolean;
  disabled?: boolean;
  caret?: InputCaret;
  onKeyDown?: (event: KeyboardEvent) => void;
  onPaste?: (event: PasteEvent) => void;
  children?: ReactNode;
};

/**
 * densable `Je` / wire `n7`.
 * Gold: caret → Vb({line, column, active: caret!==void 0, visible: caret.visible}).
 * Do not export minify `n7` / `Je`.
 */
export function Input({
  ref,
  autoFocus = false,
  disabled = false,
  caret,
  onKeyDown,
  onPaste,
  children,
}: Props): ReactNode {
  const declared = useDeclaredCursor({
    line: caret?.line ?? 0,
    column: caret?.column ?? 0,
    active: caret !== undefined,
    visible: caret?.visible,
  });
  const setRef = useCallback(
    (node: DOMElement | null) => {
      declared(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [declared, ref],
  );

  if (disabled) {
    return <Box ref={setRef}>{children}</Box>;
  }

  return (
    <Box ref={setRef} tabIndex={0} autoFocus={autoFocus} onKeyDown={onKeyDown} onPaste={onPaste}>
      {children}
    </Box>
  );
}
