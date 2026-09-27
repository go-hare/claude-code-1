import {
  Box,
  Button,
  Link,
  Text,
  stringWidth,
  useInput,
  useKeybinding,
  useOptionalKeybindingContext,
  useRegisterKeybindingContext,
  type Key,
} from '@anthropic/ink';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { getRenderVersion, subscribeRenderInvalidation } from '../utils/render/invalidateAllRenders.js';
import {
  ABOVE_PROMPT_REQUEST_ID,
  closePluginPane,
  evaluateUiRender,
  getRasterFrameVersion,
  getShownPluginPane,
  invokePress,
  recordPress,
  scrollPluginPane,
  subscribeRasterFrames,
} from '../utils/plugins/functionHooksModules.js';
import { acquirePluginClient, DETACHED_CLIENT, type ClientInstance } from '../utils/plugins/functionHooksClient.js';
import TextInput from './TextInput.js';
import { HighlightedCode } from './HighlightedCode.js';
import { Markdown } from './Markdown.js';
import { PluginImage, PluginRaster } from './PluginRaster.js';

/** densable Select `it=8` — open list window. */
const SELECT_WINDOW = 8;
/** densable `yy.DOCK_GRIP_COLUMNS` / `XN`. */
export const DOCK_GRIP_COLUMNS = 1;

/** densable `aL` — persist only a finite integer ≥ 1. */
function paneRoomValue(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 1 ? Math.floor(value) : null;
}

/** densable `Vg` room store — dock columns / inline rows. */
let dockRoomColumns: number | null = null;
let inlineRoomRows: number | null = null;
let dockRoomHydrated = false;
const dockRoomListeners = new Set<() => void>();

/**
 * densable `l$("PaneField")` — Input/Select focused in a plugin pane.
 * Grow/scroll stay on `Pane`; close is on `PaneField` too.
 */
let paneFieldHeld = false;
const paneFieldListeners = new Set<() => void>();

function paneFieldHeldNow(): boolean {
  return paneFieldHeld;
}

function subscribePaneFieldHeld(listener: () => void): () => void {
  paneFieldListeners.add(listener);
  return () => {
    paneFieldListeners.delete(listener);
  };
}

function setPaneFieldHeld(next: boolean): void {
  if (paneFieldHeld === next) return;
  paneFieldHeld = next;
  for (const listener of paneFieldListeners) listener();
}

/** densable `XP(focusable, site)` — Input/Select remap to AbovePrompt* else the site. */
export function pluginFieldContext(
  tag: string | undefined,
  site: 'Pane' | 'AbovePrompt',
): 'Pane' | 'AbovePrompt' | 'AbovePromptInput' | 'AbovePromptSelect' {
  if (tag === 'Input') return 'AbovePromptInput';
  if (tag === 'Select') return 'AbovePromptSelect';
  return site;
}

/** densable `$q` `isAhead` — held focus vs last painted focus. */
export function pluginKeysAreAhead(
  held: { focused: unknown; select: unknown },
  rendered: { focused: unknown; select: unknown },
): boolean {
  return held.focused !== rendered.focused || held.select !== rendered.select;
}

export function getDockRoomColumns(): number | null {
  return dockRoomColumns;
}

export function getInlineRoomRows(): number | null {
  return inlineRoomRows;
}

function hydrateDockRoom(): void {
  if (dockRoomHydrated) return;
  dockRoomHydrated = true;
  try {
    const { getGlobalConfig } = require('../utils/config.js') as typeof import('../utils/config.js');
    const stored = getGlobalConfig().pluginPanes;
    const dock = paneRoomValue(stored?.dockColumns);
    const inline = paneRoomValue(stored?.inlineRows);
    if (dock !== null) dockRoomColumns = dock;
    if (inline !== null) inlineRoomRows = inline;
  } catch {
    /* config unavailable */
  }
}

hydrateDockRoom();

export function chooseDockRoom(columns: number | null): void {
  dockRoomColumns = columns;
  for (const listener of dockRoomListeners) listener();
}

export function chooseInlineRoom(rows: number | null): void {
  inlineRoomRows = rows;
  for (const listener of dockRoomListeners) listener();
}

export function subscribeDockRoom(listener: () => void): () => void {
  dockRoomListeners.add(listener);
  return () => {
    dockRoomListeners.delete(listener);
  };
}

/**
 * densable `iL` keepRoom — `T4` writes `pluginPanes.dockColumns` /
 * `inlineRows`. Memory `null` keeps disk (`chosen ?? held`).
 */
export function keepPluginPaneRoom(): void {
  const chosenDock = dockRoomColumns;
  const chosenInline = inlineRoomRows;
  void import('../utils/config.js').then(({ saveGlobalConfig }) => {
    saveGlobalConfig(current => {
      const held = current.pluginPanes;
      const dockColumns = chosenDock ?? held?.dockColumns;
      const inlineRows = chosenInline ?? held?.inlineRows;
      if (held?.dockColumns === dockColumns && held?.inlineRows === inlineRows) {
        return current;
      }
      return {
        ...current,
        pluginPanes: {
          ...held,
          dockColumns,
          inlineRows,
        },
      };
    });
  });
}

/** densable `yy.DOCK_MIN_COLUMNS` / `h7`. */
const DOCK_MIN_COLUMNS = 24;
/** densable `yy.DOCK_TRANSCRIPT_MIN_COLUMNS` / `b7`. */
const DOCK_TRANSCRIPT_MIN_COLUMNS = 24;
/** densable `nq` — dock is 0 when transcript columns are below this. */
const DOCK_FLOOR_COLUMNS = 110;

/**
 * densable `ZP` / `V7` default (`ZN`): min(floor(h*0.45), 90, h-70),
 * clamped to [h7, h-b7], 0 if h<nq.
 */
export function pluginPaneDockColumns(columns: number, chosen?: number | null): number {
  if (columns < DOCK_FLOOR_COLUMNS) return 0;
  const clamp = (value: number) => Math.min(columns - DOCK_TRANSCRIPT_MIN_COLUMNS, Math.max(DOCK_MIN_COLUMNS, value));
  if (typeof chosen === 'number') return clamp(chosen);
  const raw = Math.min(Math.floor(columns * 0.45), 90, columns - 70);
  return clamp(raw);
}

/** densable `_7` / `R7` / `A7` / `I7` — inline pane rows (`oA` / `Q7`). */
/** densable `x7` — keyboard pane grow/shrink step. */
export const INLINE_KEY_ROWS = 1;
/** densable `g7` — keyboard dock grow/shrink step. */
export const DOCK_KEY_COLUMNS = 4;
const INLINE_MIN_ROWS = 5;
const INLINE_PROMPT_FLOOR_ROWS = 8;
const INLINE_TRANSCRIPT_PEEK_ROWS = 3;
const INLINE_ROWS_SHARE = 3;

