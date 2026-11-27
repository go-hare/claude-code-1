/**
 * Plugin raster panes & UI-site facade (backwards-compatible re-export barrel).
 *
 * Implementation lives in cohesive, strictly acyclic submodules under
 * `src/components/pluginRaster/*.ts(x)`. External callers may continue
 * importing from `src/components/PluginRasterPanes.js` with 100% API compatibility.
 */

export { dockLitStore, getDockLitStore } from './FullscreenLayout.js';
export {
  bumpPluginFieldSeatGeneration,
  pluginFieldSeatGeneration,
  pluginFieldSeatKey,
} from '../utils/plugins/functionHooksModules.js';

export {
  DOCK_GRIP_COLUMNS,
  BORDER_MARK_INSET,
  CLOSE_MARK_COLUMNS,
  CLOSE_MARK_CELLS,
  TITLE_TAB_MAX_COLUMNS,
  paneTitleChromeRows,
  INLINE_PANE_CHROME_COLUMNS,
  titleTabColumns,
  titleStripStart,
  hotkeyMapOfDrawing,
  hotkeyDigitVisible,
  pressShownDigit,
  isHotkeyType,
  resolveHotkeyPresses,
  MARK_EDGE_COLUMNS,
  COLLAPSE_HANDLE_COLUMNS,
  teammateViewId,
  isOtherDrawer,
  HEIGHT_SETTLE_MS,
  BAND_REQUEST_ID,
  bandWindow,
  floorOffset,
  floorBandOffset,
  relativeWheelPointer,
  nextBandFocus,
  overflowCueText,
  pluginPaneDockColumns,
  INLINE_KEY_ROWS,
  DOCK_KEY_COLUMNS,
  pluginPaneInlineRows,
  extractDrawnPlugin,
  focusablesOfDrawing,
  ensurePaneWheelAccel,
  paneWheelScroll,
  selectFocusableAt,
  resetPluginSelectSeat,
  focusableAt,
  pluginInputFieldKey,
  pluginInputPressEvent,
  createPluginInputMap,
  selectWindow,
  openListRows,
  pluginInputHoldsControl,
  pluginSelectTypeahead,
  pluginSelectTypeaheadNext,
  pluginInputIsTyped,
  pluginInputIsNav,
  pluginClientKeyFromInput,
  pluginClientPointerButton,
} from './pluginRaster/drawingHelpers.js';
export type {
  HotkeyYogaSeat,
  DrawingFocusable,
  PluginSelectFocusable,
  PluginSelectSeatState,
  PluginBandKeyContext,
  PluginBandKeysBag,
  PluginInputFieldsSlice,
  PluginInputMapApi,
} from './pluginRaster/drawingHelpers.js';

export {
  useBandDigitHotkey,
  usePluginFieldSeatMap,
  usePluginFieldValuePrune,
  useYogaMeasure,
  getPluginClientFocusedId,
  subscribePluginClientFocus,
  setPluginClientFocusedId,
  clearPluginClientFocusedId,
  useDraftHeldAway,
  usePaneToastHold,
  getBandCollapsed,
  setBandCollapsed,
  subscribeBandCollapsed,
  getSettledBudget,
  setSettledBudget,
  subscribeSettledBudget,
  getOpenListRows,
  setOpenListRows,
  subscribeOpenListRows,
  pluginFieldContext,
  pluginKeysAreAhead,
  getDockRoomColumns,
  getInlineRoomRows,
  chooseDockRoom,
  chooseInlineRoom,
  subscribeDockRoom,
  keepPluginPaneRoom,
  usePaneClickAway,
  usePluginInputSeat,
  usePluginHoverScope,
} from './pluginRaster/sessionStores.js';

export {
  useBandScrollPlace,
  bandRingHandlers,
  paneScrollHandlers,
  bandKeysWithScroll,
  clickFocusByPress,
  extendPaneRingWithCloseMark,
  selectHighlightHandlers,
  selectKeysIntercept,
  usePluginSelectSeat,
  wrapPluginFocusActs,
  usePluginFocusHost,
  pluginBandKeys,
  usePluginBandKeys,
} from './pluginRaster/focusAndBandHooks.js';
export type {
  PluginSelectSeatRing,
  PluginSelectSeat,
  PluginFocusHostApi,
} from './pluginRaster/focusAndBandHooks.js';

export {
  PluginDimButton,
  PluginBandCollapseHandle,
  PluginBandCollapsedHint,
  PluginBandOverflowCue,
  PluginPaneTitleTab,
  PluginPaneTitleStrip,
  PluginPaneCloseMark,
  PluginRowGrip,
  PluginDockGrip,
  PluginPaneKeyResize,
} from './pluginRaster/chromeComponents.js';

export { DrawingNode } from './pluginRaster/drawingElements.js';

export {
  PluginPaneDockHost,
  PluginPaneSite,
} from './pluginRaster/paneSite.js';
export type { PluginPaneSiteProps } from './pluginRaster/paneSite.js';

export { PluginAbovePromptSite } from './pluginRaster/abovePromptSite.js';

export {
  PluginRenderedTree,
  askUserQuestionRewriteProblem,
  validateAskUserQuestionRewrite,
  restoreAskUserQuestionResult,
  getAskUserQuestionSurfacePolicy,
  registerEngineConfirmQuestion,
  isEngineConfirmationAsk,
  PluginAskUserQuestionSite,
  PluginPromptHintSite,
  PluginUserMessageSite,
} from './pluginRaster/uiSites.js';
export type {
  AskUserQuestionSubmission,
  PluginUserMessageOrigin,
} from './pluginRaster/uiSites.js';
