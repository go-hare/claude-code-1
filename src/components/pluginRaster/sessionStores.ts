import { useApp, type DOMElement } from '@anthropic/ink'
import {
  Component,
  createContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
  type RefObject,
} from 'react'
import {
  isToastHoldShown,
  pluginFieldSeatKey,
  pluginFieldSeatGeneration,
  getPluginInputSeatStore,
  getPluginSelectSeatStore,
  getPluginFieldSeatGenerationStore,
  setPluginBandExpanded,
  subscribePanes,
} from '../../utils/plugins/functionHooksModules.js'
import { logForDebugging } from '../../utils/debug.js'
import { useNotifications } from '../../context/notifications.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import { createStore, type Store } from '../../state/store.js'
import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  type Session,
} from '../../utils/sessionRoot.js'
import {
  getPromptInputStoreValue,
  subscribePromptInputCursorStore,
} from '../../utils/promptInputCursorStore.js'
import {
  AZERTY_DIGIT,
  BAND_DIGIT_DEBOUNCE_MS,
  BAND_DIGIT_MOUNT_DELAY_MS,
  type DrawingFocusable,
  type PluginBandKeyContext,
  type PluginInputMapApi,
  type SelectOpen,
  createPluginInputMap,
  notifySessionListeners,
  paneRoomValue,
  pluginInputFieldKey,
  runInCapturedSession,
  snapshot,
  viewingAgentIdFromState,
} from './drawingHelpers.js'

/**
 * densable `Wm` — single-digit prompt debounce (MZ=400, cp=600, enterConfirms:!1).
 * Gold: `h.length===1` (does not trim the prompt); `onDigit` then `M("")`.
 * Local: `setPromptInputStoreValue('')` is gold `M("")`.
 */
export function useBandDigitHotkey(input: {
  inputValue: string
  enabled: boolean
  isValidDigit: (char: string) => boolean
  onDigit: (digit: string) => void
  debounceMs?: number
  mountDelayMs?: number
}): void {
  const { inputValue, enabled, isValidDigit, onDigit } = input
  const debounceMs = input.debounceMs ?? BAND_DIGIT_DEBOUNCE_MS
  const mountDelayMs = input.mountDelayMs ?? BAND_DIGIT_MOUNT_DELAY_MS
  const initialValue = useRef(inputValue)
  const triggered = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const enabledAt = useRef<number | null>(enabled ? Date.now() : null)
  const latest = useRef({ isValidDigit, onDigit })
  latest.current = { isValidDigit, onDigit }
  useEffect(() => {
    if (enabled) enabledAt.current = Date.now()
  }, [enabled])
  useEffect(() => {
    if (!enabled || triggered.current) return
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const mounting =
      mountDelayMs > 0 &&
      enabledAt.current !== null &&
      Date.now() - enabledAt.current < mountDelayMs
    if (mounting) return
    if (inputValue !== initialValue.current && inputValue.length === 1) {
      const nfkc = inputValue.normalize('NFKC')
      const mapped = latest.current.isValidDigit(nfkc)
        ? nfkc
        : (AZERTY_DIGIT.get(inputValue) ?? nfkc)
      if (latest.current.isValidDigit(mapped)) {
        timer.current = setTimeout(() => {
          timer.current = null
          triggered.current = true
          latest.current.onDigit(mapped)
        }, debounceMs)
      }
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
        timer.current = null
      }
    }
  }, [inputValue, enabled, debounceMs, mountDelayMs])
}

/**
 * densable `XXt` / ColumnsContext — body width for PluginPressInput (Wt).
 * AbovePrompt reserves DZ=COLLAPSE_HANDLE_COLUMNS; Pane uses host bodyColumns.
 */
export const PaneBodyColumnsContext = createContext<number | null>(null)

/**
 * densable QT/BO — pane-scoped ErrorBoundary. onError → unload; fallback null;
 * resetKey clears hasError (gold getDerivedStateFromProps).
 * Never export minify `BO`/`QT`/`Jmn`.
 */
type PaneErrorBoundaryProps = {
  children: ReactNode
  resetKey: string | number
  onError: (error: Error, info: ErrorInfo) => void
  /** densable BO `telemetryMessage` — Client `L1t(..., "Client")`. */
  telemetryMessage?: () => string | null
  /** densable Client BO fallback — empty sized box. Pane QT omits (null). */
  fallback?: ReactNode
}

