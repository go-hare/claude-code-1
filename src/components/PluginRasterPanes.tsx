import {
  Box,
  Button,
  Link,
  Text,
  stringWidth,
  useInput,
  useKeybinding,
  useOptionalKeybindingContext,
  useApp,
  useRegisterKeybindingContext,
  measureElement,
  type DOMElement,
  type Key,
  type MouseActionEvent,
  type WheelEvent,
} from '@anthropic/ink';
import {
  Component,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from 'react';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js';
import { getRenderVersion, subscribeRenderInvalidation } from '../utils/render/invalidateAllRenders.js';
import {
  ABOVE_PROMPT_REQUEST_ID,
  bindPluginFocusHost,
  bindPluginScrollSiteLayout,
  closePluginPane,
  dispatchPersonUiScroll,
  dispatchUiFocus,
  logUiScrollSettled,
  evaluateUiRender,
  focusPane,
  getPaneRemountGeneration,
  getPanesState,
  getPluginDrawingTrees,
  getPluginScrollSite,
  getRasterFrameVersion,
  getShownPluginPane,
  heldFocusEdge,
  invokePress,
  nearestScrollOffset,
  nextFocusedPaneId,
  cycleShownPaneId,
  showPane,
  recordPress,
  registerPluginScrollSite,
  scrollPluginPane,
  settlePaneFocusRequest,
  settlePanesTerminalColumns,
  isToastHoldShown,
  pluginFieldSeatKey,
  pluginFieldSeatGeneration,
  bumpPluginFieldSeatGeneration,
  getPluginInputSeatStore,
  getPluginSelectSeatStore,
  getPluginFieldSeatGenerationStore,
  setPluginBandExpanded,
  subscribePanes,
  subscribeRasterFrames,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from '../utils/plugins/functionHooksModules.js';
import {
  acquirePluginClient,
  clientInstanceKey,
  DETACHED_CLIENT,
  type ClientInstance,
} from '../utils/plugins/functionHooksClient.js';
import { useIsOverlayActive } from '../context/overlayContext.js';
import { useHasOpenDialogs } from '../dialog/DialogStoreContext.js';
import { logForDebugging } from '../utils/debug.js';
import { useNotifications } from '../context/notifications.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { createStore } from '../state/store.js';
import {
  getPromptInputStoreValue,
  setPromptInputStoreValue,
  subscribePromptInputCursorStore,
} from '../utils/promptInputCursorStore.js';
import TextInput from './TextInput.js';
import { HighlightedCode } from './HighlightedCode.js';
import { Markdown } from './Markdown.js';
import { PluginImage, PluginRaster } from './PluginRaster.js';
import {
  computeWheelStep,
  initWheelAccel,
  isWheelScrollAccelerationEnabled,
  resolveWheelProfile,
  type WheelAccelState,
  type WheelProfile,
} from './ScrollKeybindingHandler.js';

/** densable Select `at=8` — open list window (`FMn` / `s$`). */
const SELECT_WINDOW = 8;
/**
 * densable `lEe` — AZERTY unshifted digit row → ASCII digit, for Wm.
 * Gold: `&→1 é→2 "→3 '→4 (→5 -→6 è→7 _→8 ç→9 à→0`.
 */
const AZERTY_DIGIT: ReadonlyMap<string, string> = new Map([
  ['&', '1'],
  ['é', '2'],
  ['"', '3'],
  ["'", '4'],
  ['(', '5'],
  ['-', '6'],
  ['è', '7'],
  ['_', '8'],
  ['ç', '9'],
  ['à', '0'],
]);
const BAND_DIGIT_DEBOUNCE_MS = 400;
const BAND_DIGIT_MOUNT_DELAY_MS = 600;
/** densable `yy.DOCK_GRIP_COLUMNS` / `XN`. */
export const DOCK_GRIP_COLUMNS = 1;
/** densable `dL` — CloseMark inset from the pane edge. */
export const BORDER_MARK_INSET = 2;
/** densable `VZ` — CloseMark reserved columns. */
export const CLOSE_MARK_COLUMNS = 2;
/** densable `k$` — CloseMark glyph cells. */
export const CLOSE_MARK_CELLS = 1;
/** densable `dee` — max title-tab columns (`UM`). */
export const TITLE_TAB_MAX_COLUMNS = 12;

/**
 * densable `lL=(h,v)=>(h||!v?1:0)+(v?2:0)` where `h=open.length>1`, `v=!fill`.
 * Title/spacer 1: multi-open `_$` strip, or single-pane **dock** `height:1`.
 * Round-border +2: inline (`!fill`) top+bottom `borderStyle:"round"`.
 */
export function paneTitleChromeRows(multiOpen: boolean, fill: boolean): number {
  return (multiOpen || fill ? 1 : 0) + (fill ? 0 : 2);
}

/** densable `xZ=4` — inline round-border left+right (border+paddingX). */
export const INLINE_PANE_CHROME_COLUMNS = 4;

/** densable `UM(title)` — min(stringWidth(title)+2, 12). */
export function titleTabColumns(title: string): number {
  return Math.min(stringWidth(title) + 2, TITLE_TAB_MAX_COLUMNS);
}

/**
 * densable `w$` — leftmost open-pane index that still fits `columns` ending at shownId.
 */
export function titleStripStart(input: {
  open: ReadonlyArray<{ id: string; title: string }>;
  shownId: string;
  columns: number;
}): number {
  const at = input.open.findIndex(pane => pane.id === input.shownId);
  let start = Math.max(0, at);
  let used = -1;
  for (let i = at; i >= 0; i--) {
    used += 1 + titleTabColumns(input.open[i]?.title ?? '');
    if (used > input.columns && i < at) break;
    start = i;
  }
  return start;
}

type HotkeyPress = { plugin: string; handle: unknown };

/**
 * densable `r$` — walk drawing; Button with hotkey → Map<hotkey, press>.
 */
export function hotkeyMapOfDrawing(drawn: unknown): Map<string, HotkeyPress> {
  const map = new Map<string, HotkeyPress>();
  const walk = (node: unknown): void => {
    if (typeof node === 'string' || node === undefined || node === null) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    if (!isRecord(node)) return;
    if (node.type === 'Button') {
      const props = isRecord(node.props) ? node.props : node;
      const hotkey = typeof props.hotkey === 'string' ? props.hotkey : undefined;
      const press = pressOf(node);
      if (hotkey !== undefined && press !== undefined) map.set(hotkey, press);
      return;
    }
    if (node.type !== 'engine') {
      const props = isRecord(node.props) ? node.props : undefined;
      for (const child of childList(node, props ?? {})) walk(child);
    }
  };
  walk(drawn);
  return map;
}

/**
 * densable `LZ({hasCue,content,offset,windowRows}, seatsOf(digit))`.
 * Without yoga seats, a digit is visible when the cue is off (gold `!M→true`)
 * or when the hotkey map has that digit (cue on, seats empty → false).
 */
export function hotkeyDigitVisible(hasCue: boolean, seats: Map<string, HotkeyPress>, digit: string): boolean {
  if (!hasCue) return true;
  if (seats.size === 0) return false;
  return seats.has(digit);
}

/**
 * densable `BZ(h,v,M)` — if press exists and `v()` (visible), `M()` then fire.
 */
export function pressShownDigit(press: HotkeyPress | undefined, visible: () => boolean, clear: () => void): void {
  if (press !== undefined && visible()) {
    clear();
    firePress(press.plugin, press.handle);
  }
}

/**
 * densable `Wm` — single-digit prompt debounce (MZ=400, cp=600, enterConfirms:!1).
 * Gold: `h.length===1` (does not trim the prompt); `onDigit` then `M("")`.
 * Local: `setPromptInputStoreValue('')` is gold `M("")`.
 */
export function useBandDigitHotkey(input: {
  inputValue: string;
  enabled: boolean;
  isValidDigit: (char: string) => boolean;
  onDigit: (digit: string) => void;
  debounceMs?: number;
  mountDelayMs?: number;
}): void {
  const { inputValue, enabled, isValidDigit, onDigit } = input;
  const debounceMs = input.debounceMs ?? BAND_DIGIT_DEBOUNCE_MS;
  const mountDelayMs = input.mountDelayMs ?? BAND_DIGIT_MOUNT_DELAY_MS;
  const initialValue = useRef(inputValue);
  const triggered = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledAt = useRef<number | null>(enabled ? Date.now() : null);
  const latest = useRef({ isValidDigit, onDigit });
  latest.current = { isValidDigit, onDigit };
  useEffect(() => {
    if (enabled) enabledAt.current = Date.now();
  }, [enabled]);
  useEffect(() => {
    if (!enabled || triggered.current) return;
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const mounting = mountDelayMs > 0 && enabledAt.current !== null && Date.now() - enabledAt.current < mountDelayMs;
    if (mounting) return;
    if (inputValue !== initialValue.current && inputValue.length === 1) {
      const nfkc = inputValue.normalize('NFKC');
      const mapped = latest.current.isValidDigit(nfkc) ? nfkc : (AZERTY_DIGIT.get(inputValue) ?? nfkc);
      if (latest.current.isValidDigit(mapped)) {
        timer.current = setTimeout(() => {
          timer.current = null;
          triggered.current = true;
          latest.current.onDigit(mapped);
        }, debounceMs);
      }
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [inputValue, enabled, debounceMs, mountDelayMs]);
}

/** densable `hL` — printable, no ctrl/meta/super/escape/tab/return. */
export function isHotkeyType(input: string, key: Key): boolean {
  return (
    !key.ctrl && !key.meta && !key.super && !key.escape && !key.tab && !key.return && /^[^\p{C}\p{Z}]+$/u.test(input)
  );
}

/**
 * densable `HZ` — NFKC-lowercase each typed char through the hotkey Map.
 * All chars must hit or the chord is dropped.
 */
export function resolveHotkeyPresses(input: string, key: Key, seats: Map<string, HotkeyPress>): HotkeyPress[] {
  if (!isHotkeyType(input, key)) return [];
  const mapped = [...input.normalize('NFKC').toLowerCase()].map(ch => seats.get(ch));
  const hits = mapped.filter((row): row is HotkeyPress => row !== undefined);
  return hits.length === mapped.length ? hits : [];
}

/**
 * densable band chrome (AbovePrompt) — SEA 2.1.289 `_Ee` / `EZ` / `n$` / `OM` /
 * `IZ` / `a$` / `gL` / `yEe`. Soft remainder `l$`/`xze`/`d$`/`m$` HAVE.
 * `m$` HAVE: `usePluginInputSeat` lifted as `_Ee`/`pee` `rr` into g$ `inputs`.
 *
 * `y$` HAVE: `usePluginSelectSeat` `{fields, handlers, intercept}` over kL(YFt)+Pc.
 * `g$` HAVE on PluginAbovePromptSite and pee (Pane bag + isAhead).
 * `$l` HAVE via `useYogaMeasure` (subscribeLayout).
 * Keep effortSlider:* untouched. DualInk `onPointer` HAVE (named then alias).
 *
 * densable Chat panes (`Si`/`JSn`/`EMPTY_PANES`) HAVE as semantic store in
 * `functionHooksModules` (`getPanesState`/`getPanesStore`/`setPanesState`/
 * `subscribePanes`, `focusPane`/`nextFocusedPaneId`/`offerPanePlacement`/
 * `settlePaneFocusRequest`, `placeWaitingPanes`/`placeWaitingPanesRemote`,
 * `paneOpenFloor`/`hasAskedPane`/`rememberAskedPane`/`forgetAskedPane`/
 * `seedAskedPanes`) — minify names stay in comments only (never export
 * `Si`/`panesStore`/`oNo`/`i4n`/`askedLatch`). `abovePrompt:focus`: pending
 * `focusedId` → `$Fr`/`focusPane` (incl. clear on last); else band step; else
 * `open[0]` via `$Fr`; else band from null. Never a4n(true) on the key —
 * pending `focusRequest` is only auto-settled by the a4n effect.
 * Columns settle calls `settlePanesTerminalColumns` → `placeWaitingPanes`.
 *
 * `pluginSites` = Ide HAVE via `registerPluginScrollSite` keyed
 * `component:requestId` (gold `Fj`). Hde/`QLt` person-origin `ui.scroll` HAVE via
 * `dispatchPersonUiScroll` → `runFunctionHookChain('ui.scroll')` + vq commit
 * (no minify Ide/Hde/QLt/iZ export). asked soft persist + ui.open→unplaced
 * column gate HAVE on panes store. Leave `dialogStore.open` alone. Keep
 * effortSlider:* untouched.
 */
/** densable `pL` — CollapseHandle inset from the right edge. */
export const MARK_EDGE_COLUMNS = 1;
/** densable `DZ` — reserved columns for the collapse handle. */
export const COLLAPSE_HANDLE_COLUMNS = 5;

/**
 * densable `XXt` / ColumnsContext — body width for PluginPressInput (Wt).
 * AbovePrompt reserves DZ=COLLAPSE_HANDLE_COLUMNS; Pane uses host bodyColumns.
 */
const PaneBodyColumnsContext = createContext<number | null>(null);

/**
 * densable QT/BO — pane-scoped ErrorBoundary. onError → unload; fallback null;
 * resetKey clears hasError (gold getDerivedStateFromProps).
 * Never export minify `BO`/`QT`/`Jmn`.
 */
type PaneErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string | number;
  onError: (error: Error, info: ErrorInfo) => void;
  /** densable Client BO fallback — empty sized box. Pane QT omits (null). */
  fallback?: ReactNode;
};

type PaneErrorBoundaryState = {
  hasError: boolean;
  prevResetKey: string | number | null;
};

class PaneErrorBoundary extends Component<PaneErrorBoundaryProps, PaneErrorBoundaryState> {
  state: PaneErrorBoundaryState = { hasError: false, prevResetKey: null };

  static getDerivedStateFromError(): Pick<PaneErrorBoundaryState, 'hasError'> {
    return { hasError: true };
  }

  static getDerivedStateFromProps(
    props: PaneErrorBoundaryProps,
    state: PaneErrorBoundaryState,
  ): Partial<PaneErrorBoundaryState> | null {
    if (state.prevResetKey !== props.resetKey) {
      return { hasError: false, prevResetKey: props.resetKey };
    }
    return null;
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError(error, info);
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

/**
 * densable `h_e` lite for o$/SEe — identity id from a task.
 * Gold: local_agent → agentId; in_process_teammate → resumableAgentId ?? agentId.
 */
export function teammateViewId(task: {
  type?: string;
  agentId?: string;
  identity?: { agentId?: string; resumableAgentId?: string };
}): string | undefined {
  if (task.type === 'local_agent' && typeof task.agentId === 'string') {
    return task.agentId;
  }
  if (task.type === 'in_process_teammate') {
    const resumable = task.identity?.resumableAgentId;
    if (typeof resumable === 'string') return resumable;
    if (typeof task.identity?.agentId === 'string') return task.identity.agentId;
  }
  return undefined;
}

/** densable SEe — viewingAgentTaskId → h_e(task)?.id. */
function viewingAgentIdFromState(state: {
  viewingAgentTaskId?: string;
  tasks: Record<
    string,
    { type?: string; agentId?: string; identity?: { agentId?: string; resumableAgentId?: string } }
  >;
}): string | undefined {
  const taskId = state.viewingAgentTaskId;
  if (taskId === undefined) return undefined;
  const task = state.tasks[taskId];
  return task === undefined ? undefined : teammateViewId(task);
}

/**
 * densable o$: `h=V(SEe); return Q(()=>h===void 0?{}:{agentId:h},[h])`.
 * Selector stays a primitive — a fresh `{}` inside useAppState Object.is-fails
 * every snapshot → RootREPLBoundary #185.
 */
function useViewingAgentView(): { agentId: string } | Record<string, never> {
  const agentId = useAppState(s => viewingAgentIdFromState(s));
  return useMemo(
    () => (agentId === undefined ? {} : { agentId }) as { agentId: string } | Record<string, never>,
    [agentId],
  );
}

/**
 * densable `FZ` — both lists non-empty and no shared plugin (drawer identity flip).
 */
export function isOtherDrawer(previous: Array<{ plugin: string }>, next: Array<{ plugin: string }>): boolean {
  return previous.length > 0 && next.length > 0 && !next.some(row => previous.some(was => was.plugin === row.plugin));
}

/**
 * densable `NLe` / `DQt` / `hSo` — Client surface focusedId mutex.
 * Gold: `NLe=et({focusedId:null}); DQt=(r)=>set if changed; hSo=(r)=>clear if current`.
 */
const pluginClientFocusStore = createStore<{ focusedId: string | null }>({
  focusedId: null,
});

export { pluginFieldSeatKey, pluginFieldSeatGeneration, bumpPluginFieldSeatGeneration };

function deleteSeatKeys(map: Map<string, string>, keys: readonly string[]): Map<string, string> {
  if (keys.length === 0) return map;
  const next = new Map(map);
  for (const key of keys) next.delete(key);
  return next;
}

const EMPTY_SEAT_MAP: Map<string, string> = new Map();

/**
 * densable `kL(store, component, requestId)` — subscribe the sft bucket.
 * Persist into the module store only while `ift` generation is unchanged.
 */
export function usePluginFieldSeatMap(
  kind: 'input' | 'select',
  component: string,
  requestId: string,
): [Map<string, string>, (updater: (current: Map<string, string>) => Map<string, string>) => void] {
  const store = kind === 'input' ? getPluginInputSeatStore() : getPluginSelectSeatStore();
  const generationStore = getPluginFieldSeatGenerationStore();
  const seatKey = pluginFieldSeatKey(component, requestId);
  const generation = useSyncExternalStore(
    generationStore.subscribe,
    () => pluginFieldSeatGeneration(component, requestId),
    () => pluginFieldSeatGeneration(component, requestId),
  );
  const map = useSyncExternalStore(
    store.subscribe,
    () => store.getState().get(seatKey) ?? EMPTY_SEAT_MAP,
    () => store.getState().get(seatKey) ?? EMPTY_SEAT_MAP,
  );
  const setMap = useCallback(
    (updater: (current: Map<string, string>) => Map<string, string>) => {
      store.setState(prev => {
        const current = prev.get(seatKey) ?? new Map<string, string>();
        const nextMap = updater(current);
        if (nextMap === current) return prev;
        const next = new Map(prev);
        next.set(seatKey, nextMap);
        return next;
      });
    },
    [store, seatKey],
  );
  useEffect(() => {
    if (pluginFieldSeatGeneration(component, requestId) !== generation) return;
    store.setState(prev => {
      const held = prev.get(seatKey);
      if (held === map) return prev;
      const next = new Map(prev);
      next.set(seatKey, map);
      return next;
    });
  }, [store, seatKey, map, generation, component, requestId]);
  return [map, setMap];
}

/**
 * densable `yL(focusables, tag, onStale)` — when a tagged element's `value`
 * changed vs the last seen Map, report those BDe keys so the seat can prune.
 */
export function usePluginFieldValuePrune(
  focusables: readonly DrawingFocusable[] | undefined,
  tag: 'Input' | 'Select',
  onStale: (keys: string[]) => void,
): void {
  const seen = useRef(new Map<string, string | undefined>());
  const onStaleRef = useRef(onStale);
  onStaleRef.current = onStale;
  useEffect(() => {
    if (focusables === undefined) return;
    const stale: string[] = [];
    for (const row of focusables) {
      if (row.tag !== tag) continue;
      if (typeof row.element !== 'string' || row.element === '') continue;
      const key = pluginInputFieldKey(row.plugin, row.element);
      const value = typeof row.value === 'string' ? row.value : undefined;
      if (seen.current.has(key) && seen.current.get(key) !== value) stale.push(key);
      seen.current.set(key, value);
    }
    if (stale.length > 0) onStaleRef.current(stale);
  }, [focusables, tag]);
}

/**
 * densable `$l(read)` — `useSyncExternalStore(subscribeLayout, read)` then
 * layout-effect `Object.is` bump. Gold returns a number (width or height).
 */
export function useYogaMeasure(read: () => number): number {
  const { subscribeLayout } = useApp();
  const snapshot = useSyncExternalStore(subscribeLayout, read, read);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  useLayoutEffect(() => {
    if (!Object.is(read(), snapshot)) bump();
  });
  return snapshot;
}

export function getPluginClientFocusedId(): string | null {
  return pluginClientFocusStore.getState().focusedId;
}

export function subscribePluginClientFocus(listener: () => void): () => void {
  return pluginClientFocusStore.subscribe(listener);
}

/** densable `DQt` — set Client focusedId. */
export function setPluginClientFocusedId(id: string | null): void {
  pluginClientFocusStore.setState(prev => (prev.focusedId === id ? prev : { focusedId: id }));
}

/** densable `hSo` — clear Client focusedId if it still holds `id`. */
export function clearPluginClientFocusedId(id: string): void {
  pluginClientFocusStore.setState(prev => (prev.focusedId === id ? { focusedId: null } : prev));
}

/**
 * densable `jZ(as, Me??hs, ss)` — while band or pane is held, prompt draft
 * value change from the hold-start snapshot → away (Ie(null)+u3(null)).
 * Gold: `if(v===null)return; let N=h.getState().value; subscribe value!==N → M()`.
 */
export function useDraftHeldAway(held: number | 'band' | string | null, away: () => void): void {
  const awayRef = useRef(away);
  awayRef.current = away;
  useEffect(() => {
    if (held === null) return;
    const origin = getPromptInputStoreValue();
    return subscribePromptInputCursorStore(() => {
      if (getPromptInputStoreValue() !== origin) awayRef.current();
    });
  }, [held]);
}
/** densable `NZ` — height settle debounce for band layout. */
export const HEIGHT_SETTLE_MS = 150;
/** densable `vG` — same requestId as AbovePrompt site (`c9`). */
export const BAND_REQUEST_ID = ABOVE_PROMPT_REQUEST_ID;

/**
 * densable `FEe` / `usePaneToastHold` — when `isToastHoldShown` (FFr), latch
 * AppState `paneHoldsToasts`; cleanup clears latch and drains toast queue.
 * Void hook, no args. Never export minify `FEe`.
 */
export function usePaneToastHold(): void {
  const hold = useSyncExternalStore(
    subscribePanes,
    () => isToastHoldShown(),
    () => isToastHoldShown(),
  );
  const setAppState = useSetAppState();
  const { processQueue } = useNotifications();
  useEffect(() => {
    if (!hold) return;
    setAppState(prev => (prev.paneHoldsToasts ? prev : { ...prev, paneHoldsToasts: true }));
    return () => {
      setAppState(prev => (prev.paneHoldsToasts ? { ...prev, paneHoldsToasts: false } : prev));
      processQueue();
    };
  }, [hold, setAppState, processQueue]);
}

type BandCollapsedListener = () => void;
let bandCollapsedValue = false;
const bandCollapsedListeners = new Set<BandCollapsedListener>();

/** densable `v1t` — session bandCollapsed store. */
export function getBandCollapsed(): boolean {
  return bandCollapsedValue;
}

export function setBandCollapsed(next: boolean): void {
  if (bandCollapsedValue === next) return;
  bandCollapsedValue = next;
  setPluginBandExpanded(!next);
  for (const listener of bandCollapsedListeners) listener();
}

export function subscribeBandCollapsed(listener: BandCollapsedListener): () => void {
  bandCollapsedListeners.add(listener);
  return () => {
    bandCollapsedListeners.delete(listener);
  };
}

function useBandCollapsed(): boolean {
  return useSyncExternalStore(subscribeBandCollapsed, getBandCollapsed, getBandCollapsed);
}

type SettledBudgetListener = () => void;
/** densable `d$` — shared settledBudget Map/store (`et(js(),…)`). */
let settledBudgetValue: number | undefined;
const settledBudgetListeners = new Set<SettledBudgetListener>();

export function getSettledBudget(): number | undefined {
  return settledBudgetValue;
}

export function setSettledBudget(next: number | undefined): void {
  if (settledBudgetValue === next) return;
  settledBudgetValue = next;
  for (const listener of settledBudgetListeners) listener();
}

export function subscribeSettledBudget(listener: SettledBudgetListener): () => void {
  settledBudgetListeners.add(listener);
  return () => {
    settledBudgetListeners.delete(listener);
  };
}

function useSettledBudget(): number | undefined {
  return useSyncExternalStore(subscribeSettledBudget, getSettledBudget, getSettledBudget);
}

type OpenListRowsListener = () => void;
/** densable `s$` / `nr` — open Select extra rows into band maxHeight. */
let openListRowsValue = 0;
const openListRowsListeners = new Set<OpenListRowsListener>();

export function getOpenListRows(): number {
  return openListRowsValue;
}

export function setOpenListRows(next: number): void {
  const rows = Math.max(0, next);
  if (openListRowsValue === rows) return;
  openListRowsValue = rows;
  for (const listener of openListRowsListeners) listener();
}

export function subscribeOpenListRows(listener: OpenListRowsListener): () => void {
  openListRowsListeners.add(listener);
  return () => {
    openListRowsListeners.delete(listener);
  };
}

function useOpenListRows(): number {
  return useSyncExternalStore(subscribeOpenListRows, getOpenListRows, getOpenListRows);
}

/**
 * densable `OM` DimButton — label + optional held/hover bold.
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
    <Box onClick={onAction} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <Text bold={hover || isHeld} dimColor={!hover && !isHeld}>
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
    <Box position="absolute" top={0} right={MARK_EDGE_COLUMNS} width={COLLAPSE_HANDLE_COLUMNS}>
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
      <Text dimColor={!hover} inverse={hover} wrap="truncate-end">
        {`▸ plugin panel hidden · ${shortcut} or click to show`}
      </Text>
    </Box>
  );
}

/**
 * densable `IZ` bandWindow — reserve one row for OverflowCue when the tree
 * exceeds the live budget; bodyRows uses the settled budget.
 */
export function bandWindow(input: { budget: number; settledBudget: number; treeRows: number }): {
  windowRows: number;
  hasCue: boolean;
  maxOffset: number;
  bodyRows: number;
} {
  const budget = Math.max(0, input.budget);
  const hasCue = input.treeRows > budget;
  const windowRows = hasCue ? Math.max(0, budget - 1) : budget;
  return {
    windowRows,
    hasCue,
    maxOffset: Math.max(0, input.treeRows - windowRows),
    bodyRows: Math.max(0, input.settledBudget - 1),
  };
}

/** densable `e$` — floor non-negative scroll offset (`floorOffset` alias). */
export function floorOffset(value: number): number {
  return Math.max(0, Math.floor(value));
}

/** @deprecated Prefer `floorOffset` — same densable `e$`. */
export const floorBandOffset = floorOffset;

/**
 * densable `yEe` lite — offset / followEnd / scrollBy (in-flight queue) / place.
 * Ide HAVE: PluginAbovePromptSite syncs dims into `pluginSites` via
 * `registerPluginScrollSite` / `updatePluginScrollSite` (no minify Ide export).
 * Hde/`QLt` person-origin HAVE: `fireScroll`/`commit` void
 * `dispatchPersonUiScroll` → `runFunctionHookChain('ui.scroll')` when the
 * scroll site is registered (Pane or AbovePrompt). Keep sync drain;
 * await in background.
 */
export function useBandScrollPlace(input: {
  bodyRows: number;
  contentRows: number;
  maxOffset: number;
  plugin?: string;
  requestId?: string;
  component?: 'Pane' | 'AbovePrompt';
}): {
  offset: number;
  placed: number;
  followEnd: boolean;
  scrollBy: (delta: number) => void;
  place: (fn: (prev: number) => number) => void;
  commit: (next: number) => void;
  followEndOn: () => void;
} {
  const [placed, setPlaced] = useState(0);
  const [followEnd, setFollowEnd] = useState(false);
  const dims = useRef({
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    maxOffset: input.maxOffset,
  });
  const placedRef = useRef(placed);
  const followEndRef = useRef(followEnd);
  const inFlightRef = useRef(false);
  const queuedDeltaRef = useRef(0);
  // densable yEe Kt — skip finally drain after unmount.
  const aliveRef = useRef(true);
  const personScrollRef = useRef({
    plugin: input.plugin ?? '',
    requestId: input.requestId ?? BAND_REQUEST_ID,
    component: input.component ?? 'AbovePrompt',
  });
  dims.current = {
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    maxOffset: input.maxOffset,
  };
  placedRef.current = placed;
  followEndRef.current = followEnd;
  personScrollRef.current = {
    plugin: input.plugin ?? '',
    requestId: input.requestId ?? BAND_REQUEST_ID,
    component: input.component ?? 'AbovePrompt',
  };
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  const clamp = (n: number): number => Math.max(0, Math.min(dims.current.maxOffset, floorOffset(n)));
  const liveOffset = (): number =>
    followEndRef.current ? dims.current.maxOffset : Math.min(placedRef.current, dims.current.maxOffset);
  const offset = followEnd ? dims.current.maxOffset : Math.min(placed, dims.current.maxOffset);
  useEffect(() => {
    if (followEnd && placed !== dims.current.maxOffset) {
      setPlaced(dims.current.maxOffset);
    }
  }, [followEnd, input.maxOffset, placed]);
  const dispatchPersonIfRegistered = (nextOffset: number, by: number): Promise<void> => {
    const siteMeta = personScrollRef.current;
    // densable yEe commits for Pane + AbovePrompt once Ide site is registered.
    if (siteMeta.plugin === '' || siteMeta.requestId === '') return Promise.resolve();
    if (getPluginScrollSite(siteMeta.plugin, siteMeta.requestId, siteMeta.component) === undefined) {
      return Promise.resolve();
    }
    // densable `Hde(\`ui.scroll …\`, QLt(...))` — await settles inFlight.
    return dispatchPersonUiScroll({
      component: siteMeta.component,
      requestId: siteMeta.requestId,
      offset: nextOffset,
      by,
      bodyRows: dims.current.bodyRows,
      contentRows: dims.current.contentRows,
      plugin: siteMeta.plugin,
    }).then(() => undefined);
  };
  const commit = useCallback((next: number): number => {
    const before = liveOffset();
    const clamped = clamp(next);
    followEndRef.current = false;
    placedRef.current = clamped;
    setFollowEnd(false);
    setPlaced(clamped);
    return clamped - before;
  }, []);
  // densable yEe `io=ce((no)=>Vt(no(Ne())),[Vt,Ne])` — stable place identity.
  const place = useCallback(
    (fn: (prev: number) => number): void => {
      const by = commit(fn(placedRef.current));
      if (by !== 0) {
        void dispatchPersonIfRegistered(placedRef.current, by);
      }
    },
    [commit],
  );
  const fireScroll = (delta: number): void => {
    inFlightRef.current = true;
    const by = commit(liveOffset() + delta);
    // densable QLt.finally — keep inFlight until person scroll settles, then drain.
    const after = (): void => {
      if (!aliveRef.current) {
        inFlightRef.current = false;
        queuedDeltaRef.current = 0;
        return;
      }
      inFlightRef.current = false;
      const queued = queuedDeltaRef.current;
      queuedDeltaRef.current = 0;
      if (queued !== 0) fireScroll(queued);
    };
    if (by === 0) {
      after();
      return;
    }
    void dispatchPersonIfRegistered(placedRef.current, by).finally(after);
  };
  const scrollBy = (delta: number): void => {
    if (delta === 0) return;
    if (inFlightRef.current) {
      queuedDeltaRef.current += delta;
      return;
    }
    fireScroll(delta);
  };
  const followEndOn = (): void => {
    followEndRef.current = true;
    setFollowEnd(true);
  };
  return {
    offset,
    placed: followEnd ? dims.current.maxOffset : placed,
    followEnd,
    scrollBy,
    place,
    commit,
    followEndOn,
  };
}

/**
 * densable `gL` nextBandFocus — first land / wrap / stay on `"band"`.
 * Full AbovePrompt focus ring still deferred; exported for gold-shaped hosts.
 */
export function nextBandFocus(input: { focus: number | 'band' | null; count: number }): number | 'band' | null {
  const hasFocusables = input.count > 0;
  if (typeof input.focus === 'number') {
    return input.focus + 1 < input.count ? input.focus + 1 : null;
  }
  if (hasFocusables) return 0;
  return input.focus === null ? 'band' : null;
}

/** densable `i$` overflowCueText — `↑ N more · ↓ M more`. */
export function overflowCueText(above: number, below: number): string {
  return [above > 0 ? `↑ ${above} more` : '', below > 0 ? `↓ ${below} more` : '']
    .filter(part => part !== '')
    .join(' · ');
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
      width={CLOSE_MARK_COLUMNS}
      onClick={onClose}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <Text bold={hover || isHeld} dimColor={!hover && !isHeld}>
        {'✕'}
      </Text>
    </Box>
  );
}

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
export function pluginFieldContext(tag: string | undefined, site: 'Pane' | 'AbovePrompt'): PluginBandKeyContext {
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
  onLit,
}: {
  columns: number;
  rows: number;
  onResize: (next: number) => number;
  onSettle: () => void;
  /** densable pee `Ie` / grip lit — paints inline round-border top. */
  onLit?: (lit: boolean) => void;
}): ReactNode {
  const [lit, setLit] = useState(false);
  const drag = useRef<{ at: number; cells: number; now: number } | null>(null);
  const setGripLit = (next: boolean): void => {
    setLit(next);
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
      onPointer={event => {
        if (event.type === 'mousedown') {
          if (event.button !== 0) return;
          drag.current = { at: event.col, cells: columns, now: columns };
          setLit(true);
          return;
        }
        if (event.type === 'mousedrag') {
          const held = drag.current;
          if (held === undefined || held === null) return;
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
  const fieldHeld = useSyncExternalStore(subscribePaneFieldHeld, paneFieldHeldNow, paneFieldHeldNow);
  const paneActive = isActive && !fieldHeld;
  const fieldActive = isActive && fieldHeld;
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

/** densable `xze` focusable drawn node (Button / Input / Select). */
export type DrawingFocusable = {
  tag: 'Button' | 'Input' | 'Select';
  plugin: string;
  handle: unknown;
  element: unknown;
  isAutoFocus: boolean;
  value?: unknown;
  options?: unknown;
};

/**
 * densable `xze(e)` focusablesOfDrawing — walk drawing tree; Button/Input/Select
 * → `{tag, plugin, handle, element: props.key, isAutoFocus, value?, options?}`
 * via `e.press`; else flatMap children.
 */
export function focusablesOfDrawing(drawn: unknown): DrawingFocusable[] {
  if (drawn === undefined || typeof drawn === 'string') return [];
  if (!isRecord(drawn)) return [];
  if (drawn.type === 'engine') return [];
  const type = drawn.type;
  if (type === 'Button' || type === 'Input' || type === 'Select') {
    const press = pressOf(drawn);
    if (press === undefined) return [];
    const props = isRecord(drawn.props) ? drawn.props : drawn;
    const base: DrawingFocusable = {
      tag: type,
      plugin: press.plugin,
      handle: press.handle,
      element: props.key,
      isAutoFocus: props.autoFocus === true,
    };
    if (type !== 'Button') base.value = props.value;
    if (type === 'Select') base.options = props.options;
    return [base];
  }
  const kids = Array.isArray(drawn.children) ? drawn.children : drawn.children === undefined ? [] : [drawn.children];
  const fromProps = isRecord(drawn.props) ? drawn.props.children : undefined;
  const list =
    kids.length > 0 ? kids : fromProps === undefined ? [] : Array.isArray(fromProps) ? fromProps : [fromProps];
  return list.flatMap(focusablesOfDrawing);
}

/**
 * densable `l$(h)` ringHandlers — cycle focus index; press Button→WCe/press,
 * Input→submit; leave clears. Input submit uses PluginSiteFields `m$` via bridge.
 */
export function bandRingHandlers(input: {
  focusables: DrawingFocusable[];
  focusIndexNow: () => number | null;
  focusByPerson: (index: number) => void;
  leave: () => void;
  submit?: (focusable: DrawingFocusable) => void;
}): {
  'abovePrompt:next': () => void;
  'abovePrompt:previous': () => void;
  'abovePrompt:press': () => void;
  'abovePrompt:leave': () => void;
} {
  const count = input.focusables.length;
  return {
    'abovePrompt:next': () => {
      if (count > 0) input.focusByPerson(((input.focusIndexNow() ?? -1) + 1) % count);
    },
    'abovePrompt:previous': () => {
      if (count > 0) input.focusByPerson(((input.focusIndexNow() ?? 0) - 1 + count) % count);
    },
    'abovePrompt:press': () => {
      const index = input.focusIndexNow();
      const focused = index === null ? null : (input.focusables[index] ?? null);
      if (focused?.tag === 'Button') {
        firePress(focused.plugin, focused.handle);
        return;
      }
      if (focused?.tag === 'Input') {
        input.submit?.(focused);
      }
      // Select press owned by y$/qZ selectHighlightHandlers on AbovePromptSelect.
    },
    'abovePrompt:leave': input.leave,
  };
}

/**
 * densable `mEe` — pixel scroll bag. Page step is live `bodyRows` (gold `v` / `ro`).
 */
export function paneScrollHandlers(input: {
  bodyRows: number;
  contentRows: number;
  scrollBy: (delta: number) => void;
}): {
  'pane:scrollUp': () => void;
  'pane:scrollDown': () => void;
  'pane:pageUp': () => void;
  'pane:pageDown': () => void;
  'pane:top': () => void;
  'pane:bottom': () => void;
} {
  const { bodyRows, contentRows, scrollBy } = input;
  return {
    'pane:scrollUp': () => scrollBy(-1),
    'pane:scrollDown': () => scrollBy(1),
    'pane:pageUp': () => scrollBy(-bodyRows),
    'pane:pageDown': () => scrollBy(bodyRows),
    'pane:top': () => scrollBy(-contentRows),
    'pane:bottom': () => scrollBy(contentRows),
  };
}

/**
 * densable `AZ(h,v,M)` — ring + mEe(scroll); `!hasCue` remaps ↑↓ onto the ring.
 * Gold `Zt(Yi,{context:"AbovePrompt",isActive:is})` binds the whole bag.
 */
export function bandKeysWithScroll<H extends Record<string, () => void>>(
  ring: H,
  scroll: ReturnType<typeof paneScrollHandlers>,
  hasCue: boolean,
): H & ReturnType<typeof paneScrollHandlers> {
  return {
    ...ring,
    ...scroll,
    ...(!hasCue && {
      'pane:scrollUp': ring['abovePrompt:previous'] as () => void,
      'pane:scrollDown': ring['abovePrompt:next'] as () => void,
    }),
  };
}

/** densable `ClickedPress` / `KXt` — click maps plugin+handle onto the ring. */
const ClickedPressContext = createContext<((press: { plugin: string; handle: unknown }) => void) | null>(null);

/**
 * densable `QXt` — when a pressable is focused, report its Ink DOM node so
 * hosts can run gold `Jq`/`OMr` into-view place. Unfocused clears with null.
 */
const HeldFocusRefContext = createContext<(node: DOMElement | null) => void>(() => {});

/** densable `ZXt` — currently focused press identity for `le` hasKeyboardFocus. */
const FocusedPressContext = createContext<{ plugin: string; handle: unknown } | null>(null);

/**
 * densable `c$` — findIndex plugin+handle, then focusByPerson.
 */
export function clickFocusByPress(
  focusables: DrawingFocusable[],
  focusByPerson: (index: number) => void,
): (press: { plugin: string; handle: unknown }) => void {
  return press => {
    const index = focusables.findIndex(row => row.plugin === press.plugin && row.handle === press.handle);
    if (index >= 0) focusByPerson(index);
  };
}

type PaneCloseRing = ReturnType<typeof bandRingHandlers> & {
  'pane:scrollUp': () => void;
  'pane:scrollDown': () => void;
};

/**
 * densable `aee` — ring = focusables + other-pane tabs (`tabCount`) + close mark.
 * Engine hold: `0..tabCount-1` pick tab, `tabCount` close. `pane:scrollUp/Down`
 * cycle focusables only when Pe>0 (gold We); pixel scroll stays on
 * PluginPaneKeyResize when maxOffset>0.
 */
export function extendPaneRingWithCloseMark(input: {
  ring: ReturnType<typeof bandRingHandlers>;
  focusablesCount: number;
  focusIndexNow: () => number | null;
  engineHeldNow: () => number | null;
  holdEngine: (index: number | null) => void;
  setIndex: (index: number | null) => void;
  moveByPerson: (move: { index: number | null; apply: () => void }) => void;
  leave: () => void;
  close: () => void;
  tabs?: ReadonlyArray<{ id: string }>;
  pick?: (id: string) => void;
}): PaneCloseRing {
  const count = input.focusablesCount;
  const tabCount = input.tabs?.length ?? 0;
  const combinedCount = count + tabCount + 1;
  const combinedNow = (): number | null => {
    const engine = input.engineHeldNow();
    return engine === null ? input.focusIndexNow() : count + engine;
  };
  const go = (combined: number): void => {
    const inFocusables = combined < count;
    input.moveByPerson({
      index: inFocusables ? combined : null,
      apply: () => {
        input.holdEngine(inFocusables ? null : combined - count);
        input.setIndex(inFocusables ? combined : null);
      },
    });
  };
  const cycleFocusables = (delta: number): void => {
    if (count <= 0) return;
    const fallback = delta === 1 ? -1 : count;
    const from = input.engineHeldNow() === null ? (input.focusIndexNow() ?? fallback) : fallback;
    go((from + delta + count) % count);
  };
  const pressEngine = (engine: number): void => {
    if (engine === tabCount) {
      input.close();
      return;
    }
    const id = input.tabs?.[engine]?.id;
    if (id !== undefined) input.pick?.(id);
  };
  return {
    ...input.ring,
    'abovePrompt:next': () => go(((combinedNow() ?? -1) + 1) % combinedCount),
    'abovePrompt:previous': () => go(((combinedNow() ?? 0) - 1 + combinedCount) % combinedCount),
    'abovePrompt:press': () => {
      const engine = input.engineHeldNow();
      if (engine === null) {
        input.ring['abovePrompt:press']();
        return;
      }
      pressEngine(engine);
    },
    'abovePrompt:leave': input.leave,
    'pane:scrollUp': () => cycleFocusables(-1),
    'pane:scrollDown': () => cycleFocusables(1),
  };
}

/**
 * densable `ITt` — subscribeClicks walk parentNode; click outside pane
 * and `!isWindowActivation` → away. `(null,null)` from tellClickedNowhere
 * also away. Returns the host Box ref.
 */
export function usePaneClickAway(onAway: () => void): RefObject<DOMElement | null> {
  const ref = useRef<DOMElement | null>(null);
  const { subscribeClicks } = useApp();
  useEffect(() => {
    return subscribeClicks((node, event) => {
      let walk: DOMElement | undefined = node ?? undefined;
      while (walk && walk !== ref.current) walk = walk.parentNode;
      if (!walk && event?.isWindowActivation !== true) onAway();
    });
  }, [onAway, subscribeClicks]);
  return ref;
}

function wheelProfileDrifted(prev: WheelProfile | null, next: WheelProfile): boolean {
  if (prev === null) return false;
  return (
    prev.useDecayCurve !== next.useDecayCurve ||
    prev.wheelFlood !== next.wheelFlood ||
    prev.jediTerm !== next.jediTerm ||
    prev.wtSession !== next.wtSession ||
    prev.xtermJs !== next.xtermJs
  );
}

/**
 * densable `U4`/`uct` — lazy wheel-accel state, re-pin `base` every tick
 * (gold `h.current.base = P6().base`). Reset when J3 profile drifts
 * (same fields as ScrollKeybindingHandler.ensureWheelAccel).
 */
export function ensurePaneWheelAccel(
  held: { current: WheelAccelState | null },
  profileHeld: { current: WheelProfile | null },
): WheelAccelState {
  const profile = resolveWheelProfile();
  if (wheelProfileDrifted(profileHeld.current, profile)) held.current = null;
  profileHeld.current = profile;
  held.current ??= initWheelAccel(
    profile.useDecayCurve,
    profile.base,
    profile.wheelFlood,
    isWheelScrollAccelerationEnabled(),
  );
  held.current.base = profile.base;
  return held.current;
}

/**
 * densable `pEe`/`gEe` — WheelEvent → yEe person scrollBy.
 * `gEe` rows = `computeWheelStep` (`dct`/`FSp`); pointer is densable `dEe`
 * local col/row from the WheelEvent.
 */
export function paneWheelScroll(
  event: WheelEvent,
  input: {
    plugin: string;
    requestId: string;
    offset: number;
    bodyRows: number;
    contentRows: number;
    maxOffset: number;
    accel: WheelAccelState;
    now?: number;
  },
): void {
  const sign: 1 | -1 = event.deltaY < 0 ? -1 : 1;
  // gold dct/FSp: bounce-defer returns 0 — do not lift to 1 row.
  const rows = computeWheelStep(input.accel, sign, input.now ?? performance.now());
  const by = sign * rows;
  const next = Math.max(0, Math.min(input.maxOffset, input.offset + by));
  if (rows === 0 || next === input.offset) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  void dispatchPersonUiScroll({
    plugin: input.plugin,
    component: 'Pane',
    requestId: input.requestId,
    offset: next,
    by,
    bodyRows: input.bodyRows,
    contentRows: input.contentRows,
    pointer: { column: event.localCol, row: event.localRow },
  });
  event.preventDefault();
  event.stopPropagation();
}

/**
 * densable `qZ` — AbovePromptSelect handlers over a Select move/press host
 * (PluginSiteFields SelectFields + PluginPressSelect / firePressAnswer).
 */
export function selectHighlightHandlers(input: { move: (delta: number) => void; press: () => void }): {
  'abovePrompt:highlightNext': () => void;
  'abovePrompt:highlightPrevious': () => void;
  'abovePrompt:press': () => void;
} {
  return {
    'abovePrompt:highlightNext': () => input.move(1),
    'abovePrompt:highlightPrevious': () => input.move(-1),
    'abovePrompt:press': input.press,
  };
}

/**
 * densable `y$.intercept` — ctrl-c close/unfocus + typeahead. Gold feeds this
 * into `g$({selectKeys})` and `sb(intercept)` while Select is focused.
 * PluginAbovePromptSite `usePluginBandKeys` + PluginSiteFields useInput consume it.
 */
export function selectKeysIntercept(
  input: string,
  key: Key,
  select: {
    focusedSelect: {
      plugin: string;
      handle: unknown;
      element: string;
      options: Array<{ value: string; label?: string }>;
    } | null;
    open: {
      plugin: string;
      handle: unknown;
      highlight: number;
      element: string;
      options: Array<{ value: string; label?: string }>;
    } | null;
    close: () => void;
    unfocus: () => void;
    typeahead: (letter: string) => void;
  },
  opts?: { working?: boolean },
): boolean {
  const focused = select.focusedSelect;
  const ctrlC = key.ctrl && input === 'c';
  const typed = pluginSelectTypeahead(input, key);
  if (focused === null || (ctrlC && opts?.working === true)) return false;
  if (ctrlC && select.open !== null) {
    select.close();
    return true;
  }
  if (ctrlC) {
    select.unfocus();
    return true;
  }
  if (typed) {
    select.typeahead(input.toLowerCase());
    return true;
  }
  return false;
}

/** densable y$ `bt` — Select at a ring index. */
export type PluginSelectFocusable = {
  plugin: string;
  handle: unknown;
  element: string;
  options: Array<{ value: string; label?: string }>;
  value?: string;
};

/** densable y$ `Pc` / `Kt` — `{key,isOpen,highlight}`. */
export type PluginSelectSeatState = {
  key: string | null;
  isOpen: boolean;
  highlight: number;
};

export function selectFocusableAt(
  focusables: readonly DrawingFocusable[] | undefined,
  index: number | 'band' | null | undefined,
): PluginSelectFocusable | null {
  const row = focusableAt(focusables ?? [], typeof index === 'number' ? index : null);
  if (row === null || row.tag !== 'Select' || typeof row.element !== 'string' || row.element === '') {
    return null;
  }
  return {
    plugin: row.plugin,
    handle: row.handle,
    element: row.element,
    options: selectOptionsOf(row),
    ...(typeof row.value === 'string' && { value: row.value }),
  };
}

function selectSeatKeyOf(row: PluginSelectFocusable | null): string | null {
  return row === null ? null : pluginInputFieldKey(row.plugin, row.element);
}

/**
 * densable y$ `Kt(io)` — identity reset: Select → `{key, isOpen:true, highlight}`;
 * none → `{key:null, isOpen:false, highlight:0}`.
 */
export function resetPluginSelectSeat(
  row: PluginSelectFocusable | null,
  picked: Map<string, string>,
): PluginSelectSeatState {
  if (row === null) return { key: null, isOpen: false, highlight: 0 };
  const key = pluginInputFieldKey(row.plugin, row.element);
  const shown = picked.get(key) ?? row.value;
  const at = row.options.findIndex(option => option.value === shown);
  return { key, isOpen: true, highlight: Math.max(0, at) };
}

export type PluginSelectSeatRing = {
  focusIndex: number | 'band' | null;
  focusIndexNow: () => number | 'band' | null;
  setFocusIndex: (next: number | 'band' | null) => void;
  working?: boolean;
};

/**
 * densable `y$(h)` — `{fields, handlers, intercept}` over kL(YFt)+Pc.
 * Identity `qe.key!==Rt(Me)` resets during render (gold `We(Kt(Me))`).
 */
export function usePluginSelectSeat(
  focusables: readonly DrawingFocusable[] | undefined,
  component: string,
  requestId: string,
  ring?: PluginSelectSeatRing,
): {
  fields: {
    pickedOf: (plugin: string, element: string) => string | undefined;
    open: SelectOpen | null;
  };
  handlers: ReturnType<typeof selectHighlightHandlers>;
  intercept: (input: string, key: Key) => boolean;
  focusedSelect: PluginSelectFocusable | null;
  move: (delta: number) => void;
  press: () => void;
  typeahead: (letter: string) => void;
  close: () => void;
  toggle: (ref: {
    plugin: string;
    handle: unknown;
    element: string;
    options: Array<{ value: string; label?: string }>;
    value?: string;
  }) => void;
  focus: (ref: PluginSelectFocusable) => void;
  unfocus: () => void;
} {
  const [picked, setPicked] = usePluginFieldSeatMap('select', component, requestId);
  usePluginFieldValuePrune(focusables, 'Select', keys => {
    setPicked(current => deleteSeatKeys(current, keys));
  });
  const me = selectFocusableAt(focusables, ring?.focusIndex);
  const meKey = selectSeatKeyOf(me);
  const [seat, setSeat] = useState<PluginSelectSeatState>(() => resetPluginSelectSeat(null, picked));
  const seatNow = seat.key !== meKey ? resetPluginSelectSeat(me, picked) : seat;
  useLayoutEffect(() => {
    if (seat.key === meKey) return;
    setSeat(resetPluginSelectSeat(me, picked));
  }, [me, meKey, picked, seat.key]);
  const optionCount = me?.options.length ?? 0;
  const isOpen = me !== null && seatNow.isOpen;
  const highlight = Math.min(seatNow.highlight, Math.max(0, optionCount - 1));
  const open: SelectOpen | null =
    isOpen && me !== null
      ? {
          plugin: me.plugin,
          handle: me.handle,
          highlight,
          element: me.element,
          options: me.options,
        }
      : null;

  const rowNow = (): PluginSelectFocusable | null =>
    selectFocusableAt(focusables, ring?.focusIndexNow() ?? ring?.focusIndex);

  const ensureSeat = (row: PluginSelectFocusable): PluginSelectSeatState => {
    const key = pluginInputFieldKey(row.plugin, row.element);
    if (seatNow.key === key) return seatNow;
    const next = resetPluginSelectSeat(row, picked);
    setSeat(next);
    return next;
  };

  const move = (delta: number): void => {
    // densable y$ Vt — closed Select opens on move; open cycles highlight.
    const row = rowNow();
    if (row === null) return;
    const now = ensureSeat(row);
    const count = Math.max(1, row.options.length);
    const at = Math.min(now.highlight, Math.max(0, row.options.length - 1));
    setSeat(now.isOpen ? { ...now, highlight: (at + delta + count) % count } : { ...now, isOpen: true });
  };

  const press = (): void => {
    const row = rowNow();
    if (row === null) return;
    const now = ensureSeat(row);
    const key = pluginInputFieldKey(row.plugin, row.element);
    const choice = row.options[Math.min(now.highlight, Math.max(0, row.options.length - 1))];
    if (!now.isOpen || choice === undefined) {
      setSeat({ ...now, isOpen: true });
      return;
    }
    setPicked(current => new Map(current).set(key, choice.value));
    setSeat({ ...now, isOpen: false });
    void firePressAnswer(row.plugin, row.handle, { value: choice.value }).then(reply => {
      if (reply !== undefined && typeof reply === 'object' && reply !== null && 'value' in reply) {
        const next = (reply as { value: unknown }).value;
        if (typeof next === 'string') {
          setPicked(current => (current.get(key) === choice.value ? new Map(current).set(key, next) : current));
        }
      }
    });
  };

  const typeahead = (letter: string): void => {
    const row = rowNow();
    if (row === null) return;
    const now = ensureSeat(row);
    const next = pluginSelectTypeaheadNext(
      now.isOpen
        ? {
            plugin: row.plugin,
            handle: row.handle,
            element: row.element,
            options: row.options,
            highlight: now.highlight,
          }
        : null,
      row,
      letter,
    );
    if (next === null) return;
    setSeat({ ...now, highlight: next.highlight, isOpen: true });
  };

  const close = (): void => {
    setSeat(current => ({ ...current, isOpen: false }));
  };

  const unfocus = (): void => {
    close();
    ring?.setFocusIndex(null);
  };

  const intercept = (input: string, key: Key): boolean =>
    selectKeysIntercept(
      input,
      key,
      {
        focusedSelect: rowNow(),
        open,
        close,
        unfocus,
        typeahead,
      },
      { working: ring?.working === true },
    );

  return {
    fields: {
      pickedOf: (plugin, element) => picked.get(pluginInputFieldKey(plugin, element)),
      open,
    },
    handlers: selectHighlightHandlers({ move, press }),
    intercept,
    focusedSelect: me,
    move,
    press,
    typeahead,
    close,
    toggle(ref) {
      const key = pluginInputFieldKey(ref.plugin, ref.element);
      const same = open !== null && open.plugin === ref.plugin && open.handle === ref.handle;
      if (!same) {
        const shown = picked.get(key) ?? ref.value;
        const at = ref.options.findIndex(option => option.value === shown);
        setSeat({ key, isOpen: true, highlight: at < 0 ? 0 : at });
        return;
      }
      press();
    },
    focus() {
      /* densable Me is the ring index; mouse lands via clickedPress. */
    },
    unfocus,
  };
}

/** densable y$ return — `{fields, handlers, intercept}` plus SiteFields hosts. */
export type PluginSelectSeat = ReturnType<typeof usePluginSelectSeat>;

/** densable `Ode(list, index)` — focusable at ring index. */
export function focusableAt(focusables: DrawingFocusable[], index: number | null | undefined): DrawingFocusable | null {
  if (typeof index !== 'number') return null;
  return focusables[index] ?? null;
}

/** densable `Z$t` — queued person focus acts while a move is in flight. */
const FOCUS_HOST_QUEUE_MAX = 64;

export type PluginFocusHostApi = {
  act: (fn: () => void) => void;
  moveByPerson: (move: { index: number | null; apply: () => void }) => void;
  forget: () => void;
};

/**
 * densable `YHo(host, handlers, skip)` — wrap each handler in `host.act`
 * except keys in `skip` (gold Pane: `["abovePrompt:leave"]`).
 */
export function wrapPluginFocusActs<H extends Record<string, () => void>>(
  host: { act: (fn: () => void) => void },
  handlers: H,
  skip: readonly string[] = [],
): H {
  const next = { ...handlers };
  for (const key of Object.keys(handlers) as Array<keyof H & string>) {
    if (skip.includes(key)) continue;
    const fn = handlers[key];
    next[key] = (() => {
      host.act(fn);
    }) as H[typeof key];
  }
  return next;
}

/**
 * densable `XHo` — bind live keyboard host onto g9e focusSites.
 * commit: person `move.apply` / auto race `"the focus moved meanwhile"` / land(index).
 */
export function usePluginFocusHost(input: {
  component: 'Pane' | 'AbovePrompt';
  requestId: string;
  owner?: string;
  focusables: DrawingFocusable[];
  isHeld: boolean;
  isHeldNow: () => boolean;
  indexNow: () => number | null;
  isEmptyNow: () => boolean;
  land: (index: number) => void;
}): PluginFocusHostApi {
  const pendingRef = useRef<
    | {
        abort: AbortController;
        expected: number | null;
        move?: { index: number | null; apply: () => void };
        auto?: DrawingFocusable;
      }
    | undefined
  >(undefined);
  const queueRef = useRef<Array<() => void>>([]);
  const startedRef = useRef(false);
  const liveRef = useRef(true);
  const focusablesRef = useRef(input.focusables);
  focusablesRef.current = input.focusables;
  const indexNowRef = useRef(input.indexNow);
  indexNowRef.current = input.indexNow;
  const landRef = useRef(input.land);
  landRef.current = input.land;
  const isHeldNowRef = useRef(input.isHeldNow);
  isHeldNowRef.current = input.isHeldNow;
  const holderNowRef = useRef(() => {
    const idx = indexNowRef.current();
    return focusableAt(focusablesRef.current, idx)?.plugin;
  });

  const drain = useCallback(() => {
    while (pendingRef.current === undefined && queueRef.current.length > 0) {
      const next = queueRef.current.shift();
      next?.();
    }
  }, []);

  const forget = useCallback(() => {
    pendingRef.current?.abort.abort();
    pendingRef.current = undefined;
    queueRef.current = [];
  }, []);

  const actFocus = useCallback(
    (
      payload: {
        component: 'Pane' | 'AbovePrompt';
        requestId: string;
        plugin?: string;
        element?: unknown;
        origin: { kind: string; name?: string };
      },
      meta: {
        expected: number | null;
        move?: { index: number | null; apply: () => void };
        auto?: DrawingFocusable;
      },
    ) => {
      const ticket = { ...meta, abort: new AbortController() };
      pendingRef.current = ticket;
      const finish = () => {
        const same = pendingRef.current === ticket;
        if (same) pendingRef.current = undefined;
        if (same && liveRef.current) drain();
      };
      // densable ve → idn({input, signal}) → Tq. Person lands in commit.apply.
      const key = typeof payload.element === 'string' && payload.element !== '' ? payload.element : undefined;
      const result = dispatchUiFocus(
        {
          component: payload.component,
          requestId: payload.requestId,
          ...(payload.plugin !== undefined && { plugin: payload.plugin }),
          ...(key !== undefined && { element: key }),
          origin: payload.origin,
        },
        { signal: ticket.abort.signal },
      );
      // densable: Promise → Hde.finally(Qe); else Qe() same tick.
      if (result instanceof Promise) {
        void logUiScrollSettled(`ui.focus ${payload.requestId}`, result).finally(finish);
        return;
      }
      finish();
    },
    [drain],
  );

  const moveByPerson = useCallback(
    (move: { index: number | null; apply: () => void }) => {
      const hit = focusableAt(focusablesRef.current, move.index);
      if (move.index !== null && hit === null) return;
      startedRef.current = true;
      actFocus(
        {
          component: input.component,
          requestId: input.requestId,
          ...(hit && {
            plugin: hit.plugin,
            element: hit.element,
          }),
          origin: { kind: 'person' },
        },
        { expected: indexNowRef.current(), move },
      );
    },
    [actFocus, input.component, input.requestId],
  );

  const act = useCallback((fn: () => void) => {
    if (pendingRef.current === undefined && queueRef.current.length === 0) {
      fn();
      return;
    }
    if (queueRef.current.length < FOCUS_HOST_QUEUE_MAX) {
      queueRef.current = [...queueRef.current, fn];
    }
  }, []);

  const hasElement = useCallback((plugin: string, element: string) => {
    return focusablesRef.current.findIndex(row => row.plugin === plugin && row.element === element) >= 0;
  }, []);

  const commit = useCallback(
    (payload: { plugin: string; element?: string; origin: { kind: string; name?: string } }) => {
      const pending = pendingRef.current;
      const omitted = payload.element === undefined;
      if (payload.origin.kind === 'person') {
        const move = pending?.move;
        if (pending === undefined || move === undefined || indexNowRef.current() !== pending.expected) {
          return 'the focus moved meanwhile';
        }
        const at = focusableAt(focusablesRef.current, move.index);
        if (omitted || (at !== null && at.plugin === payload.plugin && at.element === payload.element)) {
          move.apply();
          return;
        }
      }
      const auto = pending?.auto;
      if (
        auto !== undefined &&
        payload.plugin === auto.plugin &&
        payload.element === auto.element &&
        indexNowRef.current() !== pending?.expected
      ) {
        return 'the focus moved meanwhile';
      }
      const at = focusablesRef.current.findIndex(
        row => row.plugin === payload.plugin && row.element === payload.element,
      );
      if (at < 0) {
        return omitted ? 'no element named' : `no element of ${payload.plugin} is drawn under that key`;
      }
      startedRef.current = true;
      landRef.current(at);
      return;
    },
    [],
  );

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      forget();
    };
  }, [forget]);

  useEffect(() => {
    if (input.requestId === '') return;
    return bindPluginFocusHost({
      component: input.component,
      requestId: input.requestId,
      owner: input.owner,
      isHeldNow: () => isHeldNowRef.current(),
      holderNow: () => holderNowRef.current(),
      hasElement,
      commit,
    });
  }, [input.component, input.requestId, input.owner, hasElement, commit]);

  const autoFocusable = useMemo(() => input.focusables.find(row => row.isAutoFocus), [input.focusables]);

  useEffect(() => {
    if (!input.isHeld) {
      startedRef.current = false;
      forget();
      return;
    }
    if (startedRef.current || pendingRef.current !== undefined || autoFocusable === undefined || input.isEmptyNow()) {
      return;
    }
    startedRef.current = true;
    actFocus(
      {
        component: input.component,
        requestId: input.requestId,
        plugin: autoFocusable.plugin,
        element: autoFocusable.element,
        origin: { kind: 'plugin', name: autoFocusable.plugin },
      },
      { expected: indexNowRef.current(), auto: autoFocusable },
    );
  }, [input.isHeld, autoFocusable, input, actFocus, forget]);

  return { act, moveByPerson, forget };
}

export type PluginBandKeyContext = 'AbovePrompt' | 'AbovePromptInput' | 'AbovePromptSelect' | 'Pane';

export type PluginBandKeysBag = {
  isAhead: () => boolean;
  contextNow: () => PluginBandKeyContext | null;
  focusedNow: () => DrawingFocusable | null;
  contextRendered: () => PluginBandKeyContext | null;
  focusedRendered: () => DrawingFocusable | null;
  handlers: Partial<Record<PluginBandKeyContext, Record<string, () => void>>>;
  /** densable `m$` inputs bag (textNow + fields.edit). */
  inputs?: {
    textNow: (focusable: { plugin: string; element: string; value?: string }) => string;
    fields: {
      edit: (focusable: { plugin: string; handle: unknown; element: string }, value: string) => void;
    };
  };
  /** densable `y$.intercept` / selectKeysIntercept. */
  selectKeys: (input: string, key: Key) => boolean;
};

type PluginBandResolve = (
  input: string,
  key: Key,
  contexts: Array<PluginBandKeyContext | 'Global'>,
) => { type: string; action?: string };

/**
 * densable `g$(h)` body — Yl resolve + handler bag + selectKeys + optional m$ edit.
 * Returns whether the prepend `sb` listener should consume the event.
 */
export function pluginBandKeys(
  bag: PluginBandKeysBag,
  resolve: PluginBandResolve | null | undefined,
): (input: string, key: Key, eventInput: string) => boolean {
  return (input, key, eventInput) => {
    const contextNow = bag.contextNow();
    if (resolve == null || contextNow == null) return false;
    if (key.wheelUp || key.wheelDown) return false;
    if (!bag.isAhead()) return false;
    const nowHit = resolve(input, key, [contextNow]);
    if (nowHit.type === 'match' && typeof nowHit.action === 'string') {
      const run = bag.handlers[contextNow]?.[nowHit.action];
      if (run !== undefined) {
        run();
        return true;
      }
    }
    const focusedNow = bag.focusedNow();
    if (focusedNow?.tag === 'Select' && bag.selectKeys(input, key)) return true;
    if (resolve(input, key, ['Global']).type === 'match') return false;
    const typed = input === '' ? eventInput : input;
    if (focusedNow?.tag === 'Input' && bag.inputs !== undefined) {
      if (typeof focusedNow.element !== 'string' || focusedNow.element === '') return false;
      const ref = {
        plugin: focusedNow.plugin,
        handle: focusedNow.handle,
        element: focusedNow.element,
        ...(typeof focusedNow.value === 'string' && { value: focusedNow.value }),
      };
      const shown = bag.inputs.textNow(ref);
      if (key.backspace) {
        bag.inputs.fields.edit(ref, [...shown].slice(0, -1).join(''));
        return true;
      }
      if (pluginInputIsTyped(typed, key)) {
        bag.inputs.fields.edit(ref, shown + typed);
        return true;
      }
      if (pluginInputIsNav(input, key)) return true;
    }
    const contextRendered = bag.contextRendered();
    if (contextRendered == null) return false;
    const renderedHit = resolve(input, key, [contextRendered]);
    const stealsHandler =
      renderedHit.type === 'match' &&
      typeof renderedHit.action === 'string' &&
      bag.handlers[contextRendered]?.[renderedHit.action] !== undefined;
    const stealsInput = key.backspace || pluginInputIsTyped(typed, key) || pluginInputIsNav(input, key);
    return stealsHandler || (bag.focusedRendered()?.tag === 'Input' && stealsInput);
  };
}

/**
 * densable `g$` hook — `Yl()` resolve + `sb(..., {prepend:true})`.
 * Caller supplies bag from local ring/bridge (Si panes store already HAVE).
 */
export function usePluginBandKeys(bag: PluginBandKeysBag, options: { isActive: boolean }): void {
  const keys = useOptionalKeybindingContext();
  const bagRef = useRef(bag);
  bagRef.current = bag;
  const resolve = keys?.resolve as PluginBandResolve | undefined;
  useInput(
    (input, key, event) => {
      const consume = pluginBandKeys(bagRef.current, resolve);
      if (consume(input, key, event.input)) event.stopImmediatePropagation();
    },
    { isActive: options.isActive, prepend: true },
  );
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

/** densable `BDe` — Input field Map key `plugin\0element`. */
export function pluginInputFieldKey(plugin: string, element: string): string {
  return `${plugin}\0${element}`;
}

/**
 * densable `vhr` — `ui.input` change/submit. Local via firePressAnswer/invokePress
 * (no Hde invent). Gold also passes element/component; payload kind+value is load-bearing.
 */
export function pluginInputPressEvent(event: {
  plugin: string;
  handle: unknown;
  element?: string;
  component?: string;
  kind: string;
  value: string;
}): Promise<unknown> {
  return firePressAnswer(event.plugin, event.handle, {
    kind: event.kind,
    value: event.value,
  });
}

export type PluginInputFieldsSlice = {
  textOf: (plugin: string, element: string) => string | undefined;
  edit: (ref: { plugin: string; handle: unknown; element: string }, value: string) => void;
};

/** densable `m$` return — `{fields, textNow, submit}`. */
export type PluginInputMapApi = {
  fields: PluginInputFieldsSlice;
  textNow: (ref: { plugin: string; element: string; value?: string }) => string;
  submit: (ref: { plugin: string; handle: unknown; element: string; value?: string }) => void;
};

/**
 * densable `m$(focusables, component, requestId)`.
 * Gold body: live Map + submitting Set + BDe + vhr change/submit + textOf/edit/textNow/submit.
 * `usePluginInputSeat` owns kL/yL; this is the map half.
 */
export function createPluginInputMap(
  _focusables: readonly DrawingFocusable[] | undefined,
  component: string,
  _requestId: string,
  host: {
    texts: Map<string, string>;
    setTexts: (updater: (current: Map<string, string>) => Map<string, string>) => void;
    live: { current: Map<string, string> };
    submitting: { current: Set<string> };
  },
): PluginInputMapApi {
  const { texts, setTexts, live, submitting } = host;
  const fields: PluginInputFieldsSlice = {
    textOf: (plugin, element) => texts.get(pluginInputFieldKey(plugin, element)),
    edit({ plugin, handle, element }, value) {
      const key = pluginInputFieldKey(plugin, element);
      live.current.set(key, value);
      setTexts(current => new Map(current).set(key, value));
      void pluginInputPressEvent({ plugin, handle, element, component, kind: 'change', value });
    },
  };
  return {
    fields,
    textNow({ plugin, element, value }) {
      const key = pluginInputFieldKey(plugin, element);
      return live.current.get(key) ?? texts.get(key) ?? value ?? '';
    },
    submit({ plugin, handle, element, value }) {
      const key = pluginInputFieldKey(plugin, element);
      const sent = live.current.get(key) ?? texts.get(key) ?? value ?? '';
      if (submitting.current.has(key)) return;
      submitting.current.add(key);
      void pluginInputPressEvent({ plugin, handle, element, component, kind: 'submit', value: sent }).then(
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
  };
}

/**
 * densable `m$(h,v,M)` — kL(KFt) + yL Input prune + live/submitting + vhr.
 * `_Ee`/`pee` lift this as `rr` into g$ `inputs`.
 */
export function usePluginInputSeat(
  focusables: readonly DrawingFocusable[] | undefined,
  component: string,
  requestId: string,
): PluginInputMapApi {
  const [texts, setTexts] = usePluginFieldSeatMap('input', component, requestId);
  const live = useRef(new Map<string, string>());
  const submitting = useRef(new Set<string>());
  useLayoutEffect(() => {
    if (live.current.size === 0 && texts.size > 0) live.current = new Map(texts);
  }, [texts]);
  usePluginFieldValuePrune(focusables, 'Input', keys => {
    for (const key of keys) live.current.delete(key);
    setTexts(current => deleteSeatKeys(current, keys));
  });
  return useMemo(
    () =>
      createPluginInputMap(focusables, component, requestId, {
        texts,
        setTexts,
        live,
        submitting,
      }),
    [texts, component, requestId, focusables, setTexts],
  );
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

/**
 * densable `FMn(o,i)` — open Select window of `at=8`.
 * `rows = size + (hidden>0 ? 1 : 0)` for the overflow cue line.
 */
export function selectWindow(
  count: number,
  highlight: number,
): { first: number; size: number; hidden: number; rows: number } {
  const first = Math.max(0, highlight - SELECT_WINDOW + 1);
  const size = Math.max(0, Math.min(SELECT_WINDOW, count - first));
  const hidden = count - first - size;
  return { first, size, hidden, rows: size + (hidden > 0 ? 1 : 0) };
}

/**
 * densable `s$=(h,v)=>h===null?0:FMn(v,h.highlight).rows`.
 * Open Select extra rows into band maxHeight (`nr=s$(ts,Gn)`).
 */
export function openListRows(open: { highlight: number } | null, optionCount: number): number {
  return open === null ? 0 : selectWindow(optionCount, open.highlight).rows;
}

function PluginPressButton({
  plugin,
  handle,
  element,
  label,
  hotkey,
  plain,
  dimColor,
  variant,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label: string;
  hotkey?: string;
  plain?: boolean;
  dimColor?: boolean;
  variant?: string;
}): ReactNode {
  const clicked = useContext(ClickedPressContext);
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const hasKeyboardFocus = focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle;
  return (
    <Box
      ref={hasKeyboardFocus ? reportHeldFocus : undefined}
      flexShrink={0}
      alignSelf="flex-start"
      {...(element !== undefined && { elementKey: element, elementPlugin: plugin })}
      onClick={event => {
        if (event.isWindowActivation) return;
        clicked?.({ plugin, handle });
        firePress(plugin, handle);
      }}
    >
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

/** densable `_Ee` owns Input focus in the same closure as y$/m$ — no Mods singleton. */
type BandInputFocusHost = {
  focused: FocusedInput | null;
  setFocused: (next: FocusedInput | null) => void;
};

function landBandInputFocus(
  focusable: DrawingFocusable | null | undefined,
  setInput: (next: FocusedInput | null) => void,
  closeSelect: () => void,
): void {
  if (focusable?.tag === 'Input' && typeof focusable.element === 'string' && focusable.element !== '') {
    closeSelect();
    setInput({
      plugin: focusable.plugin,
      handle: focusable.handle,
      element: focusable.element,
      ...(typeof focusable.value === 'string' && { value: focusable.value }),
    });
    return;
  }
  setInput(null);
}

const FocusedInputContext = createContext<{
  focused: FocusedInput | null;
  setFocused: (next: FocusedInput | null) => void;
} | null>(null);

/** Alias densable `BDe` for local Input/Select field keys. */
const inputFieldKey = pluginInputFieldKey;

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
  const clicked = useContext(ClickedPressContext);
  const fields = useContext(InputFieldsContext);
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const fieldKey = element ?? '';
  const focused =
    focus?.focused !== null &&
    focus?.focused !== undefined &&
    focus.focused.plugin === plugin &&
    focus.focused.handle === handle;
  const hasKeyboardFocus =
    focused || (focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle);
  /** densable `Wt` `h` — `Xjt.textOf(plugin, element) ?? value ?? ""`. */
  const shown = (fields !== null && fieldKey !== '' ? fields.textOf(plugin, fieldKey) : undefined) ?? value ?? '';
  const [cursor, setCursor] = useState(shown.length);
  const { columns: terminalColumns } = useTerminalSize();
  // densable Wt — prefer XXt body columns over full terminal width.
  const bodyColumns = useContext(PaneBodyColumnsContext);
  const columns = bodyColumns ?? terminalColumns;
  useEffect(() => {
    if (focused) setCursor(Number.MAX_SAFE_INTEGER);
  }, [focused]);
  const empty = shown === '';
  const prefix = label === undefined ? '' : `${label}: `;
  const submit = ` ⏎ ${submitLabel ?? 'submit'}`;
  const fieldColumns = Math.max(4, columns - stringWidth(prefix) - stringWidth(submit));
  return (
    <Box
      ref={hasKeyboardFocus ? reportHeldFocus : undefined}
      flexDirection="row"
      flexShrink={0}
      {...(fieldKey !== '' && { elementKey: fieldKey, elementPlugin: plugin })}
      onClick={event => {
        if (event.isWindowActivation) return;
        clicked?.({ plugin, handle });
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
  const clicked = useContext(ClickedPressContext);
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const fieldKey = element ?? '';
  const picked = fields !== null && fieldKey !== '' ? fields.pickedOf(plugin, fieldKey) : undefined;
  const shown = picked ?? value;
  const current = options.find(option => option.value === shown);
  const prefix = label === undefined ? '' : `${label}: `;
  const openRec = fields?.open;
  const isOpen = openRec !== null && openRec !== undefined && openRec.plugin === plugin && openRec.handle === handle;
  const highlight = isOpen ? openRec.highlight : 0;
  const { first, size, hidden } = selectWindow(isOpen ? options.length : 0, highlight);
  const hasKeyboardFocus = focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle;
  return (
    <Box
      ref={hasKeyboardFocus ? reportHeldFocus : undefined}
      flexDirection="column"
      flexShrink={0}
      {...(fieldKey !== '' && { elementKey: fieldKey, elementPlugin: plugin })}
      onClick={event => {
        if (event.isWindowActivation) return;
        clicked?.({ plugin, handle });
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
      elementPlugin={press.plugin}
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

/** densable `to` — Ink Key flags → surface key names. */
const PLUGIN_CLIENT_KEY_NAMES: Array<[keyof Key, string]> = [
  ['upArrow', 'up'],
  ['downArrow', 'down'],
  ['leftArrow', 'left'],
  ['rightArrow', 'right'],
  ['pageUp', 'pageup'],
  ['pageDown', 'pagedown'],
  ['home', 'home'],
  ['end', 'end'],
  ['return', 'return'],
  ['tab', 'tab'],
  ['backspace', 'backspace'],
  ['delete', 'delete'],
];

/**
 * densable `ro` — skip wheel; named key or space; empty input drops.
 */
export function pluginClientKeyFromInput(
  input: string,
  key: Key,
): { key: string; ctrl?: true; shift?: true; meta?: true } | undefined {
  if (key.wheelUp || key.wheelDown) return undefined;
  const named = PLUGIN_CLIENT_KEY_NAMES.find(([flag]) => key[flag])?.[1] ?? (input === ' ' ? 'space' : input);
  if (named === '') return undefined;
  return {
    key: named,
    ...(key.ctrl ? { ctrl: true as const } : {}),
    ...(key.shift ? { shift: true as const } : {}),
    ...(key.meta ? { meta: true as const } : {}),
  };
}

function pluginClientPointerKind(type: MouseActionEvent['type']): 'down' | 'up' | 'move' {
  if (type === 'mousedown') return 'down';
  if (type === 'mouseup') return 'up';
  return 'move';
}

/**
 * densable `eo` — isolate pointer button names. DualInk packs SGR mods in
 * high bits; mask 0x03 so 0/1/2 still map left/middle/right.
 */
export function pluginClientPointerButton(button: number | undefined): 'left' | 'middle' | 'right' | undefined {
  if (button === undefined) return undefined;
  switch (button & 0x03) {
    case 0:
      return 'left';
    case 1:
      return 'middle';
    case 2:
      return 'right';
    default:
      return undefined;
  }
}

function measurePluginClientBox(node: DOMElement | null): { width: number; height: number } {
  if (node === null) return { width: 0, height: 0 };
  return measureElement(node);
}

function PluginClient({
  plugin,
  moduleName,
  elementKey,
  requestId,
  props,
  drawn,
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
  /** densable `o.drawn` — Client node props identity (`x(()=>i.drawnAgain(),[i,o.drawn])`). */
  drawn?: unknown;
  width?: number;
  height?: number;
  flexGrow?: number;
  engine?: ReactNode;
}): ReactNode {
  const instanceRef = useRef<ClientInstance>(DETACHED_CLIENT);
  const [snapshot, setSnapshot] = useState(() => DETACHED_CLIENT.getSnapshot());
  const boxRef = useRef<DOMElement | null>(null);
  const measuredWidth = useYogaMeasure(() => measurePluginClientBox(boxRef.current).width);
  const measuredHeight = useYogaMeasure(() => measurePluginClientBox(boxRef.current).height);
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
    // densable `Xt(()=>{i.laidOut()})` — layout mark, not snapshot-driven.
    instanceRef.current.laidOut();
  });
  useLayoutEffect(() => {
    // densable `x(()=>{i.resize(R,T)},[i,R,T])` — size only; snapshot in this
    // dep list remount-paints in a loop (RootREPLBoundary #185).
    instanceRef.current.resize(measuredWidth, measuredHeight);
  }, [measuredWidth, measuredHeight]);
  useEffect(() => {
    // densable `x(()=>{i.drawnAgain()},[i,o.drawn])` — Client node props identity.
    instanceRef.current.drawnAgain();
  }, [drawn]);
  const isDrawn = snapshot.status === 'drawn';
  // densable `Z` / `i.id` — same key as acquirePluginClient.
  const clientId = clientInstanceKey({
    plugin,
    surface: 'terminal',
    requestId: requestId ?? 'detached',
    key: elementKey ?? '',
  });
  const panesFocusedId = useSyncExternalStore(subscribePanes, () => getPanesState().focusedId);
  const clientHeld =
    useSyncExternalStore(subscribePluginClientFocus, getPluginClientFocusedId, getPluginClientFocusedId) === clientId;
  useEffect(() => {
    // densable oo: pane focusedId + this client held → DQt(null).
    if (panesFocusedId !== null && clientHeld) setPluginClientFocusedId(null);
  }, [panesFocusedId, clientHeld]);
  const clientAway = useCallback(() => {
    clearPluginClientFocusedId(clientId);
  }, [clientId]);
  const clientAwayRef = usePaneClickAway(clientAway);
  useEffect(() => () => clearPluginClientFocusedId(clientId), [clientId]);
  const pointerAt = useRef({ x: 0, y: 0 });
  const acceptsPointer = isDrawn && instanceRef.current.acceptsPointer();
  const acceptsKeys = isDrawn && instanceRef.current.acceptsKeys();
  const pointerLive = acceptsPointer || acceptsKeys;
  const { retainFinePointer } = useApp();
  useEffect(() => {
    // densable fDn(F): retainFinePointer while Client acceptsPointer.
    if (!acceptsPointer) return;
    return retainFinePointer();
  }, [acceptsPointer, retainFinePointer]);
  useInput(
    (input, key, event) => {
      // densable oo `sb`: only while NLe.focusedId===id.
      const live = instanceRef.current;
      if (getPluginClientFocusedId() !== clientId) return;
      if (!live.acceptsKeys()) {
        clientAway();
        return;
      }
      const leave = key.escape || (key.ctrl && (input === 'c' || input === 'd'));
      if (leave) {
        setPluginClientFocusedId(null);
        if (key.escape) event.stopImmediatePropagation();
        return;
      }
      const mapped = pluginClientKeyFromInput(input === '' ? event.input : input, key);
      if (mapped === undefined) return;
      live.key(mapped);
      event.stopImmediatePropagation();
    },
    { isActive: clientHeld, prepend: true },
  );
  const firePointer = (kind: 'down' | 'up' | 'move' | 'enter' | 'leave', event?: MouseActionEvent): void => {
    const live = instanceRef.current;
    if (kind === 'down' && live.acceptsKeys()) {
      focusPane(null);
      setPluginClientFocusedId(clientId);
    }
    const x = event?.localCol ?? pointerAt.current.x;
    const y = event?.localRow ?? pointerAt.current.y;
    pointerAt.current = { x, y };
    const namedButton = pluginClientPointerButton(event?.button);
    live.pointer({
      type: kind,
      x,
      y,
      ...(namedButton !== undefined ? { button: namedButton } : {}),
      ...(event?.shift ? { shift: true } : {}),
      ...(event?.alt ? { alt: true } : {}),
      ...(event?.ctrl ? { ctrl: true } : {}),
      ...(event?.fine ? { fine: { x: event.fine.col, y: event.fine.row } } : {}),
    });
  };
  const clientResetKey = snapshot.status === 'failed' ? `failed:${snapshot.text}` : snapshot.status;
  const clientFallback = (
    <Box
      flexShrink={0}
      overflow="hidden"
      {...(width !== undefined && { width })}
      {...(height !== undefined && { height })}
      {...(flexGrow !== undefined && { flexGrow })}
    >
      <Text> </Text>
    </Box>
  );
  return (
    <PaneErrorBoundary
      resetKey={clientResetKey}
      onError={error => {
        instanceRef.current.threw(error);
      }}
      fallback={clientFallback}
    >
      <Box
        ref={node => {
          boxRef.current = node;
          clientAwayRef.current = node;
        }}
        flexDirection="column"
        flexShrink={0}
        overflow="hidden"
        {...(elementKey !== undefined && { elementKey, elementPlugin: plugin })}
        {...(width !== undefined && { width })}
        {...(height !== undefined && { height })}
        {...(flexGrow !== undefined && { flexGrow })}
        {...(pointerLive
          ? {
              onPointer: (event: MouseActionEvent) => firePointer(pluginClientPointerKind(event.type), event),
              onMouseEnter: () => {
                instanceRef.current.pointer({ type: 'enter', ...pointerAt.current });
              },
              onMouseLeave: () => {
                instanceRef.current.pointer({ type: 'leave', ...pointerAt.current });
              },
            }
          : {})}
      >
        {isDrawn ? (
          <DrawingNode node={snapshot.tree} plugin={plugin} requestId={requestId} index={0} engine={engine} />
        ) : null}
        {snapshot.status === 'failed' && (
          <Text dimColor wrap="truncate-end">
            {snapshot.text}
          </Text>
        )}
      </Box>
    </PaneErrorBoundary>
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
        element={key}
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
        drawn={props}
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
      <Box
        key={live ? String(key) : undefined}
        flexDirection="column"
        elementKey={String(key)}
        elementPlugin={owner}
        {...layoutFrom(layoutProps)}
      >
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
    const abort = new AbortController();
    void evaluateUiRender(current, abort.signal).then(
      tree => {
        if (!abort.signal.aborted) setDrawn(isEngineDrawing(tree) ? undefined : tree);
      },
      err => {
        // densable `mr` — site failed log then engine fallback (`RZ`).
        logForDebugging(
          `ui.render (${String(current.component)} ${String(current.requestId ?? '')}): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!abort.signal.aborted) setDrawn(undefined);
      },
    );
    return () => {
      abort.abort();
    };
  }, [inputKey, version]);
  return drawn;
}

function PluginSiteFields({
  children,
  site = 'Pane',
  requestId,
  focusables,
  selectSeat,
  inputSeat,
  inputFocusHost,
}: {
  children: ReactNode;
  /** densable `$q` `XP(focusable, site)` — Pane vs AbovePrompt. */
  site?: 'Pane' | 'AbovePrompt';
  /** densable `kL` requestId — Pane id or above-prompt. */
  requestId?: string;
  focusables?: readonly DrawingFocusable[];
  /** densable `_Ee`/`pee` lifted y$ — same object as g$ `fr`. */
  selectSeat: PluginSelectSeat;
  /** densable `_Ee`/`pee` lifted m$ — same object as g$ `rr`/`inputs`. */
  inputSeat: PluginInputMapApi;
  /** densable `_Ee` Input focus — parent ring land, not a process bridge. */
  inputFocusHost?: BandInputFocusHost;
}): ReactNode {
  const ySelect = selectSeat;
  const open = ySelect.fields.open;
  const [localFocused, setLocalFocused] = useState<FocusedInput | null>(null);
  const focused = inputFocusHost !== undefined ? inputFocusHost.focused : localFocused;
  const setFocused = inputFocusHost?.setFocused ?? setLocalFocused;
  const fieldsRef = useRef<InputFields | null>(null);
  const selectRef = useRef<SelectFields | null>(null);
  const focusedRef = useRef(focused);
  focusedRef.current = focused;
  const fields: InputFields = {
    textOf: inputSeat.fields.textOf,
    edit: inputSeat.fields.edit,
    textNow: inputSeat.textNow,
    submit: inputSeat.submit,
  };
  const select: SelectFields = {
    pickedOf: ySelect.fields.pickedOf,
    open,
    toggle: ySelect.toggle,
    move: ySelect.move,
    typeahead: ySelect.typeahead,
    close: ySelect.close,
    focusedSelect: ySelect.focusedSelect,
    focus: ySelect.focus,
    unfocus: ySelect.unfocus,
  };
  fieldsRef.current = fields;
  selectRef.current = select;
  // densable `nr=s$(ts,Gn)` — open Select extra rows into *band* maxHeight.
  // Gold `_Ee` only; Pane Select must not bump the AbovePrompt store.
  const openOptionCount = open?.options.length ?? 0;
  useEffect(() => {
    if (site !== 'AbovePrompt') return;
    setOpenListRows(openListRows(open, openOptionCount));
    return () => setOpenListRows(0);
  }, [open, openOptionCount, site]);
  const focusApi = useMemo(
    () => ({
      focused,
      setFocused: (next: FocusedInput | null) => {
        if (next !== null) ySelect.close();
        setFocused(next);
      },
    }),
    [focused, setFocused, ySelect],
  );
  const keys = useOptionalKeybindingContext();
  const fieldHeld = focused !== null || open !== null || ySelect.focusedSelect !== null;
  const renderedFocus = useRef({ focused, select: ySelect.focusedSelect });
  useEffect(() => {
    renderedFocus.current = { focused, select: ySelect.focusedSelect };
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
        // densable y$.intercept → g$ selectKeys (site usePluginBandKeys + local useInput).
        if (ySelect.intercept(input, key)) {
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

function PluginSiteFieldsOwned({
  children,
  site = 'Pane',
  requestId,
  focusables,
  selectRing,
}: {
  children: ReactNode;
  site?: 'Pane' | 'AbovePrompt';
  requestId?: string;
  focusables?: readonly DrawingFocusable[];
  selectRing?: PluginSelectSeatRing;
}): ReactNode {
  const seatRequestId = requestId ?? (site === 'AbovePrompt' ? BAND_REQUEST_ID : 'Pane');
  const selectSeat = usePluginSelectSeat(focusables, site, seatRequestId, selectRing);
  const inputSeat = usePluginInputSeat(focusables, site, seatRequestId);
  return (
    <PluginSiteFields
      site={site}
      requestId={requestId}
      focusables={focusables}
      selectSeat={selectSeat}
      inputSeat={inputSeat}
    >
      {children}
    </PluginSiteFields>
  );
}

function rebuild(
  drawn: unknown,
  plugin: string,
  requestId: string,
  engine?: ReactNode,
  site: 'Pane' | 'AbovePrompt' = 'Pane',
  focusables?: readonly DrawingFocusable[],
  selectSeat?: PluginSelectSeat,
  inputSeat?: PluginInputMapApi,
  inputFocusHost?: BandInputFocusHost,
): ReactNode {
  if (drawn === undefined || isEngineDrawing(drawn)) return engine ?? null;
  const node = <DrawingNode node={drawn} plugin={plugin} requestId={requestId} index={0} engine={engine} />;
  if (selectSeat !== undefined && inputSeat !== undefined) {
    return (
      <PluginSiteFields
        site={site}
        requestId={requestId}
        focusables={focusables}
        selectSeat={selectSeat}
        inputSeat={inputSeat}
        inputFocusHost={inputFocusHost}
      >
        {node}
      </PluginSiteFields>
    );
  }
  return (
    <PluginSiteFieldsOwned site={site} requestId={requestId} focusables={focusables}>
      {node}
    </PluginSiteFieldsOwned>
  );
}

/**
 * densable `cv` / `Zq` / QT gate: light host around pee.
 * Gold QT: `if(!(N!==void 0&&h.rows>0&&h.columns>0))return null` then mount pee.
 * Empty REPL hosts must NOT run pee hooks — that boot #185 under RootREPLBoundary.
 */
export type PluginPaneSiteProps = {
  fill?: boolean;
  columns?: number;
  rows?: number;
  /** densable mee `working` — skip Esc-close while a turn is in flight. */
  isWorking?: boolean;
  /** densable mee `Ne.getState().value!==""` — skip Esc-close while prompt has text. */
  promptEmpty?: boolean;
  /** densable mee `queueEditIndex!==null`. */
  queueEditing?: boolean;
  /**
   * densable mee `promptOwnsEscape` / draft `inputOwnsEscape`.
   * Gold: vim || history/help overlay || mode!=="prompt" || queue || poppable.
   */
  promptOwnsEscape?: boolean;
  /** densable pee `Ie` — RowGrip hover lights inline round-border top. */
  lit?: boolean;
};

/**
 * densable `Mee` — dock row host. `he=$l(Js(ref).height)` then QT
 * `rows:he, fill:!0`. First frame he=0 → QT gate keeps pee unmounted.
 */
export function PluginPaneDockHost({
  width,
  isWorking = false,
  promptEmpty = true,
  queueEditing = false,
  promptOwnsEscape = false,
  onResize,
  onSettle,
}: {
  width: number;
  isWorking?: boolean;
  promptEmpty?: boolean;
  queueEditing?: boolean;
  promptOwnsEscape?: boolean;
  onResize: (next: number) => number;
  onSettle: () => void;
}): ReactNode {
  const hostRef = useRef<DOMElement | null>(null);
  const hostRows = useYogaMeasure(() => measurePluginClientBox(hostRef.current).height);
  if (width <= 0) return null;
  const columns = Math.max(0, width - DOCK_GRIP_COLUMNS);
  return (
    <Box ref={hostRef} flexGrow={1} flexDirection="row" width={width}>
      <PluginDockGrip columns={width} onResize={onResize} onSettle={onSettle} />
      <Box flexGrow={1} flexDirection="column" width={columns}>
        <PluginPaneSite
          fill
          columns={columns}
          rows={hostRows}
          isWorking={isWorking}
          promptEmpty={promptEmpty}
          queueEditing={queueEditing}
          promptOwnsEscape={promptOwnsEscape}
        />
      </Box>
    </Box>
  );
}

export function PluginPaneSite({
  fill = false,
  columns,
  rows,
  isWorking = false,
  promptEmpty = true,
  queueEditing = false,
  promptOwnsEscape = false,
  lit = false,
}: PluginPaneSiteProps = {}): ReactNode {
  const shownId = useSyncExternalStore(subscribePanes, () => getPanesState().shownId);
  const pane = shownId === null ? undefined : getShownPluginPane();
  const { addNotification } = useNotifications();
  const paneId = pane?.id;
  const resetKey = useSyncExternalStore(
    subscribePanes,
    () => (paneId === undefined ? '0' : `${paneId} ${getPaneRemountGeneration(paneId)}`),
    () => '0',
  );
  // densable QT: `x(()=>{if(M)u3(null)},[M])` + unmount `u3(null)`.
  const dialogOpen = useHasOpenDialogs();
  useEffect(() => {
    if (dialogOpen) focusPane(null);
  }, [dialogOpen]);
  useEffect(() => () => focusPane(null), []);
  // densable QT: `if(!(N!==void 0&&h.rows>0&&h.columns>0))return null` then pee.
  // Host rows/columns only — never fall back to pane.rows/columns.
  if (pane === undefined) return null;
  if (!((rows ?? 0) > 0 && (columns ?? 0) > 0)) return null;
  const onPaneDrawError = (error: Error): void => {
    // densable BO onError: u3(null) + l8e(id,{kind:"unload"}) + Jmn toast.
    focusPane(null);
    void closePluginPane(pane.id, { kind: 'unload' });
    addNotification({
      key: `pane-threw-while-drawn:${pane.id}`,
      text: `ui.render (Pane) threw while drawn: ${error.message}; the pane was closed`,
      priority: 'immediate',
      kind: 'warning',
      color: 'error',
    });
  };
  // densable QT: BO wraps pee (gate then e(BO,{children:e(pee,...)})).
  return (
    <PaneErrorBoundary key={resetKey} resetKey={resetKey} onError={onPaneDrawError}>
      <PluginPaneSiteBody
        fill={fill}
        columns={columns}
        rows={rows}
        isWorking={isWorking}
        promptEmpty={promptEmpty}
        queueEditing={queueEditing}
        promptOwnsEscape={promptOwnsEscape}
        lit={lit}
        pane={pane}
      />
    </PaneErrorBoundary>
  );
}

type ShownPluginPane = NonNullable<ReturnType<typeof getShownPluginPane>>;

/**
 * densable `pee` — Pane body. Only mounted when QT gate passes.
 */
function PluginPaneSiteBody({
  fill = false,
  columns,
  rows,
  isWorking = false,
  promptEmpty = true,
  queueEditing = false,
  promptOwnsEscape = false,
  lit = false,
  pane,
}: PluginPaneSiteProps & { pane: ShownPluginPane }): ReactNode {
  const shownId = pane.id;
  const focusedId = useSyncExternalStore(subscribePanes, () => getPanesState().focusedId);
  const paneIdRef = useRef(pane.id);
  paneIdRef.current = pane.id;
  const [paneFocusIndex, setPaneFocusIndex] = useState<number | null>(null);
  const paneFocusIndexRef = useRef(paneFocusIndex);
  paneFocusIndexRef.current = paneFocusIndex;
  const [focusPlaceBump, setFocusPlaceBump] = useState(0);
  const bumpFocusPlace = useCallback(() => setFocusPlaceBump(n => n + 1), []);
  const landPaneFocusIndex = useCallback(
    (index: number | null) => {
      setPaneFocusIndex(index);
      bumpFocusPlace();
    },
    [bumpFocusPlace],
  );
  const paneContentRef = useRef<DOMElement | null>(null);
  const dockHostRef = useRef<DOMElement | null>(null);
  const heldFocusRef = useRef<{ node: DOMElement; index: number } | null>(null);
  const [focusTop, setFocusTop] = useState(-1);
  const [focusBottom, setFocusBottom] = useState(-1);
  const [paneTreeRows, setPaneTreeRows] = useState(0);
  const [dockHostRows, setDockHostRows] = useState(0);
  const panePluginRef = useRef(pane.plugin);
  panePluginRef.current = pane.plugin;
  const viewingAgentView = useViewingAgentView();
  const openCount = useSyncExternalStore(subscribePanes, () => getPanesState().open.length);
  const titleChromeRows = paneTitleChromeRows(openCount > 1, fill);
  // densable `Ao=max(0,Pe-lL(ro,io))` — chrome-subtracted allocation (clip only).
  // Dock fill: measure the flex host (not the full terminal) then subtract chrome.
  const paneAllocated =
    rows !== undefined
      ? Math.max(0, rows - titleChromeRows)
      : fill && dockHostRows > 0
        ? Math.max(0, dockHostRows - titleChromeRows)
        : (pane.rows ?? (pane.bodyRows > 0 ? pane.bodyRows : 0));
  // densable `ao=Me?Ao:Math.min(Ao,pt)` — yEe bodyRows / maxOffset only.
  // pt=0 first layout → inline ao=0; clip stays on Ao so measure can grow.
  const paneViewport = fill ? paneAllocated : Math.min(paneAllocated, paneTreeRows);
  const paneMaxOffset = Math.max(0, paneTreeRows - paneViewport);
  // densable pee `qo=yEe({component:"Pane",...})` — local offset / place / scrollBy.
  const {
    offset: paneScrollOffset,
    placed: panePlaced,
    place: panePlace,
    scrollBy: paneScrollBy,
  } = useBandScrollPlace({
    component: 'Pane',
    requestId: pane.id,
    plugin: pane.plugin,
    bodyRows: paneViewport,
    contentRows: paneTreeRows,
    maxOffset: paneMaxOffset,
  });
  const input = {
    surface: 'terminal',
    component: 'Pane',
    requestId: pane.id,
    props: {
      title: pane.title,
      isFocused: pane.isFocused,
      bodyColumns: pane.columns,
      placement: fill ? 'dock' : 'inline',
      scroll: { offset: paneScrollOffset, bodyRows: paneViewport },
      view: viewingAgentView,
    },
  };
  const drawn = useRenderDrawing(
    input,
    `${pane.id}\0${pane.title}\0${String(pane.isFocused)}\0${String(pane.columns)}\0${String(paneScrollOffset)}\0${String(paneViewport)}\0${fill ? 'dock' : 'inline'}\0${JSON.stringify(viewingAgentView)}`,
  );
  useLayoutEffect(() => {
    const contentH = paneContentRef.current?.yogaNode?.getComputedHeight() ?? 0;
    setPaneTreeRows(prev => (prev === contentH ? prev : contentH));
    if (fill) {
      const hostH = dockHostRef.current?.yogaNode?.getComputedHeight() ?? 0;
      setDockHostRows(prev => (prev === hostH ? prev : hostH));
    }
    const top = heldFocusEdge(
      {
        held: heldFocusRef.current,
        index: paneFocusIndex,
        content: paneContentRef.current,
      },
      'top',
    );
    const bottom = heldFocusEdge(
      {
        held: heldFocusRef.current,
        index: paneFocusIndex,
        content: paneContentRef.current,
      },
      'bottom',
    );
    setFocusTop(prev => (prev === top ? prev : top));
    setFocusBottom(prev => (prev === bottom ? prev : bottom));
  });
  useEffect(() => {
    registerPluginScrollSite(pane.plugin, pane.id, 'Pane', {
      offset: paneScrollOffset,
      bodyRows: paneViewport,
      contentRows: paneTreeRows,
      maxOffset: paneMaxOffset,
    });
    return () => {
      unregisterPluginScrollSite(panePluginRef.current ?? pane.plugin, pane.id);
    };
  }, [pane.plugin, pane.id]);
  useEffect(() => {
    updatePluginScrollSite(pane.plugin, pane.id, {
      offset: paneScrollOffset,
      bodyRows: paneViewport,
      contentRows: paneTreeRows,
      maxOffset: paneMaxOffset,
    });
  }, [pane.plugin, pane.id, paneScrollOffset, paneViewport, paneTreeRows, paneMaxOffset]);
  // densable pee `if(To>So)an(()=>So)`.
  useEffect(() => {
    if (panePlaced > paneMaxOffset) panePlace(() => paneMaxOffset);
  }, [panePlaced, paneMaxOffset, panePlace]);
  // densable pee `if(rr>=0)an(is=>OMr(...))`.
  useEffect(() => {
    if (focusTop < 0) return;
    panePlace(prev =>
      nearestScrollOffset({
        offset: prev,
        bodyRows: paneViewport,
        top: focusTop,
        bottom: focusBottom,
      }),
    );
  }, [focusTop, focusBottom, paneViewport, focusPlaceBump, panePlace]);
  const reportHeldFocusNode = useCallback((node: DOMElement | null) => {
    const index = paneFocusIndexRef.current;
    heldFocusRef.current = node !== null && index !== null ? { node, index } : null;
  }, []);
  const paneFocusables = useMemo(() => focusablesOfDrawing(drawn), [pane, drawn]);
  // densable `h$` — prune with ht(null), not Un/land (no Vt place bump).
  useEffect(() => {
    if (paneFocusIndex !== null && paneFocusIndex >= paneFocusables.length) {
      setPaneFocusIndex(null);
    }
  }, [paneFocusIndex, paneFocusables.length]);
  const [engineHeld, setEngineHeld] = useState<number | null>(null);
  const engineHeldRef = useRef<number | null>(null);
  engineHeldRef.current = engineHeld;
  // densable `N` / `bn`: isHeld from render; isHeldNow reads live focusedId.
  const paneHeld = focusedId === pane.id;
  const paneIsHeldNow = (): boolean => {
    const id = paneIdRef.current;
    return id !== undefined && getPanesState().focusedId === id;
  };
  const paneHost = usePluginFocusHost({
    component: 'Pane',
    requestId: pane.id,
    owner: pane.plugin,
    focusables: paneFocusables,
    isHeld: paneHeld,
    isHeldNow: paneIsHeldNow,
    indexNow: () => paneFocusIndexRef.current,
    isEmptyNow: () => paneFocusIndexRef.current === null && engineHeldRef.current === null,
    land: landPaneFocusIndex,
  });
  const focusedTag = typeof paneFocusIndex === 'number' ? (paneFocusables[paneFocusIndex]?.tag ?? null) : null;
  const inputFocused = paneHeld && focusedTag === 'Input';
  const selectFocused = paneHeld && focusedTag === 'Select';
  const paneRingActive = paneHeld && !inputFocused && !selectFocused;
  const paneFieldActive = inputFocused || selectFocused;
  const paneRingContext = pluginFieldContext(focusedTag ?? undefined, 'Pane');
  const openKey = useSyncExternalStore(subscribePanes, () =>
    getPanesState()
      .open.map(row => `${row.id}\0${row.title}`)
      .join('|'),
  );
  const openPanes = useMemo(() => getPanesState().open, [openKey]);
  const otherTabs = useMemo(
    () => (openCount > 1 ? openPanes.filter(row => row.id !== pane.id) : []),
    [openCount, openPanes, pane],
  );
  const tabCount = otherTabs.length;
  const closeMarkHeld = engineHeld === tabCount;
  const heldTabId = engineHeld !== null && engineHeld < tabCount ? (otherTabs[engineHeld]?.id ?? null) : null;
  // densable pee `x(()=>{if(!N)ht(null),Rt(null)},[N])` — clear without Un/Vt.
  // Boot hosts mount PluginPaneSite with shownId=null → paneHeld=false forever;
  // landPaneFocusIndex(null) would bump focusPlace every effect and #185.
  useEffect(() => {
    if (!paneHeld) {
      setPaneFocusIndex(null);
      setEngineHeld(null);
      heldFocusRef.current = null;
    }
  }, [paneHeld]);
  const focusByPerson = useCallback(
    (index: number) => {
      const id = paneIdRef.current;
      if (id === undefined) return;
      focusPane(id);
      paneHost.moveByPerson({
        index,
        apply: () => landPaneFocusIndex(index),
      });
    },
    [paneHost, landPaneFocusIndex],
  );
  // densable pee Jt — ht(null)+Rt(null)+u3(null); no Un/Vt place bump on clear.
  const clearPaneFocusLocal = useCallback(() => {
    setPaneFocusIndex(null);
    setEngineHeld(null);
    heldFocusRef.current = null;
  }, []);
  const clickAway = useCallback(() => {
    const id = paneIdRef.current;
    if (id !== undefined && getPanesState().focusedId === id) {
      clearPaneFocusLocal();
      focusPane(null);
    }
  }, [clearPaneFocusLocal]);
  const paneAwayRef = usePaneClickAway(clickAway);
  const paneWheelAccel = useRef<WheelAccelState | null>(null);
  const paneWheelProfile = useRef<WheelProfile | null>(null);
  const shownIdRef = useRef(shownId);
  useEffect(() => {
    // densable QT is keyed by pane id — tab switch unmounts → u3(null).
    // Local PluginPaneSite stays mounted; drop focus only on real tab switch
    // (not first open / last close).
    const prev = shownIdRef.current;
    shownIdRef.current = shownId;
    if (prev !== null && shownId !== null && prev !== shownId) clickAway();
  }, [shownId, clickAway]);
  const leavePaneRing = useCallback(() => {
    paneHost.forget();
    clearPaneFocusLocal();
    const id = paneIdRef.current;
    if (id === undefined) return;
    if (getShownPluginPane()?.closeOnEscape === true) {
      void closePluginPane(id, { kind: 'person' });
      return;
    }
    focusPane(null);
  }, [paneHost, clearPaneFocusLocal]);
  const clickedPress = useMemo(() => clickFocusByPress(paneFocusables, focusByPerson), [paneFocusables, focusByPerson]);
  const paneRing = useMemo(() => {
    const base = bandRingHandlers({
      focusables: paneFocusables,
      focusIndexNow: () => paneFocusIndexRef.current,
      focusByPerson,
      leave: leavePaneRing,
    });
    return wrapPluginFocusActs(
      paneHost,
      extendPaneRingWithCloseMark({
        ring: base,
        focusablesCount: paneFocusables.length,
        focusIndexNow: () => paneFocusIndexRef.current,
        engineHeldNow: () => engineHeldRef.current,
        holdEngine: setEngineHeld,
        setIndex: landPaneFocusIndex,
        moveByPerson: paneHost.moveByPerson,
        leave: leavePaneRing,
        close: () => {
          const id = paneIdRef.current;
          if (id !== undefined) void closePluginPane(id, { kind: 'person' });
        },
        tabs: otherTabs,
        pick: showPane,
      }),
      ['abovePrompt:leave'],
    );
  }, [paneFocusables, paneHost, focusByPerson, leavePaneRing, otherTabs]);
  useRegisterKeybindingContext('Pane', paneRingActive);
  useRegisterKeybindingContext('PaneField', paneFieldActive);
  useRegisterKeybindingContext('AbovePromptInput', inputFocused);
  useRegisterKeybindingContext('AbovePromptSelect', selectFocused);
  const ringLive = paneHeld && (paneFocusables.length > 0 || engineHeld !== null);
  useKeybinding('abovePrompt:next', paneRing['abovePrompt:next'], {
    context: paneRingContext,
    isActive: ringLive,
  });
  useKeybinding('abovePrompt:previous', paneRing['abovePrompt:previous'], {
    context: paneRingContext,
    isActive: ringLive,
  });
  useKeybinding('abovePrompt:press', paneRing['abovePrompt:press'], {
    context: paneRingContext,
    isActive: paneHeld && (paneFocusIndex !== null || engineHeld !== null),
  });
  useKeybinding('abovePrompt:leave', paneRing['abovePrompt:leave'], {
    context: paneRingContext,
    isActive: paneHeld && (paneFocusIndex !== null || engineHeld !== null),
  });
  const paneRenderedFocusIndex = useRef(paneFocusIndex);
  useEffect(() => {
    paneRenderedFocusIndex.current = paneFocusIndex;
  });
  // densable pee `hn` — last painted engine tab (dn()!==hn).
  const paneRenderedEngineHeld = useRef(engineHeld);
  useEffect(() => {
    paneRenderedEngineHeld.current = engineHeld;
  });
  // densable pee `fr=y$({...})` / `rr=m$({...})` — same objects as SiteFields / g$.
  const paneSelect = usePluginSelectSeat(paneFocusables, 'Pane', pane.id, {
    focusIndex: paneFocusIndex,
    focusIndexNow: () => paneFocusIndexRef.current,
    setFocusIndex: next => {
      landPaneFocusIndex(typeof next === 'number' ? next : null);
    },
    working: isWorking,
  });
  const paneInput = usePluginInputSeat(paneFocusables, 'Pane', pane.id);
  const paneKeysBag = useMemo<PluginBandKeysBag>(
    () => ({
      // densable pee `bn()!==N||Ln()!==eo||dn()!==hn`
      isAhead: () =>
        paneIsHeldNow() !== paneHeld ||
        paneFocusIndexRef.current !== paneRenderedFocusIndex.current ||
        engineHeldRef.current !== paneRenderedEngineHeld.current,
      contextNow: () => {
        if (paneFocusIndexRef.current === null) return null;
        return pluginFieldContext(focusableAt(paneFocusables, paneFocusIndexRef.current)?.tag, 'Pane');
      },
      focusedNow: () => focusableAt(paneFocusables, paneFocusIndexRef.current),
      contextRendered: () => {
        if (paneRenderedFocusIndex.current === null) return null;
        return pluginFieldContext(paneFocusables[paneRenderedFocusIndex.current]?.tag, 'Pane');
      },
      focusedRendered: () =>
        typeof paneRenderedFocusIndex.current === 'number'
          ? (paneFocusables[paneRenderedFocusIndex.current] ?? null)
          : null,
      handlers: {
        Pane: paneRing,
        AbovePromptInput: paneRing,
        AbovePromptSelect: { ...paneRing, ...paneSelect.handlers },
      },
      inputs: {
        textNow: paneInput.textNow,
        fields: paneInput.fields,
      },
      selectKeys: (input, key) => paneSelect.intercept(input, key),
    }),
    [paneFocusables, paneRing, paneSelect, paneInput, paneHeld],
  );
  usePluginBandKeys(paneKeysBag, { isActive: paneHeld });
  // densable iee/mEe: pixel scroll via yEe scrollBy when maxOffset>0;
  // aee We focus-cycle only when the pane is not scrollable.
  const panePixelActive = paneHeld && paneMaxOffset > 0;
  useKeybinding('pane:scrollUp', () => paneScrollBy(-1), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:scrollDown', () => paneScrollBy(1), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:pageUp', () => paneScrollBy(-Math.max(1, paneViewport)), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:pageDown', () => paneScrollBy(Math.max(1, paneViewport)), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:top', () => paneScrollBy(-paneTreeRows), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:bottom', () => paneScrollBy(paneTreeRows), {
    context: 'Pane',
    isActive: panePixelActive,
  });
  useKeybinding('pane:scrollUp', paneRing['pane:scrollUp'], {
    context: 'Pane',
    isActive: paneRingActive && paneFocusables.length > 0 && paneMaxOffset === 0,
  });
  useKeybinding('pane:scrollDown', paneRing['pane:scrollDown'], {
    context: 'Pane',
    isActive: paneRingActive && paneFocusables.length > 0 && paneMaxOffset === 0,
  });
  const hotkeys = useMemo(() => hotkeyMapOfDrawing(drawn), [drawn]);
  useInput(
    (input, key, event) => {
      const hits = resolveHotkeyPresses(input, key, hotkeys);
      if (hits.length === 0) return;
      for (const hit of hits) firePress(hit.plugin, hit.handle);
      event.stopImmediatePropagation();
    },
    { isActive: paneRingActive && hotkeys.size > 0, prepend: true },
  );
  useKeybinding(
    'pane:next',
    () => {
      const next = cycleShownPaneId(1);
      if (next !== null) showPane(next);
    },
    { context: 'Global', isActive: openCount > 1 },
  );
  useKeybinding(
    'pane:previous',
    () => {
      const next = cycleShownPaneId(-1);
      if (next !== null) showPane(next);
    },
    { context: 'Global', isActive: openCount > 1 },
  );
  const closingNow = useSyncExternalStore(subscribePanes, () => getPanesState().closing.includes(pane.id));
  // densable mee overlay gates: zCe=dialogStore.open.length>0, u7t=overlay,
  // viewSelectionMode==="viewing-agent", footerSelection!==null,
  // promptOwnsEscape = draft.inputOwnsEscape (REPL host).
  const dialogOpen = useHasOpenDialogs();
  const overlayActive = useIsOverlayActive();
  const viewingAgent = useAppState(s => s.viewSelectionMode === 'viewing-agent');
  const footerSelected = useAppState(s => s.footerSelection !== null);
  useKeybinding(
    'chat:cancel',
    () => {
      const id = paneIdRef.current;
      if (id === undefined) return false;
      void closePluginPane(id, { kind: 'person' });
      return;
    },
    {
      context: 'Chat',
      prepend: true,
      isActive:
        pane.closeOnEscape === true &&
        !paneHeld &&
        !isWorking &&
        promptEmpty &&
        !queueEditing &&
        !closingNow &&
        !promptOwnsEscape &&
        !dialogOpen &&
        !overlayActive &&
        !viewingAgent &&
        !footerSelected,
    },
  );
  const node = rebuild(drawn, pane.plugin, pane.id, undefined, 'Pane', paneFocusables, paneSelect, paneInput);
  if (node === null) return null;
  const focusedPress =
    typeof paneFocusIndex === 'number'
      ? (() => {
          const row = paneFocusables[paneFocusIndex];
          return row === undefined ? null : { plugin: row.plugin, handle: row.handle };
        })()
      : null;
  const paneBodyColumns =
    (columns ?? pane.columns) !== undefined
      ? fill
        ? (columns ?? pane.columns ?? 0)
        : Math.max(0, (columns ?? pane.columns ?? 0) - INLINE_PANE_CHROME_COLUMNS)
      : null;
  return (
    <ClickedPressContext.Provider value={clickedPress}>
      <FocusedPressContext.Provider value={focusedPress}>
        <HeldFocusRefContext.Provider value={reportHeldFocusNode}>
          <PaneBodyColumnsContext.Provider value={paneBodyColumns}>
            <Box
              ref={node => {
                paneAwayRef.current = node;
                dockHostRef.current = node;
              }}
              position="relative"
              flexShrink={0}
              flexGrow={fill ? 1 : 0}
              flexDirection="column"
              overflow="hidden"
              selectionScope
              onWheel={
                dialogOpen
                  ? undefined
                  : (event: WheelEvent) => {
                      // densable gEe(yEe, dEe) — scrollBy via local Me; no paneWheelScroll bypass.
                      const sign: 1 | -1 = event.deltaY < 0 ? -1 : 1;
                      const rows = computeWheelStep(
                        ensurePaneWheelAccel(paneWheelAccel, paneWheelProfile),
                        sign,
                        performance.now(),
                      );
                      if (rows === 0) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                      }
                      paneScrollBy(sign * rows);
                      event.preventDefault();
                      event.stopPropagation();
                    }
              }
              onClick={() => {
                // densable hs: skip person-focus while a dialog is open (`l1`).
                if (dialogOpen) return;
                focusPane(pane.id);
              }}
              {...((columns ?? pane.columns) !== undefined && { width: columns ?? pane.columns })}
              {...(rows !== undefined ? { height: rows } : {})}
              {...(!fill && rows === undefined && (pane.bodyRows > 0 ? pane.bodyRows : pane.rows) !== undefined
                ? { height: pane.bodyRows > 0 ? pane.bodyRows : pane.rows }
                : {})}
            >
              <Box
                flexDirection="column"
                flexShrink={0}
                selectionScope
                {...(!fill && {
                  borderStyle: 'round',
                  borderDimColor: !paneHeld,
                  borderTopDimColor: !paneHeld && !lit,
                  borderTopColor: lit ? 'suggestion' : undefined,
                  paddingX: 1,
                })}
                {...((columns ?? pane.columns) !== undefined && {
                  width: fill
                    ? (columns ?? pane.columns)
                    : Math.max(0, (columns ?? pane.columns ?? 0) - INLINE_PANE_CHROME_COLUMNS),
                })}
              >
                {openCount > 1 ? (
                  <PluginPaneTitleStrip
                    open={openPanes}
                    shownId={pane.id}
                    heldId={heldTabId}
                    columns={
                      fill
                        ? Math.max(0, (columns ?? pane.columns ?? 0) - CLOSE_MARK_COLUMNS - MARK_EDGE_COLUMNS)
                        : Math.max(0, (columns ?? pane.columns ?? 0) - INLINE_PANE_CHROME_COLUMNS)
                    }
                    onPick={showPane}
                  />
                ) : fill ? (
                  <Box flexShrink={0} height={1} />
                ) : null}
                {/* densable pee clip: height:fill?Ao, maxHeight:Ao, overflowY:hidden > fEe(offset). */}
                <Box
                  flexDirection="column"
                  flexShrink={fill ? 1 : 0}
                  flexGrow={fill ? 1 : 0}
                  {...(fill ? { height: paneAllocated } : {})}
                  maxHeight={paneAllocated}
                  overflowY="hidden"
                >
                  <Box
                    flexDirection="column"
                    flexShrink={0}
                    marginTop={-paneScrollOffset}
                    marginRight={0}
                    ref={node => {
                      paneContentRef.current = node;
                      bindPluginScrollSiteLayout(pane.plugin, pane.id, node, 'Pane');
                    }}
                  >
                    {node}
                  </Box>
                </Box>
              </Box>
              <PluginPaneCloseMark
                inset={fill ? MARK_EDGE_COLUMNS : BORDER_MARK_INSET}
                isHeld={closeMarkHeld}
                onClose={() => {
                  void closePluginPane(pane.id, { kind: 'person' });
                }}
              />
            </Box>
          </PaneBodyColumnsContext.Provider>
        </HeldFocusRefContext.Provider>
      </FocusedPressContext.Provider>
    </ClickedPressContext.Provider>
  );
}

/**
 * densable `dAe`: `nWt(xI("AbovePrompt", factory, deps), () => null)`.
 * Lives immediately above PromptInput — gold's site, not a drawing dump.
 */
export function PluginAbovePromptSite({
  isWorking,
  hasSurvey = false,
  promptEmpty = true,
}: {
  isWorking: boolean;
  hasSurvey?: boolean;
  /** densable JW `Un===""` — prompt draft empty (REPL `inputValue === ''`). */
  promptEmpty?: boolean;
}): ReactNode {
  const { columns, rows } = useTerminalSize();
  const { addNotification } = useNotifications();
  const [aboveResetKey, setAboveResetKey] = useState(0);
  const bandCollapsed = useBandCollapsed();
  const panesFocusRequest = useSyncExternalStore(subscribePanes, () => getPanesState().focusRequest);
  const contentRef = useRef<DOMElement | null>(null);
  const heldFocusRef = useRef<{ node: DOMElement; index: number } | null>(null);
  const [focusPlaceBump, setFocusPlaceBump] = useState(0);
  const [focusTop, setFocusTop] = useState(-1);
  const [focusBottom, setFocusBottom] = useState(-1);
  const [treeRows, setTreeRows] = useState(0);
  // densable `d$` — store is source of truth for settled budget used by bandWindow.
  const settledFromStore = useSettledBudget();
  const settledBudget = settledFromStore ?? rows;
  // densable `Me` — focus index: number | 'band' | null.
  const [focusIndex, setFocusIndex] = useState<number | 'band' | null>(null);
  const focusIndexRef = useRef(focusIndex);
  focusIndexRef.current = focusIndex;
  const [bandInputFocused, setBandInputFocused] = useState<FocusedInput | null>(null);
  const bandSelectRef = useRef<PluginSelectSeat | null>(null);
  const bandInputRef = useRef<PluginInputMapApi | null>(null);
  const toggleShortcut = getShortcutDisplay('abovePrompt:toggle', 'Chat', 'ctrl+x ctrl+a');
  // densable `Wr=l1()` — dialog open blocks auto-settle.
  const dialogOpen = useHasOpenDialogs();

  // densable `sst(h,v,M)` — write d3 then oNo. Chrome = CollapseHandle columns.
  useEffect(() => {
    settlePanesTerminalColumns(columns, rows, COLLAPSE_HANDLE_COLUMNS);
  }, [columns, rows]);

  // densable a4n mount/unmount clear pending focusRequest.
  useEffect(() => {
    settlePaneFocusRequest(false);
    return () => settlePaneFocusRequest(false);
  }, []);

  // densable a4n auto-settle when focusRequest pending + idle gates.
  useEffect(() => {
    if (panesFocusRequest === null) return;
    const panes = getPanesState();
    settlePaneFocusRequest(
      promptEmpty &&
        !hasSurvey &&
        !dialogOpen &&
        focusIndex === null &&
        panes.focusedId === null &&
        panes.placements > 0,
    );
  }, [panesFocusRequest, promptEmpty, hasSurvey, dialogOpen, focusIndex]);

  // densable `NZ` settle: fold live budget into `d$` settledBudget after HEIGHT_SETTLE_MS.
  useEffect(() => {
    if (settledFromStore === rows) return;
    const handle = setTimeout(() => setSettledBudget(rows), HEIGHT_SETTLE_MS);
    return () => clearTimeout(handle);
  }, [rows, settledFromStore]);

  useLayoutEffect(() => {
    const height = contentRef.current?.yogaNode?.getComputedHeight() ?? 0;
    setTreeRows(prev => (prev === height ? prev : height));
    const index = typeof focusIndexRef.current === 'number' ? focusIndexRef.current : null;
    const top = heldFocusEdge({ held: heldFocusRef.current, index, content: contentRef.current }, 'top');
    const bottom = heldFocusEdge({ held: heldFocusRef.current, index, content: contentRef.current }, 'bottom');
    setFocusTop(prev => (prev === top ? prev : top));
    setFocusBottom(prev => (prev === bottom ? prev : bottom));
  });

  const { windowRows, hasCue, maxOffset, bodyRows } = bandWindow({
    budget: rows,
    settledBudget,
    treeRows,
  });
  const listRows = useOpenListRows();
  // densable Ide — owner from AbovePrompt drawing when known; else ''.
  // Hde/`QLt` person-origin HAVE via useBandScrollPlace → dispatchPersonUiScroll.
  const scrollOwner =
    getPluginDrawingTrees().find(
      drawing => drawing.component === 'AbovePrompt' || drawing.requestId === BAND_REQUEST_ID,
    )?.plugin ?? '';
  // densable IZ split: yEe/OMr/Ide use live `windowRows` (ro); only
  // `props.scroll.bodyRows` stays settled `bodyRows` (Ao).
  const { offset, placed, place, scrollBy } = useBandScrollPlace({
    bodyRows: windowRows,
    contentRows: treeRows,
    maxOffset,
    plugin: scrollOwner,
    requestId: BAND_REQUEST_ID,
    component: 'AbovePrompt',
  });
  const scrollOwnerRef = useRef(scrollOwner);
  scrollOwnerRef.current = scrollOwner;
  useEffect(() => {
    registerPluginScrollSite(scrollOwner, BAND_REQUEST_ID, 'AbovePrompt', {
      offset,
      maxOffset,
      bodyRows: windowRows,
      contentRows: treeRows,
    });
    return () => {
      unregisterPluginScrollSite(scrollOwnerRef.current, BAND_REQUEST_ID, 'AbovePrompt');
    };
  }, [scrollOwner]);
  useEffect(() => {
    updatePluginScrollSite(
      scrollOwner,
      BAND_REQUEST_ID,
      {
        offset,
        maxOffset,
        bodyRows: windowRows,
        contentRows: treeRows,
      },
      'AbovePrompt',
    );
  }, [scrollOwner, offset, maxOffset, windowRows, treeRows]);
  // densable `_Ee` / pee `if(To>So)an(()=>So)`.
  useEffect(() => {
    if (placed > maxOffset) place(() => maxOffset);
  }, [placed, maxOffset, place]);
  // densable `_Ee` / pee OMr into-view place — gold OMr bodyRows:ro.
  useEffect(() => {
    if (focusTop < 0) return;
    place(prev =>
      nearestScrollOffset({
        offset: prev,
        bodyRows: windowRows,
        top: focusTop,
        bottom: focusBottom,
      }),
    );
  }, [focusTop, focusBottom, windowRows, focusPlaceBump, place]);
  const reportHeldFocusNode = useCallback((node: DOMElement | null) => {
    const index = typeof focusIndexRef.current === 'number' ? focusIndexRef.current : null;
    heldFocusRef.current = node !== null && index !== null ? { node, index } : null;
  }, []);

  const viewingAgentView = useViewingAgentView();
  const aboveBodyColumns = Math.max(0, columns - COLLAPSE_HANDLE_COLUMNS);
  const drawn = useRenderDrawing(
    {
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: BAND_REQUEST_ID,
      props: {
        hasSurvey,
        isWorking,
        maxRows: settledBudget,
        bodyColumns: aboveBodyColumns,
        // densable props.scroll.bodyRows:Ao (settled) — not live ro.
        scroll: { offset, bodyRows },
        view: viewingAgentView,
      },
    },
    `${String(isWorking)}\0${String(hasSurvey)}\0${String(columns)}\0${String(rows)}\0${String(settledBudget)}\0${String(bandCollapsed)}\0${String(offset)}\0${String(bodyRows)}\0${JSON.stringify(viewingAgentView)}`,
  );
  const hasPluginTree =
    drawn !== undefined &&
    drawn !== null &&
    (typeof drawn === 'string' || (typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine'));

  // densable `Nn=xze(Fo)` — focusables after drawn.
  const focusables = useMemo(() => focusablesOfDrawing(drawn), [drawn]);
  const focused = typeof focusIndex === 'number' ? (focusables[focusIndex] ?? null) : null;
  const bandHeld = hasPluginTree && !bandCollapsed;
  const focusedTag = focused?.tag;
  const ringActive = hasPluginTree && !bandCollapsed;
  const inputFocused = ringActive && focusedTag === 'Input';
  const selectFocused = ringActive && focusedTag === 'Select';

  // densable lr=`ce(($r)=>{Ie($r),Jt(es=>es+1)})` — person land bumps place.
  // densable Ie(null)/Ie("band") clears do NOT Vt.
  const landFocusIndex = (index: number | 'band' | null): void => {
    setFocusIndex(index);
    setFocusPlaceBump(n => n + 1);
    if (typeof index === 'number') {
      landBandInputFocus(focusables[index], setBandInputFocused, () => bandSelectRef.current?.close());
      return;
    }
    heldFocusRef.current = null;
    setBandInputFocused(null);
    bandSelectRef.current?.close();
  };
  const clearFocusIndex = useCallback((next: number | 'band' | null): void => {
    setFocusIndex(next);
    if (typeof next !== 'number') {
      heldFocusRef.current = null;
      setBandInputFocused(null);
      bandSelectRef.current?.close();
    }
  }, []);
  // densable `sr=!h&&(Nn.length>0||no)` then `x(()=>{if(!sr)Ie(null)},[sr])`.
  const bandLiveGate = !hasSurvey && (focusables.length > 0 || hasCue);
  useEffect(() => {
    if (!bandLiveGate) clearFocusIndex(null);
  }, [bandLiveGate, clearFocusIndex]);
  // densable `hs=xe(Si(), focusedId)` then `x(()=>{if(hs!==null)Ie(null)},[hs])`.
  const panesFocusedId = useSyncExternalStore(subscribePanes, () => getPanesState().focusedId);
  useEffect(() => {
    if (panesFocusedId !== null) clearFocusIndex(null);
  }, [panesFocusedId, clearFocusIndex]);
  // densable `x(ss,[h,ss])` — survey *flip* (not mount): Ie(null)+u3(null).
  const prevSurveyRef = useRef(hasSurvey);
  useEffect(() => {
    if (prevSurveyRef.current !== hasSurvey) {
      clearFocusIndex(null);
      focusPane(null);
    }
    prevSurveyRef.current = hasSurvey;
  }, [hasSurvey, clearFocusIndex]);
  // densable `h$(eo,Nn.length,()=>Ie("band"))`.
  useEffect(() => {
    if (typeof focusIndex === 'number' && focusIndex >= focusables.length) {
      clearFocusIndex('band');
    }
  }, [focusIndex, focusables.length, clearFocusIndex]);
  // densable FZ identity flip: Oo(()=>0), Ie(null).
  const prevFocusablesRef = useRef(focusables);
  useEffect(() => {
    if (isOtherDrawer(prevFocusablesRef.current, focusables)) {
      place(() => 0);
      clearFocusIndex(null);
    }
    prevFocusablesRef.current = focusables;
  }, [focusables, place, clearFocusIndex]);
  const bandAway = useCallback(() => {
    clearFocusIndex(null);
    focusPane(null);
  }, [clearFocusIndex]);
  // densable ITt(ce(()=>Ie(null),[])) — click-away clears band focus only (not u3).
  const bandClickAway = useCallback(() => {
    clearFocusIndex(null);
  }, [clearFocusIndex]);
  const bandAwayRef = usePaneClickAway(bandClickAway);
  // densable jZ(as, Me??hs, ss): prompt draft change while band/pane held → Ie(null)+u3(null).
  useDraftHeldAway(focusIndex ?? panesFocusedId, bandAway);
  // densable ks=xe(NLe, focusedId) → Ie(null); io=Me!==null → DQt(null).
  const clientFocusedId = useSyncExternalStore(
    subscribePluginClientFocus,
    getPluginClientFocusedId,
    getPluginClientFocusedId,
  );
  useEffect(() => {
    if (clientFocusedId !== null) clearFocusIndex(null);
  }, [clientFocusedId, clearFocusIndex]);
  useEffect(() => {
    if (focusIndex !== null) setPluginClientFocusedId(null);
  }, [focusIndex]);

  // densable XHo on AbovePrompt — bind after landFocusIndex exists.
  const bandHost = usePluginFocusHost({
    component: 'AbovePrompt',
    requestId: BAND_REQUEST_ID,
    owner: scrollOwner || undefined,
    focusables,
    isHeld: bandHeld,
    isHeldNow: () => focusIndexRef.current !== null,
    indexNow: () => {
      const now = focusIndexRef.current;
      return typeof now === 'number' ? now : null;
    },
    isEmptyNow: () => focusIndexRef.current === 'band',
    land: index => landFocusIndex(index),
  });

  // densable `GO("AbovePrompt"|"AbovePromptInput"|"AbovePromptSelect")` via NM/pluginFieldContext.
  // AbovePrompt stays up for scroll chords when the tree is visible and focus is not an Input/Select.
  useRegisterKeybindingContext('AbovePrompt', ringActive && !inputFocused && !selectFocused);
  useRegisterKeybindingContext('AbovePromptInput', inputFocused);
  useRegisterKeybindingContext('AbovePromptSelect', selectFocused);

  useKeybinding(
    'abovePrompt:toggle',
    () => {
      if (!hasPluginTree) return;
      setBandCollapsed(!getBandCollapsed());
      clearFocusIndex(null);
    },
    { context: 'Chat', isActive: hasPluginTree },
  );

  const ring = useMemo(
    () =>
      wrapPluginFocusActs(
        bandHost,
        bandRingHandlers({
          focusables,
          focusIndexNow: () => {
            const now = focusIndexRef.current;
            return typeof now === 'number' ? now : null;
          },
          focusByPerson: index => {
            bandHost.moveByPerson({
              index,
              apply: () => landFocusIndex(index),
            });
          },
          leave: () => {
            bandHost.forget();
            clearFocusIndex(null);
          },
          submit: focusable => {
            if (typeof focusable.element !== 'string' || focusable.element === '') return;
            bandInputRef.current?.submit({
              plugin: focusable.plugin,
              handle: focusable.handle,
              element: focusable.element,
              ...(typeof focusable.value === 'string' && { value: focusable.value }),
            });
          },
        }),
        ['abovePrompt:leave'],
      ),
    [focusables, bandHost],
  );
  const bandClickedPress = useMemo(
    () =>
      clickFocusByPress(focusables, index => {
        bandHost.moveByPerson({
          index,
          apply: () => landFocusIndex(index),
        });
      }),
    [focusables, bandHost],
  );
  const ringContext = pluginFieldContext(focusedTag, 'AbovePrompt');
  // densable Chat `abovePrompt:focus` — never a4n(true); pending focusRequest
  // is only auto-settled by the a4n effect. Order: focusedId → $Fr/u3; else
  // band step (sr && next≠null); else open[0] via $Fr; else band from null.
  useKeybinding(
    'abovePrompt:focus',
    () => {
      const panes = getPanesState();
      // densable `sr=!h&&(Nn.length>0||no)` — survey off + focusables or cue.
      const bandLive = !hasSurvey && hasPluginTree && !bandCollapsed && (focusables.length > 0 || hasCue);
      const bandNext = nextBandFocus({ focus: focusIndex, count: focusables.length });
      const canBandStep = bandLive && panes.focusedId === null && bandNext !== null;

      if (panes.focusedId !== null) {
        // densable u3($Fr($r)) — last pane yields null and clears focus.
        focusPane(nextFocusedPaneId(panes));
        return;
      }
      if (canBandStep) {
        if (typeof bandNext === 'number' || bandNext === 'band') {
          landFocusIndex(bandNext);
        }
        return;
      }
      if (panes.open.length > 0) {
        // densable Ie(null), u3($Fr($r)) — $Fr with focusedId null → open[0].
        clearFocusIndex(null);
        focusPane(nextFocusedPaneId(panes));
        return;
      }
      if (bandLive) {
        const fromNull = nextBandFocus({ focus: null, count: focusables.length });
        if (typeof fromNull === 'number' || fromNull === 'band') {
          landFocusIndex(fromNull);
        }
      }
    },
    {
      context: 'Chat',
      isActive:
        getPanesState().focusedId !== null ||
        getPanesState().open.length > 0 ||
        (!hasSurvey && hasPluginTree && !bandCollapsed && (focusables.length > 0 || hasCue)),
    },
  );
  useKeybinding('abovePrompt:next', ring['abovePrompt:next'], {
    context: ringContext,
    isActive: ringActive,
  });
  useKeybinding('abovePrompt:previous', ring['abovePrompt:previous'], {
    context: ringContext,
    isActive: ringActive,
  });
  useKeybinding('abovePrompt:press', ring['abovePrompt:press'], {
    context: ringContext,
    isActive: ringActive && focusIndex !== null,
  });
  useKeybinding('abovePrompt:leave', ring['abovePrompt:leave'], {
    context: ringContext,
    isActive: ringActive && focusIndex !== null,
  });
  // densable `_Ee` `fr=y$({...})` / `rr=m$({...})` — same objects as SiteFields / g$.
  const bandSelect = usePluginSelectSeat(focusables, 'AbovePrompt', BAND_REQUEST_ID, {
    focusIndex,
    focusIndexNow: () => focusIndexRef.current,
    setFocusIndex: landFocusIndex,
    working: isWorking,
  });
  const bandInput = usePluginInputSeat(focusables, 'AbovePrompt', BAND_REQUEST_ID);
  bandSelectRef.current = bandSelect;
  bandInputRef.current = bandInput;
  const bandInputFocusHost = useMemo<BandInputFocusHost>(
    () => ({
      focused: bandInputFocused,
      setFocused: next => {
        if (next !== null) bandSelect.close();
        setBandInputFocused(next);
      },
    }),
    [bandInputFocused, bandSelect],
  );
  useKeybinding('abovePrompt:highlightNext', bandSelect.handlers['abovePrompt:highlightNext'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });
  useKeybinding('abovePrompt:highlightPrevious', bandSelect.handlers['abovePrompt:highlightPrevious'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });
  useKeybinding('abovePrompt:press', bandSelect.handlers['abovePrompt:press'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });

  // densable `g$({isAhead:()=>Ne()!==Me, handlers:{AbovePrompt|Input|Select}, inputs, selectKeys})`.
  // densable isAhead(Ne!==Me) — Me=rendered focusIndex via effect; Ne=held ref.
  const renderedFocusIndex = useRef(focusIndex);
  useEffect(() => {
    renderedFocusIndex.current = focusIndex;
  });
  const scrollHandlers = useMemo(
    () =>
      paneScrollHandlers({
        bodyRows: windowRows,
        contentRows: treeRows,
        scrollBy,
      }),
    [scrollBy, windowRows, treeRows],
  );
  // densable AZ(ds, ao, no) — Yi bound on AbovePrompt while `is`.
  const abovePromptHandlers = useMemo(
    () => bandKeysWithScroll(ring, scrollHandlers, hasCue),
    [ring, scrollHandlers, hasCue],
  );
  const selectBagHandlers = useMemo(
    () => ({
      ...ring,
      ...bandSelect.handlers,
    }),
    [ring, bandSelect.handlers],
  );
  const bandKeysBag = useMemo<PluginBandKeysBag>(
    () => ({
      // densable isAhead(Ne!==Me)
      isAhead: () => focusIndexRef.current !== renderedFocusIndex.current,
      contextNow: () => {
        if (focusIndexRef.current === null) return null;
        return pluginFieldContext(focusableAt(focusables, focusIndexRef.current)?.tag, 'AbovePrompt');
      },
      focusedNow: () => focusableAt(focusables, focusIndexRef.current),
      contextRendered: () => {
        if (renderedFocusIndex.current === null) return null;
        return pluginFieldContext(focused?.tag, 'AbovePrompt');
      },
      focusedRendered: () => focused,
      handlers: {
        AbovePrompt: abovePromptHandlers,
        AbovePromptInput: ring,
        AbovePromptSelect: selectBagHandlers,
      },
      inputs: {
        textNow: bandInput.textNow,
        fields: bandInput.fields,
      },
      selectKeys: (input, key) => bandSelect.intercept(input, key),
    }),
    [focusables, focused, ring, abovePromptHandlers, selectBagHandlers, bandSelect, bandInput],
  );
  usePluginBandKeys(bandKeysBag, { isActive: ringActive });
  // densable `sb(fr.intercept,{isActive:Os})` — Select intercept also prepends alone.
  useInput(
    (input, key, event) => {
      if (bandSelect.intercept(input, key)) event.stopImmediatePropagation();
    },
    { isActive: selectFocused, prepend: true },
  );

  // densable `Zt(Yi,{context:"AbovePrompt",isActive:is})` — `is` = held && !Input && !Select.
  const abovePromptIsActive = ringActive && !inputFocused && !selectFocused;
  useKeybinding('pane:scrollUp', abovePromptHandlers['pane:scrollUp'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });
  useKeybinding('pane:scrollDown', abovePromptHandlers['pane:scrollDown'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });
  useKeybinding('pane:pageUp', abovePromptHandlers['pane:pageUp'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });
  useKeybinding('pane:pageDown', abovePromptHandlers['pane:pageDown'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });
  useKeybinding('pane:top', abovePromptHandlers['pane:top'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });
  useKeybinding('pane:bottom', abovePromptHandlers['pane:bottom'], {
    context: 'AbovePrompt',
    isActive: abovePromptIsActive,
  });

  // densable `u$` / `HZ` — Button hotkeys while band ring (not Input/Select).
  const bandHotkeys = useMemo(() => hotkeyMapOfDrawing(drawn), [drawn]);
  useInput(
    (input, key, event) => {
      const hits = resolveHotkeyPresses(input, key, bandHotkeys);
      if (hits.length === 0) return;
      for (const hit of hits) firePress(hit.plugin, hit.handle);
      event.stopImmediatePropagation();
    },
    {
      isActive: ringActive && !inputFocused && !selectFocused && bandHotkeys.size > 0,
      prepend: true,
    },
  );

  // densable `Wm({inputValue:Un,enabled:!h&&Xo.size>0,enterConfirms:!1,…})`.
  const promptValue = useSyncExternalStore(
    subscribePromptInputCursorStore,
    getPromptInputStoreValue,
    getPromptInputStoreValue,
  );
  const bandWheelAccel = useRef<WheelAccelState | null>(null);
  const bandWheelProfile = useRef<WheelProfile | null>(null);
  const digitEnabled = !hasSurvey && bandHotkeys.size > 0;
  const digitVisible = (digit: string): boolean => hotkeyDigitVisible(hasCue, bandHotkeys, digit);
  useBandDigitHotkey({
    inputValue: promptValue,
    enabled: digitEnabled,
    isValidDigit: char => /^[0-9]$/.test(char) && bandHotkeys.has(char) && digitVisible(char),
    onDigit: digit =>
      pressShownDigit(
        bandHotkeys.get(digit),
        () => digitVisible(digit),
        () => setPromptInputStoreValue(''),
      ),
  });
  const bandWheel = useCallback(
    (event: WheelEvent) => {
      const sign: 1 | -1 = event.deltaY < 0 ? -1 : 1;
      const step = computeWheelStep(ensurePaneWheelAccel(bandWheelAccel, bandWheelProfile), sign, performance.now());
      if (step === 0) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      scrollBy(sign * step);
      event.preventDefault();
      event.stopPropagation();
    },
    [scrollBy],
  );

  // densable: collapsed → n$ inside We (ITt host stays bound).
  if (bandCollapsed) {
    if (!hasPluginTree) return null;
    return (
      <Box
        ref={node => {
          bandAwayRef.current = node;
        }}
        flexShrink={0}
        flexDirection="column"
        onWheel={hasCue && !dialogOpen ? bandWheel : undefined}
      >
        <PluginBandCollapsedHint
          shortcut={toggleShortcut}
          onExpand={() => {
            setBandCollapsed(false);
            setFocusIndex(null);
            setBandInputFocused(null);
            bandSelectRef.current?.close();
          }}
        />
      </Box>
    );
  }

  const node = rebuild(
    drawn,
    '',
    BAND_REQUEST_ID,
    undefined,
    'AbovePrompt',
    focusables,
    bandSelect,
    bandInput,
    bandInputFocusHost,
  );
  if (node === null) return null;
  const focusedPress = focused === null ? null : { plugin: focused.plugin, handle: focused.handle };
  const onAboveDrawError = (error: Error): void => {
    // densable Jmn/NBr + Ymn.AbovePrompt; L1t unique English on the debug log.
    logForDebugging(`ui.render (AbovePrompt): a plugin's tree threw while drawn (plugin unattributed, unattributed)`);
    addNotification({
      key: `above-threw-while-drawn:${aboveResetKey}`,
      text: `ui.render (AbovePrompt) threw while drawn: ${error.message}; nothing was drawn`,
      priority: 'immediate',
      kind: 'warning',
      color: 'error',
    });
    setAboveResetKey(n => n + 1);
  };
  return (
    <PaneErrorBoundary resetKey={aboveResetKey} onError={onAboveDrawError}>
      <ClickedPressContext.Provider value={bandClickedPress}>
        <FocusedPressContext.Provider value={focusedPress}>
          <HeldFocusRefContext.Provider value={reportHeldFocusNode}>
            <PaneBodyColumnsContext.Provider value={aboveBodyColumns}>
              <Box
                ref={node => {
                  bandAwayRef.current = node;
                }}
                position="relative"
                flexShrink={0}
                flexDirection="column"
                maxHeight={rows + listRows}
                overflowY="hidden"
                onWheel={hasCue && !dialogOpen ? bandWheel : undefined}
              >
                <Box flexDirection="column" flexShrink={0} maxHeight={windowRows} overflowY="hidden">
                  {/* densable `fEe` — marginTop=-offset; keptColumns=DZ under CollapseHandle. */}
                  <Box
                    ref={node => {
                      contentRef.current = node;
                      if (scrollOwner) bindPluginScrollSiteLayout(scrollOwner, BAND_REQUEST_ID, node, 'AbovePrompt');
                    }}
                    flexDirection="column"
                    flexShrink={0}
                    marginTop={-offset}
                    marginRight={COLLAPSE_HANDLE_COLUMNS}
                  >
                    {node}
                  </Box>
                </Box>
                {hasCue ? <PluginBandOverflowCue above={offset} below={Math.max(0, maxOffset - offset)} /> : null}
                {hasPluginTree ? (
                  <PluginBandCollapseHandle
                    onCollapse={() => {
                      setBandCollapsed(true);
                      setFocusIndex(null);
                    }}
                  />
                ) : null}
              </Box>
            </PaneBodyColumnsContext.Provider>
          </HeldFocusRefContext.Provider>
        </FocusedPressContext.Provider>
      </ClickedPressContext.Provider>
    </PaneErrorBoundary>
  );
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
