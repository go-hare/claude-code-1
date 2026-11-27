import { Box, Text, useKeybinding, useRegisterKeybindingContext } from '@anthropic/ink';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { getDockLitStore } from '../FullscreenLayout.js';
import {
  closePluginPane,
  getPanesState,
  getShownPluginPane,
  scrollPluginPane,
  subscribePanes,
} from '../../utils/plugins/functionHooksModules.js';
import { useHasOpenDialogs } from '../../dialog/DialogStoreContext.js';
import {
  BORDER_MARK_INSET,
  DOCK_GRIP_COLUMNS,
  MARK_EDGE_COLUMNS,
  overflowCueText,
  titleStripStart,
  titleTabColumns,
} from './drawingHelpers.js';
import { keepPluginPaneRoom, paneFieldHeldNow, subscribePaneFieldHeld } from './sessionStores.js';

/**
 * densable `OM` DimButton — hover or held is inverse, otherwise dim.
 */
export function PluginDimButton({
  label,
  isHeld = false,
  onAction,
}: {
  label: string;
  isHeld?: boolean;
  onAction: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box
      onClick={event => {
        event.stopImmediatePropagation();
        if (event.isWindowActivation) return;
        onAction();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text inverse={hover || isHeld} dimColor={!hover && !isHeld}>
        {label}
      </Text>
    </Box>
  );
}

/**
 * densable `EZ` CollapseHandle — absolute `top:0,right:pL` DimButton `[-]`.
 */
export function PluginBandCollapseHandle({ onCollapse }: { onCollapse: () => void }): ReactNode {
  return (
    <Box position="absolute" top={0} right={MARK_EDGE_COLUMNS}>
      <PluginDimButton label="[-]" onAction={onCollapse} />
    </Box>
  );
}

/**
 * densable `n$` CollapsedHint — `▸ plugin panel hidden · {shortcut} or click to show`.
 */
export function PluginBandCollapsedHint({ shortcut, onExpand }: { shortcut: string; onExpand: () => void }): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box
      flexShrink={0}
      alignSelf="flex-start"
      onClick={onExpand}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text dimColor inverse={hover} wrap="truncate-end">
        {`▸ plugin panel hidden · ${shortcut} or click to show`}
      </Text>
    </Box>
  );
}

/**
 * densable `a$` OverflowCue — dim truncate-end cue under the band window.
 */
export function PluginBandOverflowCue({ above, below }: { above: number; below: number }): ReactNode {
  const label = overflowCueText(above, below);
  if (label === '') return null;
  return (
    <Text dimColor wrap="truncate-end">
      {label}
    </Text>
  );
}

/**
 * densable `S$` CloseMark — absolute `top:0,right:inset` DimButton (`✕`).
 * Gold: `e(DimButton,{label:✕,isHeld,onAction:onClose})` in absolute Box.
 */
/**
 * densable `xL` — one open-pane title tab. Click `showPane` (l4n).
 */