type PaneErrorBoundaryState = {
  hasError: boolean
  prevResetKey: string | number | null
}

export class PaneErrorBoundary extends Component<
  PaneErrorBoundaryProps,
  PaneErrorBoundaryState
> {
  state: PaneErrorBoundaryState = { hasError: false, prevResetKey: null }

  static getDerivedStateFromError(): Pick<PaneErrorBoundaryState, 'hasError'> {
    return { hasError: true }
  }

  static getDerivedStateFromProps(
    props: PaneErrorBoundaryProps,
    state: PaneErrorBoundaryState,
  ): Partial<PaneErrorBoundaryState> | null {
    if (state.prevResetKey !== props.resetKey) {
      return { hasError: false, prevResetKey: props.resetKey }
    }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const debug = this.props.telemetryMessage?.()
    if (debug) logForDebugging(debug)
    this.props.onError(error, info)
  }

  render(): ReactNode {
    if (this.state.hasError) return this.props.fallback ?? null
    return this.props.children
  }
}

/**
 * densable o$: `h=V(SEe); return Q(()=>h===void 0?{}:{agentId:h},[h])`.
 * Selector stays a primitive — a fresh `{}` inside useAppState Object.is-fails
 * every snapshot → RootREPLBoundary #185.
 */
export function useViewingAgentView():
  | { agentId: string }
  | Record<string, never> {
  const agentId = useAppState(s => viewingAgentIdFromState(s))
  return useMemo(
    () =>
      (agentId === undefined ? {} : { agentId }) as
        | { agentId: string }
        | Record<string, never>,
    [agentId],
  )
}

/**
 * densable `NLe` / `DQt` / `hSo` — Client surface focusedId mutex.
 * Gold: `NLe=et({focusedId:null}); DQt=(r)=>set if changed; hSo=(r)=>clear if current`.
 */
const pluginClientFocusStoreBySession = new RootSessionSlot<
  Store<{ focusedId: string | null }>
>(() =>
  createStore<{ focusedId: string | null }>({
    focusedId: null,
  }),
)

function getPluginClientFocusStore(): Store<{ focusedId: string | null }> {
  return pluginClientFocusStoreBySession.of(getBootstrapSession())
}

export function deleteSeatKeys(
  map: Map<string, string>,
  keys: readonly string[],
): Map<string, string> {
  if (keys.length === 0) return map
  const next = new Map(map)
  for (const key of keys) next.delete(key)
  return next
}

const EMPTY_SEAT_MAP: Map<string, string> = new Map()

/**
 * densable `kL(store, component, requestId)` — subscribe the sft bucket.
 * Persist into the module store only while `ift` generation is unchanged.
 */
export function usePluginFieldSeatMap(
  kind: 'input' | 'select',
  component: string,
  requestId: string,
): [
  Map<string, string>,
  (updater: (current: Map<string, string>) => Map<string, string>) => void,
] {
  const store =
    kind === 'input' ? getPluginInputSeatStore() : getPluginSelectSeatStore()
  const generationStore = getPluginFieldSeatGenerationStore()
  const seatKey = pluginFieldSeatKey(component, requestId)
  const generation = useSyncExternalStore(
    generationStore.subscribe,
    () => pluginFieldSeatGeneration(component, requestId),
    () => pluginFieldSeatGeneration(component, requestId),
  )
  const map = useSyncExternalStore(
    store.subscribe,
    () => store.getState().get(seatKey) ?? EMPTY_SEAT_MAP,
    () => store.getState().get(seatKey) ?? EMPTY_SEAT_MAP,
  )
  const setMap = useCallback(
    (updater: (current: Map<string, string>) => Map<string, string>) => {
      store.setState(prev => {
        const current = prev.get(seatKey) ?? new Map<string, string>()
        const nextMap = updater(current)
        if (nextMap === current) return prev
        const next = new Map(prev)
        next.set(seatKey, nextMap)
        return next
      })
    },
    [store, seatKey],
  )
  useEffect(() => {
    if (pluginFieldSeatGeneration(component, requestId) !== generation) return
    store.setState(prev => {
      const held = prev.get(seatKey)
      if (held === map) return prev
      const next = new Map(prev)
      next.set(seatKey, map)
      return next
    })
  }, [store, seatKey, map, generation, component, requestId])
  return [map, setMap]
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
  const seen = useRef(new Map<string, string | undefined>())
  const onStaleRef = useRef(onStale)
  onStaleRef.current = onStale
  useEffect(() => {
    if (focusables === undefined) return
    const stale: string[] = []
    for (const row of focusables) {
      if (row.tag !== tag) continue
      if (typeof row.element !== 'string' || row.element === '') continue
      const key = pluginInputFieldKey(row.plugin, row.element)
      const value = typeof row.value === 'string' ? row.value : undefined
      if (seen.current.has(key) && seen.current.get(key) !== value)
        stale.push(key)
      seen.current.set(key, value)
    }
    if (stale.length > 0) onStaleRef.current(stale)
  }, [focusables, tag])
}

