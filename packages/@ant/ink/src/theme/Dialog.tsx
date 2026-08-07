import React from 'react';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCD.js';
import { Box, Text } from '../index.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import type { Theme } from './theme-types.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { Pane } from './Pane.js';

type DialogProps = {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onCancel: () => void;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  /** Custom input guide content. Receives exitState for Ctrl+C/D pending display. */
  inputGuide?: (exitState: ExitState) => React.ReactNode;
  /**
   * Controls whether Dialog's built-in confirm:no (Esc/n) and app:exit/interrupt
   * (Ctrl-C/D) keybindings are active. Set to `false` while an embedded text
   * field is being edited so those keys reach the field instead of being
   * consumed by Dialog. TextInput has its own ctrl+c/d handlers (cancel on
   * press, delete-forward on ctrl+d with text). Defaults to `true`.
   */
  isCancelActive?: boolean;
};

export function Dialog({
  title,
  subtitle,
  children,
  onCancel,
  color = 'permission',
  hideInputGuide,
  hideBorder,
  inputGuide,
  isCancelActive = true,
}: DialogProps): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings(undefined, undefined, isCancelActive);

  // Use configurable keybinding for ESC to cancel.
  // isCancelActive lets consumers (e.g. ElicitationDialog) disable this while
  // an embedded TextInput is focused, so that keys like 'n' reach the field
  // instead of being consumed here.
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: isCancelActive,
  });

  const defaultInputGuide = exitState.pending ? (
    <Text>Press {exitState.keyName} again to exit</Text>
  ) : (
    <Byline>
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
    </Byline>
  );

  // densable nr (2.1.216): keyboard-hint footer is flexShrink:0 so yoga never
  // collapses it when the dialog body is taller than the fullscreen modal
  // panel. Title/body use minWidth:0 so long labels clamp inside the panel
  // width instead of stretching past the right edge.
  const content = (
    <>
      <Box flexDirection="column" gap={1} minWidth={0} width="100%">
        <Box flexDirection="column" minWidth={0}>
          <Text bold color={color} wrap="truncate-end">
            {title}
          </Text>
          {subtitle && (
            <Text dimColor wrap="truncate-end">
              {subtitle}
            </Text>
          )}
        </Box>
        {children}
      </Box>
      {!hideInputGuide && (
        <Box marginTop={1} flexShrink={0} minWidth={0}>
          <Text dimColor italic wrap="truncate-end">
            {inputGuide ? inputGuide(exitState) : defaultInputGuide}
          </Text>
        </Box>
      )}
    </>
  );

  if (hideBorder) {
    return content;
  }

  return <Pane color={color}>{content}</Pane>;
}
