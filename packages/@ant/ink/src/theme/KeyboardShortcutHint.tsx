import React from 'react';
import Text from '../components/Text.js';
import { formatShortcutString, shortcutFormatPlatform, type ShortcutFormat } from '../keybindings/formatChord.js';

type Props = {
  /** The key or chord to display (e.g., "ctrl+o", "Enter", "↑/↓") */
  shortcut: string;
  /** The action the key performs (e.g., "expand", "select", "navigate") */
  action: string;
  /** Whether to wrap the hint in parentheses. Default: false */
  parens?: boolean;
  /** Whether to render the shortcut in bold. Default: false */
  bold?: boolean;
  /**
   * densable DualInk `B` `format`. Gold send-now is `{keyCase:"lower"}`.
   * When set, DualInk `R` paints the chord; omit keeps the preformatted string.
   */
  format?: ShortcutFormat;
};

/**
 * densable DualInk `B`. Gold: `v(chord, format)` then `{chord} to {action}`.
 * Never `export function B`.
 *
 * Wrap in <Text dimColor> for the common dim styling.
 */
export function KeyboardShortcutHint({
  shortcut,
  action,
  parens = false,
  bold = false,
  format,
}: Props): React.ReactNode {
  const painted =
    format === undefined
      ? shortcut
      : formatShortcutString(shortcut, {
          ...format,
          platform: format.platform ?? shortcutFormatPlatform(),
        });
  if (!painted) return null;
  const shortcutText = bold ? <Text bold>{painted}</Text> : painted;

  if (parens) {
    return (
      <Text>
        ({shortcutText} to {action})
      </Text>
    );
  }
  return (
    <Text>
      {shortcutText} to {action}
    </Text>
  );
}