/**
 * densable `$l(read)` — `useSyncExternalStore(subscribeLayout, read)` then
 * layout-effect `Object.is` bump. Gold returns a number (width or height).
 */
export function useYogaMeasure(read: () => number): number {
  const { subscribeLayout } = useApp()
  const snapshot = useSyncExternalStore(subscribeLayout, read)
  const [, bump] = useReducer((n: number) => n + 1, 0)
  useLayoutEffect(() => {
    if (!Object.is(read(), snapshot)) bump()
  })
  return snapshot
}

export function getPluginClientFocusedId(): string | null {
  return getPluginClientFocusStore().getState().focusedId
}

export function subscribePluginClientFocus(listener: () => void): () => void {
  const store = getPluginClientFocusStore()
  const captured = getActiveSessionFromAls()
  return store.subscribe(() => {
    runInCapturedSession(captured, listener)
  })
}

/** densable `DQt` — set Client focusedId. */
export function setPluginClientFocusedId(id: string | null): void {
  getPluginClientFocusStore().setState(prev =>
    prev.focusedId === id ? prev : { focusedId: id },
  )
}

/** densable `hSo` — clear Client focusedId if it still holds `id`. */
export function clearPluginClientFocusedId(id: string): void {
  getPluginClientFocusStore().setState(prev =>
    prev.focusedId === id ? { focusedId: null } : prev,
  )
}

/**
 * densable `jZ(as, Me??hs, ss)` — while band or pane is held, prompt draft
 * value change from the hold-start snapshot → away (Ie(null)+u3(null)).
 * Gold: `if(v===null)return; let N=h.getState().value; subscribe value!==N → M()`.
 */
export function useDraftHeldAway(
  held: number | 'band' | string | null,
  away: () => void,
): void {
  const awayRef = useRef(away)
  awayRef.current = away
  useEffect(() => {
    if (held === null) return
    const origin = getPromptInputStoreValue()
    return subscribePromptInputCursorStore(() => {
      if (getPromptInputStoreValue() !== origin) awayRef.current()
    })
  }, [held])
}

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
  )
  const setAppState = useSetAppState()
  const { processQueue } = useNotifications()
  useEffect(() => {
    if (!hold) return
    setAppState(prev =>
      prev.paneHoldsToasts ? prev : { ...prev, paneHoldsToasts: true },
    )
    return () => {
      setAppState(prev =>
        prev.paneHoldsToasts ? { ...prev, paneHoldsToasts: false } : prev,
      )
      processQueue()
    }
  }, [hold, setAppState, processQueue])
}

type BandCollapsedListener = () => void

type SettledBudgetListener = () => void

type OpenListRowsListener = () => void

type PluginBandUiSessionState = {
  bandCollapsedValue: boolean
  bandCollapsedListeners: Map<BandCollapsedListener, Session | undefined>
  settledBudgetValue: number | undefined
  settledBudgetListeners: Map<SettledBudgetListener, Session | undefined>
  openListRowsValue: number
  openListRowsListeners: Map<OpenListRowsListener, Session | undefined>
}

const pluginBandUiStateBySession =
  new RootSessionSlot<PluginBandUiSessionState>(() => ({
    bandCollapsedValue: false,
    bandCollapsedListeners: new Map(),
    settledBudgetValue: undefined,
    settledBudgetListeners: new Map(),
    openListRowsValue: 0,
    openListRowsListeners: new Map(),
  }))