export function PluginPaneTitleTab({
  pane,
  isShown,
  isHeld,
  onPick,
}: {
  pane: { id: string; title: string };
  isShown: boolean;
  isHeld: boolean;
  onPick: (id: string) => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  const lit = hover || isHeld;
  const inverse = isShown || lit;
  const dim = lit && !isShown;
  const minWidth = titleTabColumns(pane.title);
  return (
    <Box
      flexShrink={1}
      minWidth={minWidth}
      height={1}
      overflow="hidden"
      onClick={event => {
        event.stopImmediatePropagation();
        if (event.isWindowActivation) return;
        onPick(pane.id);
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text inverse={inverse} bold={isShown} dimColor={dim} wrap="truncate-end">
        {` ${pane.title} `}
      </Text>
    </Box>
  );
}

/**
 * densable `_$` — row of title tabs from `w$` window start.
 */
export function PluginPaneTitleStrip({
  open,
  shownId,
  heldId,
  columns,
  onPick,
}: {
  open: ReadonlyArray<{ id: string; title: string }>;
  shownId: string;
  heldId: string | null;
  columns: number;
  onPick: (id: string) => void;
}): ReactNode {
  const start = titleStripStart({ open, shownId, columns });
  return (
    <Box flexDirection="row" flexShrink={0} width={columns} height={1} gap={1} overflow="hidden">
      {open.slice(start).map(pane => (
        <PluginPaneTitleTab
          key={pane.id}
          pane={pane}
          isShown={pane.id === shownId}
          isHeld={pane.id === heldId}
          onPick={onPick}
        />
      ))}
    </Box>
  );
}

export function PluginPaneCloseMark({
  inset = BORDER_MARK_INSET,
  isHeld = false,
  onClose,
}: {
  inset?: number;
  isHeld?: boolean;
  onClose: () => void;
}): ReactNode {
  const [hover, setHover] = useState(false);
  return (
    <Box
      position="absolute"
      top={0}
      right={inset}
      onClick={event => {
        event.stopImmediatePropagation();
        if (event.isWindowActivation) return;
        onClose();
      }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text inverse={hover || isHeld} dimColor={!hover && !isHeld}>
        {'✕'}
      </Text>
    </Box>
  );
}

/**
 * densable `dL` RowGrip — 1-row absolute top bar. Drag resizes inline rows.
 */
export function PluginRowGrip({
  columns,
  rows,
  onResize,
  onSettle,
  onLit,
}: {
  columns: number;
  rows: number;
  onResize: (next: number) => number;
  onSettle: () => void;
  /** densable pee `Ie` / grip lit — paints inline round-border top. */
  onLit?: (lit: boolean) => void;
}): ReactNode {
  const drag = useRef<{ at: number; cells: number; now: number } | null>(null);
  const setGripLit = (next: boolean): void => {
    onLit?.(next);
  };
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={1}
      onMouseEnter={() => setGripLit(true)}
      onMouseLeave={() => setGripLit(false)}
      onPointer={event => {
        if (event.type === 'mousedown') {
          if (event.button !== 0) return;
          drag.current = { at: event.row, cells: rows, now: rows };
          setGripLit(true);
          return;
        }
        if (event.type === 'mousedrag') {
          const held = drag.current;
          if (held === undefined || held === null) return;
          held.now = onResize(held.cells + held.at - event.row);
          return;
        }
        if (event.type === 'mouseup') {
          const held = drag.current;
          drag.current = null;
          setGripLit(false);
          if (held !== null && held.now !== held.cells) onSettle();
        }
      }}
    />
  );
}

/**
 * densable `TL` / `Pw`: 1-col left border grip.
 * Drag resizes dock columns; mouse-up calls keepRoom. Lit on hover/drag or focused pane.
 */
export function PluginDockGrip({
  columns,
  onResize,
  onSettle,
  isFocused,
}: {
  columns: number;
  onResize: (next: number) => number;
  onSettle: () => void;
  isFocused?: boolean;
}): ReactNode {
  const [lit, setLit] = useState(false);
  const drag = useRef<{ at: number; cells: number; now: number } | null>(null);
  const dialogOpen = useHasOpenDialogs();
  const panesFocused = useSyncExternalStore(
    subscribePanes,
    () => getPanesState().focusedId !== null,
    () => getPanesState().focusedId !== null,
  );
  const isGripLit = !dialogOpen && lit;
  useEffect(() => {
    const store = getDockLitStore();
    store.setState(() => isGripLit);
    return () => {
      store.setState(() => false);
    };
  }, [isGripLit]);
  const gripLit = isGripLit || (isFocused ?? panesFocused);
  return (
    <Box
      flexShrink={0}
      width={DOCK_GRIP_COLUMNS}
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftDimColor={!gripLit}
      borderLeftColor={gripLit ? 'suggestion' : undefined}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => {
        setLit(false);
      }}
      onPointer={event => {
        if (event.type === 'mousedown') {
          if (event.button !== 0 || dialogOpen) return;
          drag.current = { at: event.col, cells: columns, now: columns };
          setLit(true);
          return;
        }
        if (event.type === 'mousedrag') {
          const held = drag.current;
          if (held === undefined || held === null || dialogOpen) return;
          held.now = onResize(held.cells + held.at - event.col);
          return;
        }
        if (event.type === 'mouseup') {
          const held = drag.current;
          drag.current = null;
          setLit(false);
          if (held !== null && held.now !== held.cells) onSettle();
        }
      }}
    />
  );
}

/**
 * densable `FT` / `E7` — `pane:grow` / `pane:shrink` step `x7` (inline) or `g7` (dock).
 * Persist via `iL` only when the clamp actually moves.
 */
export function PluginPaneKeyResize({
  isActive,
  docked: _docked,
  cells,
  step,
  resizeTo,
  pixelScroll = true,
}: {
  isActive: boolean;
  docked: boolean;
  cells: number;
  step: number;
  resizeTo: (next: number) => number;
  /** densable iee `maxOffset>0` — mEe pixel scroll. False lets aee We cycle focus. */
  pixelScroll?: boolean;
}): ReactNode {
  const paneFocused = useSyncExternalStore(
    subscribePanes,
    () => {
      const state = getPanesState();
      const shown = getShownPluginPane();
      return shown !== undefined ? state.focusedId === shown.id : state.focusedId !== null;
    },
    () => false,
  );
  const fieldHeld = useSyncExternalStore(subscribePaneFieldHeld, paneFieldHeldNow, paneFieldHeldNow);
  const focusedActive = isActive && paneFocused;
  const paneActive = focusedActive && !fieldHeld;
  const fieldActive = focusedActive && fieldHeld;
  const pixelActive = paneActive && pixelScroll;
  useRegisterKeybindingContext('Pane', paneActive);
  useRegisterKeybindingContext('PaneField', fieldActive);
  const grow = (): void => {
    const next = resizeTo(cells + step);
    if (next !== cells) keepPluginPaneRoom();
  };
  const shrink = (): void => {
    const next = resizeTo(cells - step);
    if (next !== cells) keepPluginPaneRoom();
  };
  useKeybinding('pane:grow', grow, { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:shrink', shrink, { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:scrollUp', () => scrollPluginPane('up'), { context: 'Pane', isActive: pixelActive });
  useKeybinding('pane:scrollDown', () => scrollPluginPane('down'), {
    context: 'Pane',
    isActive: pixelActive,
  });
  useKeybinding('pane:pageUp', () => scrollPluginPane('pageUp'), { context: 'Pane', isActive: pixelActive });
  useKeybinding('pane:pageDown', () => scrollPluginPane('pageDown'), {
    context: 'Pane',
    isActive: pixelActive,
  });
  useKeybinding('pane:top', () => scrollPluginPane('top'), { context: 'Pane', isActive: pixelActive });
  useKeybinding('pane:bottom', () => scrollPluginPane('bottom'), {
    context: 'Pane',
    isActive: pixelActive,
  });
  useKeybinding('pane:close', () => void closePluginPane(), { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:close', () => void closePluginPane(), { context: 'PaneField', isActive: fieldActive });
  return null;
}
