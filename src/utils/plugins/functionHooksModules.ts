/**
 * densable 2.1.282 function-hooks registry (`ct().loadedModules`).
 *
 * Thin backwards-compatible barrel & runtime bootstrap.
 * Implementation submodules live under `./functionHooks/`.
 */
import { exitSessionContext } from '../sessionHost.js'
import { setClientPressBridge } from './functionHooksClient.js'
import { installDefaultCollectorTelemetryRoad } from './functionHooks/hookChain.js'
import { fhState, pressSlot } from './functionHooks/state.js'
// Side-effect imports ensure runtimeBridge callbacks are wired at module load.
import './functionHooks/pluginEngine.js'
import './functionHooks/workerAndLoader.js'

export {
  applyPluginToolListDenyRules,
  applyPluginToolListFilter,
  checkMcpToolRemovedByPlugin,
  getPluginToolListState,
  invalidatePluginToolList,
  isToolRemovedByPlugin,
  recordPluginToolListAnswer,
  resetPluginToolListState,
  settlePluginToolList,
} from './pluginToolList.js'

export {
  ABOVE_PROMPT_REQUEST_ID,
  EMPTY_PANES,
  FUNCTION_HOOK_EVENTS,
  HOOK_DEPTH_LIMIT_MESSAGE,
  HOOK_VM_DEPTH_LIMIT_MESSAGE,
  MAX_HOOK_VALUE_DEPTH,
  MAX_HOOK_VM_DEPTH,
  PANE_ASKED_MAX,
  PANE_OPEN_FLOOR_ASKED,
  PANE_OPEN_FLOOR_DEFAULT,
  assertHookValueDepth,
  formatPluginStatusText,
  functionHookPatternMatches,
  isModModelUsageLimitError,
  modelCompleteTokenBudget,
  parseFunctionHookPattern,
  sanitizeHookBoundaryValue,
} from './functionHooks/constants.js'
export {
  cancelClientMessage,
  dispatchClientFault,
  dispatchClientMessage,
  enqueueClientMessage,
} from './functionHooks/faultRender.js'
export {
  PRESS_ANSWER_MS,
  computeDrawingFingerprint,
  createHeldPressStore,
  getLivePressEvent,
} from './functionHooks/heldPressStore.js'
export {
  dispatchTelemetryLog,
  formatHookPassedByLine,
  getHooksPassedByLines,
  installDefaultCollectorTelemetryRoad,
  recordHooksPassedBy,
  resetHooksPassedByForTests,
  runEngineCreateFold,
  runEngineCreateLocalInProcess,
  runFunctionHookChain,
  runFunctionHookHop,
  runFunctionHookStreamChain,
} from './functionHooks/hookChain.js'
export { handleHostOp } from './functionHooks/hostOp.js'
export {
  bumpPluginFieldSeatGeneration,
  closePluginPane,
  cycleShownPaneId,
  focusPane,
  forgetAskedPane,
  getPaneRemountGeneration,
  getPanesState,
  getPanesStore,
  getPanesTerminalSize,
  getPluginFieldSeatGenerationStore,
  getPluginInputSeatStore,
  getPluginPanes,
  getPluginSelectSeatStore,
  getShownPluginPane,
  hasAskedPane,
  isToastHoldShown,
  keptAskedPanesFromConfig,
  nextFocusedPaneId,
  offerPanePlacement,
  offerPlacement,
  paneOpenFloor,
  panesIncludingUnplaced,
  placeWaitingPanes,
  placeWaitingPanesRemote,
  placementAtOpen,
  pluginFieldSeatGeneration,
  pluginFieldSeatKey,
  rememberAskedPane,
  scrollPluginPane,
  seedAskedPanes,
  setPanesState,
  settleFocusRequest,
  settlePaneFocusRequest,
  settlePanesTerminalColumns,
  showPane,
  subscribePanes,
  syncRemotePaneKeyboard,
  wirePanesState,
  withKeptAsked,
} from './functionHooks/panes.js'
export {
  callPluginInterface,
  finalizeOwnedTable,
} from './functionHooks/pluginEngine.js'
export {
  holdPress,
  invokePress,
  releasePresses,
} from './functionHooks/press.js'
export {
  PROMPT_AUTOCOMPLETE_HOP_SITE,
  SESSION_RECEIVE_HOP_SITE,
  createPromptChangeCoordinator,
  createPromptEditComposer,
  createRemoteAutocompleteDispatcher,
  extractAutocompleteToken,
  normalizeAutocompleteSuggestions,
  readPromptMediaById,
  runPromptAutocomplete,
  withPromptSubmitMedia,
} from './functionHooks/promptAndSession.js'
export {
  decodeRasterCells,
  rasterWordsToAnsi,
} from './functionHooks/raster.js'
export {
  clearPersonalPluginEnvSetKeysForReset,
  dropPersonalPluginEnvSetIfMatches,
  engineMergeRead,
  getHookedMergeState,
  getPersonalPluginEnvSetKeys,
  hasPersonalPluginEnvChangeForKeys,
  onSettingsChangedForMerge,
  raiseEngineSettingsMerge,
  resetHookedMergeState,
  scheduleEngineSettingsMerge,
  settingsReadPlugins,
  withPersonalPluginEnvIsolated,
} from './functionHooks/settingsAndEnv.js'
export {
  applyPendingUiInvalidations,
  bindHostOpPort,
  bumpRasterFrames,
  checkPluginInputRefusal,
  clearSessionStoppedForPluginInput,
  clearTurnRequestCacheSafeParams,
  createRasterPalette,
  flushHeadlessInlineModStderr,
  getClientMessagesDispatched,
  getCurrentHeldTurnId,
  getCurrentInterfaceCallers,
  getLastInterfaceCallers,
  getLastUiRenderPlugin,
  getLiveHookEvent,
  getLoadedFunctionHooksModules,
  getOwnedTable,
  getPendingUiInvalidations,
  getPluginDrawingTrees,
  getPluginFaultRenderStateSize,
  getPluginFaultRunsSize,
  getPluginHostCalls,
  getPluginInputRefusalReason,
  getPluginRegisteredCommands,
  getRasterFrameVersion,
  getRecordedPresses,
  getResolvedAnswer,
  getResolvedTables,
  hasClassicFunctionHook,
  hasMatchingFunctionHook,
  heldByKeyOf,
  heldPress,
  heldPressCount,
  hostedButtonsOf,
  isInsideAgentSpawnLaunch,
  isOwnedTableFinalized,
  markSessionStoppedForPluginInput,
  notePluginSpawnedTurnTaken,
  notifyFunctionHooksModulesLoaded,
  recordPress,
  recordSessionStartLoad,
  registerUiInvalidationHandlers,
  reportHeadlessInlineModStderr,
  resetHeadlessInlineModStderrState,
  setAgentSpawnHandler,
  setBackgroundCeilingProvider,
  setCommandRunHandler,
  setFunctionHooksAppStateReader,
  setFunctionHooksAppStateWriter,
  setFunctionHooksHost,
  setFunctionHooksToolUseContext,
  setFunctionHooksTurnReader,
  setHeadlessPluginOutputFormat,
  setLaterLoadedSessionStart,
  setOwnedTable,
  setPluginBandExpanded,
  setPromptSubmitHandler,
  setSessionCompactHandler,
  setSpawnedTurnTakenCallback,
  setToolCallHandler,
  setToolCheckHandler,
  setTurnAbortHandler,
  setTurnRequestCacheSafeParams,
  setUiAskHandler,
  setUiAskHostHandler,
  setUiCancelNotifyHandler,
  setUiNotifyHandler,
  setUiStatusHandler,
  setUiToastShowHandler,
  setUiViewHost,
  storeResolvedTables,
  subscribeRasterFrames,
  unbindHostOpPort,
  withSessionStartDedup,
} from './functionHooks/state.js'
export {
  getBackdropRenderProps,
  getSessionTheme,
  getThemeRenderProps,
  resetSessionThemeForTests,
  subscribeSessionTheme,
} from './functionHooks/theme.js'
export {
  AGENT_SPAWN_HOP_SITE,
  agentSpawnUnappliedWarning,
  awaitPluginToolSessionUnmount,
  evaluateClaudeAuthoredModLoadPolicy,
  getRegisteredPluginAgentDefinitions,
  runWorkflowAgentSpawn,
  wrapCanUseToolForPluginModCall,
} from './functionHooks/toolsAndAgents.js'
export type {
  AskedPaneRef,
  FunctionHookBudget,
  FunctionHookFailedReport,
  FunctionHookHandler,
  FunctionHookHopSite,
  FunctionHookHostHandler,
  FunctionHookPlugin,
  FunctionHookTail,
  HeldPressRecord,
  HookOriginEntry,
  HookServingContext,
  HookTraceEntry,
  HookedMergeAnswers,
  HookedMergeEntry,
  HookedMergeError,
  HookedMergeState,
  LeftoverHooksModule,
  LoadedFunctionHook,
  LoadedFunctionHooksModule,
  MountedRaster,
  PanesState,
  PanesTerminalSize,
  PersonUiScrollInput,
  PersonalPluginEnvWrite,
  PluginDrawingTree,
  PluginFocusCommitInput,
  PluginFocusHostBind,
  PluginFocusSiteSnapshot,
  PluginPaneEntry,
  PluginScrollOrigin,
  PluginScrollSiteDims,
  PluginScrollSiteSnapshot,
  PromptAutocompleteSuggestion,
  PromptChangeOrigin,
  PromptEditBox,
  PromptMediaAttachmentInput,
  RasterPalette,
  RemoteClientMessageInput,
  RemoteClientPressInput,
  RemoteUiFocusInput,
  RemoteUiScrollInput,
  ScrollSiteLayoutNode,
  SessionThemeState,
  UiNotifyChannelResult,
  UiViewShowResult,
} from './functionHooks/types.js'
export {
  evaluateUiRender,
  runUiHost,
} from './functionHooks/uiRender.js'
export {
  alignScrollToKeyRows,
  attachImageWidgetSwap,
  attachRasterWidgetPaint,
  bindPluginFocusHost,
  bindPluginScrollSiteLayout,
  clientModuleFor,
  commitPluginScrollSite,
  dispatchPersonUiScroll,
  dispatchUiFocus,
  followPluginScrollSiteEnd,
  getMountedImageFrames,
  getMountedRasterFrames,
  getPluginFocusSite,
  getPluginScrollSite,
  heldFocusEdge,
  isForeignPluginScrollOrigin,
  layoutKeyRows,
  layoutOffsetTop,
  logUiScrollSettled,
  mountRaster,
  nearestScrollOffset,
  noteDrawnElement,
  registerPluginScrollSite,
  runRemoteClientMessage,
  runRemoteClientPress,
  runRemoteUiFocus,
  runRemoteUiScroll,
  scrollSiteKeyRows,
  subscribePluginFocusSiteDraws,
  unregisterPluginScrollSite,
  updatePluginScrollSite,
} from './functionHooks/uiSites.js'
export {
  PROMPT_DECORATION_KEYS,
  PROMPT_DECORATION_STYLE_KEYS,
  PROMPT_DECORATION_VIRTUAL_TEXT,
  UI_BOX_NAMED_SPACING,
  UI_BOX_OVERFLOW_X_VALUES,
  UI_BOX_SHORTHAND_SPACING,
  UI_BOX_SPACING_AXES,
  UI_TEXT_DIRS,
  UI_TEXT_MAX_LINES_LIMIT,
  UI_TEXT_SIZES,
  UI_TEXT_WEIGHTS,
  UI_TEXT_WRAP_VALUES,
  getSurfaceUiRenderCaps,
  matcherAllows,
  normalizeModScrollXTree,
  normalizeModTextProps,
  normalizeModTextWrapAndMaxLines,
  resolveModBoxSpacingProp,
  sessionCompactMessagesCheck,
  uiRenderDialogRowsCheck,
  uiRenderDrawingPlainCheck,
  uiRenderEnginePropsCheck,
  uiRenderHoverCheck,
  uiRenderMatcherNeverRuns,
  uiRenderModPropsCheck,
  uiRenderTreeCheck,
  validateModBoxOverflowX,
  validateModTextMaxLines,
  validateModTextWrap,
  validatePromptDecorations,
} from './functionHooks/uiValidation.js'
export {
  beginFunctionHooksWorkerReplacement,
  leftoverBuiltinHooksModule,
  leftoverFu,
  leftoverLh,
  leftoverUs,
  listBuiltinFunctionHookPlugins,
  loadFunctionHooksInProcess,
  loadFunctionHooksModules,
  recordFunctionHookPlugins,
  retireFunctionHooksModule,
  scanFunctionHookSource,
  setLoadedFunctionHooksModules,
  stopFunctionHooksWorker,
} from './functionHooks/workerAndLoader.js'