function getPluginBandUiState(): PluginBandUiSessionState {
  return pluginBandUiStateBySession.of(getBootstrapSession())
}

/** densable `v1t` — session bandCollapsed store. */
export function getBandCollapsed(): boolean {
  return getPluginBandUiState().bandCollapsedValue
}

export function setBandCollapsed(next: boolean): void {
  const state = getPluginBandUiState()
  if (state.bandCollapsedValue === next) return
  state.bandCollapsedValue = next
  setPluginBandExpanded(!next)
  notifySessionListeners(state.bandCollapsedListeners)
}

export function subscribeBandCollapsed(
  listener: BandCollapsedListener,
): () => void {
  const state = getPluginBandUiState()
  state.bandCollapsedListeners.set(listener, getActiveSessionFromAls())
  return () => {
    state.bandCollapsedListeners.delete(listener)
  }
}

export function useBandCollapsed(): boolean {
  return useSyncExternalStore(
    subscribeBandCollapsed,
    getBandCollapsed,
    getBandCollapsed,
  )
}

/** densable `d$` — shared settledBudget Map/store (`et(js(),…)`). */
export function getSettledBudget(): number | undefined {
  return getPluginBandUiState().settledBudgetValue
}

export function setSettledBudget(next: number | undefined): void {
  const state = getPluginBandUiState()
  if (state.settledBudgetValue === next) return
  state.settledBudgetValue = next
  notifySessionListeners(state.settledBudgetListeners)
}

export function subscribeSettledBudget(
  listener: SettledBudgetListener,
): () => void {
  const state = getPluginBandUiState()
  state.settledBudgetListeners.set(listener, getActiveSessionFromAls())
  return () => {
    state.settledBudgetListeners.delete(listener)
  }
}

export function useSettledBudget(): number | undefined {
  return useSyncExternalStore(
    subscribeSettledBudget,
    getSettledBudget,
    getSettledBudget,
  )
}

/** densable `s$` / `nr` — open Select extra rows into band maxHeight. */
export function getOpenListRows(): number {
  return getPluginBandUiState().openListRowsValue
}

export function setOpenListRows(next: number): void {
  const state = getPluginBandUiState()
  const rows = Math.max(0, next)
  if (state.openListRowsValue === rows) return
  state.openListRowsValue = rows
  notifySessionListeners(state.openListRowsListeners)
}

export function subscribeOpenListRows(
  listener: OpenListRowsListener,
): () => void {
  const state = getPluginBandUiState()
  state.openListRowsListeners.set(listener, getActiveSessionFromAls())
  return () => {
    state.openListRowsListeners.delete(listener)
  }
}

export function useOpenListRows(): number {
  return useSyncExternalStore(
    subscribeOpenListRows,
    getOpenListRows,
    getOpenListRows,
  )
}

type DockRoomSessionState = {
  dockRoomColumns: number | null
  inlineRoomRows: number | null
  dockRoomHydrated: boolean
  dockRoomListeners: Map<() => void, Session | undefined>
  paneFieldHeld: boolean
  paneFieldListeners: Map<() => void, Session | undefined>
}

const dockRoomStateBySession = new RootSessionSlot<DockRoomSessionState>(
  () => ({
    dockRoomColumns: null,
    inlineRoomRows: null,
    dockRoomHydrated: false,
    dockRoomListeners: new Map(),
    paneFieldHeld: false,
    paneFieldListeners: new Map(),
  }),
)

function getDockRoomState(): DockRoomSessionState {
  const state = dockRoomStateBySession.of(getBootstrapSession())
  hydrateDockRoom(state)
  return state
}

/**
 * densable `l$("PaneField")` — Input/Select focused in a plugin pane.
 * Grow/scroll stay on `Pane`; close is on `PaneField` too.
 */
export function paneFieldHeldNow(): boolean {
  return dockRoomStateBySession.of(getBootstrapSession()).paneFieldHeld
}

export function subscribePaneFieldHeld(listener: () => void): () => void {
  const state = dockRoomStateBySession.of(getBootstrapSession())
  state.paneFieldListeners.set(listener, getActiveSessionFromAls())
  return () => {
    state.paneFieldListeners.delete(listener)
  }
}

