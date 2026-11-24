import React, { useCallback, useContext, useInsertionEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DialogIdContext, MenuWaitContext } from '../components/InputNowContext.js';
import { type DOMElement, stampFirstFrame } from '../core/dom.js';
import type { KeyboardEvent } from '../core/events/keyboard-event.js';
import { getFocusManager } from '../core/focus.js';
import { type ExitState, useExitOnCtrlCDWithKeybindings } from '../hooks/useExitOnCtrlCD.js';
import { Box, Text } from '../index.js';
import { useKeybinding, useKeybindings } from '../keybindings/useKeybinding.js';
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

export type DialogKeyHint = {
  /** Keybinding action name (e.g. `'confirm:yes'`, `'confirm:toggle'`). */
  action?: string;
  /** Raw key or keys to match/display when no action is set (e.g. `'r'`, `['up', 'down']`). */
  on?: string | readonly string[];
  /** Optional key handler; returning `false` lets the event propagate. */
  run?: (() => void) | (() => boolean);
  /** Hint verb rendered in the default footer; pass `''` to suppress the hint. */
  hint?: string;
  /** Only trigger on chord completion. */
  chordOnly?: boolean;
  onlyIn?: 'list' | 'question';
  needsRows?: boolean;
};

const DIALOG_ACTION_FALLBACK_KEYS: Record<string, string> = {
  'confirm:yes': 'Enter',
  'confirm:no': 'Esc',
  'confirm:previous': '↑',
  'confirm:next': '↓',
  'confirm:toggle': 'Space',
  'confirm:nextField': 'Tab',
  'confirm:previousField': 'Shift+Tab',
  'confirm:cycleMode': 'Shift+Tab',
  'select:accept': 'Enter',
  'select:cancel': 'Esc',
  'select:previous': '↑',
  'select:next': '↓',
  'tabs:previous': '←',
  'tabs:next': '→',
};

const DIALOG_ACTION_DEFAULT_DESCRIPTIONS: Record<string, string> = {
  'confirm:yes': 'confirm',
  'confirm:no': 'cancel',
  'confirm:previous': 'navigate',
  'confirm:next': 'navigate',
  'confirm:nextField': 'next field',
  'confirm:previousField': 'previous field',
  'confirm:toggle': 'toggle',
  'confirm:cycleMode': 'cycle mode',
  'select:accept': 'select',
  'select:cancel': 'cancel',
  'select:previous': 'navigate',
  'select:next': 'navigate',
  'tabs:previous': 'switch',
  'tabs:next': 'switch',
};

function formatDialogKeyOn(on: string | readonly string[]): string {
  return Array.isArray(on) ? on.join('/') : String(on);
}

