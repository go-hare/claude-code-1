/**
 * Hooks are user-defined shell commands, prompts, agents, HTTP endpoints,
 * MCP tools, and callbacks executed at various points in Claude Code's lifecycle.
 *
 * Facade barrel re-exporting all cohesive submodules under `src/utils/hooks/`.
 */

export {
  formatHookErrorOutput,
  HOOK_ERROR_COLLAPSED_MAX_CHARS,
  HOOK_ERROR_EXPANDED_MAX_CHARS,
  HOOK_EXIT_127_PRETOOL_MESSAGE,
} from './hooks/hookErrorDisplay.js'

export {
  executeInBackground,
  extractCommandScriptPaths,
  isOfficialHookPluginId,
  resetBrokenAsyncRewakeForTests,
} from './hooks/hookAsyncRewake.js'

export {
  computeSessionEndHooksBoundMs,
  getPreToolHookBlockingMessage,
  getSessionEndHookTimeoutMs,
  getSessionEndHooksBoundMs,
  getStopHookMessage,
  getTaskCompletedHookMessage,
  getTaskCreatedHookMessage,
  getTeammateIdleHookMessage,
  getUserPromptExpansionHookBlockingMessage,
  getUserPromptSubmitHookBlockingMessage,
  shouldDowngradeMissingHookScriptExit2,
  shouldFailClosedHookInput,
  shouldSkipHookDueToTrust,
} from './hooks/hookInputHelpers.js'

export {
  Eve,
  Swt,
  Uct,
  wwt,
} from './hooks/hookOutputValidation.js'

export type {
  AggregatedHookResult,
  ElicitationResponse,
  HookBlockingError,
  HookOutsideReplResult,
  HookResult,
} from './hooks/hookTypes.js'

export {
  createBaseHookInput,
  kwt,
  parseHookOutput,
  formatHookCompletionDebugLog,
  isManagedSettingsHook,
  buildManagedHookIsolatedEnv,
  escapeSystemReminderTags,
  ON_FAILURE_BLOCK_IGNORED_EVENTS,
  isOnFailureBlock,
  wrapPowerShellHookCommand,
  wrapPowerShellHookWithNoBashAstGuard,
  shouldBlockNoBashGuard,
  shouldBlockOnFailureForEvent,
  applyOnFailureBlockToHookResult,
  applyOnFailureBlockToAggregatedHookResult,
} from './hooks/hookCore.js'
export type {
  PluginHookMatcherIdentity,
  SessionStartHookExecutionOptions,
} from './hooks/hookCore.js'

export {
  MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
  MAX_CONCURRENT_MODEL_HOOKS_PER_SESSION,
  MAX_OVERDUE_MODEL_HOOKS_PER_SESSION,
  MIN_MODEL_HOOK_TIMEOUT_SECONDS,
  resolveModelHookTimeoutMs,
  ModelHookSlotPool,
  createSessionModelHookSlots,
  getSessionModelHookSlots,
  mergeHookGeneratorsWithModelCap,
} from './hooks/hookModelSlotPool.js'
export type { SessionModelHookSlots } from './hooks/hookModelSlotPool.js'

export { processHookJSONOutput } from './hooks/hookOutputProcessor.js'

export {
  execCommandHook,
  executeStatusLineCommand,
  executeFileSuggestionCommand,
} from './hooks/hookShellRunner.js'

export {
  getMonitorCommand,
  extractBashLikeInputFromMonitor,
  getMonitorBashStandIn,
  getHookFamilyNames,
  remapHookInputForMonitorAsBash,
  enforceThroughFamilyOnlyHookResult,
  remapHookInputForMatchedHook,
  remapHookInputForOwnTool,
  hasHookForEvent,
  getMatchingHooks,
} from './hooks/hookConfigRegistry.js'

export { hasBlockingResult } from './hooks/hookOutsideReplEngine.js'

export {
  executePreToolHooks,
  executePostToolHooks,
  executePostToolUseFailureHooks,
  executePostToolBatchHooks,
  executePermissionDeniedHooks,
  executePermissionRequestHooks,
} from './hooks/hookToolEvents.js'

export {
  executeStopHooks,
  executeTeammateIdleHooks,
  executeTaskCreatedHooks,
  executeTaskCompletedHooks,
  shouldSkipUserPromptSubmitForCodeModeScriptOutput,
  executeUserPromptSubmitHooks,
  executeUserPromptExpansionHooks,
  runUserPromptExpansionHook,
  executeSessionStartHooks,
  executePreModelSwitchHooks,
  executePostModelSwitchHooks,
  executeSetupHooks,
  executeSubagentStartHooks,
  executeMessageDisplayHooks,
} from './hooks/hookSessionAndPromptEvents.js'
export type {
  StopHookPass,
  UserPromptExpansionMessage,
  UserPromptExpansionBlocked,
  UserPromptExpansionOk,
  PreModelSwitchDecision,
} from './hooks/hookSessionAndPromptEvents.js'

export {
  executeNotificationHooks,
  executeStopFailureHooks,
  executePreCompactHooks,
  executePostCompactHooks,
  executeSessionEndHooks,
  executeConfigChangeHooks,
  executeCwdChangedHooks,
  executeFileChangedHooks,
  executeDirectoryAddedHooks,
  hasInstructionsLoadedHook,
  executeInstructionsLoadedHooks,
  executeElicitationHooks,
  executeElicitationResultHooks,
  hasWorktreeCreateHook,
  hasWorktreeRemoveHook,
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
} from './hooks/hookLifecycleEvents.js'
export type {
  ConfigChangeSource,
  InstructionsLoadReason,
  InstructionsMemoryType,
  ElicitationHookResult,
  ElicitationResultHookResult,
} from './hooks/hookLifecycleEvents.js'