export function setPaneFieldHeld(next: boolean): void {
  const state = dockRoomStateBySession.of(getBootstrapSession())
  if (state.paneFieldHeld === next) return
  state.paneFieldHeld = next
  notifySessionListeners(state.paneFieldListeners)
}

/** densable `XP(focusable, site)` — Input/Select remap to AbovePrompt* else the site. */
export function pluginFieldContext(
  tag: string | undefined,
  site: 'Pane' | 'AbovePrompt',
): PluginBandKeyContext {
  if (tag === 'Input') return 'AbovePromptInput'
  if (tag === 'Select') return 'AbovePromptSelect'
  return site
}

/** densable `$q` `isAhead` — held focus vs last painted focus. */
export function pluginKeysAreAhead(
  held: { focused: unknown; select: unknown },
  rendered: { focused: unknown; select: unknown },
): boolean {
  return held.focused !== rendered.focused || held.select !== rendered.select
}

export function getDockRoomColumns(): number | null {
  return getDockRoomState().dockRoomColumns
}

export function getInlineRoomRows(): number | null {
  return getDockRoomState().inlineRoomRows
}

function hydrateDockRoom(state: DockRoomSessionState): void {
  if (state.dockRoomHydrated) return
  state.dockRoomHydrated = true
  try {
    const { getGlobalConfig } =
      require('../../utils/config.js') as typeof import('../../utils/config.js')
    const stored = getGlobalConfig().pluginPanes
    const dock = paneRoomValue(stored?.dockColumns)
    const inline = paneRoomValue(stored?.inlineRows)
    if (dock !== null) state.dockRoomColumns = dock
    if (inline !== null) state.inlineRoomRows = inline
  } catch {
    /* config unavailable */
  }
}

export function chooseDockRoom(columns: number | null): void {
  const state = getDockRoomState()
  state.dockRoomColumns = columns
  notifySessionListeners(state.dockRoomListeners)
}

export function chooseInlineRoom(rows: number | null): void {
  const state = getDockRoomState()
  state.inlineRoomRows = rows
  notifySessionListeners(state.dockRoomListeners)
}

export function subscribeDockRoom(listener: () => void): () => void {
  const state = getDockRoomState()
  state.dockRoomListeners.set(listener, getActiveSessionFromAls())
  return () => {
    state.dockRoomListeners.delete(listener)
  }
}

/**
 * densable `iL` keepRoom — `T4` writes `pluginPanes.dockColumns` /
 * `inlineRows`. Memory `null` keeps disk (`chosen ?? held`).
 */
export function keepPluginPaneRoom(): void {
  const state = getDockRoomState()
  const chosenDock = state.dockRoomColumns
  const chosenInline = state.inlineRoomRows
  const captured = getActiveSessionFromAls()
  void import('../../utils/config.js').then(({ saveGlobalConfig }) => {
    runInCapturedSession(captured, () => {
      saveGlobalConfig(current => {
        const held = current.pluginPanes
        const dockColumns = chosenDock ?? held?.dockColumns
        const inlineRows = chosenInline ?? held?.inlineRows
        if (
          held?.dockColumns === dockColumns &&
          held?.inlineRows === inlineRows
        ) {
          return current
        }
        return {
          ...current,
          pluginPanes: {
            ...held,
            dockColumns,
            inlineRows,
          },
        }
      })
    })
  })
}

/** densable `ClickedPress` / `KXt` — click maps plugin+handle onto the ring. */
export const ClickedPressContext = createContext<
  ((press: { plugin: string; handle: unknown }) => void) | null
>(null)

/**
 * densable `QXt` — when a pressable is focused, report its Ink DOM node so
 * hosts can run gold `Jq`/`OMr` into-view place. Unfocused clears with null.
 */
export const HeldFocusRefContext = createContext<
  (node: DOMElement | null) => void
>(() => {})

/** densable `ZXt` — currently focused press identity for `le` hasKeyboardFocus. */
export const FocusedPressContext = createContext<{
  plugin: string
  handle: unknown
} | null>(null)

/**
 * densable `ITt` — subscribeClicks walk parentNode; click outside pane
 * and `!isWindowActivation` → away. `(null,null)` from tellClickedNowhere
 * also away. Returns the host Box ref.
 */