/**
 * densable `oA`: floor(rows/3); fullscreen uses that; else max(share, rows-peek-floor).
 * Clamp to [min(5, cap), cap]. Chosen wins, then requested, else share.
 */
export function pluginPaneInlineRows(
  rows: number,
  layout: 'fullscreen' | 'inline' = 'inline',
  chosen?: number | null,
  requested?: number,
): number {
  const share = Math.floor(rows / INLINE_ROWS_SHARE);
  const cap =
    layout === 'fullscreen' ? share : Math.max(share, rows - INLINE_TRANSCRIPT_PEEK_ROWS - INLINE_PROMPT_FLOOR_ROWS);
  const floor = Math.min(INLINE_MIN_ROWS, cap);
  const clamp = (value: number) => Math.min(cap, Math.max(floor, value));
  if (typeof chosen === 'number') return clamp(chosen);
  if (typeof requested === 'number') return clamp(requested);
  return share;
}

/**
 * densable `dL` RowGrip — 1-row absolute top bar. Drag resizes inline rows.
 */
export function PluginRowGrip({
  columns,
  rows,
  onResize,
  onSettle,
}: {
  columns: number;
  rows: number;
  onResize: (next: number) => number;
  onSettle: () => void;
}): ReactNode {
  const [lit, setLit] = useState(false);
  const drag = useRef<{ at: number; cells: number; now: number } | null>(null);
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      width={columns}
      height={1}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => setLit(false)}
      onMouseDown={event => {
        if (event.button !== 0) return;
        drag.current = { at: event.row, cells: rows, now: rows };
        setLit(true);
      }}
      onMouseDrag={event => {
        const held = drag.current;
        if (held === undefined || held === null) return;
        held.now = onResize(held.cells + held.at - event.row);
      }}
      onMouseUp={() => {
        const held = drag.current;
        drag.current = null;
        setLit(false);
        if (held !== null && held.now !== held.cells) onSettle();
      }}
    >
      <Text dimColor={!lit}> </Text>
    </Box>
  );
}

/**
 * densable `oL` / `LT` / `dv`: 1-col left border grip.
 * Drag resizes dock columns; mouse-up calls keepRoom.
 */
