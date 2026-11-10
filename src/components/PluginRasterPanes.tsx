import {
  Box,
  Button,
  ClockContext,
  Link,
  MOUNT_SETTLE_MS,
  NoSelect,
  Text,
  getFocusManager,
  stringWidth,
  useInput,
  useKeybinding,
  useOptionalKeybindingContext,
  useApp,
  useRegisterKeybindingContext,
  useSelection,
  measureElement,
  type DOMElement,
  type Key,
  type MouseActionEvent,
  type WheelEvent,
} from '@anthropic/ink';
import {
  Component,
  cloneElement,
  createContext,
  isValidElement,
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
  type ComponentType,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { AbovePromptLeftoverContext, dockLitStore, leftoverPluginBandBudget } from './FullscreenLayout.js';
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
  getLastUiRenderPlugin,
  hasMatchingFunctionHook,
  runFunctionHookChain,
  focusPane,
  getPaneRemountGeneration,
  getPanesState,
  getPanesTerminalSize,
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
import { useIsOverlayActive, useRegisterOverlay } from '../context/overlayContext.js';
import { useHasOpenDialogs } from '../dialog/DialogStoreContext.js';
import { logForDebugging } from '../utils/debug.js';
import { isFullscreenEnvEnabled } from '../utils/fullscreen.js';
import { useNotifications } from '../context/notifications.js';
import { useAppState, useSetAppState } from '../state/AppState.js';
import { createStore } from '../state/store.js';
import {
  getPromptInputStoreValue,
  setPromptInputStoreValue,
  subscribePromptInputCursorStore,
} from '../utils/promptInputCursorStore.js';
import { parsePatch, type StructuredPatchHunk } from 'diff';
import TextInput from './TextInput.js';
import { HighlightedCode as BaseHighlightedCode } from './HighlightedCode.js';
import { Markdown } from './Markdown.js';

const HighlightedCode = BaseHighlightedCode as unknown as ComponentType<
  ComponentProps<typeof BaseHighlightedCode> & { startLine?: number; lineNumbers?: boolean }
>;
export { dockLitStore };
import { PluginImage, PluginRaster } from './PluginRaster.js';
import { StructuredDiff } from './StructuredDiff.js';
import { intersperse } from '../utils/array.js';
import { truncateToWidth } from '../utils/format.js';
import { cleanPromptHintText, resolvePromptHintText } from './PromptInput/PromptInputFooterSuggestions.js';
import { encodePluginLinkHref, encodePluginLinkLabel } from '../utils/plugins/pluginLinkHref.js';
import { Jmn, L1t, tellerOf, tellerOfPlugin } from '../utils/plugins/pluginDrawError.js';
import {
  RZ,
  hasPluginDrawing,
  isEngineFallback,
  isG2eComponent,
  siteIsOff,
  useHeldSiteRows,
  useSiteMeasure,
} from '../utils/plugins/pluginSiteHold.js';
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
  ['§', '6'],
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

export type HotkeyYogaSeat = {
  hotkey: string;
  top: number;
  height: number;
};

/**
 * densable `LZ` — cue off means every digit is visible. Cue on means every
 * yoga seat for that digit sits fully inside [offset, offset+windowRows].
 */
export function hotkeyDigitVisible(
  hasCue: boolean,
  digit: string,
  seats: readonly HotkeyYogaSeat[],
  offset: number,
  windowRows: number,
): boolean {
  if (!hasCue) return true;
  const mine = seats.filter(seat => seat.hotkey === digit);
  if (mine.length === 0) return false;
  const end = offset + windowRows;
  return mine.every(seat => seat.top >= offset && seat.top + seat.height <= end);
}

function hotkeySeatsIn(content: DOMElement | null): HotkeyYogaSeat[] {
  if (content === null) return [];
  const seats: HotkeyYogaSeat[] = [];
  const walk = (node: DOMElement): void => {
    const hotkey = node.attributes.hotkey;
    const yoga = node.yogaNode;
    if (typeof hotkey === 'string' && yoga) {
      seats.push({
        hotkey,
        top: yoga.getComputedTop(),
        height: yoga.getComputedHeight(),
      });
    }
    for (const child of node.childNodes) {
      if (child.nodeName === '#text') continue;
      walk(child);
    }
  };
  walk(content);
  return seats;
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
  /** densable BO `telemetryMessage` — Client `L1t(..., "Client")`. */
  telemetryMessage?: () => string | null;
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
    const debug = this.props.telemetryMessage?.();
    if (debug) logForDebugging(debug);
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

/** densable `dEe` — wheel pointer relative to the scroll clip box's cachedLayout. */
export function relativeWheelPointer(
  clipRef: RefObject<DOMElement | null>,
  event: WheelEvent,
): { column: number; row: number } | undefined {
  const layout = (clipRef.current as { cachedLayout?: { x: number; y: number } } | null)?.cachedLayout;
  return event.col !== undefined && event.row !== undefined && layout !== undefined
    ? { column: event.col - layout.x, row: event.row - layout.y }
    : undefined;
}

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
  scrollBy: (delta: number, pointer?: { column: number; row: number }) => void;
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
  const queuedPointerRef = useRef<{ column: number; row: number } | undefined>(undefined);
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
  // densable raster bump — ui.scroll / follow-end write the site, then
  // bumpRasterFrames. Paint reads React offset, so adopt the site here.
  const rasterFrame = useSyncExternalStore(subscribeRasterFrames, getRasterFrameVersion, getRasterFrameVersion);
  useEffect(() => {
    const siteMeta = personScrollRef.current;
    if (siteMeta.plugin === '' || siteMeta.requestId === '') return;
    const site = getPluginScrollSite(siteMeta.plugin, siteMeta.requestId, siteMeta.component);
    if (site === undefined) return;
    // Person scroll still in flight: do not pull React back to a stale site.offset.
    if (inFlightRef.current) return;
    if (site.followEnd) {
      const pinned = Math.max(0, dims.current.maxOffset);
      if (!followEndRef.current || placedRef.current !== pinned) {
        followEndRef.current = true;
        placedRef.current = pinned;
        setFollowEnd(true);
        setPlaced(pinned);
      }
      return;
    }
    if (followEndRef.current || placedRef.current !== site.offset) {
      followEndRef.current = false;
      placedRef.current = site.offset;
      setFollowEnd(false);
      setPlaced(site.offset);
    }
  }, [rasterFrame]);
  const dispatchPersonIfRegistered = (
    nextOffset: number,
    by: number,
    pointer?: { column: number; row: number },
  ): Promise<void> => {
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
      ...(pointer !== undefined && { pointer }),
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
  // Person path: the ui.scroll hook commits the site. React follows only if
  // that commit landed. An unregistered site still moves locally.
  const commitIfPersonAllowed = (
    target: number,
    by: number,
    pointer?: { column: number; row: number },
  ): Promise<void> => {
    const siteMeta = personScrollRef.current;
    const registered =
      siteMeta.plugin !== '' &&
      siteMeta.requestId !== '' &&
      getPluginScrollSite(siteMeta.plugin, siteMeta.requestId, siteMeta.component) !== undefined;
    if (!registered) {
      commit(target);
      return Promise.resolve();
    }
    return dispatchPersonIfRegistered(target, by, pointer).then(() => {
      const site = getPluginScrollSite(siteMeta.plugin, siteMeta.requestId, siteMeta.component);
      if (site?.offset === target) commit(target);
    });
  };
  // densable yEe `io=ce((no)=>Vt(no(Ne())),[Vt,Ne])` — stable place identity.
  const place = useCallback(
    (fn: (prev: number) => number): void => {
      inFlightRef.current = true;
      const target = clamp(fn(placedRef.current));
      const by = target - liveOffset();
      if (by === 0) {
        inFlightRef.current = false;
        return;
      }
      void commitIfPersonAllowed(target, by).finally(() => {
        inFlightRef.current = false;
      });
    },
    [commit],
  );
  const fireScroll = (delta: number, pointer?: { column: number; row: number }): void => {
    inFlightRef.current = true;
    const target = clamp(liveOffset() + delta);
    const by = target - liveOffset();
    // densable QLt.finally — keep inFlight until person scroll settles, then drain.
    const after = (): void => {
      if (!aliveRef.current) {
        inFlightRef.current = false;
        queuedDeltaRef.current = 0;
        queuedPointerRef.current = undefined;
        return;
      }
      inFlightRef.current = false;
      const queued = queuedDeltaRef.current;
      const queuedPointer = queuedPointerRef.current;
      queuedDeltaRef.current = 0;
      queuedPointerRef.current = undefined;
      if (queued !== 0) fireScroll(queued, queuedPointer);
    };
    if (by === 0) {
      after();
      return;
    }
    void commitIfPersonAllowed(target, by, pointer).finally(after);
  };
  const scrollBy = (delta: number, pointer?: { column: number; row: number }): void => {
    if (delta === 0) return;
    if (inFlightRef.current) {
      queuedDeltaRef.current += delta;
      queuedPointerRef.current = pointer;
      return;
    }
    fireScroll(delta, pointer);
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
export function pluginPaneDockColumns(columns: number, chosen?: number | null, requested?: number | null): number {
  if (columns < DOCK_FLOOR_COLUMNS) return 0;
  const clamp = (value: number) => Math.min(columns - DOCK_TRANSCRIPT_MIN_COLUMNS, Math.max(DOCK_MIN_COLUMNS, value));
  if (typeof chosen === 'number') return clamp(chosen);
  if (typeof requested === 'number') return clamp(requested);
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
    dockLitStore.setState(() => isGripLit);
    return () => {
      dockLitStore.setState(() => false);
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

/** densable `L1t` debug + `Jmn` toast. Kind is gold `answer`. */
function reportDrawWhileDrawn(
  component: string,
  names: readonly string[],
  error: Error,
  addNotification: (notification: {
    key: string;
    text: string;
    priority: 'immediate';
    kind: 'warning';
    color: 'error';
  }) => void,
): void {
  const teller = tellerOf(names);
  const debug = L1t(component, teller, 'answer');
  if (debug !== null) logForDebugging(debug);
  const toast = Jmn({ component, teller, error });
  if (toast === null) return;
  addNotification({
    key: toast.key,
    text: toast.text,
    priority: 'immediate',
    kind: 'warning',
    color: 'error',
  });
}

function stampedPlugin(node: Record<string, unknown>, fallback: string): string {
  if (typeof node.__plugin === 'string' && node.__plugin !== '') return node.__plugin;
  if (typeof node.plugin === 'string' && node.plugin !== '') return node.plugin;
  const raster = isRecord(node.raster) ? node.raster : undefined;
  if (typeof raster?.plugin === 'string' && raster.plugin !== '') return raster.plugin;
  const image = isRecord(node.image) ? node.image : undefined;
  if (typeof image?.plugin === 'string' && image.plugin !== '') return image.plugin;
  const client = isRecord(node.client) ? node.client : undefined;
  if (typeof client?.plugin === 'string' && client.plugin !== '') return client.plugin;
  return fallback;
}

function flattenDrawingChildren(raw: unknown, out: unknown[] = []): unknown[] {
  if (raw === undefined || raw === null || typeof raw === 'boolean') return out;
  if (Array.isArray(raw)) {
    for (const item of raw) flattenDrawingChildren(item, out);
    return out;
  }
  out.push(typeof raw === 'number' ? String(raw) : raw);
  return out;
}

export function extractDrawnPlugin(node: unknown, component?: string, requestId?: string): string | undefined {
  const walk = (item: unknown): string | undefined => {
    if (Array.isArray(item)) {
      for (const child of item) {
        const hit = walk(child);
        if (hit !== undefined) return hit;
      }
      return undefined;
    }
    if (!isRecord(item)) return undefined;
    const direct = stampedPlugin(item, '');
    if (direct !== '') return direct;
    const press = isRecord(item.press) ? item.press : undefined;
    if (typeof press?.plugin === 'string' && press.plugin !== '') return press.plugin;
    const group = isRecord(item.group) ? item.group : undefined;
    if (typeof group?.plugin === 'string' && group.plugin !== '') return group.plugin;
    const props = isRecord(item.props) ? item.props : {};
    for (const child of childList(item, props)) {
      const hit = walk(child);
      if (hit !== undefined) return hit;
    }
    return undefined;
  };
  const found = walk(node);
  if (found !== undefined) return found;
  if (component !== undefined) {
    const stored = getPluginDrawingTrees().find(
      drawing => drawing.component === component && (requestId === undefined || drawing.requestId === requestId),
    )?.plugin;
    if (typeof stored === 'string' && stored !== '') return stored;
  }
  return undefined;
}

function pressOf(node: Record<string, unknown>, fallbackPlugin = ''): { plugin: string; handle: unknown } | undefined {
  const press = isRecord(node.press) ? node.press : undefined;
  if (press === undefined || typeof press.plugin !== 'string') return undefined;
  const plugin = press.plugin !== '' ? press.plugin : stampedPlugin(node, fallbackPlugin);
  return { plugin, handle: press.handle };
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
 * via `e.press`; else flatMap children (including nested arrays).
 */
export function focusablesOfDrawing(drawn: unknown): DrawingFocusable[] {
  if (drawn === undefined || drawn === null || typeof drawn === 'string' || typeof drawn === 'boolean') return [];
  if (Array.isArray(drawn)) return flattenDrawingChildren(drawn).flatMap(focusablesOfDrawing);
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
  const props = isRecord(drawn.props) ? drawn.props : {};
  return childList(drawn, props).flatMap(focusablesOfDrawing);
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

function selectOptionsOf(row: DrawingFocusable): Array<{ value: string; label?: string }> {
  const raw = row.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    if (!isRecord(item) || typeof item.value !== 'string') return [];
    return [
      {
        value: item.value,
        ...(typeof item.label === 'string' && { label: item.label }),
      },
    ];
  });
}

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

/** densable `Ode(list, index)` — focusable at ring index. `'band'` is not a row. */
export function focusableAt(
  focusables: readonly DrawingFocusable[],
  index: number | 'band' | null | undefined,
): DrawingFocusable | null {
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
    | 'display'
    | 'position'
    | 'top'
    | 'left'
    | 'right'
    | 'bottom'
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
    | 'paddingTop'
    | 'paddingBottom'
    | 'paddingLeft'
    | 'paddingRight'
    | 'margin'
    | 'marginX'
    | 'marginY'
    | 'marginTop'
    | 'marginBottom'
    | 'marginLeft'
    | 'marginRight'
    | 'borderStyle'
    | 'borderColor'
    | 'borderDimColor'
    | 'backgroundColor'
  >]: ComponentProps<typeof Box>[K];
};

/** densable `oqn` — standard named terminal colors mapped to hex (`rdn`/`He`). */
const NAMED_TO_HEX: Readonly<Record<string, string>> = {
  black: '#000000',
  red: '#e5484d',
  green: '#46a758',
  yellow: '#f5d90a',
  blue: '#3e63dd',
  magenta: '#d6409f',
  cyan: '#05a2c2',
  white: '#ffffff',
  gray: '#8b8d98',
  grey: '#8b8d98',
  blackBright: '#6e6e6e',
  redBright: '#ff6369',
  greenBright: '#5bd07f',
  yellowBright: '#ffe629',
  blueBright: '#5b8def',
  magentaBright: '#ee6ac2',
  cyanBright: '#3ec2e0',
  whiteBright: '#ffffff',
};

function resolvePluginColor(color: string): string {
  return Object.hasOwn(NAMED_TO_HEX, color) ? NAMED_TO_HEX[color]! : color;
}

/** densable `Le` — hover scope refcount store (`plugin\0scope` → count). */
const pluginHoverGroupsStore = createStore<Map<string, number>>(new Map());

function adjustPluginHoverGroup(groupKey: string, delta: number): void {
  pluginHoverGroupsStore.setState(prev => {
    const nextCount = (prev.get(groupKey) ?? 0) + delta;
    const next = new Map(prev);
    if (nextCount > 0) next.set(groupKey, nextCount);
    else next.delete(groupKey);
    return next;
  });
}

function usePluginHoverScope(
  plugin: string | undefined,
  hover: Record<string, unknown> | undefined,
): {
  isScoped: boolean;
  isHot: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
} {
  const scope = typeof hover?.scope === 'string' && hover.scope !== '' ? hover.scope : undefined;
  const groupKey = plugin !== undefined && plugin !== '' && scope !== undefined ? `${plugin}\0${scope}` : undefined;
  const isHot = useSyncExternalStore(
    pluginHoverGroupsStore.subscribe,
    () => (groupKey !== undefined ? (pluginHoverGroupsStore.getState().get(groupKey) ?? 0) > 0 : false),
    () => false,
  );
  const heldKeyRef = useRef<string | undefined>(undefined);
  const enter = useCallback((key: string | undefined) => {
    if (key !== undefined && heldKeyRef.current === undefined) {
      heldKeyRef.current = key;
      adjustPluginHoverGroup(key, 1);
    }
  }, []);
  const leave = useCallback(() => {
    const held = heldKeyRef.current;
    if (held !== undefined) {
      heldKeyRef.current = undefined;
      adjustPluginHoverGroup(held, -1);
    }
  }, []);
  useEffect(() => {
    if (heldKeyRef.current !== undefined && heldKeyRef.current !== groupKey) {
      leave();
      enter(groupKey);
    }
  }, [groupKey, enter, leave]);
  useEffect(() => leave, [leave]);
  return {
    isScoped: groupKey !== undefined,
    isHot,
    onMouseEnter: () => enter(groupKey),
    onMouseLeave: leave,
  };
}

function textStyleFrom(props: Record<string, unknown> | undefined): Partial<ComponentProps<typeof Text>> {
  if (props === undefined) return {};
  return {
    ...(boolProp(props, 'bold') !== undefined && { bold: boolProp(props, 'bold') }),
    ...(boolProp(props, 'dimColor') !== undefined && { dimColor: boolProp(props, 'dimColor') }),
    ...(boolProp(props, 'italic') !== undefined && { italic: boolProp(props, 'italic') }),
    ...(boolProp(props, 'underline') !== undefined && { underline: boolProp(props, 'underline') }),
    ...(boolProp(props, 'strikethrough') !== undefined && { strikethrough: boolProp(props, 'strikethrough') }),
    ...(boolProp(props, 'inverse') !== undefined && { inverse: boolProp(props, 'inverse') }),
    ...(typeof props.color === 'string' && {
      color: resolvePluginColor(props.color) as ComponentProps<typeof Text>['color'],
    }),
    ...(typeof props.backgroundColor === 'string' && {
      backgroundColor: resolvePluginColor(props.backgroundColor) as ComponentProps<typeof Text>['backgroundColor'],
    }),
    ...((props.wrap === 'wrap' ||
      props.wrap === 'truncate' ||
      props.wrap === 'truncate-start' ||
      props.wrap === 'truncate-middle' ||
      props.wrap === 'truncate-end') && { wrap: props.wrap }),
  };
}

function layoutFrom(props: Record<string, unknown> | undefined): BoxLayout {
  if (props === undefined) return {};
  const out: BoxLayout = {};
  if (props.display === 'flex' || props.display === 'none') {
    out.display = props.display;
  }
  if (props.position === 'absolute' || props.position === 'relative') {
    out.position = props.position;
  }
  if (typeof props.top === 'number') out.top = props.top;
  if (typeof props.left === 'number') out.left = props.left;
  if (typeof props.right === 'number') out.right = props.right;
  if (typeof props.bottom === 'number') out.bottom = props.bottom;
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
  if (typeof props.paddingTop === 'number') out.paddingTop = props.paddingTop;
  if (typeof props.paddingBottom === 'number') out.paddingBottom = props.paddingBottom;
  if (typeof props.paddingLeft === 'number') out.paddingLeft = props.paddingLeft;
  if (typeof props.paddingRight === 'number') out.paddingRight = props.paddingRight;
  if (typeof props.margin === 'number') out.margin = props.margin;
  if (typeof props.marginX === 'number') out.marginX = props.marginX;
  if (typeof props.marginY === 'number') out.marginY = props.marginY;
  if (typeof props.marginTop === 'number') out.marginTop = props.marginTop;
  if (typeof props.marginBottom === 'number') out.marginBottom = props.marginBottom;
  if (typeof props.marginLeft === 'number') out.marginLeft = props.marginLeft;
  if (typeof props.marginRight === 'number') out.marginRight = props.marginRight;
  if (typeof props.borderStyle === 'string') {
    out.borderStyle = props.borderStyle as BoxLayout['borderStyle'];
  }
  if (typeof props.borderColor === 'string') {
    out.borderColor = resolvePluginColor(props.borderColor) as BoxLayout['borderColor'];
  }
  if (typeof props.borderDimColor === 'boolean') {
    out.borderDimColor = props.borderDimColor;
  }
  if (typeof props.backgroundColor === 'string') {
    out.backgroundColor = resolvePluginColor(props.backgroundColor) as BoxLayout['backgroundColor'];
  }
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

/** densable `Jr` / `$t` — ranked `props.action` keybinding fallback seats (`bs`: Pane=2 > AbovePrompt=1 > 0). */
type PluginActionKeySeat = {
  action: string;
  rank: number;
  seq: number;
  plugin: string;
  handle: unknown;
};

const pluginActionKeySeats = (() => {
  const list: PluginActionKeySeat[] = [];
  let seq = 0;
  const remove = (seat: PluginActionKeySeat): void => {
    const idx = list.indexOf(seat);
    if (idx >= 0) list.splice(idx, 1);
  };
  return {
    add(seat: PluginActionKeySeat) {
      remove(seat);
      seat.seq = ++seq;
      list.push(seat);
    },
    remove,
    winnerOf(action: string): PluginActionKeySeat | undefined {
      return list
        .filter(item => item.action === action)
        .reduce<PluginActionKeySeat | undefined>(
          (best, cur) =>
            best === undefined || cur.rank > best.rank || (cur.rank === best.rank && cur.seq > best.seq) ? cur : best,
          undefined,
        );
    },
  };
})();

function actionComponentRank(component: string | undefined): number {
  return component === 'Pane' ? 2 : component === 'AbovePrompt' ? 1 : 0;
}

/** densable `qt` / `Ut` — register fallback keybinding for Button `props.action`. */
function PluginButtonActionKeys({
  plugin,
  handle,
  action,
  component,
}: {
  plugin: string;
  handle: unknown;
  action: string;
  component?: string;
}): ReactNode {
  const keybindingContext = useOptionalKeybindingContext();
  const dialogOpen = useHasOpenDialogs();
  const rank = actionComponentRank(component);
  const [seat] = useState<PluginActionKeySeat>(() => ({
    action,
    rank,
    seq: 0,
    plugin,
    handle,
  }));
  const bindings = keybindingContext?.bindings;
  const contexts = useMemo(
    () => [...new Set((bindings ?? []).filter(b => b.action === action).map(b => b.context))],
    [action, bindings],
  );
  useLayoutEffect(() => {
    seat.plugin = plugin;
    seat.handle = handle;
    seat.rank = rank;
  });
  useEffect(() => {
    seat.action = action;
    pluginActionKeySeats.add(seat);
    return () => pluginActionKeySeats.remove(seat);
  }, [action, seat]);
  useEffect(() => {
    if (!keybindingContext || dialogOpen) return;
    const unsubs = contexts.map(ctx =>
      keybindingContext.registerHandler({
        action,
        context: ctx,
        handler: () => {
          const winner = pluginActionKeySeats.winnerOf(action);
          if (winner === undefined) return;
          firePress(winner.plugin, winner.handle);
        },
      }),
    );
    return () => {
      for (const unsub of unsubs) unsub();
    };
  }, [keybindingContext, action, contexts, dialogOpen]);
  useInput(
    (input, key, event) => {
      if (!keybindingContext || dialogOpen) return;
      const toCheck = [...new Set([...keybindingContext.activeContexts, ...contexts, 'Global'])];
      const resolved = keybindingContext.resolve(input, key, toCheck);
      if (resolved.type !== 'match' || resolved.action !== action) return;
      const winner = pluginActionKeySeats.winnerOf(action);
      if (winner === undefined) return;
      keybindingContext.setPendingChord(null);
      firePress(winner.plugin, winner.handle);
      event.stopImmediatePropagation();
    },
    { isActive: !dialogOpen && contexts.length > 0 },
  );
  return null;
}

/** densable `NMn` — release Ink focus if activeElement is inside `node`. */
function releaseButtonInkFocus(node: DOMElement | null): void {
  if (!node) return;
  try {
    const fm = getFocusManager(node);
    let cur: DOMElement | undefined = fm.activeElement ?? undefined;
    while (cur && cur !== node) cur = cur.parentNode;
    if (cur === node) fm.blur();
  } catch {
    /* detached node */
  }
}

function PluginPressButton({
  plugin,
  handle,
  element,
  label,
  hotkey,
  action,
  plain,
  dimColor,
  variant,
  hover,
  component,
}: {
  plugin: string;
  handle: unknown;
  element?: string;
  label: string;
  hotkey?: string;
  action?: string;
  plain?: boolean;
  dimColor?: boolean;
  variant?: string;
  hover?: Record<string, unknown>;
  component?: string;
}): ReactNode {
  const focusedPress = useContext(FocusedPressContext);
  const reportHeldFocus = useContext(HeldFocusRefContext);
  const hasKeyboardFocus = focusedPress !== null && focusedPress.plugin === plugin && focusedPress.handle === handle;
  const boxRef = useRef<DOMElement | null>(null);
  const [boxHovered, setBoxHovered] = useState(false);
  const hoverScope = usePluginHoverScope(plugin, hover);
  const hoverLit = hover !== undefined && (hoverScope.isScoped ? hoverScope.isHot : boxHovered);
  const hoverTextOverrides = hoverLit ? textStyleFrom(hover) : {};
  return (
    <Box
      ref={boxRef}
      flexShrink={0}
      alignSelf="flex-start"
      {...(element !== undefined && { elementKey: element, elementPlugin: plugin })}
      {...(hotkey !== undefined && { hotkey })}
      onClick={event => {
        releaseButtonInkFocus(boxRef.current);
        event.stopImmediatePropagation();
      }}
      {...(hover !== undefined && {
        onMouseEnter: () => {
          setBoxHovered(true);
          hoverScope.onMouseEnter();
        },
        onMouseLeave: () => {
          setBoxHovered(false);
          hoverScope.onMouseLeave();
        },
      })}
    >
      {action !== undefined && (
        <PluginButtonActionKeys plugin={plugin} handle={handle} action={action} component={component} />
      )}
      <Button
        ref={hasKeyboardFocus ? reportHeldFocus : undefined}
        tabIndex={-1}
        flexShrink={0}
        alignSelf="flex-start"
        onAction={() => firePress(plugin, handle)}
      >
        {state => {
          const inverse = state.focused || state.hovered || hasKeyboardFocus;
          const dim = dimColor === true && !inverse;
          if (plain === true) {
            return (
              <Text inverse={inverse} dimColor={dim} {...hoverTextOverrides}>
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
            <Text
              inverse={inverse}
              bold
              dimColor={dim}
              color={variant === 'primary' ? 'suggestion' : undefined}
              {...hoverTextOverrides}
            >
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
  const isInputFocused = focused || (fields !== null && hasKeyboardFocus);
  /** densable `Wt` `h` — `Xjt.textOf(plugin, element) ?? value ?? ""`. */
  const shown = (fields !== null && fieldKey !== '' ? fields.textOf(plugin, fieldKey) : undefined) ?? value ?? '';
  const [cursor, setCursor] = useState(shown.length);
  const { columns: terminalColumns } = useTerminalSize();
  // densable Wt — prefer XXt body columns over full terminal width.
  const bodyColumns = useContext(PaneBodyColumnsContext);
  const columns = bodyColumns ?? terminalColumns;
  useEffect(() => {
    if (isInputFocused) setCursor(Number.MAX_SAFE_INTEGER);
  }, [isInputFocused]);
  const empty = shown === '';
  const prefix = label === undefined ? '' : `${label}: `;
  const submit = ` ⏎ ${submitLabel ?? 'submit'}`;
  const fieldColumns = Math.max(12, columns - stringWidth(prefix) - stringWidth(submit));
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
      }}
    >
      {prefix !== '' && <Text bold={isInputFocused}>{prefix}</Text>}
      {isInputFocused ? (
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
      {isInputFocused && <Text dimColor>{submit}</Text>}
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
        if (options.length > 0) {
          const curIdx = options.findIndex(option => option.value === shown);
          const nextOpt = options[(curIdx + 1) % options.length];
          if (nextOpt !== undefined) {
            firePress(plugin, handle, { value: nextOpt.value });
          }
        }
      }}
    >
      <Text wrap="truncate-end">
        {prefix !== '' && <Text bold={hasKeyboardFocus}>{prefix}</Text>}
        {current === undefined ? (
          <Text dimColor>none</Text>
        ) : (
          <Text inverse={hasKeyboardFocus && !isOpen}>{current.label ?? current.value}</Text>
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

const PLUGIN_CODE_DEFAULT_COLUMNS = 80;
const PLUGIN_DIFF_MAX_LINE = 1_000_000_000;

function sanitizePluginCodeText(line: string): string {
  return line.replace(/\t/g, '  ').replace(/[؜‪-‮⁦-⁩]/gu, '�');
}

function pluginDiffGutterWidth(hunk: StructuredPatchHunk): number {
  return `+ ${Math.max(hunk.oldStart + hunk.oldLines - 1, hunk.newStart + hunk.newLines - 1, 1)} `.length;
}

function parsePluginDiffHunks(source: string): StructuredPatchHunk[] | undefined {
  let patches: ReturnType<typeof parsePatch>;
  try {
    patches = parsePatch(source);
  } catch {
    return undefined;
  }
  const hunks = patches
    .flatMap(patch => patch.hunks)
    .map(hunk => ({
      ...hunk,
      lines: hunk.lines.filter(line => !line.startsWith('\\')),
    }));
  if (hunks.length === 0) return undefined;
  const invalid = hunks.some(
    ({ oldStart, oldLines, newStart, newLines }) =>
      ![oldStart, oldLines, newStart, newLines].every(
        value => Number.isSafeInteger(value) && value >= 0 && value <= PLUGIN_DIFF_MAX_LINE,
      ),
  );
  return invalid ? undefined : hunks;
}

function formatPluginDiffHunks(hunks: StructuredPatchHunk[], width: number, truncate: boolean): StructuredPatchHunk[] {
  return hunks.map(hunk => {
    const budget = Math.max(1, width - pluginDiffGutterWidth(hunk));
    return {
      ...hunk,
      lines: hunk.lines.map(line => {
        const prefix = line.slice(0, 1);
        const rest = sanitizePluginCodeText(line.slice(1));
        return prefix + (truncate ? truncateToWidth(rest, budget) : rest);
      }),
    };
  });
}

function clipPluginCodeLines(source: string, width: number, startLine: number | undefined): string {
  const lines = source.replace(/\n$/, '').split('\n');
  const gutter = startLine !== undefined ? String(startLine + lines.length - 1).length + 2 : 0;
  const budget = Math.max(1, width - gutter);
  return lines.map(line => truncateToWidth(sanitizePluginCodeText(line), budget)).join('\n');
}

function PluginCode({
  source,
  language,
  path,
  startLine,
  format,
  wrap,
}: {
  source?: unknown;
  language?: unknown;
  path?: unknown;
  startLine?: unknown;
  format?: unknown;
  wrap?: unknown;
}): ReactNode {
  const rawText = typeof source === 'string' ? source : '';
  const lang = typeof language === 'string' && language !== '' ? language : undefined;
  const codePath = typeof path === 'string' ? path : undefined;
  const start =
    typeof startLine === 'number' && Number.isSafeInteger(startLine) && startLine >= 1 ? startLine : undefined;
  // densable `Ye`: language → `source.${language}`; else `path ?? ""`.
  const filePath = lang !== undefined ? `source.${lang}` : (codePath ?? '');
  const codeBoxRef = useRef<DOMElement | null>(null);
  const measuredWidth = useYogaMeasure(() =>
    codeBoxRef.current ? Math.floor(measureElement(codeBoxRef.current).width) : 0,
  );
  // densable 2.1.289: highlight once at the pane's final width, not a
  // provisional 80-column pass and not a 0-width measure of an empty box.
  const bodyColumns = useContext(PaneBodyColumnsContext);
  const fallbackWidth = bodyColumns !== null && bodyColumns > 0 ? bodyColumns : PLUGIN_CODE_DEFAULT_COLUMNS;
  const width = measuredWidth > 0 ? measuredWidth : fallbackWidth;
  const truncate = wrap === 'truncate-end';
  const parsedHunks = useMemo(() => (format === 'diff' ? parsePluginDiffHunks(rawText) : undefined), [rawText, format]);
  const hunks = useMemo(
    () => (parsedHunks === undefined ? undefined : formatPluginDiffHunks(parsedHunks, width, truncate)),
    [parsedHunks, width, truncate],
  );
  const text = useMemo(
    () => (truncate ? clipPluginCodeLines(rawText, width, start) : rawText),
    [rawText, width, start, truncate],
  );
  return (
    <Box ref={codeBoxRef} flexDirection="column" flexGrow={1} flexShrink={1}>
      {hunks !== undefined ? (
        intersperse(
          hunks.map((hunk, i) => (
            <Box flexDirection="column" key={`hunk-${i}`}>
              <StructuredDiff patch={hunk} dim={false} width={width} filePath={filePath} firstLine={null} />
            </Box>
          )),
          i => (
            <NoSelect fromLeftEdge key={`ellipsis-${i}`}>
              <Text dimColor>...</Text>
            </NoSelect>
          ),
        )
      ) : text === '' ? (
        <Text>{text}</Text>
      ) : (
        // <HighlightedCode code={text} filePath={filePath} width={width} />
        <HighlightedCode
          code={text}
          filePath={filePath}
          width={width}
          startLine={start}
          lineNumbers={start !== undefined}
        />
      )}
    </Box>
  );
}

function normalizeMarkdownLinkHref(href: string): string {
  const candidate = /^www\./i.test(href) ? `http://${href}` : href;
  try {
    return new URL(candidate).href;
  } catch {
    return candidate;
  }
}

function isPressableMarkdownLink(href: string, pressableLinks: unknown): boolean {
  if (pressableLinks === undefined || pressableLinks === true) return true;
  if (!Array.isArray(pressableLinks)) return false;
  const target = normalizeMarkdownLinkHref(href);
  return pressableLinks.some(item => typeof item === 'string' && normalizeMarkdownLinkHref(item) === target);
}

const PLUGIN_MARKDOWN_LINK_SCHEMES: ReadonlySet<string> = new Set(['https', 'http', 'file']);
const PLUGIN_MARKDOWN_LINK_DELAY_MS = 500;

function PluginMarkdown({
  text,
  dimColor,
  press,
  elementKey,
  pressableLinks,
}: {
  text: string;
  dimColor?: boolean;
  press?: { plugin: string; handle: unknown };
  elementKey?: string;
  pressableLinks?: unknown;
}): ReactNode {
  const clock = useContext(ClockContext);
  const selection = useSelection();
  const [mountedAt] = useState(() => clock?.now() ?? Date.now());
  const cancelPendingRef = useRef<(() => void) | null>(null);
  const latestPressRef = useRef({ press, pressableLinks });
  latestPressRef.current = { press, pressableLinks };
  useEffect(() => () => cancelPendingRef.current?.(), []);
  const markdownProps = {
    dimColor,
    linkSchemes: PLUGIN_MARKDOWN_LINK_SCHEMES,
    stripPromptTags: false,
  };
  const body = <Markdown {...markdownProps}>{text}</Markdown>;
  if (press === undefined) {
    return elementKey === undefined ? (
      body
    ) : (
      <Box flexDirection="column" elementKey={elementKey}>
        {body}
      </Box>
    );
  }
  return (
    <Box
      flexDirection="column"
      {...(elementKey !== undefined && { elementKey })}
      elementPlugin={press.plugin}
      onClick={event => {
        const href = event.hyperlinkUrl;
        if (href === undefined || event.mods.ctrl || event.mods.alt || !isPressableMarkdownLink(href, pressableLinks)) {
          event.allowDefault();
          return;
        }
        const now = clock?.now() ?? Date.now();
        if (event.isWindowActivation || now - mountedAt < MOUNT_SETTLE_MS) {
          event.dropAsStray();
          return;
        }
        event.stopImmediatePropagation();
        cancelPendingRef.current?.();
        if (selection.hasSelection()) return;
        const unsubscribe = selection.subscribe(() => {
          if (selection.hasSelection()) cancelPendingRef.current?.();
        });
        const fire = () => {
          cancelPendingRef.current = null;
          unsubscribe();
          const current = latestPressRef.current;
          if (current.press !== undefined && isPressableMarkdownLink(href, current.pressableLinks)) {
            firePress(current.press.plugin, current.press.handle, { href });
          }
        };
        const cancelTimer = clock
          ? clock.setTimeout(fire, PLUGIN_MARKDOWN_LINK_DELAY_MS)
          : (() => {
              const timer = setTimeout(fire, PLUGIN_MARKDOWN_LINK_DELAY_MS);
              return () => clearTimeout(timer);
            })();
        cancelPendingRef.current = () => {
          cancelPendingRef.current = null;
          unsubscribe();
          cancelTimer();
        };
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
  component = 'AbovePrompt',
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
  /** densable `Z` / `L1t(..., "Client")` component. */
  component?: string;
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
  const [initialProps] = useState(() => props);
  const lastPropsRef = useRef<unknown>(initialProps);
  const boxRef = useRef<DOMElement | null>(null);
  const measuredWidth = useYogaMeasure(() => measurePluginClientBox(boxRef.current).width);
  const measuredHeight = useYogaMeasure(() => measurePluginClientBox(boxRef.current).height);
  useLayoutEffect(() => {
    const instance = acquirePluginClient({
      plugin,
      component,
      key: elementKey ?? '',
      module: moduleName,
      requestId,
      props: initialProps,
    });
    instanceRef.current = instance;
    lastPropsRef.current = initialProps;
    setSnapshot(instance.getSnapshot());
    const unsub = instance.subscribe(() => setSnapshot(instance.getSnapshot()));
    return () => {
      unsub();
      instance.release();
      instanceRef.current = DETACHED_CLIENT;
    };
  }, [plugin, component, moduleName, elementKey, requestId, initialProps]);
  useLayoutEffect(() => {
    if (Object.is(lastPropsRef.current, props)) return;
    lastPropsRef.current = props;
    instanceRef.current.setProps(props);
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
      telemetryMessage={() => L1t(component, tellerOfPlugin(plugin), 'Client')}
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
        {...(snapshot.status !== 'drawn' && snapshot.status !== 'failed' ? { drawPending: true } : {})}
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
          <DrawingNode
            node={snapshot.tree}
            plugin={plugin}
            requestId={requestId}
            index={0}
            engine={engine}
            component={component}
          />
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
  plugin,
  elementKey,
  elementPlugin,
  children,
}: {
  isInline: boolean;
  props: Record<string, unknown>;
  hover: Record<string, unknown>;
  plugin?: string;
  elementKey?: string;
  elementPlugin?: string;
  children: ReactNode;
}): ReactNode {
  const [hot, setHot] = useState(false);
  const scope = usePluginHoverScope(plugin ?? elementPlugin, hover);
  const active = scope.isScoped ? scope.isHot : hot;
  if (isInline) {
    const textProps = {
      ...textStyleFrom(props),
      ...(active ? textStyleFrom(hover) : {}),
    };
    return (
      <Text
        {...textProps}
        hoverFollowsPaint={true}
        onMouseEnter={() => {
          setHot(true);
          scope.onMouseEnter();
        }}
        onMouseLeave={() => {
          setHot(false);
          scope.onMouseLeave();
        }}
      >
        {children}
      </Text>
    );
  }
  const layout = { ...layoutFrom(props), ...(active ? layoutFrom(hover) : {}) };
  return (
    <Box
      {...layout}
      {...(elementKey !== undefined && { elementKey })}
      {...(elementPlugin !== undefined && { elementPlugin })}
      flexDirection={layout.flexDirection ?? 'column'}
      hoverFollowsPaint={true}
      onMouseEnter={() => {
        setHot(true);
        scope.onMouseEnter();
      }}
      onMouseLeave={() => {
        setHot(false);
        scope.onMouseLeave();
      }}
    >
      {children}
    </Box>
  );
}

function childList(node: Record<string, unknown>, props: Record<string, unknown>): unknown[] {
  const raw = props.children ?? node.children;
  return flattenDrawingChildren(raw);
}

/**
 * densable `pt` → Ink: Button/Input/Select/Code/Markdown/Client/Svg/Link/Raster/Image/engine/Box/Text.
 * Stamps plugin onto Raster like gold `Te`.
 */
export function DrawingNode({
  node,
  plugin: fallbackPlugin,
  requestId,
  index,
  engine,
  seenKeys,
  component = 'AbovePrompt',
}: {
  node: unknown;
  plugin: string;
  requestId?: string;
  index: number;
  /** densable `pt` `i(ref)` — engine node. Pane/AbovePrompt is null; UserMessage is the engine draw. */
  engine?: ReactNode;
  seenKeys?: Set<unknown>;
  /** densable `Z` / Client `L1t` component. */
  component?: string;
}): ReactNode {
  if (typeof node === 'string') return <Text>{node}</Text>;
  if (Array.isArray(node)) {
    return flattenDrawingChildren(node).map((child, i) => (
      <DrawingNode
        key={i}
        node={child}
        plugin={fallbackPlugin}
        requestId={requestId}
        index={i}
        engine={engine}
        component={component}
      />
    ));
  }
  if (!isRecord(node)) return null;
  if (node.type === 'engine') return engine ?? null;
  const props = isRecord(node.props) ? node.props : node;
  const type = typeof node.type === 'string' ? node.type : undefined;
  const key = (typeof props.key === 'string' && props.key) || (typeof node.key === 'string' && node.key) || undefined;
  const plugin = stampedPlugin(node, fallbackPlugin);
  const owner = plugin;
  const req =
    (typeof props.requestId === 'string' && props.requestId) ||
    (typeof node.requestId === 'string' && node.requestId) ||
    requestId;
  const columns =
    typeof props.columns === 'number' ? props.columns : typeof node.columns === 'number' ? node.columns : 1;
  const rows = typeof props.rows === 'number' ? props.rows : typeof node.rows === 'number' ? node.rows : 1;
  const cells = typeof props.cells === 'string' ? props.cells : typeof node.cells === 'string' ? node.cells : undefined;
  if (type === 'Raster' && key && req) {
    return (
      <PluginRaster
        key={`raster:${plugin}:${key}`}
        plugin={plugin}
        requestId={req}
        elementKey={key}
        columns={columns}
        rows={rows}
        cells={cells}
      />
    );
  }
  if (type === 'Image' && key && req) {
    const alt = typeof props.alt === 'string' ? props.alt : typeof node.alt === 'string' ? node.alt : undefined;
    const imageSource = isRecord(props.source) ? props.source : isRecord(node.source) ? node.source : undefined;
    return (
      <PluginImage
        key={`image:${plugin}:${key}`}
        plugin={plugin}
        requestId={req}
        elementKey={key}
        source={imageSource}
        columns={columns}
        rows={rows}
        alt={alt}
      />
    );
  }
  if (type === 'Button') {
    const press = pressOf(node, owner);
    if (press === undefined) return null;
    const childLabel = childList(node, props)
      .filter((child): child is string => typeof child === 'string')
      .join('');
    const buttonHover = isRecord(node.hover) ? node.hover : isRecord(props.hover) ? props.hover : undefined;
    return (
      <PluginPressButton
        plugin={press.plugin}
        handle={press.handle}
        element={key}
        label={stringProp(props, node, 'label') ?? childLabel}
        hotkey={stringProp(props, node, 'hotkey')}
        action={stringProp(props, node, 'action')}
        plain={boolProp(props, 'plain')}
        dimColor={boolProp(props, 'dimColor')}
        variant={stringProp(props, node, 'variant')}
        hover={buttonHover}
        component={component}
      />
    );
  }
  if (type === 'Input') {
    const press = pressOf(node, owner);
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
    const press = pressOf(node, owner);
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
    return (
      <PluginCode
        source={props.source}
        language={props.language}
        path={props.path}
        startLine={props.startLine}
        format={props.format}
        wrap={props.wrap}
      />
    );
  }
  if (type === 'Markdown') {
    const text = stringProp(props, node, 'text') ?? '';
    return (
      <PluginMarkdown
        text={text}
        dimColor={boolProp(props, 'dimColor')}
        press={'press' in node ? pressOf(node, owner) : undefined}
        elementKey={key}
        pressableLinks={props.pressableLinks}
      />
    );
  }
  if (type === 'Client') {
    return (
      <PluginClient
        key={`client:${plugin}:${key}`}
        plugin={plugin}
        moduleName={stringProp(props, node, 'module') ?? ''}
        elementKey={key}
        requestId={req}
        component={component}
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
        component={component}
      />
    ),
  );
  if (type === 'Link') {
    const href = stringProp(props, node, 'href') ?? '';
    const label = stringProp(props, node, 'label');
    // densable pane Link: visible URL is `PYe(k)`, OSC 8 url is `HYe(k)`.
    const shown = encodePluginLinkLabel(href);
    const inner = mapped.length > 0 ? mapped : [label ?? shown];
    const fallback =
      mapped.length === 0 && label === undefined ? undefined : (
        <Text>
          {inner} <Text dimColor>{shown}</Text>
        </Text>
      );
    return (
      <Link url={encodePluginLinkHref(href)} fallback={fallback}>
        {inner}
      </Link>
    );
  }
  const groupPlugin =
    isRecord(node.group) && typeof node.group.plugin === 'string' && node.group.plugin !== ''
      ? node.group.plugin
      : owner;
  const hover = isRecord(node.hover) ? node.hover : isRecord(props.hover) ? props.hover : undefined;
  if (type === 'Box' && key !== undefined) {
    const live = seenKeys === undefined || !seenKeys.has(key);
    if (seenKeys !== undefined) seenKeys.add(key);
    const layoutProps = { ...props };
    delete layoutProps.key;
    if (hover !== undefined) {
      return (
        <HoverBox
          key={live ? String(key) : undefined}
          isInline={false}
          props={layoutProps}
          hover={hover}
          plugin={groupPlugin}
          elementKey={String(key)}
          elementPlugin={owner}
        >
          {mapped}
        </HoverBox>
      );
    }
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
    const textProps = textStyleFrom(props);
    if (hover !== undefined) {
      return (
        <HoverBox isInline props={props} hover={hover} plugin={groupPlugin}>
          {text !== undefined ? text : mapped}
        </HoverBox>
      );
    }
    return <Text {...textProps}>{text !== undefined ? text : mapped}</Text>;
  }
  if (hover !== undefined) {
    return (
      <HoverBox isInline={false} props={props} hover={hover} plugin={groupPlugin}>
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

function extractEngineSlotProps(node: unknown): Record<string, unknown> | undefined {
  if (!isRecord(node)) return undefined;
  if (node.type === 'engine') {
    return isRecord(node.props) ? node.props : undefined;
  }
  if (node.type === 'Button' || node.type === 'Input' || node.type === 'Select') {
    return undefined;
  }
  const props = isRecord(node.props) ? node.props : {};
  for (const child of childList(node, props)) {
    const found = extractEngineSlotProps(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * densable `fr` / `ar` consumer: `Hoe().ui.render` then `pt`. Fail and
 * engine reply settle as gold `RZ` so `pr` can see `isFallback`.
 */
function useRenderDrawing(
  input: Record<string, unknown> | null,
  inputKey: string,
): {
  drawn: unknown;
  drawnPlugin: string;
  engineProps: Record<string, unknown> | undefined;
  markThrown: () => void;
} {
  const [drawn, setDrawn] = useState<unknown>(undefined);
  const [drawnPlugin, setDrawnPlugin] = useState('');
  const [engineProps, setEngineProps] = useState<Record<string, unknown> | undefined>(undefined);
  const inputRef = useRef(input);
  inputRef.current = input;
  const version = useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  useSyncExternalStore(subscribeRasterFrames, snapshot, snapshot);
  useEffect(() => {
    const current = inputRef.current;
    if (current === null) {
      setDrawn(undefined);
      setDrawnPlugin('');
      setEngineProps(undefined);
      return;
    }
    const abort = new AbortController();
    void evaluateUiRender(current, abort.signal).then(
      tree => {
        if (!abort.signal.aborted) {
          const owner =
            extractDrawnPlugin(tree, String(current.component ?? ''), String(current.requestId ?? '')) ??
            getLastUiRenderPlugin();
          setDrawnPlugin(owner);
          setEngineProps(extractEngineSlotProps(tree));
          setDrawn(isEngineDrawing(tree) ? RZ : tree);
        }
      },
      err => {
        // densable `mr` — site failed log then engine fallback (`RZ`).
        logForDebugging(
          `ui.render (${String(current.component)} ${String(current.requestId ?? '')}): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!abort.signal.aborted) {
          setEngineProps(undefined);
          setDrawn(RZ);
        }
      },
    );
    return () => {
      abort.abort();
    };
  }, [inputKey, version]);
  const markThrown = useCallback(() => {
    setEngineProps(undefined);
    setDrawn(RZ);
  }, []);
  return { drawn, drawnPlugin, engineProps, markThrown };
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
  component: string = site,
): ReactNode {
  if (drawn === undefined || isEngineDrawing(drawn)) return engine ?? null;
  const node = (
    <DrawingNode node={drawn} plugin={plugin} requestId={requestId} index={0} engine={engine} component={component} />
  );
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
  const isFocused = useSyncExternalStore(
    subscribePanes,
    () => getPanesState().focusedId !== null,
    () => getPanesState().focusedId !== null,
  );
  if (width <= 0) return null;
  const columns = Math.max(0, width - DOCK_GRIP_COLUMNS);
  return (
    <Box ref={hostRef} flexGrow={1} flexDirection="row" width={width}>
      <PluginDockGrip columns={width} onResize={onResize} onSettle={onSettle} isFocused={isFocused} />
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
    // densable BO onError: u3(null) + l8e(id,{kind:"unload"}) + L1t + Jmn.
    focusPane(null);
    void closePluginPane(pane.id, { kind: 'unload' });
    reportDrawWhileDrawn('Pane', [pane.plugin || getLastUiRenderPlugin()], error, addNotification);
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
  const paneClipRef = useRef<DOMElement | null>(null);
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
  const terminalSize = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const panesViewport = getPanesTerminalSize();
  const paneViewportInfo = {
    columns: panesViewport?.conversationColumns ?? terminalSize.columns,
    rows: panesViewport?.rows ?? terminalSize.rows,
    isFullscreen,
  };
  const input = {
    surface: 'terminal',
    component: 'Pane',
    requestId: pane.id,
    viewport: paneViewportInfo,
    props: {
      title: pane.title,
      isFocused: pane.isFocused,
      bodyColumns: pane.columns,
      placement: fill ? 'dock' : 'inline',
      scroll: { offset: paneScrollOffset, bodyRows: paneViewport },
      view: viewingAgentView,
    },
  };
  const { drawn } = useRenderDrawing(
    input,
    `${pane.id}\0${pane.title}\0${String(pane.isFocused)}\0${String(pane.columns)}\0${String(paneScrollOffset)}\0${String(paneViewport)}\0${fill ? 'dock' : 'inline'}\0${String(paneViewportInfo.columns)}\0${String(paneViewportInfo.rows)}\0${String(isFullscreen)}\0${JSON.stringify(viewingAgentView)}`,
  );
  const paneHeldRows = useHeldSiteRows({
    isOff: siteIsOff(hasMatchingFunctionHook('ui.render', { component: 'Pane' }), input),
    input: `${pane.id}\0${pane.title}`,
    drawn,
    isFallback: isEngineFallback(drawn),
    lastRows: paneTreeRows,
    contentRows: paneTreeRows,
  });
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
  const paneInputRef = useRef<PluginInputMapApi | null>(null);
  const paneRing = useMemo(() => {
    const base = bandRingHandlers({
      focusables: paneFocusables,
      focusIndexNow: () => paneFocusIndexRef.current,
      focusByPerson,
      leave: leavePaneRing,
      submit: focusable => {
        if (typeof focusable.element !== 'string' || focusable.element === '') return;
        paneInputRef.current?.submit({
          plugin: focusable.plugin,
          handle: focusable.handle,
          element: focusable.element,
          ...(typeof focusable.value === 'string' && { value: focusable.value }),
        });
      },
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
  useRegisterOverlay('above-prompt-input', inputFocused);
  useRegisterOverlay('above-prompt-select', selectFocused);
  useLayoutEffect(() => {
    setPaneFieldHeld(paneFieldActive);
    return () => setPaneFieldHeld(false);
  }, [paneFieldActive]);
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
    isActive: paneHeld && (paneFocusIndex !== null || engineHeld !== null) && !selectFocused,
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
  paneInputRef.current = paneInput;
  useKeybinding('abovePrompt:highlightNext', paneSelect.handlers['abovePrompt:highlightNext'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });
  useKeybinding('abovePrompt:highlightPrevious', paneSelect.handlers['abovePrompt:highlightPrevious'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });
  useKeybinding('abovePrompt:press', paneSelect.handlers['abovePrompt:press'], {
    context: 'AbovePromptSelect',
    isActive: selectFocused,
  });
  useInput(
    (inputChar, key, event) => {
      if (paneSelect.intercept(inputChar, key)) event.stopImmediatePropagation();
    },
    { isActive: selectFocused, prepend: true },
  );
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
  // densable mee `[qe,We]=g(!1); x(()=>We(!1),[M,v])` — if a plugin refuses
  // close on Escape, do not swallow subsequent Escape presses.
  const [escapeRefused, setEscapeRefused] = useState(false);
  useEffect(() => {
    setEscapeRefused(false);
  }, [paneHeld, pane]);
  useKeybinding(
    'chat:cancel',
    () => {
      const id = paneIdRef.current;
      if (id === undefined) return false;
      if (!promptEmpty || queueEditing || getPanesState().closing.includes(id)) return false;
      void closePluginPane(id, { kind: 'person' }).then(() => {
        setEscapeRefused(getPanesState().open.some(openPane => openPane.id === id));
      });
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
        !footerSelected &&
        !escapeRefused,
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
                dialogOpen || overlayActive
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
                      paneScrollBy(sign * rows, relativeWheelPointer(paneClipRef, event));
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
              {...(rows !== undefined ? (fill ? { height: rows } : { maxHeight: rows }) : {})}
              {...(!fill && rows === undefined && (pane.bodyRows > 0 ? pane.bodyRows : pane.rows) !== undefined
                ? { maxHeight: pane.bodyRows > 0 ? pane.bodyRows : pane.rows }
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
                  ref={paneClipRef}
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
                    {...(paneHeldRows !== undefined && { minHeight: paneHeldRows })}
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
  onHoldsBandChange,
}: {
  isWorking: boolean;
  hasSurvey?: boolean;
  /** densable JW `Un===""` — prompt draft empty (REPL `inputValue === ''`). */
  promptEmpty?: boolean;
  /** densable `_Ee` `onHoldsBandChange` (`N`) — true while visible band holds hotkeys. */
  onHoldsBandChange?: (holds: boolean) => void;
}): ReactNode {
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  // densable `_Ee` `bt` from tot leftover `f5` (`Pe`), not a second floor(rows/2).
  const leftoverOf = useContext(AbovePromptLeftoverContext);
  const { addNotification } = useNotifications();
  const [aboveResetKey, setAboveResetKey] = useState(0);
  const bandCollapsed = useBandCollapsed();
  const panesFocusRequest = useSyncExternalStore(subscribePanes, () => getPanesState().focusRequest);
  const panesOpenCount = useSyncExternalStore(subscribePanes, () => getPanesState().open.length);
  const contentRef = useRef<DOMElement | null>(null);
  const bandClipRef = useRef<DOMElement | null>(null);
  const leftoverHostRef = useRef<DOMElement | null>(null);
  const heldFocusRef = useRef<{ node: DOMElement; index: number } | null>(null);
  const [focusPlaceBump, setFocusPlaceBump] = useState(0);
  // densable `d$` — store is source of truth for settled budget used by bandWindow.
  const settledFromStore = useSettledBudget();
  // densable `Me` — focus index: number | 'band' | null.
  const [focusIndex, setFocusIndex] = useState<number | 'band' | null>(null);
  const focusIndexRef = useRef(focusIndex);
  focusIndexRef.current = focusIndex;
  // densable `_Ee` `bt=$l(...)` / `Rt=$l` / `dn`/`Wn=$l(Jq)`.
  const promptRoom = useYogaMeasure(() =>
    leftoverPluginBandBudget(
      leftoverOf,
      leftoverOf === null ? null : leftoverOf(),
      leftoverHostRef.current,
      leftoverHostRef.current?.yogaNode?.getComputedHeight() ?? 0,
      getSettledBudget(),
      rows,
    ),
  );
  const treeRows = useYogaMeasure(() => contentRef.current?.yogaNode?.getComputedHeight() ?? 0);
  const focusTop = useYogaMeasure(() =>
    heldFocusEdge(
      {
        held: heldFocusRef.current,
        index: typeof focusIndexRef.current === 'number' ? focusIndexRef.current : null,
        content: contentRef.current,
      },
      'top',
    ),
  );
  const focusBottom = useYogaMeasure(() =>
    heldFocusEdge(
      {
        held: heldFocusRef.current,
        index: typeof focusIndexRef.current === 'number' ? focusIndexRef.current : null,
        content: contentRef.current,
      },
      'bottom',
    ),
  );
  const settledBudget = settledFromStore ?? promptRoom;
  const [bandInputFocused, setBandInputFocused] = useState<FocusedInput | null>(null);
  const bandSelectRef = useRef<PluginSelectSeat | null>(null);
  const bandInputRef = useRef<PluginInputMapApi | null>(null);
  const toggleShortcut = getShortcutDisplay('abovePrompt:toggle', 'Chat', 'ctrl+x ctrl+a');
  // densable `Wr=l1()` — dialog open blocks auto-settle.
  const dialogOpen = useHasOpenDialogs();
  // densable overlay (BackgroundTasksDialog registers as overlay, not a dialog).
  const overlayActive = useIsOverlayActive();
  const bandBlocked = dialogOpen || overlayActive;
  // Fullscreen Background tasks replaces the prompt; leave no stale band row above it.
  const backgroundTasksOpen = useAppState(s => s.activeOverlays.has('background-tasks-dialog'));

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
        !bandBlocked &&
        focusIndex === null &&
        panes.focusedId === null &&
        panes.placements > 0,
    );
  }, [panesFocusRequest, promptEmpty, hasSurvey, bandBlocked, focusIndex]);

  // densable `NZ` settle: fold live budget into `d$` settledBudget after HEIGHT_SETTLE_MS.
  useEffect(() => {
    if (settledFromStore === promptRoom) return;
    const handle = setTimeout(() => setSettledBudget(promptRoom), HEIGHT_SETTLE_MS);
    return () => clearTimeout(handle);
  }, [promptRoom, settledFromStore]);

  const listRows = useOpenListRows();
  const { windowRows, hasCue, maxOffset, bodyRows } = bandWindow({
    budget: promptRoom,
    settledBudget,
    treeRows: Math.max(0, treeRows - listRows),
  });
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
  const panesViewport = getPanesTerminalSize();
  const aboveViewport = {
    columns: panesViewport?.conversationColumns ?? columns,
    rows: panesViewport?.rows ?? rows,
    isFullscreen,
  };
  const { drawn, drawnPlugin, markThrown } = useRenderDrawing(
    {
      surface: 'terminal',
      component: 'AbovePrompt',
      requestId: BAND_REQUEST_ID,
      viewport: aboveViewport,
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
    `${String(isWorking)}\0${String(hasSurvey)}\0${String(aboveViewport.columns)}\0${String(aboveViewport.rows)}\0${String(isFullscreen)}\0${String(settledBudget)}\0${String(bandCollapsed)}\0${String(offset)}\0${String(bodyRows)}\0${JSON.stringify(viewingAgentView)}`,
  );
  const hasPluginTree =
    drawn !== undefined &&
    drawn !== null &&
    (typeof drawn === 'string' || (typeof drawn === 'object' && (drawn as { type?: string }).type !== 'engine'));
  const aboveHeldRows = useHeldSiteRows({
    isOff: siteIsOff(hasMatchingFunctionHook('ui.render', { component: 'AbovePrompt' }), {
      props: {
        hasSurvey,
        isWorking,
        maxRows: settledBudget,
        bodyColumns: aboveBodyColumns,
        scroll: { offset, bodyRows },
        view: viewingAgentView,
      },
    }),
    input: `${String(isWorking)}\0${String(hasSurvey)}\0${String(settledBudget)}\0${String(offset)}`,
    drawn,
    isFallback: isEngineFallback(drawn),
    lastRows: treeRows,
    contentRows: treeRows,
  });

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
  useRegisterOverlay('above-prompt-input', inputFocused);
  useRegisterOverlay('above-prompt-select', selectFocused);

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
  // densable `OZ(Nn)` — first autoFocus index, or 0 when focusables exist.
  const entryIndex = useMemo(() => {
    if (focusables.length === 0) return null;
    const auto = focusables.findIndex(row => row.isAutoFocus);
    return Math.max(0, auto);
  }, [focusables]);
  const fromNullBandFocus = nextBandFocus({ focus: null, count: focusables.length });
  // densable `vn`: transition null→'band', then act(moveByPerson or Ie+Jt).
  const focusBandStep = useCallback(
    (pick: (wasNull: boolean) => number | 'band' | null) => {
      const wasNull = focusIndexRef.current === null;
      if (wasNull) clearFocusIndex('band');
      bandHost.act(() => {
        const chosen = pick(wasNull);
        if (typeof chosen === 'number') {
          bandHost.moveByPerson({
            index: chosen,
            apply: () => landFocusIndex(chosen),
          });
        } else if (chosen !== null) {
          landFocusIndex(chosen);
        } else {
          setFocusPlaceBump(n => n + 1);
        }
      });
    },
    [bandHost, clearFocusIndex],
  );
  // densable `Kr`: click or element click focuses band (jumping to OZ on initial focus).
  const focusBandByClick = useCallback(
    (index: number | null) => {
      if (!bandLiveGate || bandBlocked || bandCollapsed) return;
      focusPane(null);
      const target = index ?? (focusIndexRef.current === null ? entryIndex : null);
      if (target === null) {
        if (focusIndexRef.current === null && fromNullBandFocus !== null) {
          clearFocusIndex(fromNullBandFocus);
        }
        return;
      }
      focusBandStep(() => target);
    },
    [bandLiveGate, bandBlocked, bandCollapsed, entryIndex, fromNullBandFocus, focusBandStep, clearFocusIndex],
  );

  const bandClickedPress = useMemo(
    () => clickFocusByPress(focusables, index => focusBandByClick(index)),
    [focusables, focusBandByClick],
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
      const liveBandNext = nextBandFocus({ focus: focusIndexRef.current, count: focusables.length }) ?? bandNext;
      const canBandStep = bandLive && panes.focusedId === null && liveBandNext !== null;
      const pickAutoOrStep = (wasNull: boolean, step: number | 'band' | null) =>
        wasNull && typeof step === 'number' ? (entryIndex ?? step) : step;

      if (panes.focusedId !== null) {
        // densable u3($Fr($r)) — last pane yields null and clears focus.
        focusPane(nextFocusedPaneId(panes));
        return;
      }
      if (canBandStep) {
        focusBandStep(wasNull =>
          pickAutoOrStep(wasNull, nextBandFocus({ focus: focusIndexRef.current, count: focusables.length })),
        );
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
        focusBandStep(wasNull => pickAutoOrStep(wasNull, fromNull));
        return;
      }
      return false;
    },
    {
      context: 'Chat',
      isActive:
        panesFocusedId !== null ||
        panesOpenCount > 0 ||
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
    isActive: ringActive && focusIndex !== null && !selectFocused,
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
  const bandHotkeys = useMemo(
    () => (bandCollapsed ? new Map<string, { plugin: string; handle: unknown }>() : hotkeyMapOfDrawing(drawn)),
    [bandCollapsed, drawn],
  );
  // densable `_Ee` `Us=Xo.size>0; Xt(()=>{N?.(Us&&!Qo(Zo))},...); Xt(()=>()=>N?.(!1),[N])`.
  const holdsBand = bandHotkeys.size > 0 && hasPluginTree;
  useLayoutEffect(() => {
    onHoldsBandChange?.(holdsBand);
  }, [holdsBand, onHoldsBandChange]);
  useLayoutEffect(
    () => () => {
      onHoldsBandChange?.(false);
    },
    [onHoldsBandChange],
  );
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
  const digitVisible = (digit: string): boolean =>
    hotkeyDigitVisible(hasCue, digit, hotkeySeatsIn(contentRef.current), offset, windowRows);
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
      scrollBy(sign * step, relativeWheelPointer(bandClipRef, event));
      event.preventDefault();
      event.stopPropagation();
    },
    [scrollBy],
  );

  // densable: collapsed → n$ inside We (ITt host stays bound).
  if (backgroundTasksOpen) return null;
  if (bandCollapsed) {
    if (!hasPluginTree) {
      return (
        <Box
          ref={node => {
            leftoverHostRef.current = node;
            bandAwayRef.current = node;
          }}
          flexShrink={0}
          flexDirection="column"
          maxHeight={promptRoom + listRows}
          overflowY="hidden"
        />
      );
    }
    return (
      <Box
        ref={node => {
          leftoverHostRef.current = node;
          bandAwayRef.current = node;
        }}
        flexShrink={0}
        flexDirection="column"
        maxHeight={promptRoom + listRows}
        overflowY="hidden"
        onWheel={hasCue && !bandBlocked ? bandWheel : undefined}
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
  const focusedPress = focused === null ? null : { plugin: focused.plugin, handle: focused.handle };
  const onAboveDrawError = (error: Error): void => {
    // densable L1t + Jmn/NBr/Ymn.AbovePrompt; markThrown settles RZ for pr.
    markThrown();
    const owner = extractDrawnPlugin(drawn, 'AbovePrompt', BAND_REQUEST_ID) ?? (drawnPlugin || scrollOwner);
    reportDrawWhileDrawn('AbovePrompt', [owner], error, addNotification);
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
                  leftoverHostRef.current = node;
                  bandAwayRef.current = node;
                }}
                position="relative"
                flexShrink={0}
                flexDirection="column"
                maxHeight={promptRoom + listRows}
                overflowY="hidden"
                onWheel={hasCue && !bandBlocked ? bandWheel : undefined}
              >
                <Box
                  ref={bandClipRef}
                  flexDirection="column"
                  flexShrink={0}
                  maxHeight={windowRows + listRows}
                  overflowY="hidden"
                  onClick={event => {
                    if (event.hyperlinkUrl !== undefined) event.allowDefault();
                    if (event.isWindowActivation || event.droppedAsStray) return;
                    focusBandByClick(null);
                  }}
                >
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
                    {...(aboveHeldRows !== undefined && { minHeight: aboveHeldRows })}
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

/**
 * Render an already-evaluated plugin `ui.render` tree with an `engine` slot
 * (`{ type: "engine", ref: 0 }`) and live `ui.blit` frame subscription.
 */
export function PluginRenderedTree({
  node,
  plugin,
  requestId,
  component,
  engine,
}: {
  node: unknown;
  plugin?: string;
  requestId?: string;
  component: string;
  engine?: ReactNode;
}): ReactNode {
  useSyncExternalStore(subscribeRasterFrames, snapshot, snapshot);
  const [resetKey, setResetKey] = useState(0);
  const [failedNode, setFailedNode] = useState<unknown>(undefined);
  const focusables = useMemo(() => focusablesOfDrawing(node), [node]);
  const owner = useMemo(
    () => extractDrawnPlugin(node, component, requestId) ?? (plugin || getLastUiRenderPlugin()),
    [node, component, requestId, plugin],
  );
  if (!hasPluginDrawing(node) || node === failedNode) return engine ?? null;
  const hasInteractiveFields = focusables.some(row => row.tag === 'Input' || row.tag === 'Select');
  const renderedBody = (
    <DrawingNode node={node} plugin={owner} requestId={requestId} index={0} engine={engine} component={component} />
  );
  return (
    <PaneErrorBoundary
      resetKey={resetKey}
      fallback={engine ?? null}
      onError={error => {
        logForDebugging(`ui.render (${component} ${requestId ?? ''}): draw failed: ${error.message}`, {
          level: 'error',
        });
        setFailedNode(() => node);
        setResetKey(n => n + 1);
      }}
    >
      {hasInteractiveFields ? (
        <PluginSiteFieldsOwned requestId={requestId} focusables={focusables}>
          {renderedBody}
        </PluginSiteFieldsOwned>
      ) : (
        renderedBody
      )}
    </PaneErrorBoundary>
  );
}

/**
 * densable 2.1.289 `Meo` — validate that an AskUserQuestion rewrite only
 * relabels question text/header (same count, same multiSelect, same option
 * labels/previews, unique question texts).
 */
export function askUserQuestionRewriteProblem(
  rewritten: readonly unknown[],
  original: readonly unknown[],
): string | undefined {
  if (rewritten.length !== original.length) {
    return `change how many questions there are (${original.length} asked, ${rewritten.length} drawn)`;
  }
  for (const [index, asked] of original.entries()) {
    const drawn = rewritten[index];
    if (drawn === undefined) return `leave question ${index + 1} out`;
    if (!isRecord(asked) || !isRecord(drawn)) return 'leave question schema invalid';
    if ((drawn.multiSelect ?? false) !== (asked.multiSelect ?? false)) {
      return `change whether question ${index + 1} is multi-select`;
    }
    const askedOpts = Array.isArray(asked.options) ? asked.options : [];
    const drawnOpts = Array.isArray(drawn.options) ? drawn.options : [];
    const askedLabels = askedOpts.map(o => (isRecord(o) ? o.label : undefined));
    const drawnLabels = drawnOpts.map(o => (isRecord(o) ? o.label : undefined));
    if (JSON.stringify(drawnLabels) !== JSON.stringify(askedLabels)) {
      return `change question ${index + 1}'s options (asked ${JSON.stringify(askedLabels)}, drawn ${JSON.stringify(drawnLabels)})`;
    }
    const askedPreviews = askedOpts.map(o => (isRecord(o) ? o.preview : undefined));
    const drawnPreviews = drawnOpts.map(o => (isRecord(o) ? o.preview : undefined));
    if (JSON.stringify(drawnPreviews) !== JSON.stringify(askedPreviews)) {
      return `change question ${index + 1}'s previews`;
    }
    const drawnText = drawn.question;
    const sameQuestion = (row: unknown, rowIndex: number): boolean =>
      rowIndex !== index && isRecord(row) && row.question === drawnText;
    const quoted = JSON.stringify(drawnText);
    if (rewritten.some(sameQuestion)) {
      return `give two questions one text (${quoted})`;
    }
    if (original.some(sameQuestion)) {
      return `give question ${index + 1} another question's text (${quoted})`;
    }
  }
  return undefined;
}

/**
 * densable 2.1.289 `YXe` — validate rewritten AskUserQuestion questions; fall
 * back to `original` with a warning log on schema/shape mismatch.
 */
export function validateAskUserQuestionRewrite(rewritten: unknown, original: readonly unknown[]): readonly unknown[] {
  if (rewritten === undefined || rewritten === original || JSON.stringify(rewritten) === JSON.stringify(original)) {
    return original;
  }
  if (
    !Array.isArray(rewritten) ||
    !rewritten.every(
      item =>
        isRecord(item) &&
        typeof item.question === 'string' &&
        item.question.length > 0 &&
        Array.isArray(item.options) &&
        item.options.every(opt => isRecord(opt) && typeof opt.label === 'string'),
    )
  ) {
    logForDebugging(
      `ui.render (AskUserQuestion): rewritten questions do not match the tool's input schema; drawing the original`,
      { level: 'warn' },
    );
    return original;
  }
  const problem = askUserQuestionRewriteProblem(rewritten, original);
  if (problem !== undefined) {
    logForDebugging(
      `ui.render (AskUserQuestion): a rewrite may relabel the questions but not ${problem}; drawing the original`,
      { level: 'warn' },
    );
    return original;
  }
  return rewritten;
}

/**
 * densable 2.1.289 `zXe` — map submitted answer/annotation keys from rewritten
 * question texts back to the original question texts.
 */
export type AskUserQuestionSubmission = {
  behavior?: string;
  updatedInput?: {
    answers?: Record<string, string>;
    annotations?: Record<string, unknown>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export function restoreAskUserQuestionResult<T extends AskUserQuestionSubmission>(
  result: T,
  drawnQuestions: readonly unknown[],
  askedQuestions: readonly unknown[],
): T {
  if (result.behavior !== 'allow' || drawnQuestions === askedQuestions || result.updatedInput === undefined) {
    return result;
  }
  const remapRecord = <V,>(
    record: Record<string, V> | undefined,
    transform: (value: V, index: number) => V,
  ): Record<string, V> | undefined => {
    if (record === undefined) return undefined;
    const out: Record<string, V> = {};
    for (const [key, val] of Object.entries(record)) {
      const idx = drawnQuestions.findIndex(q => isRecord(q) && q.question === key);
      const orig = idx === -1 ? undefined : askedQuestions[idx];
      const origKey = isRecord(orig) && typeof orig.question === 'string' ? orig.question : key;
      out[origKey] = orig === undefined ? val : transform(val, idx);
    }
    return out;
  };
  const updatedInput = result.updatedInput;
  const answers = remapRecord(updatedInput.answers, (val, idx) => {
    const drawnQ = drawnQuestions[idx];
    const askedQ = askedQuestions[idx];
    const drawnOpts = isRecord(drawnQ) && Array.isArray(drawnQ.options) ? drawnQ.options : [];
    const askedOpts = isRecord(askedQ) && Array.isArray(askedQ.options) ? askedQ.options : [];
    const optIdx = drawnOpts.findIndex(o => isRecord(o) && o.label === val);
    if (optIdx === -1) return val;
    const origOpt = askedOpts[optIdx];
    return isRecord(origOpt) && typeof origOpt.label === 'string' ? origOpt.label : val;
  });
  const annotations = remapRecord(updatedInput.annotations, val => val);
  return {
    ...result,
    updatedInput: {
      ...updatedInput,
      ...(answers !== undefined && { answers }),
      ...(annotations !== undefined && { annotations }),
    },
  };
}

function remapAskedKeysToDrawn<V>(
  record: Record<string, V> | undefined,
  askedQuestions: readonly unknown[],
  drawnQuestions: readonly unknown[],
): Record<string, V> | undefined {
  if (record === undefined || drawnQuestions === askedQuestions) return record;
  const out: Record<string, V> = {};
  for (const [key, val] of Object.entries(record)) {
    const idx = askedQuestions.findIndex(q => isRecord(q) && q.question === key);
    const drawn = idx === -1 ? undefined : drawnQuestions[idx];
    const drawnKey = isRecord(drawn) && typeof drawn.question === 'string' ? drawn.question : key;
    out[drawnKey] = val;
  }
  return out;
}

function mapDrawnQuestionKeyToAsked(
  questionKey: string,
  drawnQuestions: readonly unknown[],
  askedQuestions: readonly unknown[],
): string {
  const idx = drawnQuestions.findIndex(q => isRecord(q) && q.question === questionKey);
  if (idx === -1) return questionKey;
  const orig = askedQuestions[idx];
  return isRecord(orig) && typeof orig.question === 'string' ? orig.question : questionKey;
}

function rewriteAskUserQuestionEngineChild(
  node: ReactNode,
  askedQuestions: readonly unknown[],
  drawnQuestions: readonly unknown[],
): ReactNode {
  if (drawnQuestions === askedQuestions || !isValidElement(node)) return node;
  const element = node as ReactElement<Record<string, unknown>>;
  const props = element.props;
  const patches: Record<string, unknown> = {};
  if ('questions' in props && Array.isArray(props.questions)) {
    patches.questions = drawnQuestions;
    const idx = typeof props.currentQuestionIndex === 'number' ? props.currentQuestionIndex : 0;
    const drawnQ = drawnQuestions[idx];
    const askedQ = askedQuestions[idx];
    if ('question' in props && drawnQ !== undefined) {
      patches.question = drawnQ;
      if (
        isRecord(drawnQ) &&
        isRecord(askedQ) &&
        typeof drawnQ.question === 'string' &&
        drawnQ.question !== askedQ.question
      ) {
        patches.displayQuestion = drawnQ.question;
      }
    }
    if (isRecord(props.answers)) {
      patches.answers = remapAskedKeysToDrawn(props.answers as Record<string, unknown>, askedQuestions, drawnQuestions);
    }
    if (isRecord(props.questionStates)) {
      patches.questionStates = remapAskedKeysToDrawn(
        props.questionStates as Record<string, unknown>,
        askedQuestions,
        drawnQuestions,
      );
    }
    if (typeof props.onAnswer === 'function') {
      const origOnAnswer = props.onAnswer as (
        questionText: string,
        label: string | string[],
        textInput?: string,
        shouldAdvance?: boolean,
      ) => void;
      patches.onAnswer = (
        questionText: string,
        label: string | string[],
        textInput?: string,
        shouldAdvance?: boolean,
      ) => {
        origOnAnswer(
          mapDrawnQuestionKeyToAsked(questionText, drawnQuestions, askedQuestions),
          label,
          textInput,
          shouldAdvance,
        );
      };
    }
    if (typeof props.onUpdateQuestionState === 'function') {
      const origOnUpdate = props.onUpdateQuestionState as (
        questionText: string,
        updates: unknown,
        isTextInput?: boolean,
      ) => void;
      patches.onUpdateQuestionState = (questionText: string, updates: unknown, isTextInput?: boolean) => {
        origOnUpdate(mapDrawnQuestionKeyToAsked(questionText, drawnQuestions, askedQuestions), updates, isTextInput);
      };
    }
  }
  const rawChildren = props.children;
  let nextChildren = rawChildren;
  if (Array.isArray(rawChildren)) {
    nextChildren = rawChildren.map(child =>
      rewriteAskUserQuestionEngineChild(child as ReactNode, askedQuestions, drawnQuestions),
    );
  } else if (isValidElement(rawChildren)) {
    nextChildren = rewriteAskUserQuestionEngineChild(rawChildren, askedQuestions, drawnQuestions);
  }
  if (Object.keys(patches).length === 0 && nextChildren === rawChildren) {
    return node;
  }
  return cloneElement(element, patches, ...(nextChildren !== undefined ? [nextChildren as ReactNode] : []));
}

/**
 * densable 2.1.289 `AskUserQuestion` `ui.render` site (`cc-plugin-mods-guide`
 * Clawd cooking `Raster` header + `{ type: "engine", ref: 0 }` slot).
 * Synchronous pass-through with zero wrapper layout when no hook matches.
 */
export function PluginAskUserQuestionSite({
  requestId,
  toolName,
  questions,
  metadataSource,
  children,
}: {
  requestId: string;
  toolName: string;
  questions: readonly unknown[];
  metadataSource?: string;
  children: ReactNode;
}): ReactNode {
  useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  const askProps = useMemo(
    () => ({
      tool: toolName,
      questions,
      ...(metadataSource !== undefined && { metadataSource }),
    }),
    [toolName, questions, metadataSource],
  );
  const hasHook = hasMatchingFunctionHook('ui.render', {
    surface: 'terminal',
    component: 'AskUserQuestion',
    requestId,
    props: askProps,
  });
  if (!hasHook) {
    return children;
  }
  return (
    <PluginAskUserQuestionActiveSite requestId={requestId} questions={questions} askProps={askProps}>
      {children}
    </PluginAskUserQuestionActiveSite>
  );
}

function PluginAskUserQuestionActiveSite({
  requestId,
  questions,
  askProps,
  children,
}: {
  requestId: string;
  questions: readonly unknown[];
  askProps: Record<string, unknown>;
  children: ReactNode;
}): ReactNode {
  const { addNotification } = useNotifications();
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const renderInput = useMemo(
    () => ({
      surface: 'terminal',
      component: 'AskUserQuestion',
      requestId,
      viewport: { columns, rows, isFullscreen },
      props: askProps,
    }),
    [requestId, columns, rows, isFullscreen, askProps],
  );
  const inputKey = useMemo(
    () => `${requestId}\0${columns}\0${rows}\0${String(isFullscreen)}\0${JSON.stringify(askProps)}`,
    [requestId, columns, rows, isFullscreen, askProps],
  );
  const { drawn, drawnPlugin, engineProps, markThrown } = useRenderDrawing(renderInput, inputKey);
  const ownerPlugin = useMemo(
    () => extractDrawnPlugin(drawn, 'AskUserQuestion', requestId) ?? drawnPlugin,
    [drawn, drawnPlugin, requestId],
  );
  const rewrittenQuestions = useMemo(
    () => validateAskUserQuestionRewrite(engineProps?.questions, questions),
    [engineProps?.questions, questions],
  );
  const engineElement = useMemo(
    () => rewriteAskUserQuestionEngineChild(children, questions, rewrittenQuestions),
    [children, questions, rewrittenQuestions],
  );
  const [resetKey, setResetKey] = useState(0);
  if (!hasPluginDrawing(drawn)) {
    return engineElement;
  }
  return (
    <PaneErrorBoundary
      resetKey={resetKey}
      fallback={engineElement}
      onError={error => {
        markThrown();
        reportDrawWhileDrawn('AskUserQuestion', [ownerPlugin], error, addNotification);
        setResetKey(n => n + 1);
      }}
    >
      <DrawingNode
        node={drawn}
        plugin={ownerPlugin}
        requestId={requestId}
        index={0}
        engine={engineElement}
        component="AskUserQuestion"
      />
    </PaneErrorBoundary>
  );
}

type SettledPromptHint = {
  isDraft: boolean;
  isWorking: boolean;
  hint: string;
  tail: string;
  pluginTree?: unknown;
  pluginName?: string;
};

/**
 * densable 2.1.289 `PromptHint` (`PromptHintPart` / `PromptHintSite`) `ui.render`
 * site (`cc-plugin-responsive-mode` draft-while-working `tail` / `hint`, plus
 * `diff` viewport reader). Renders `null` synchronously when no hook matches.
 */
export function PluginPromptHintSite({
  isDraft,
  isWorking,
  isInteractive,
  onSuppressDefaultHint,
  onTail,
}: {
  isDraft: boolean;
  isWorking: boolean;
  isInteractive: boolean;
  onSuppressDefaultHint?: (suppress: boolean) => void;
  onTail?: (tail: string) => void;
}): ReactNode {
  const ver = useSyncExternalStore(subscribeRenderInvalidation, renderVersion, renderVersion);
  const hasHook = !isInteractive && hasMatchingFunctionHook('ui.render', { component: 'PromptHint' });
  if (!hasHook) {
    return null;
  }
  return (
    <PluginPromptHintActiveSite
      isDraft={isDraft}
      isWorking={isWorking}
      renderVer={ver}
      onSuppressDefaultHint={onSuppressDefaultHint}
      onTail={onTail}
    />
  );
}

function PluginPromptHintActiveSite({
  isDraft,
  isWorking,
  renderVer,
  onSuppressDefaultHint,
  onTail,
}: {
  isDraft: boolean;
  isWorking: boolean;
  renderVer: number;
  onSuppressDefaultHint?: (suppress: boolean) => void;
  onTail?: (tail: string) => void;
}): ReactNode {
  const { columns, rows } = useTerminalSize();
  const isFullscreen = isFullscreenEnvEnabled();
  const defaultHint = isDraft ? '' : isWorking ? 'esc to interrupt' : '? for shortcuts';
  const [settled, setSettled] = useState<SettledPromptHint | undefined>(undefined);
  const evalKey = `${columns}\0${rows}\0${String(isFullscreen)}\0${isDraft ? '1' : '0'}\0${isWorking ? '1' : '0'}\0${renderVer}\0${defaultHint}`;

  useEffect(() => {
    let cancelled = false;
    const eventPayload: Record<string, unknown> = {
      surface: 'terminal',
      component: 'PromptHint',
      requestId: 'prompt-hint',
      viewport: { columns, rows, isFullscreen },
      props: {
        isDraft,
        isWorking,
        hint: defaultHint,
      },
    };
    void runFunctionHookChain('ui.render', eventPayload, async ev => {
      const nextProps = isRecord(ev) && isRecord(ev.props) ? ev.props : eventPayload.props;
      return { type: 'engine', ref: 0, props: nextProps };
    }).then(
      answer => {
        if (cancelled) return;
        if (isRecord(answer) && answer.type === 'engine') {
          const props = isRecord(answer.props) ? answer.props : undefined;
          setSettled({
            isDraft: typeof props?.isDraft === 'boolean' ? props.isDraft : isDraft,
            isWorking: typeof props?.isWorking === 'boolean' ? props.isWorking : isWorking,
            hint: typeof props?.hint === 'string' ? cleanPromptHintText(props.hint) : defaultHint,
            tail: typeof props?.tail === 'string' ? cleanPromptHintText(props.tail) : '',
          });
          return;
        }
        if (isRecord(answer) && typeof answer.type === 'string' && hasPluginDrawing(answer)) {
          const owner =
            extractDrawnPlugin(answer, 'PromptHint', 'prompt-hint') ?? (getLastUiRenderPlugin() || undefined);
          setSettled({
            isDraft,
            isWorking,
            hint: defaultHint,
            tail: '',
            pluginTree: answer,
            pluginName: owner,
          });
          return;
        }
        if (isRecord(answer)) {
          setSettled({
            isDraft: typeof answer.isDraft === 'boolean' ? answer.isDraft : isDraft,
            isWorking: typeof answer.isWorking === 'boolean' ? answer.isWorking : isWorking,
            hint: typeof answer.hint === 'string' ? cleanPromptHintText(answer.hint) : defaultHint,
            tail: typeof answer.tail === 'string' ? cleanPromptHintText(answer.tail) : '',
          });
          return;
        }
        setSettled({ isDraft, isWorking, hint: defaultHint, tail: '' });
      },
      err => {
        logForDebugging(
          `ui.render (PromptHint prompt-hint): site failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        );
        if (!cancelled) {
          setSettled({ isDraft, isWorking, hint: defaultHint, tail: '' });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [evalKey, columns, rows, isFullscreen, isDraft, isWorking, defaultHint]);

  const isCurrentReading = settled !== undefined && settled.isDraft === isDraft && settled.isWorking === isWorking;
  // densable Hx (`standsIn`): tail-only does NOT suppress the default hint row.
  const suppressesDefault =
    !isDraft && isCurrentReading && (settled.pluginTree !== undefined || settled.hint !== defaultHint);
  const tailOnly =
    isCurrentReading && settled.pluginTree === undefined && settled.hint === defaultHint ? settled.tail : '';

  useLayoutEffect(() => {
    onSuppressDefaultHint?.(suppressesDefault);
  }, [onSuppressDefaultHint, suppressesDefault]);

  useLayoutEffect(() => {
    onTail?.(tailOnly);
  }, [onTail, tailOnly]);

  useLayoutEffect(() => {
    return () => {
      onSuppressDefaultHint?.(false);
      onTail?.('');
    };
  }, [onSuppressDefaultHint, onTail]);

  if (settled === undefined) return null;
  if (settled.pluginTree !== undefined && isCurrentReading) {
    return (
      <Box paddingX={2}>
        <PluginRenderedTree
          node={settled.pluginTree}
          plugin={settled.pluginName}
          requestId="prompt-hint"
          component="PromptHint"
        />
      </Box>
    );
  }
  if (tailOnly !== '') {
    return (
      <Box paddingX={2}>
        <Text dimColor wrap="truncate">
          {defaultHint !== '' ? `${defaultHint} · ${tailOnly}` : ` · ${tailOnly}`}
        </Text>
      </Box>
    );
  }
  const shownText = resolvePromptHintText({
    isDraft,
    isWorking,
    defaultHint,
    settledIsDraft: settled.isDraft,
    settledIsWorking: settled.isWorking,
    settledHint: settled.hint,
    settledTail: settled.tail,
  });
  if (shownText === '') return null;
  return (
    <Box paddingX={2}>
      <Text dimColor wrap="truncate">
        {shownText}
      </Text>
    </Box>
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
  const { addNotification } = useNotifications();
  const { subscribeFrames } = useApp();
  const hasHook = hasMatchingFunctionHook('ui.render', { component: 'UserMessage' });
  // densable `ar`: `ii()&&g2e&&MYe` — `ii` is fullscreen (virtual scroll).
  const measure = isFullscreenEnvEnabled() && isG2eComponent('UserMessage') && hasHook;
  const {
    ref: cardRef,
    lastRows,
    contentRows,
    onScreen,
  } = useSiteMeasure(measure, `UserMessage\0${requestId}`, subscribeFrames);
  const userInput = {
    surface: 'terminal',
    component: 'UserMessage',
    requestId,
    props: {
      text,
      ...(origin !== undefined && { origin }),
      ...(isExpanded !== undefined && { isExpanded }),
      ...(task !== undefined && { task }),
      ...(from !== undefined && { from }),
      ...(onScreen !== undefined && { onScreen }),
    },
  };
  const userInputKey = `${requestId}\0${text}\0${origin?.kind ?? ''}\0${String(isExpanded ?? '')}`;
  const { drawn, drawnPlugin, markThrown } = useRenderDrawing(userInput, userInputKey);
  const ownerPlugin = useMemo(
    () => extractDrawnPlugin(drawn, 'UserMessage', requestId) ?? drawnPlugin,
    [drawn, drawnPlugin, requestId],
  );
  const userHeldRows = useHeldSiteRows({
    isOff: siteIsOff(hasHook, userInput),
    input: userInputKey,
    drawn,
    isFallback: isEngineFallback(drawn),
    lastRows,
    contentRows,
  });
  const [userResetKey, setUserResetKey] = useState(0);
  // densable t7t `ref:u` is stable. A fresh callback ref is a changed host prop
  // every commit → markDirty; once scrolled above the viewport the row stays
  // dirty+uncached and skews ScrollBox cull math (rows below vanish).
  const setCardRef = useCallback(
    (node: DOMElement | null) => {
      cardRef.current = node;
    },
    [cardRef],
  );
  const pluginTree = hasHook && hasPluginDrawing(drawn);
  const engine = children;
  const pluginNode = (
    <DrawingNode node={drawn} plugin={ownerPlugin} requestId={requestId} index={0} component="UserMessage" />
  );
  return (
    <Box ref={setCardRef} flexDirection="column" {...(userHeldRows !== undefined && { minHeight: userHeldRows })}>
      {pluginTree ? (
        <PaneErrorBoundary
          resetKey={userResetKey}
          fallback={engine}
          onError={error => {
            markThrown();
            reportDrawWhileDrawn('UserMessage', [ownerPlugin], error, addNotification);
            setUserResetKey(n => n + 1);
          }}
        >
          {pluginNode}
        </PaneErrorBoundary>
      ) : (
        engine
      )}
    </Box>
  );
}