type DialogProps = {
  title: React.ReactNode;
  titleEnd?: React.ReactNode;
  /** Official 2.1.328 `xe.titleSuffix` — rendered inline beside `title` without inheriting bold/color. */
  titleSuffix?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Official 2.1.328 `xe.isSubtitleDimmed` — render subtitle dimmed (default `true`). */
  isSubtitleDimmed?: boolean;
  children: React.ReactNode;
  onCancel: () => void;
  onInterrupt?: () => boolean;
  exitOnCtrlCD?: boolean;
  color?: keyof Theme;
  hideInputGuide?: boolean;
  hideBorder?: boolean;
  /** Custom input guide content. Accepts ReactNode or a function receiving exitState. */
  inputGuide?: React.ReactNode | ((exitState: ExitState) => React.ReactNode);
  /** Official 2.1.328 `xe.truncateInputGuide` — truncate the input guide to one line when `true` (default `false`). */
  truncateInputGuide?: boolean;
  /** Official 2.1.328 `xe.escapeAction` — Esc hint action text in the default input guide (default `'cancel'`). */
  escapeAction?: string;
  /** Official 2.1.328 `xe.enterAction` — Enter hint action text in the default input guide (default `'confirm'`). */
  enterAction?: string;
  /** Official 2.1.328 `xe.pressAgainAction` — action text for "Press Ctrl-C again to …" (defaults to `escapeAction ?? 'cancel'`). */
  pressAgainAction?: string;
  /** Official 2.1.328 `xe.keys` — optional shortcut declarations rendered in the default input guide and dispatched on keypress. */
  keys?: readonly DialogKeyHint[];
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
  titleSuffix,
  subtitle,
  isSubtitleDimmed = true,
  children,
  onCancel,
  onInterrupt,
  exitOnCtrlCD = false,
  color = 'permission',
  hideInputGuide,
  hideBorder,
  inputGuide,
  truncateInputGuide = false,
  escapeAction = 'cancel',
  enterAction = 'confirm',
  pressAgainAction,
  keys,
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

  const chromeRows = (title == null && subtitle == null ? 0 : headerRows + 1) + (hideInputGuide ? 0 : 2);
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

  const extraActionHandlers = useMemo(() => {
    const map: Record<string, () => false | undefined> = {};
    if (!keys) return map;
    for (const entry of keys) {
      if (entry.action && entry.run) {
        const run = entry.run;
        map[entry.action] = () => (run() === false ? false : undefined);
      }
    }
    return map;
  }, [keys]);
  const hasExtraActionHandlers = Object.keys(extraActionHandlers).length > 0;
  useKeybindings(extraActionHandlers, {
    context: 'Confirmation',
    isActive: isCancelActive && hasExtraActionHandlers,
  });

  const hasRawKeyHandlers = Boolean(keys?.some(entry => entry.on != null && entry.run != null));
  const handleExtraKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (!isCancelActive || !keys || event.defaultPrevented || event.ctrl || event.meta) {
        return;
      }
      for (const entry of keys) {
        if (!entry.on || !entry.run) continue;
        const targets = Array.isArray(entry.on) ? entry.on : [entry.on];
        if (targets.includes(event.key) && entry.run() !== false) {
          event.preventDefault();
          return;
        }
      }
    },
    [isCancelActive, keys],
  );

  const pendingAction = exitOnCtrlCD ? 'exit' : (pressAgainAction ?? escapeAction);
  const defaultGuideHints: React.ReactNode[] = [];
  let keysDeclaresEnter = false;
  if (keys) {
    for (let i = 0; i < keys.length; i++) {
      const entry = keys[i]!;
      const isEnterDecl =
        entry.action === 'confirm:yes' ||
        entry.on === 'enter' ||
        (Array.isArray(entry.on) && entry.on.includes('enter'));
      if (isEnterDecl) {
        keysDeclaresEnter = true;
      }
      if (entry.hint === '' || entry.action === 'confirm:no') continue;
      const description = entry.hint ?? (entry.action ? DIALOG_ACTION_DEFAULT_DESCRIPTIONS[entry.action] : undefined);
      if (!description) continue;
      if (entry.action) {
        const fallback =
          DIALOG_ACTION_FALLBACK_KEYS[entry.action] ?? (entry.on ? formatDialogKeyOn(entry.on) : entry.action);
        defaultGuideHints.push(
          <ConfigurableShortcutHint
            key={`key-action-${i}-${entry.action}`}
            action={entry.action}
            context="Confirmation"
            fallback={fallback}
            description={description}
          />,
        );
      } else if (entry.on != null) {
        defaultGuideHints.push(
          <KeyboardShortcutHint
            key={`key-on-${i}-${formatDialogKeyOn(entry.on)}`}
            shortcut={formatDialogKeyOn(entry.on)}
            action={description}
          />,
        );
      }
    }
  }
  if (!keysDeclaresEnter && enterAction !== '') {
    defaultGuideHints.push(<KeyboardShortcutHint key="dialog-enter" shortcut="Enter" action={enterAction} />);
  }
  if (escapeAction !== '') {
    defaultGuideHints.push(
      <ConfigurableShortcutHint
        key="dialog-escape"
        action="confirm:no"
        context="Confirmation"
        fallback="Esc"
        description={escapeAction}
      />,
    );
  }

  const defaultInputGuide = exitState.pending ? (
    <Text>
      Press {exitState.keyName} again to {pendingAction}
    </Text>
  ) : (
    <Byline>{defaultGuideHints}</Byline>
  );

  const resolvedGuide =
    typeof inputGuide === 'function'
      ? inputGuide(exitState)
      : exitState.pending
        ? defaultInputGuide
        : inputGuide != null
          ? inputGuide
          : defaultInputGuide;

  // Official 2.1.328 `A` (@308190350:5266): let title and subtitle wrap cleanly
  // (no unconditional wrap="truncate-end"); keep wrap="truncate-start" on titleEnd.
  const titleText =
    title == null ? null : titleSuffix == null ? (
      <Text bold color={color}>
        {title}
      </Text>
    ) : (
      <Text>
        <Text bold color={color}>
          {title}
        </Text>
        {titleSuffix}
      </Text>
    );

  const titleNode =
    titleText == null ? null : titleEnd ? (
      <Box justifyContent="space-between" gap={2}>
        {titleText}
        <Text dimColor wrap="truncate-start">
          {titleEnd}
        </Text>
      </Box>
    ) : (
      titleText
    );

  const subtitleNode = subtitle ? (
    isSubtitleDimmed ? (
      <Text dimColor>{subtitle}</Text>
    ) : typeof subtitle === 'string' || typeof subtitle === 'number' ? (
      <Text>{subtitle}</Text>
    ) : (
      subtitle
    )
  ) : null;

  // densable nr (2.1.216) & official 2.1.328 `xe` (@308190350): wrap title/body,
  // input guide, and `<DialogWait />` inside a column Box so InputGate `.wait`
  // covers every descendant (including Select) for both bordered and borderless dialogs.
  const content = (
    <Box
      flexDirection="column"
      flexGrow={hideBorder || modalCtx ? 0 : 1}
      minWidth={0}
      width="100%"
      onKeyDown={hasRawKeyHandlers ? handleExtraKeyDown : undefined}
    >
      <Box flexDirection="column" gap={1} minWidth={0} width="100%">
        {(titleNode != null || subtitleNode != null) && (
          <Box ref={headerRef} flexDirection="column" minWidth={0}>
            {titleNode}
            {subtitleNode}
          </Box>
        )}
        <ModalContext.Provider value={innerModalCtx}>{children}</ModalContext.Provider>
      </Box>
      {!hideInputGuide && (
        <Box marginTop={1} flexShrink={0} minWidth={0}>
          <Text dimColor italic wrap={truncateInputGuide ? 'truncate' : undefined}>
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