export function PluginDockGrip({
  columns,
  onResize,
  onSettle,
}: {
  columns: number;
  onResize: (next: number) => number;
  onSettle: () => void;
}): ReactNode {
  const [lit, setLit] = useState(false);
  const drag = useRef<{ at: number; cells: number; now: number } | null>(null);
  return (
    <Box
      flexShrink={0}
      width={DOCK_GRIP_COLUMNS}
      borderStyle="single"
      borderLeft
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderLeftDimColor={!lit}
      borderLeftColor={lit ? 'suggestion' : undefined}
      onMouseEnter={() => setLit(true)}
      onMouseLeave={() => {
        setLit(false);
      }}
      onMouseDown={event => {
        if (event.button !== 0) return;
        drag.current = { at: event.col, cells: columns, now: columns };
        setLit(true);
      }}
      onMouseDrag={event => {
        const held = drag.current;
        if (held === undefined || held === null) return;
        held.now = onResize(held.cells + held.at - event.col);
      }}
      onMouseUp={() => {
        const held = drag.current;
        drag.current = null;
        setLit(false);
        if (held !== null && held.now !== held.cells) onSettle();
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
}: {
  isActive: boolean;
  docked: boolean;
  cells: number;
  step: number;
  resizeTo: (next: number) => number;
}): ReactNode {
  const fieldHeld = useSyncExternalStore(subscribePaneFieldHeld, paneFieldHeldNow, paneFieldHeldNow);
  const paneActive = isActive && !fieldHeld;
  const fieldActive = isActive && fieldHeld;
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
  useKeybinding('pane:scrollUp', () => scrollPluginPane('up'), { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:scrollDown', () => scrollPluginPane('down'), {
    context: 'Pane',
    isActive: paneActive,
  });
  useKeybinding('pane:pageUp', () => scrollPluginPane('pageUp'), { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:pageDown', () => scrollPluginPane('pageDown'), {
    context: 'Pane',
    isActive: paneActive,
  });
  useKeybinding('pane:top', () => scrollPluginPane('top'), { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:bottom', () => scrollPluginPane('bottom'), {
    context: 'Pane',
    isActive: paneActive,
  });
  useKeybinding('pane:close', () => void closePluginPane(), { context: 'Pane', isActive: paneActive });
  useKeybinding('pane:close', () => void closePluginPane(), { context: 'PaneField', isActive: fieldActive });
  return null;
}

function snapshot(): number {
  return getRasterFrameVersion();
}

function renderVersion(): number {
  return getRenderVersion('ui.render');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isEngineDrawing(value: unknown): boolean {
  return isRecord(value) && value.type === 'engine';
}

function stampedPlugin(node: Record<string, unknown>, fallback: string): string {
  const raster = isRecord(node.raster) ? node.raster : undefined;
  if (typeof raster?.plugin === 'string' && raster.plugin !== '') return raster.plugin;
  const image = isRecord(node.image) ? node.image : undefined;
  if (typeof image?.plugin === 'string' && image.plugin !== '') return image.plugin;
  const client = isRecord(node.client) ? node.client : undefined;
  if (typeof client?.plugin === 'string' && client.plugin !== '') return client.plugin;
  return fallback;
}

function pressOf(node: Record<string, unknown>): { plugin: string; handle: unknown } | undefined {
  const press = isRecord(node.press) ? node.press : undefined;
  if (press === undefined || typeof press.plugin !== 'string') return undefined;
  return { plugin: press.plugin, handle: press.handle };
}

/** densable `n_e` → `ui.press` via local recordPress/invokePress. */
function firePress(plugin: string, handle: unknown, event?: unknown): void {
  recordPress(plugin, handle, event);
  void invokePress(plugin, handle, event);
}

function firePressAnswer(plugin: string, handle: unknown, event: unknown): Promise<unknown> {
  recordPress(plugin, handle, event);
  return invokePress(plugin, handle, event);
}

function stringProp(props: Record<string, unknown>, node: Record<string, unknown>, key: string): string | undefined {
  const fromProps = props[key];
  if (typeof fromProps === 'string') return fromProps;
  const fromNode = node[key];
  return typeof fromNode === 'string' ? fromNode : undefined;
}

function numberProp(props: Record<string, unknown>, node: Record<string, unknown>, key: string): number | undefined {
  const fromProps = props[key];
  if (typeof fromProps === 'number') return fromProps;
  const fromNode = node[key];
  return typeof fromNode === 'number' ? fromNode : undefined;
}

function boolProp(props: Record<string, unknown>, key: string): boolean | undefined {
  const value = props[key];
  return typeof value === 'boolean' ? value : undefined;
}

type BoxLayout = {
  -readonly [K in keyof Pick<
    ComponentProps<typeof Box>,
    | 'flexDirection'
    | 'flexGrow'
    | 'flexShrink'
    | 'flexWrap'
    | 'alignItems'
    | 'alignSelf'
    | 'justifyContent'
    | 'width'
    | 'height'
    | 'minWidth'
    | 'minHeight'
    | 'maxWidth'
    | 'maxHeight'
    | 'overflow'
    | 'gap'
    | 'columnGap'
    | 'rowGap'
    | 'padding'
    | 'paddingX'
    | 'paddingY'
    | 'margin'
    | 'marginX'
    | 'marginY'
    | 'marginTop'
  >]: ComponentProps<typeof Box>[K];
};

function layoutFrom(props: Record<string, unknown> | undefined): BoxLayout {
  if (props === undefined) return {};
  const out: BoxLayout = {};
  const flexDirection = props.flexDirection;
  if (
    flexDirection === 'row' ||
    flexDirection === 'column' ||
    flexDirection === 'row-reverse' ||
    flexDirection === 'column-reverse'
  ) {
    out.flexDirection = flexDirection;
  }
  if (typeof props.flexGrow === 'number') out.flexGrow = props.flexGrow;
  if (typeof props.flexShrink === 'number') out.flexShrink = props.flexShrink;
  if (props.flexWrap === 'nowrap' || props.flexWrap === 'wrap' || props.flexWrap === 'wrap-reverse') {
    out.flexWrap = props.flexWrap;
  }
  if (
    props.alignItems === 'flex-start' ||
    props.alignItems === 'center' ||
    props.alignItems === 'flex-end' ||
    props.alignItems === 'stretch'
  ) {
    out.alignItems = props.alignItems;
  }
  if (
    props.alignSelf === 'flex-start' ||
    props.alignSelf === 'center' ||
    props.alignSelf === 'flex-end' ||
    props.alignSelf === 'auto'
  ) {
    out.alignSelf = props.alignSelf;
  }
  if (
    props.justifyContent === 'flex-start' ||
    props.justifyContent === 'center' ||
    props.justifyContent === 'flex-end' ||
    props.justifyContent === 'space-between' ||
    props.justifyContent === 'space-around'
  ) {
    out.justifyContent = props.justifyContent;
  }
  if (typeof props.width === 'number') out.width = props.width;
  else if (typeof props.width === 'string' && props.width.endsWith('%')) {
    out.width = props.width as `${number}%`;
  }
  if (typeof props.height === 'number') out.height = props.height;
  else if (typeof props.height === 'string' && props.height.endsWith('%')) {
    out.height = props.height as `${number}%`;
  }
  if (typeof props.minWidth === 'number') out.minWidth = props.minWidth;
  if (typeof props.minHeight === 'number') out.minHeight = props.minHeight;
  if (typeof props.maxWidth === 'number') out.maxWidth = props.maxWidth;
  if (typeof props.maxHeight === 'number') out.maxHeight = props.maxHeight;
  if (props.overflow === 'visible' || props.overflow === 'hidden') out.overflow = props.overflow;
  if (typeof props.gap === 'number') out.gap = props.gap;
  if (typeof props.columnGap === 'number') out.columnGap = props.columnGap;
  if (typeof props.rowGap === 'number') out.rowGap = props.rowGap;
  if (typeof props.padding === 'number') out.padding = props.padding;
  if (typeof props.paddingX === 'number') out.paddingX = props.paddingX;
  if (typeof props.paddingY === 'number') out.paddingY = props.paddingY;
  if (typeof props.margin === 'number') out.margin = props.margin;
  if (typeof props.marginX === 'number') out.marginX = props.marginX;
  if (typeof props.marginY === 'number') out.marginY = props.marginY;
  if (typeof props.marginTop === 'number') out.marginTop = props.marginTop;
  return out;
}

/** densable Select `v_n` window of `it=8`. */
function selectWindow(count: number, highlight: number): { first: number; size: number; hidden: number } {
  const first = Math.max(0, highlight - SELECT_WINDOW + 1);
  const size = Math.max(0, Math.min(SELECT_WINDOW, count - first));
  const hidden = count - first - size;
  return { first, size, hidden };
}

function PluginPressButton({
  plugin,
  handle,
  label,
  hotkey,
  plain,
  dimColor,
  variant,
}: {
  plugin: string;
  handle: unknown;
  label: string;
  hotkey?: string;
  plain?: boolean;
  dimColor?: boolean;
  variant?: string;
}): ReactNode {
  return (
    <Box flexShrink={0} alignSelf="flex-start" onClick={() => firePress(plugin, handle)}>
      <Button tabIndex={-1} flexShrink={0} alignSelf="flex-start" onAction={() => firePress(plugin, handle)}>
        {state => {
          const inverse = state.focused || state.hovered;
          const dim = dimColor === true && !inverse;
          if (plain === true) {
            return (
              <Text inverse={inverse} dimColor={dim}>
                {hotkey === undefined ? (
                  label
                ) : (
                  <>
                    <Text color="suggestion">{hotkey}</Text>
                    {': '}
                    {label}
                  </>
                )}
              </Text>
            );
          }
          return (
            <Text inverse={inverse} bold dimColor={dim} color={variant === 'primary' ? 'suggestion' : undefined}>
              {`[ ${label} ]`}
            </Text>
          );
        }}
      </Button>
    </Box>
  );
}

/** densable `Xjt` / `Uq` InputFields: textOf + edit keyed plugin\0element. */
type InputFields = {
  textOf: (plugin: string, element: string) => string | undefined;
  edit: (ref: { plugin: string; handle: unknown; element: string }, value: string) => void;
  textNow: (ref: { plugin: string; element: string; value?: string }) => string;
  submit: (ref: { plugin: string; handle: unknown; element: string; value?: string }) => void;
};

const InputFieldsContext = createContext<InputFields | null>(null);

type SelectOpen = {
  plugin: string;
  handle: unknown;
  highlight: number;
  element: string;
  options: Array<{ value: string; label?: string }>;
};

/**
 * densable `mR`/`pyr` for `$q`/`Wq`: `ez.escape` + lone surrogate + U+10EEEE.
 * Not tab/LF/CR (`a4` has those; `pyr` does not). Char-code loop for biome.
 */
export function pluginInputHoldsControl(input: string): boolean {
  for (const ch of input) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp <= 0x08) return true;
    if (cp === 0x0b || cp === 0x0c) return true;
    if (cp >= 0x0e && cp <= 0x1f) return true;
    if (cp >= 0x7f && cp <= 0x9f) return true;
    if (cp >= 0xd800 && cp <= 0xdfff) return true;
    if (cp === 0x10eeee) return true;
  }
  return false;
}

/** densable `qN` — Select typeahead: one non-C/Z grapheme, no ctrl/meta/super/esc/tab/return. */
export function pluginSelectTypeahead(input: string, key: Key): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    !key.super &&
    !key.escape &&
    !key.tab &&
    !key.return &&
    [...input].length === 1 &&
    /^[^\p{C}\p{Z}]+$/u.test(input)
  );
}