installDefaultCollectorTelemetryRoad()

exitSessionContext(() => {
  setClientPressBridge({
    hold(plugin, run) {
      const handle = -++fhState().nextClientPressHandle
      fhState().pressHandlers.set(pressSlot(plugin, handle), run)
      const set =
        fhState().clientPressHandlesByPlugin.get(plugin) ?? new Set<number>()
      set.add(handle)
      fhState().clientPressHandlesByPlugin.set(plugin, set)
      return handle
    },
    release(plugin, handles) {
      const set = fhState().clientPressHandlesByPlugin.get(plugin)
      for (const handle of handles) {
        fhState().pressHandlers.delete(pressSlot(plugin, handle))
        set?.delete(handle)
      }
      if (set?.size === 0) fhState().clientPressHandlesByPlugin.delete(plugin)
    },
    forget(plugin) {
      if (plugin === undefined) {
        for (const [owner, handles] of fhState().clientPressHandlesByPlugin) {
          for (const handle of handles) {
            fhState().pressHandlers.delete(pressSlot(owner, handle))
          }
        }
        fhState().clientPressHandlesByPlugin.clear()
        return
      }
      const set = fhState().clientPressHandlesByPlugin.get(plugin)
      if (!set) return
      for (const handle of set) {
        fhState().pressHandlers.delete(pressSlot(plugin, handle))
      }
      fhState().clientPressHandlesByPlugin.delete(plugin)
    },
  })
})
