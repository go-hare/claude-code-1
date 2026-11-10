import React, { useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DOMElement } from '../core/dom.js';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCD.js';
import { Box, Text } from '../index.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import type { Theme } from './theme-types.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { ModalContext } from './modalContext.js';
import { Pane } from './Pane.js';

type DialogProps = {
  title: React.ReactNode;
  titleEnd?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  onCancel: () => void;
  onInterrupt?: () => boolean;
  exitOnCtrlCD?: boolean;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  /** Custom input guide content. Accepts ReactNode or a function receiving exitState. */
  inputGuide?: React.ReactNode | ((exitState: ExitState) => React.ReactNode);
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
  titleEnd,
  subtitle,
  children,
  onCancel,
  onInterrupt,
  exitOnCtrlCD = false,
  color = 'permission',
  hideInputGuide,
  hideBorder,
  inputGuide,
  isCancelActive = true,
}: DialogProps): React.ReactNode {
  const exitState = useExitOnCtrlCDWithKeybindings(exitOnCtrlCD ? undefined : onCancel, onInterrupt, isCancelActive);
  const modalCtx = useContext(ModalContext);
  const headerRef = useRef<DOMElement | null>(null);
  const [headerRows, setHeaderRows] = useState(subtitle ? 2 : 1);

  useLayoutEffect(() => {
    if (!modalCtx || !headerRef.current?.yogaNode) return;
    const h = Math.floor(headerRef.current.yogaNode.getComputedHeight());
    if (h > 0 && h !== headerRows) {
      setHeaderRows(h);
    }
  });

  const chromeRows = headerRows + 1 + (hideInputGuide ? 0 : 2);
  const innerModalCtx = useMemo(
    () => (modalCtx ? { ...modalCtx, rows: Math.max(0, modalCtx.rows - chromeRows) } : null),
    [modalCtx, chromeRows],
  );

  // Use configurable keybinding for ESC to cancel.
  // isCancelActive lets consumers (e.g. ElicitationDialog) disable this while
  // an embedded TextInput is focused, so that keys like 'n' reach the field
  // instead of being consumed here.
  useKeybinding('confirm:no', onCancel, {
    context: 'Confirmation',
    isActive: isCancelActive,
  });

  const pendingAction = exitOnCtrlCD ? 'exit' : 'cancel';
  const defaultInputGuide = exitState.pending ? (
    <Text>
      Press {exitState.keyName} again to {pendingAction}
    </Text>
  ) : (
    <Byline>
      <KeyboardShortcutHint shortcut="Enter" action="confirm" />
      <ConfigurableShortcutHint action="confirm:no" context="Confirmation" fallback="Esc" description="cancel" />
    </Byline>
  );

  const resolvedGuide =
    typeof inputGuide === 'function'
      ? inputGuide(exitState)
      : exitState.pending
        ? defaultInputGuide
        : inputGuide != null
          ? inputGuide
          : defaultInputGuide;

  const titleNode =
    title == null ? null : titleEnd ? (
      <Box justifyContent="space-between" gap={2}>
        <Text bold color={color} wrap="truncate-end">
          {title}
        </Text>
        <Text dimColor wrap="truncate-start">
          {titleEnd}
        </Text>
      </Box>
    ) : (
      <Text bold color={color} wrap="truncate-end">
        {title}
      </Text>
    );

  // densable nr (2.1.216): keyboard-hint footer is flexShrink:0 so yoga never
  // collapses it when the dialog body is taller than the fullscreen modal
  // panel. Title/body use minWidth:0 so long labels clamp inside the panel
  // width instead of stretching past the right edge.
  const content = (
    <>
      <Box flexDirection="column" gap={1} minWidth={0} width="100%">
        {(titleNode != null || subtitle != null) && (
          <Box ref={headerRef} flexDirection="column" minWidth={0}>
            {titleNode}
            {subtitle && (
              <Text dimColor wrap="truncate-end">
                {subtitle}
              </Text>
            )}
          </Box>
        )}
        <ModalContext.Provider value={innerModalCtx}>{children}</ModalContext.Provider>
      </Box>
      {!hideInputGuide && (
        <Box marginTop={1} flexShrink={0} minWidth={0}>
          <Text dimColor italic wrap="truncate-end">
            {resolvedGuide}
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