/**
 * densable `ro` — typeahead only opens (`isOpen:!0`) on a hit. A miss is a no-op
 * (closed stays closed; open highlight is unchanged).
 */
export function pluginSelectTypeaheadNext(
  current: SelectOpen | null,
  focused: {
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
  } | null,
  letter: string,
): SelectOpen | null {
  const base =
    current ??
    (focused === null
      ? null
      : {
          plugin: focused.plugin,
          handle: focused.handle,
          element: focused.element,
          options: focused.options,
          highlight: 0,
        });
  if (base === null) return current;
  const needle = letter.toLowerCase();
  const from = current === null ? -1 : base.highlight;
  const count = base.options.length;
  const hit = base.options
    .map((_, i) => (from + 1 + i) % Math.max(1, count))
    .find(i => {
      const option = base.options[i];
      return option !== undefined && (option.label ?? option.value).toLowerCase().startsWith(needle);
    });
  if (hit === undefined) return current;
  return { ...base, highlight: hit };
}

/** densable `Wq` — printable insert for focused plugin Input. */
export function pluginInputIsTyped(input: string, key: Key): boolean {
  return (
    input !== '' &&
    !key.ctrl &&
    !key.meta &&
    !key.super &&
    !key.tab &&
    !key.return &&
    !key.escape &&
    !pluginInputHoldsControl(input)
  );
}

/** densable `jq` — nav keys the host swallows on a focused Input. */
export function pluginInputIsNav(input: string, key: Key): boolean {
  return (
    key.leftArrow ||
    key.rightArrow ||
    key.home ||
    key.end ||
    key.delete ||
    key.pageUp ||
    key.pageDown ||
    (input.length === 1 && key.ctrl && 'abdefhknpuwy'.includes(input)) ||
    (input.length === 1 && key.meta && 'bdfy'.includes(input))
  );
}

/** densable `tWt` — pickedOf + open {plugin,handle,highlight}. */
type SelectFields = {
  pickedOf: (plugin: string, element: string) => string | undefined;
  open: SelectOpen | null;
  toggle: (ref: {
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
    value?: string;
  }) => void;
  move: (delta: number) => void;
  typeahead: (letter: string) => void;
  close: () => void;
  /** densable `Kq` focused Select (`Rs=un==="Select"`), open or closed. */
  focusedSelect: {
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
  } | null;
  focus: (ref: {
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
  }) => void;
  unfocus: () => void;
};

const SelectFieldsContext = createContext<SelectFields | null>(null);

type FocusedInput = {
  plugin: string;
  handle: unknown;
  element: string;
  value?: string;
};

const FocusedInputContext = createContext<{
  focused: FocusedInput | null;
  setFocused: (next: FocusedInput | null) => void;
} | null>(null);

function inputFieldKey(plugin: string, element: string): string {
  return `${plugin}\0${element}`;
}

function PluginPressInput({
  plugin,
  handle,
  element,
  label,
  placeholder,
  value,
  submitLabel,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  submitLabel?: string;
}): ReactNode {
  const focus = useContext(FocusedInputContext);
  const fields = useContext(InputFieldsContext);
  const fieldKey = element ?? '';
  const focused =
    focus?.focused !== null &&
    focus?.focused !== undefined &&
    focus.focused.plugin === plugin &&
    focus.focused.handle === handle;
  /** densable `Wt` `h` — `Xjt.textOf(plugin, element) ?? value ?? ""`. */
  const shown = (fields !== null && fieldKey !== '' ? fields.textOf(plugin, fieldKey) : undefined) ?? value ?? '';
  const [cursor, setCursor] = useState(shown.length);
  const { columns } = useTerminalSize();
  useEffect(() => {
    if (focused) setCursor(Number.MAX_SAFE_INTEGER);
  }, [focused]);
  const empty = shown === '';
  const prefix = label === undefined ? '' : `${label}: `;
  const submit = ` ⏎ ${submitLabel ?? 'submit'}`;
  const fieldColumns = Math.max(4, columns - stringWidth(prefix) - stringWidth(submit));
  return (
    <Box
      flexDirection="row"
      flexShrink={0}
      onClick={() => {
        if (fieldKey !== '') {
          focus?.setFocused({ plugin, handle, element: fieldKey, value });
        }
        firePress(plugin, handle);
      }}
    >
      {prefix !== '' && <Text bold={focused}>{prefix}</Text>}
      {focused ? (
        <TextInput
          value={shown}
          onChange={next => {
            if (fields !== null && fieldKey !== '') {
              fields.edit({ plugin, handle, element: fieldKey }, next);
              return;
            }
            firePress(plugin, handle, { kind: 'change', value: next });
          }}
          onSubmit={next => {
            if (fields !== null && fieldKey !== '') {
              fields.submit({ plugin, handle, element: fieldKey, value: next });
            } else {
              firePress(plugin, handle, { kind: 'submit', value: next });
            }
            focus?.setFocused(null);
          }}
          placeholder={placeholder}
          columns={fieldColumns}
          cursorOffset={Math.min(cursor, shown.length)}
          onChangeCursorOffset={setCursor}
          focus
          showCursor
          multiline={false}
          disableEscapeDoublePress
        />
      ) : (
        <Text dimColor={empty} wrap="truncate-end">
          {empty ? (placeholder ?? '') : shown}
        </Text>
      )}
      {focused && <Text dimColor>{submit}</Text>}
    </Box>
  );
}

