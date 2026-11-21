import React, { useContext, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DialogIdContext, MenuWaitContext } from '../components/InputNowContext.js';
import { type DOMElement, stampFirstFrame } from '../core/dom.js';
import { getFocusManager } from '../core/focus.js';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCD.js';
import { Box, Text } from '../index.js';
import { useKeybinding } from '../keybindings/useKeybinding.js';
import type { Theme } from './theme-types.js';
import { ConfigurableShortcutHint } from './ConfigurableShortcutHint.js';
import { Byline } from './Byline.js';
import { KeyboardShortcutHint } from './KeyboardShortcutHint.js';
import { ModalContext } from './modalContext.js';
import { Pane } from './Pane.js';

function activeElementReachesBottom(el: DOMElement | null): boolean {
  const parent = el?.parentNode;
  if (!parent) return true;
  let active: DOMElement = parent;
  try {
    active = getFocusManager(parent)?.activeElement ?? parent;
  } catch {
    active = parent;
  }
  let bottom = active.yogaNode?.getComputedHeight() ?? 0;
  for (let cur: DOMElement = active; cur !== parent; cur = cur.parentNode ?? parent) {
    bottom += cur.yogaNode?.getComputedTop() ?? 0;
  }
  return bottom >= (parent.yogaNode?.getComputedHeight() ?? 0);
}

export type DialogWaitProps = {
  isMenu?: boolean;
  shows?: unknown;
  owner?: unknown;
  onDropped?: (detail?: unknown) => void;
};

/**
 * Official 2.1.328 `ene` (@307400470 @1470) — attaches InputGate `wait` metadata
 * onto the enclosing parent `<Box>` so early accidental keypresses right after a
 * dialog paints are dropped and show the `"Not answered yet"` guidance row.
 */
export function DialogWait({ isMenu, shows, owner, onDropped }: DialogWaitProps): React.ReactNode {
  const resolvedOwner = owner === undefined ? null : owner;
  const inDialogHost = useContext(DialogIdContext) !== null;
  const menuCtx = useContext(MenuWaitContext);
  const effectiveIsMenu = isMenu ?? (inDialogHost ? undefined : menuCtx);
  const boxRef = useRef<DOMElement | null>(null);
  const [droppedKind, setDroppedKind] = useState<'choose' | 'again' | null>(null);
  const [overlayAtBottom, setOverlayAtBottom] = useState(false);

  useLayoutEffect(() => {
    if (effectiveIsMenu === undefined) return;
    const parent = boxRef.current?.parentNode;
    if (!parent) return;
    parent.firstFrame = boxRef.current?.firstFrame ?? parent.firstFrame;
    return () => {
      parent.wait = undefined;
    };
  }, [effectiveIsMenu]);

  useLayoutEffect(() => {
    if (effectiveIsMenu === undefined) return;
    const parent = boxRef.current?.parentNode;
    if (!parent) return;
    parent.wait = {
      ...parent.wait,
      isMenu: effectiveIsMenu,
      owner: resolvedOwner,
      onChange(dropped, detail) {
        const nextKind: 'choose' | 'again' | null =
          dropped === undefined ? null : dropped === null ? 'choose' : 'again';
        const nextOverlay = droppedKind === null ? !activeElementReachesBottom(boxRef.current) : overlayAtBottom;
        if (detail === 'click' && droppedKind === null && !nextOverlay) return;
        setDroppedKind(nextKind);
        setOverlayAtBottom(nextOverlay);
        if (nextKind === null) return;
        onDropped?.(detail === 'click' ? undefined : detail);
      },
    };
  });

  useInsertionEffect(() => {
    let cur = boxRef.current?.parentNode;
    while (cur && !cur.wait) cur = cur.parentNode;
    if (cur) stampFirstFrame(cur);
  }, [shows]);

  if (droppedKind === null) {
    return <Box ref={boxRef} display="none" />;
  }

  return (
    <Box
      ref={boxRef}
      flexShrink={0}
      paddingLeft={1}
      {...(overlayAtBottom && {
        position: 'absolute' as const,
        bottom: 0,
        width: '100%' as const,
        opaque: true,
      })}
    >
      <Text dimColor wrap="truncate">
        <Byline>
          <Text color="warning">Not answered yet</Text>
          {droppedKind === 'choose' ? '↓ after a second' : 'wait a second, then press again'}
        </Byline>
      </Text>
    </Box>
  );
}

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

  // densable nr (2.1.216) & official 2.1.328 `xe` (@308190350): wrap title/body,
  // input guide, and `<DialogWait />` inside a column Box so InputGate `.wait`
  // covers every descendant (including Select) for both bordered and borderless dialogs.
  const content = (
    <Box flexDirection="column" flexGrow={hideBorder || modalCtx ? 0 : 1} minWidth={0} width="100%">
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
      <DialogWait />
    </Box>
  );

  if (hideBorder) {
    return content;
  }

  return <Pane color={color}>{content}</Pane>;
}