export function usePaneClickAway(
  onAway: () => void,
): RefObject<DOMElement | null> {
  const ref = useRef<DOMElement | null>(null)
  const { subscribeClicks } = useApp()
  useEffect(() => {
    return subscribeClicks((node, event) => {
      let walk: DOMElement | undefined = node ?? undefined
      while (walk && walk !== ref.current) walk = walk.parentNode
      if (!walk && event?.isWindowActivation !== true) onAway()
    })
  }, [onAway, subscribeClicks])
  return ref
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
  const [texts, setTexts] = usePluginFieldSeatMap('input', component, requestId)
  const live = useRef(new Map<string, string>())
  const submitting = useRef(new Set<string>())
  useLayoutEffect(() => {
    if (live.current.size === 0 && texts.size > 0) live.current = new Map(texts)
  }, [texts])
  usePluginFieldValuePrune(focusables, 'Input', keys => {
    for (const key of keys) live.current.delete(key)
    setTexts(current => deleteSeatKeys(current, keys))
  })
  return useMemo(
    () =>
      createPluginInputMap(focusables, component, requestId, {
        texts,
        setTexts,
        live,
        submitting,
      }),
    [texts, component, requestId, focusables, setTexts],
  )
}

/** densable `Le` — hover scope refcount store (`plugin\0scope` → count). */
const pluginHoverGroupsStoreBySession = new RootSessionSlot<
  Store<Map<string, number>>
>(() => createStore<Map<string, number>>(new Map()))

function getPluginHoverGroupsStore(): Store<Map<string, number>> {
  return pluginHoverGroupsStoreBySession.of(getBootstrapSession())
}

function adjustPluginHoverGroup(
  store: Store<Map<string, number>>,
  groupKey: string,
  delta: number,
): void {
  store.setState(prev => {
    const nextCount = (prev.get(groupKey) ?? 0) + delta
    const next = new Map(prev)
    if (nextCount > 0) next.set(groupKey, nextCount)
    else next.delete(groupKey)
    return next
  })
}

export function usePluginHoverScope(
  plugin: string | undefined,
  hover: Record<string, unknown> | undefined,
): {
  isScoped: boolean
  isHot: boolean
  onMouseEnter: () => void
  onMouseLeave: () => void
} {
  const scope =
    typeof hover?.scope === 'string' && hover.scope !== ''
      ? hover.scope
      : undefined
  const groupKey =
    plugin !== undefined && plugin !== '' && scope !== undefined
      ? `${plugin}\0${scope}`
      : undefined
  const [hoverStore] = useState(() => getPluginHoverGroupsStore())
  const [capturedSession] = useState(() => getActiveSessionFromAls())
  const subscribeHoverGroups = useCallback(
    (listener: () => void) =>
      hoverStore.subscribe(() => {
        runInCapturedSession(capturedSession, listener)
      }),
    [hoverStore, capturedSession],
  )
  const isHot = useSyncExternalStore(
    subscribeHoverGroups,
    () =>
      groupKey !== undefined
        ? (hoverStore.getState().get(groupKey) ?? 0) > 0
        : false,
    () => false,
  )
  const heldKeyRef = useRef<string | undefined>(undefined)
  const enter = useCallback(
    (key: string | undefined) => {
      if (key !== undefined && heldKeyRef.current === undefined) {
        heldKeyRef.current = key
        adjustPluginHoverGroup(hoverStore, key, 1)
      }
    },
    [hoverStore],
  )
  const leave = useCallback(() => {
    const held = heldKeyRef.current
    if (held !== undefined) {
      heldKeyRef.current = undefined
      adjustPluginHoverGroup(hoverStore, held, -1)
    }
  }, [hoverStore])
  useEffect(() => {
    if (heldKeyRef.current !== undefined && heldKeyRef.current !== groupKey) {
      leave()
      enter(groupKey)
    }
  }, [groupKey, enter, leave])
  useEffect(() => leave, [leave])
  return {
    isScoped: groupKey !== undefined,
    isHot,
    onMouseEnter: () => enter(groupKey),
    onMouseLeave: leave,
  }
}