function PluginPressSelect({
  plugin,
  handle,
  element,
  label,
  options,
  value,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label?: string;
  options: Array<{ value: string; label?: string }>;
  value?: string;
}): ReactNode {
  const fields = useContext(SelectFieldsContext);
  const fieldKey = element ?? '';
  const picked = fields !== null && fieldKey !== '' ? fields.pickedOf(plugin, fieldKey) : undefined;
  const shown = picked ?? value;
  const current = options.find(option => option.value === shown);
  const prefix = label === undefined ? '' : `${label}: `;
  const openRec = fields?.open;
  const isOpen = openRec !== null && openRec !== undefined && openRec.plugin === plugin && openRec.handle === handle;
  const highlight = isOpen ? openRec.highlight : 0;
  const { first, size, hidden } = selectWindow(isOpen ? options.length : 0, highlight);
  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      onClick={() => {
        if (fields !== null && fieldKey !== '') {
          fields.focus({ plugin, handle, element: fieldKey, options });
          fields.toggle({ plugin, handle, element: fieldKey, options, value });
          return;
        }
        firePress(plugin, handle);
      }}
    >
      <Text wrap="truncate-end">
        {prefix !== '' && <Text>{prefix}</Text>}
        {current === undefined ? (
          <Text dimColor>none</Text>
        ) : (
          <Text inverse={!isOpen}>{current.label ?? current.value}</Text>
        )}
        <Text dimColor>{isOpen ? ' ▴' : ' ▾'}</Text>
      </Text>
      {options.slice(first, first + size).map((option, i) => (
        <Text key={option.value} inverse={first + i === highlight} wrap="truncate-end">
          {`  ${option.label ?? option.value}`}
        </Text>
      ))}
      {hidden > 0 && <Text dimColor>{`  … ${hidden} more`}</Text>}
    </Box>
  );
}

function PluginCode({ source, format }: { source?: unknown; format?: unknown }): ReactNode {
  const text = typeof source === 'string' ? source : '';
  const filePath = typeof format === 'string' && format !== '' ? format : 'code';
  return (
    <Box flexDirection="column" flexGrow={1} flexShrink={1}>
      {text === '' ? <Text>{text}</Text> : <HighlightedCode code={text} filePath={filePath} />}
    </Box>
  );
}

function PluginMarkdown({
  text,
  dimColor,
  press,
  pressableLinks,
}: {
  text: string;
  dimColor?: boolean;
  press?: { plugin: string; handle: unknown };
  pressableLinks?: unknown;
}): ReactNode {
  const body = (
    <Markdown dimColor={dimColor} stripPromptTags={false}>
      {text}
    </Markdown>
  );
  if (press === undefined) {
    return <Box flexDirection="column">{body}</Box>;
  }
  return (
    <Box
      flexDirection="column"
      onClick={event => {
        const href = event.hyperlinkUrl;
        if (href === undefined) {
          event.allowDefault();
          return;
        }
        if (pressableLinks !== undefined && pressableLinks !== true) {
          if (!Array.isArray(pressableLinks) || !pressableLinks.includes(href)) {
            event.allowDefault();
            return;
          }
        }
        if (event.isWindowActivation) {
          event.dropAsStray();
          return;
        }
        event.stopImmediatePropagation();
        firePress(press.plugin, press.handle, { href });
      }}
    >
      {body}
    </Box>
  );
}

function PluginClient({
  plugin,
  moduleName,
  elementKey,
  requestId,
  props,
  width,
  height,
  flexGrow,
  engine,
}: {
  plugin: string;
  moduleName: string;
  elementKey?: string;
  requestId?: string;
  props?: unknown;
  width?: number;
  height?: number;
  flexGrow?: number;
  engine?: ReactNode;
}): ReactNode {
  const instanceRef = useRef<ClientInstance>(DETACHED_CLIENT);
  const [snapshot, setSnapshot] = useState(() => DETACHED_CLIENT.getSnapshot());
  const boxRef = useRef<{ width?: number; height?: number } | null>(null);
  useLayoutEffect(() => {
    const instance = acquirePluginClient({
      plugin,
      key: elementKey ?? '',
      module: moduleName,
      requestId,
      props,
    });
    instanceRef.current = instance;
    setSnapshot(instance.getSnapshot());
    const unsub = instance.subscribe(() => setSnapshot(instance.getSnapshot()));
    return () => {
      unsub();
      instance.release();
      instanceRef.current = DETACHED_CLIENT;
    };
  }, [plugin, moduleName, elementKey, requestId, props]);
  useLayoutEffect(() => {
    const instance = instanceRef.current;
    instance.setProps(props);
  }, [props]);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const columns = typeof box?.width === 'number' ? box.width : (width ?? 0);
    const rows = typeof box?.height === 'number' ? box.height : (height ?? 0);
    instanceRef.current.resize(columns, rows);
  }, [width, height, snapshot]);
  const drawn = snapshot.status === 'drawn';
  return (
    <Box
      ref={node => {
        boxRef.current = node as { width?: number; height?: number } | null;
      }}
      flexDirection="column"
      flexShrink={0}
      overflow="hidden"
      {...(width !== undefined && { width })}
      {...(height !== undefined && { height })}
      {...(flexGrow !== undefined && { flexGrow })}
    >
      {drawn ? (
        <DrawingNode node={snapshot.tree} plugin={plugin} requestId={requestId} index={0} engine={engine} />
      ) : null}
      {snapshot.status === 'failed' && (
        <Text dimColor wrap="truncate-end">
          {snapshot.text}
        </Text>
      )}
    </Box>
  );
}

function HoverBox({
  isInline,
  props,
  hover,
  children,
}: {
  isInline: boolean;
  props: Record<string, unknown>;
  hover: Record<string, unknown>;
  children: ReactNode;
}): ReactNode {
  const [hot, setHot] = useState(false);
  const layout = { ...layoutFrom(props), ...(hot ? layoutFrom(hover) : {}) };
  return (
    <Box
      {...layout}
      flexDirection={isInline ? 'row' : (layout.flexDirection ?? 'column')}
      onMouseEnter={() => setHot(true)}
      onMouseLeave={() => setHot(false)}
    >
      {children}
    </Box>
  );
}

function childList(node: Record<string, unknown>, props: Record<string, unknown>): unknown[] {
  const raw = props.children ?? node.children;
  if (raw === undefined) return [];
  return Array.isArray(raw) ? raw : [raw];
}

/**
 * densable `pt` → Ink: Button/Input/Select/Code/Markdown/Client/Svg/Link/Raster/Image/engine/Box/Text.
 * Stamps plugin onto Raster like gold `Te`.
 */
