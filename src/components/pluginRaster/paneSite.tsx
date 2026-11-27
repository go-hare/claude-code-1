import {
  Box,
  useInput,
  useKeybinding,
  useRegisterKeybindingContext,
  type DOMElement,
  type WheelEvent,
} from '@anthropic/ink';
import {
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import {
  bindPluginScrollSiteLayout,
  closePluginPane,
  getLastUiRenderPlugin,
  hasMatchingFunctionHook,
  focusPane,
  getPaneRemountGeneration,
  getPanesState,
  getPanesTerminalSize,
  getShownPluginPane,
  heldFocusEdge,
  nearestScrollOffset,
  cycleShownPaneId,
  showPane,
  registerPluginScrollSite,
  subscribePanes,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from '../../utils/plugins/functionHooksModules.js';
import { useIsOverlayActive, useRegisterOverlay } from '../../context/overlayContext.js';
import { useHasOpenDialogs } from '../../dialog/DialogStoreContext.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { useNotifications } from '../../context/notifications.js';
import { useAppState } from '../../state/AppState.js';
import { isEngineFallback, siteIsOff, useHeldSiteRows } from '../../utils/plugins/pluginSiteHold.js';
import { computeWheelStep, type WheelAccelState, type WheelProfile } from '../ScrollKeybindingHandler.js';
import {
  BORDER_MARK_INSET,
  CLOSE_MARK_COLUMNS,
  DOCK_GRIP_COLUMNS,
  INLINE_PANE_CHROME_COLUMNS,
  MARK_EDGE_COLUMNS,
  type PluginBandKeysBag,
  type PluginInputMapApi,
  ensurePaneWheelAccel,
  firePress,
  focusableAt,
  focusablesOfDrawing,
  hotkeyMapOfDrawing,
  measurePluginClientBox,
  paneTitleChromeRows,
  relativeWheelPointer,
  reportDrawWhileDrawn,
  resolveHotkeyPresses,
} from './drawingHelpers.js';
import {
  ClickedPressContext,
  FocusedPressContext,
  HeldFocusRefContext,
  PaneBodyColumnsContext,
  PaneErrorBoundary,
  pluginFieldContext,
  setPaneFieldHeld,
  usePaneClickAway,
  usePluginInputSeat,
  useViewingAgentView,
  useYogaMeasure,
} from './sessionStores.js';
import {
  bandRingHandlers,
  clickFocusByPress,
  extendPaneRingWithCloseMark,
  useBandScrollPlace,
  usePluginBandKeys,
  usePluginFocusHost,
  usePluginSelectSeat,
  wrapPluginFocusActs,
} from './focusAndBandHooks.js';
import { PluginDockGrip, PluginPaneCloseMark, PluginPaneTitleStrip } from './chromeComponents.js';
import { rebuild, useRenderDrawing } from './drawingElements.js';

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
  const hasOpenDialogs = useHasOpenDialogs();
  const isOverlayActive = useIsOverlayActive();
  // Official 2.1.323 #1979: tell a mod's Pane when a dialog or above-prompt
  // overlay covers the prompt (and this pane is not focused).
  const isPromptCovered = !pane.isFocused && (hasOpenDialogs || isOverlayActive);
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
      ...(isPromptCovered ? { isPromptCovered: true } : {}),
    },
  };
  const { drawn } = useRenderDrawing(
    input,
    `${pane.id}\0${pane.title}\0${String(pane.isFocused)}\0${String(pane.columns)}\0${String(paneScrollOffset)}\0${String(paneViewport)}\0${fill ? 'dock' : 'inline'}\0${String(paneViewportInfo.columns)}\0${String(paneViewportInfo.rows)}\0${String(isFullscreen)}\0${String(isPromptCovered)}\0${JSON.stringify(viewingAgentView)}`,
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
