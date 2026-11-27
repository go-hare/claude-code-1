import {
  Box,
  useInput,
  useKeybinding,
  useRegisterKeybindingContext,
  type DOMElement,
  type WheelEvent,
} from '@anthropic/ink';
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AbovePromptLeftoverContext, leftoverPluginBandBudget } from '../FullscreenLayout.js';
import { useTerminalSize } from '../../hooks/useTerminalSize.js';
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js';
import {
  bindPluginScrollSiteLayout,
  hasMatchingFunctionHook,
  focusPane,
  getPanesState,
  getPanesTerminalSize,
  getPluginDrawingTrees,
  heldFocusEdge,
  nearestScrollOffset,
  nextFocusedPaneId,
  registerPluginScrollSite,
  settlePaneFocusRequest,
  settlePanesTerminalColumns,
  subscribePanes,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from '../../utils/plugins/functionHooksModules.js';
import { useIsOverlayActive, useRegisterOverlay } from '../../context/overlayContext.js';
import { useHasOpenDialogs } from '../../dialog/DialogStoreContext.js';
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js';
import { useNotifications } from '../../context/notifications.js';
import { useAppState } from '../../state/AppState.js';
import {
  getPromptInputStoreValue,
  setPromptInputStoreValue,
  subscribePromptInputCursorStore,
} from '../../utils/promptInputCursorStore.js';
import { isEngineFallback, siteIsOff, useHeldSiteRows } from '../../utils/plugins/pluginSiteHold.js';
import { computeWheelStep, type WheelAccelState, type WheelProfile } from '../ScrollKeybindingHandler.js';
import {
  BAND_REQUEST_ID,
  COLLAPSE_HANDLE_COLUMNS,
  HEIGHT_SETTLE_MS,
  type PluginBandKeysBag,
  type PluginInputMapApi,
  bandWindow,
  ensurePaneWheelAccel,
  extractDrawnPlugin,
  firePress,
  focusableAt,
  focusablesOfDrawing,
  hotkeyDigitVisible,
  hotkeyMapOfDrawing,
  hotkeySeatsIn,
  isOtherDrawer,
  nextBandFocus,
  pressShownDigit,
  relativeWheelPointer,
  reportDrawWhileDrawn,
  resolveHotkeyPresses,
} from './drawingHelpers.js';
import {
  type BandInputFocusHost,
  ClickedPressContext,
  type FocusedInput,
  FocusedPressContext,
  HeldFocusRefContext,
  PaneBodyColumnsContext,
  PaneErrorBoundary,
  getBandCollapsed,
  getPluginClientFocusedId,
  getSettledBudget,
  landBandInputFocus,
  pluginFieldContext,
  setBandCollapsed,
  setPluginClientFocusedId,
  setSettledBudget,
  subscribePluginClientFocus,
  useBandCollapsed,
  useBandDigitHotkey,
  useDraftHeldAway,
  useOpenListRows,
  usePaneClickAway,
  usePluginInputSeat,
  useSettledBudget,
  useViewingAgentView,
  useYogaMeasure,
} from './sessionStores.js';
import {
  type PluginSelectSeat,
  bandKeysWithScroll,
  bandRingHandlers,
  clickFocusByPress,
  paneScrollHandlers,
  useBandScrollPlace,
  usePluginBandKeys,
  usePluginFocusHost,
  usePluginSelectSeat,
  wrapPluginFocusActs,
} from './focusAndBandHooks.js';
import { PluginBandCollapseHandle, PluginBandCollapsedHint, PluginBandOverflowCue } from './chromeComponents.js';
import { rebuild, useRenderDrawing } from './drawingElements.js';

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