export function DrawingNode({
  node,
  plugin,
  requestId,
  index,
  engine,
  seenKeys,
}: {
  node: unknown;
  plugin: string;
  requestId?: string;
  index: number;
  /** densable `pt` `i(ref)` — engine node. Pane/AbovePrompt is null; UserMessage is the engine draw. */
  engine?: ReactNode;
  seenKeys?: Set<unknown>;
}): ReactNode {
  if (typeof node === 'string') return <Text>{node}</Text>;
  if (Array.isArray(node)) {
    return node.map((child, i) => (
      <DrawingNode key={i} node={child} plugin={plugin} requestId={requestId} index={i} engine={engine} />
    ));
  }
  if (!isRecord(node)) return null;
  if (node.type === 'engine') return engine ?? null;
  const props = isRecord(node.props) ? node.props : node;
  const type = typeof node.type === 'string' ? node.type : undefined;
  const key = (typeof props.key === 'string' && props.key) || (typeof node.key === 'string' && node.key) || undefined;
  const owner = stampedPlugin(node, plugin);
  const req =
    (typeof props.requestId === 'string' && props.requestId) ||
    (typeof node.requestId === 'string' && node.requestId) ||
    requestId;
  const columns =
    typeof props.columns === 'number' ? props.columns : typeof node.columns === 'number' ? node.columns : 1;
  const rows = typeof props.rows === 'number' ? props.rows : typeof node.rows === 'number' ? node.rows : 1;
  const cells = typeof props.cells === 'string' ? props.cells : typeof node.cells === 'string' ? node.cells : undefined;
  if (type === 'Raster' && key && req) {
    return <PluginRaster plugin={owner} requestId={req} elementKey={key} columns={columns} rows={rows} cells={cells} />;
  }
  if (type === 'Image' && key && req) {
    const alt = typeof props.alt === 'string' ? props.alt : typeof node.alt === 'string' ? node.alt : undefined;
    return <PluginImage plugin={owner} requestId={req} elementKey={key} columns={columns} rows={rows} alt={alt} />;
  }
  if (type === 'Button') {
    const press = pressOf(node);
    if (press === undefined) return null;
    return (
      <PluginPressButton
        plugin={press.plugin}
        handle={press.handle}
        label={stringProp(props, node, 'label') ?? ''}
        hotkey={stringProp(props, node, 'hotkey')}
        plain={boolProp(props, 'plain')}
        dimColor={boolProp(props, 'dimColor')}
        variant={stringProp(props, node, 'variant')}
      />
    );
  }
  if (type === 'Input') {
    const press = pressOf(node);
    if (press === undefined) return null;
    return (
      <PluginPressInput
        plugin={press.plugin}
        handle={press.handle}
        element={key}
        label={stringProp(props, node, 'label')}
        placeholder={stringProp(props, node, 'placeholder')}
        value={stringProp(props, node, 'value')}
        submitLabel={stringProp(props, node, 'submitLabel')}
      />
    );
  }
  if (type === 'Select') {
    const press = pressOf(node);
    if (press === undefined) return null;
    const rawOptions = props.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.flatMap(item => {
          if (!isRecord(item) || typeof item.value !== 'string') return [];
          return [
            {
              value: item.value,
              ...(typeof item.label === 'string' && { label: item.label }),
            },
          ];
        })
      : [];
    return (
      <PluginPressSelect
        plugin={press.plugin}
        handle={press.handle}
        label={stringProp(props, node, 'label')}
        element={key}
        options={options}
        value={stringProp(props, node, 'value')}
      />
    );
  }
  if (type === 'Code') {
    return <PluginCode source={props.source} format={props.format} />;
  }
  if (type === 'Markdown') {
    const text = stringProp(props, node, 'text') ?? '';
    return (
      <PluginMarkdown
        text={text}
        dimColor={boolProp(props, 'dimColor')}
        press={'press' in node ? pressOf(node) : undefined}
        pressableLinks={props.pressableLinks}
      />
    );
  }
  if (type === 'Client') {
    const client = isRecord(node.client) ? node.client : undefined;
    return (
      <PluginClient
        plugin={typeof client?.plugin === 'string' ? client.plugin : owner}
        moduleName={stringProp(props, node, 'module') ?? ''}
        elementKey={key}
        requestId={req}
        props={props.props}
        width={numberProp(props, node, 'width')}
        height={numberProp(props, node, 'height')}
        flexGrow={numberProp(props, node, 'flexGrow')}
        engine={engine}
      />
    );
  }
  if (type === 'Svg') {
    return <Text dimColor>{stringProp(props, node, 'alt') ?? ''}</Text>;
  }
  const kids = childList(node, props);
  const siblingKeys = new Set();
  const mapped = kids.map((child, i) =>
    (type === 'Text' || type === 'Link') && typeof child === 'string' ? (
      child
    ) : (
      <DrawingNode
        key={i}
        node={child}
        plugin={owner}
        requestId={req}
        index={i}
        engine={engine}
        seenKeys={siblingKeys}
      />
    ),
  );
  if (type === 'Link') {
    const href = stringProp(props, node, 'href') ?? '';
    const label = stringProp(props, node, 'label');
    const inner = mapped.length > 0 ? mapped : [label ?? href];
    const fallback =
      mapped.length === 0 && label === undefined ? undefined : (
        <Text>
          {inner} <Text dimColor>{href}</Text>
        </Text>
      );
    return (
      <Link url={href} fallback={fallback}>
        {inner}
      </Link>
    );
  }
  const hover = isRecord(node.hover) ? node.hover : undefined;
  if (type === 'Box' && key !== undefined) {
    const live = seenKeys === undefined || !seenKeys.has(key);
    if (seenKeys !== undefined) seenKeys.add(key);
    const layoutProps = { ...props };
    delete layoutProps.key;
    return (
      <Box key={live ? String(key) : undefined} flexDirection="column" {...layoutFrom(layoutProps)}>
        {mapped}
      </Box>
    );
  }
  if (type === 'Text') {
    const text =
      typeof props.text === 'string'
        ? props.text
        : typeof node.text === 'string'
          ? node.text
          : mapped.length === 0
            ? null
            : undefined;
    if (hover !== undefined) {
      return (
        <HoverBox isInline props={props} hover={hover}>
          {text !== undefined ? text : mapped}
        </HoverBox>
      );
    }
    return <Text>{text !== undefined ? text : mapped}</Text>;
  }
  if (hover !== undefined) {
    return (
      <HoverBox isInline={false} props={props} hover={hover}>
        {mapped}
      </HoverBox>
    );
  }
  return (
    <Box flexDirection="column" key={key ?? index} {...layoutFrom(props)}>
      {mapped}
    </Box>
  );
}

/**
 * densable `ar` consumer: call `Hoe().ui.render` (`evaluateUiRender`) and
 * rebuild with `pt` (`DrawingNode`). Engine fallback (`sMe`) is `undefined`.
 */
