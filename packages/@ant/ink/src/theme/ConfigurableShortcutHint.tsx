import React from 'react';
import { useOptionalKeybindingContext } from '../keybindings/KeybindingContext.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';

type Props = {
  action: string;
  context: string;
  fallback: string;
  description: string;
  parens?: boolean;
  bold?: boolean;
};

export function ConfigurableShortcutHint({
  action,
  context,
  fallback,
  description,
  parens,
  bold,
}: Props): React.ReactNode {
  const keybindingContext = useOptionalKeybindingContext();
  const shortcut = keybindingContext?.getDisplayText(action, context) ?? fallback;
  return <KeyboardShortcutHint shortcut={shortcut} action={description} parens={parens} bold={bold} />;
}