/** densable `Jr` / `$t` — ranked `props.action` keybinding fallback seats (`bs`: Pane=2 > AbovePrompt=1 > 0). */
export type PluginActionKeySeat = {
  action: string
  rank: number
  seq: number
  plugin: string
  handle: unknown
}

type PluginActionKeySeatsRegistry = {
  add: (seat: PluginActionKeySeat) => void
  remove: (seat: PluginActionKeySeat) => void
  winnerOf: (action: string) => PluginActionKeySeat | undefined
}

function createPluginActionKeySeatsRegistry(): PluginActionKeySeatsRegistry {
  const list: PluginActionKeySeat[] = []
  let seq = 0
  const remove = (seat: PluginActionKeySeat): void => {
    const idx = list.indexOf(seat)
    if (idx >= 0) list.splice(idx, 1)
  }
  return {
    add(seat: PluginActionKeySeat) {
      remove(seat)
      seat.seq = ++seq
      list.push(seat)
    },
    remove,
    winnerOf(action: string): PluginActionKeySeat | undefined {
      return list
        .filter(item => item.action === action)
        .reduce<PluginActionKeySeat | undefined>(
          (best, cur) =>
            best === undefined ||
            cur.rank > best.rank ||
            (cur.rank === best.rank && cur.seq > best.seq)
              ? cur
              : best,
          undefined,
        )
    },
  }
}

const pluginActionKeySeatsBySession =
  new RootSessionSlot<PluginActionKeySeatsRegistry>(
    createPluginActionKeySeatsRegistry,
  )

export function getPluginActionKeySeats(): PluginActionKeySeatsRegistry {
  return pluginActionKeySeatsBySession.of(getBootstrapSession())
}

export function actionComponentRank(component: string | undefined): number {
  return component === 'Pane' ? 2 : component === 'AbovePrompt' ? 1 : 0
}

/** densable `Xjt` / `Uq` InputFields: textOf + edit keyed plugin\0element. */
export type InputFields = {
  textOf: (plugin: string, element: string) => string | undefined
  edit: (
    ref: { plugin: string; handle: unknown; element: string },
    value: string,
  ) => void
  textNow: (ref: { plugin: string; element: string; value?: string }) => string
  submit: (ref: {
    plugin: string
    handle: unknown
    element: string
    value?: string
  }) => void
}

export const InputFieldsContext = createContext<InputFields | null>(null)

/** densable `tWt` — pickedOf + open {plugin,handle,highlight}. */
export type SelectFields = {
  pickedOf: (plugin: string, element: string) => string | undefined
  open: SelectOpen | null
  toggle: (ref: {
    plugin: string
    handle: unknown
    element: string
    options: Array<{ value: string; label?: string }>
    value?: string
  }) => void
  move: (delta: number) => void
  typeahead: (letter: string) => void
  close: () => void
  /** densable `Kq` focused Select (`Rs=un==="Select"`), open or closed. */
  focusedSelect: {
    plugin: string
    handle: unknown
    element: string
    options: Array<{ value: string; label?: string }>
  } | null
  focus: (ref: {
    plugin: string
    handle: unknown
    element: string
    options: Array<{ value: string; label?: string }>
  }) => void
  unfocus: () => void
}

export const SelectFieldsContext = createContext<SelectFields | null>(null)

export type FocusedInput = {
  plugin: string
  handle: unknown
  element: string
  value?: string
}

/** densable `_Ee` owns Input focus in the same closure as y$/m$ — no Mods singleton. */
export type BandInputFocusHost = {
  focused: FocusedInput | null
  setFocused: (next: FocusedInput | null) => void
}

export function landBandInputFocus(
  focusable: DrawingFocusable | null | undefined,
  setInput: (next: FocusedInput | null) => void,
  closeSelect: () => void,
): void {
  if (
    focusable?.tag === 'Input' &&
    typeof focusable.element === 'string' &&
    focusable.element !== ''
  ) {
    closeSelect()
    setInput({
      plugin: focusable.plugin,
      handle: focusable.handle,
      element: focusable.element,
      ...(typeof focusable.value === 'string' && { value: focusable.value }),
    })
    return
  }
  setInput(null)
}

export const FocusedInputContext = createContext<{
  focused: FocusedInput | null
  setFocused: (next: FocusedInput | null) => void
} | null>(null)