function useRenderDrawing(input: Record<string, unknown> | null, inputKey: string): unknown {
  const [drawn, setDrawn] = useState<unknown>(undefined);
  const inputRef = useRef(input);
  inputRef.current = input;
  const version = useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  useSyncExternalStore(subscribeRasterFrames, snapshot, snapshot);
  useEffect(() => {
    const current = inputRef.current;
    if (current === null) {
      setDrawn(undefined);
      return;
    }
    let cancelled = false;
    void evaluateUiRender(current).then(
      tree => {
        if (!cancelled) setDrawn(isEngineDrawing(tree) ? undefined : tree);
      },
      () => {
        if (!cancelled) setDrawn(undefined);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [inputKey, version]);
  return drawn;
}

function PluginSiteFields({
  children,
  site = 'Pane',
}: {
  children: ReactNode;
  /** densable `$q` `XP(focusable, site)` — Pane vs AbovePrompt. */
  site?: 'Pane' | 'AbovePrompt';
}): ReactNode {
  const [texts, setTexts] = useState(() => new Map<string, string>());
  const live = useRef(new Map<string, string>());
  const submitting = useRef(new Set<string>());
  const [picked, setPicked] = useState(() => new Map<string, string>());
  const [open, setOpen] = useState<SelectOpen | null>(null);
  const [selectFocus, setSelectFocus] = useState<{
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
  } | null>(null);
  const [focused, setFocused] = useState<FocusedInput | null>(null);
  const fieldsRef = useRef<InputFields | null>(null);
  const selectRef = useRef<SelectFields | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const fields = useMemo<InputFields>(
    () => ({
      textOf: (plugin, element) => texts.get(inputFieldKey(plugin, element)),
      edit({ plugin, handle, element }, value) {
        const key = inputFieldKey(plugin, element);
        live.current.set(key, value);
        setTexts(current => new Map(current).set(key, value));
        firePress(plugin, handle, { kind: 'change', value });
      },
      textNow({ plugin, element, value }) {
        const key = inputFieldKey(plugin, element);
        return live.current.get(key) ?? texts.get(key) ?? value ?? '';
      },
      submit({ plugin, handle, element, value }) {
        const key = inputFieldKey(plugin, element);
        const sent = live.current.get(key) ?? texts.get(key) ?? value ?? '';
        if (submitting.current.has(key)) return;
        submitting.current.add(key);
        void firePressAnswer(plugin, handle, { kind: 'submit', value: sent }).then(
          reply => {
            submitting.current.delete(key);
            if (reply !== undefined && (live.current.get(key) ?? sent) === sent) {
              live.current.set(key, '');
              setTexts(current => new Map(current).set(key, ''));
            }
          },
          () => {
            submitting.current.delete(key);
          },
        );
      },
    }),
    [texts],
  );
  const select = useMemo<SelectFields>(
    () => ({
      pickedOf: (plugin, element) => picked.get(inputFieldKey(plugin, element)),
      open,
      toggle({ plugin, handle, element, options, value }) {
        const key = inputFieldKey(plugin, element);
        const isOpen = open !== null && open.plugin === plugin && open.handle === handle;
        if (!isOpen) {
          const shown = picked.get(key) ?? value;
          const at = options.findIndex(option => option.value === shown);
          setFocused(null);
          setOpen({ plugin, handle, highlight: at < 0 ? 0 : at, element, options });
          return;
        }
        const choice = options[Math.min(open.highlight, Math.max(0, options.length - 1))];
        if (choice === undefined) {
          setOpen(null);
          return;
        }
        setPicked(current => new Map(current).set(key, choice.value));
        setOpen(null);
        void firePressAnswer(plugin, handle, { value: choice.value }).then(
          reply => {
            if (reply !== undefined && typeof reply === 'object' && reply !== null && 'value' in reply) {
              const next = (reply as { value: unknown }).value;
              if (typeof next === 'string') {
                setPicked(current => (current.get(key) === choice.value ? new Map(current).set(key, next) : current));
              }
            }
          },
          () => undefined,
        );
      },
      move(delta) {
        setOpen(current => {
          if (current === null) return current;
          const count = Math.max(1, current.options.length);
          return { ...current, highlight: (current.highlight + delta + count) % count };
        });
      },
      typeahead(letter) {
        setOpen(current => pluginSelectTypeaheadNext(current, selectFocus, letter));
      },
      close() {
        setOpen(null);
      },
      focusedSelect: selectFocus,
      focus(ref) {
        setFocused(null);
        setSelectFocus(ref);
      },
      unfocus() {
        setSelectFocus(null);
        setOpen(null);
      },
    }),
    [picked, open, selectFocus],
  );
  fieldsRef.current = fields;
  selectRef.current = select;
  const focusApi = useMemo(
    () => ({
      focused,
      setFocused: (next: FocusedInput | null) => {
        if (next !== null) {
          setOpen(null);
          setSelectFocus(null);
        }
        setFocused(next);
      },
    }),
    [focused],
  );
  const keys = useOptionalKeybindingContext();
  const fieldHeld = focused !== null || open !== null || selectFocus !== null;
  const renderedFocus = useRef({ focused, select: selectFocus });
  useEffect(() => {
    renderedFocus.current = { focused, select: selectFocus };
  });
  useLayoutEffect(() => {
    setPaneFieldHeld(fieldHeld);
    return () => setPaneFieldHeld(false);
  }, [fieldHeld]);
  useInput(
    (input, key, event) => {
      if (key.wheelUp || key.wheelDown) return;
      const selectNow = selectRef.current;
      const focusedSelect = selectNow?.focusedSelect ?? null;
      const openNow = selectNow?.open ?? null;
      const heldNow = focusedRef.current;
      const rendered = renderedFocus.current;
      const isAhead = pluginKeysAreAhead({ focused: heldNow, select: focusedSelect }, rendered);
      const contextNow = pluginFieldContext(
        focusedSelect !== null ? 'Select' : heldNow !== null ? 'Input' : undefined,
        site,
      );
      const contextRendered = pluginFieldContext(
        rendered.select !== null && rendered.select !== undefined
          ? 'Select'
          : rendered.focused !== null && rendered.focused !== undefined
            ? 'Input'
            : undefined,
        site,
      );
      let selectIntercepted = false;
      if (focusedSelect !== null && selectNow !== null) {
        const ctrlC = key.ctrl && input === 'c';
        if (ctrlC && openNow !== null) {
          selectNow.close();
          event.stopImmediatePropagation();
          return;
        }
        if (ctrlC) {
          selectNow.unfocus();
          event.stopImmediatePropagation();
          return;
        }
        if (pluginSelectTypeahead(input, key)) {
          selectNow.typeahead(input.toLowerCase());
          event.stopImmediatePropagation();
          return;
        }
        if (openNow !== null) {
          if (key.downArrow) {
            selectNow.move(1);
            event.stopImmediatePropagation();
            return;
          }
          if (key.upArrow) {
            selectNow.move(-1);
            event.stopImmediatePropagation();
            return;
          }
          if (key.return) {
            selectNow.toggle({
              plugin: openNow.plugin,
              handle: openNow.handle,
              element: openNow.element,
              options: openNow.options,
            });
            event.stopImmediatePropagation();
            return;
          }
        }
        selectIntercepted = true;
      }
      /**
       * densable `$q`: if !isAhead, do not steal (keys go to rendered Pane).
       * Select intercept above is gold `x_(Kq.intercept)` and still runs.
       * Then Global match → do not steal; then Input Wq/jq.
       */
      if (!isAhead) return;
      const nowHit = keys?.resolve(input, key, [contextNow]);
      if (nowHit?.type === 'match') {
        event.stopImmediatePropagation();
        return;
      }
      const globalHit = keys?.resolve(input, key, ['Global']);
      if (globalHit?.type === 'match') return;
      const renderedHit = keys?.resolve(input, key, [contextRendered]);
      if (renderedHit?.type === 'match') {
        event.stopImmediatePropagation();
        return;
      }
      const held = focusedRef.current;
      const inputFields = fieldsRef.current;
      if (held === null || inputFields === null) return;
      if (selectIntercepted) return;
      const shown = inputFields.textNow(held);
      if (key.backspace) {
        inputFields.edit(held, [...shown].slice(0, -1).join(''));
        event.stopImmediatePropagation();
        return;
      }
      const typed = input === '' ? event.input : input;
      if (pluginInputIsTyped(typed, key)) {
        inputFields.edit(held, shown + typed);
        event.stopImmediatePropagation();
        return;
      }
      if (pluginInputIsNav(input, key)) {
        event.stopImmediatePropagation();
      }
    },
    { isActive: fieldHeld, prepend: true },
  );
  return (
    <FocusedInputContext.Provider value={focusApi}>
      <InputFieldsContext.Provider value={fields}>
        <SelectFieldsContext.Provider value={select}>{children}</SelectFieldsContext.Provider>
      </InputFieldsContext.Provider>
    </FocusedInputContext.Provider>
  );
}

function rebuild(
  drawn: unknown,
  plugin: string,
  requestId: string,
  engine?: ReactNode,
  site: 'Pane' | 'AbovePrompt' = 'Pane',
): ReactNode {
  if (drawn === undefined || isEngineDrawing(drawn)) return engine ?? null;
  return (
    <PluginSiteFields site={site}>
      <DrawingNode node={drawn} plugin={plugin} requestId={requestId} index={0} engine={engine} />
    </PluginSiteFields>
  );
}

/**
 * densable `cv` / `Zq`: `nWt(xI("Pane", factory, deps), () => null)`.
 * Hosts `Ho.node` — plugin `wo`/`xo` sit in this Ink site, not a dump slot.
 */
export function PluginPaneSite({
  fill = false,
  columns,
  rows,
}: {
  fill?: boolean;
  columns?: number;
  rows?: number;
} = {}): ReactNode {
  const pane = getShownPluginPane();
  const input =
    pane === undefined
      ? null
      : {
          surface: 'terminal',
          component: 'Pane',
          requestId: pane.id,
          props: {
            title: pane.title,
            isFocused: pane.isFocused,
            bodyColumns: pane.columns,
            placement: fill ? 'dock' : 'inline',
            scroll: { offset: pane.offset, bodyRows: pane.bodyRows },
            view: {},
          },
        };
  const drawn = useRenderDrawing(
    input,
    pane === undefined
      ? ''
      : `${pane.id}\0${pane.title}\0${String(pane.isFocused)}\0${String(pane.columns)}\0${String(pane.offset)}\0${String(pane.bodyRows)}\0${fill ? 'dock' : 'inline'}`,
  );
  if (pane === undefined) return null;
  const node = rebuild(drawn, pane.plugin, pane.id, undefined, 'Pane');
  if (node === null) return null;
  return (
    <Box
      flexShrink={0}
      flexDirection="column"
      overflow="hidden"
      {...((columns ?? pane.columns) !== undefined && { width: columns ?? pane.columns })}
      {...((rows ?? (pane.bodyRows > 0 ? pane.bodyRows : pane.rows)) !== undefined && {
        height: rows ?? (pane.bodyRows > 0 ? pane.bodyRows : pane.rows),
      })}
    >
      <Box flexDirection="column" flexShrink={0} marginTop={-pane.offset}>
        {node}
      </Box>
    </Box>
  );
}

/**
 * densable `dAe`: `nWt(xI("AbovePrompt", factory, deps), () => null)`.
 * Lives immediately above PromptInput — gold's site, not a drawing dump.
 */
export function PluginAbovePromptSite({
  isWorking,
  hasSurvey = false,
}: {
  isWorking: boolean;
  hasSurvey?: boolean;
}): ReactNode {
  const { columns, rows } = useTerminalSize();
  const drawn = useRenderDrawing(
    {
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: ABOVE_PROMPT_REQUEST_ID,
      props: {
        hasSurvey,
        isWorking,
        maxRows: rows,
        bodyColumns: columns,
        scroll: { offset: 0, bodyRows: rows },
        view: {},
      },
    },
    `${String(isWorking)}\0${String(hasSurvey)}\0${String(columns)}\0${String(rows)}`,
  );
  return rebuild(drawn, '', ABOVE_PROMPT_REQUEST_ID, undefined, 'AbovePrompt');
}

export type PluginUserMessageOrigin = {
  kind: string;
  name?: string;
  [key: string]: unknown;
};

/**
 * densable `URe` / `OM(xI("UserMessage"), engine)`: plugin tree or the
 * engine's own message (`i(m)`).
 */
export function PluginUserMessageSite({
  requestId,
  text,
  origin,
  isExpanded,
  task,
  from,
  children,
}: {
  requestId: string;
  text: string;
  origin?: PluginUserMessageOrigin;
  isExpanded?: boolean;
  task?: unknown;
  from?: unknown;
  children: ReactNode;
}): ReactNode {
  const drawn = useRenderDrawing(
    {
      surface: 'terminal',
      component: 'UserMessage',
      requestId,
      props: {
        text,
        ...(origin !== undefined && { origin }),
        ...(isExpanded !== undefined && { isExpanded }),
        ...(task !== undefined && { task }),
        ...(from !== undefined && { from }),
      },
    },
    `${requestId}\0${text}\0${origin?.kind ?? ''}\0${String(isExpanded ?? '')}`,
  );
  return rebuild(drawn, '', requestId, children);
}
