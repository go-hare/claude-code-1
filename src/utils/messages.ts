/**
 * Message creation, normalization, lookup, streaming, and API sanitization utilities.
 *
 * Facade barrel re-exporting all cohesive submodules under `src/utils/messages/`.
 */

export {
  isScheduledTaskOrigin,
  SCHEDULED_TASK_DISCLAIMER_PREFIX,
  wrapScheduledTaskDisclaimer,
} from './scheduledTaskDisclaimer.js'

export {
  assistantUiRenderText,
  isEmptyMessageText,
  stripPromptXMLTags,
} from './emptyMessageText.js'

export {
  withMemoryCorrectionHint,
  deriveShortMessageId,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  INTERRUPT_MESSAGE_FOR_PLUGIN_TOOL_USE,
  USER_REJECTED_TOOL_USE,
  SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
  CANCEL_MESSAGE,
  REJECT_MESSAGE,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  PLAN_REJECTION_PREFIX,
  interruptedCall,
  DENIAL_WORKAROUND_GUIDANCE,
  AUTO_REJECT_MESSAGE,
  DONT_ASK_REJECT_MESSAGE,
  NO_RESPONSE_REQUESTED,
  SYNTHETIC_TOOL_RESULT_PLACEHOLDER,
  isClassifierDenial,
  buildYoloRejectionMessage,
  formatClassifierUnavailableDetail,
  formatClassifierWaitDuration,
  formatClassifierWaitDetail,
  buildClassifierUnavailableMessage,
  buildHandoffClassifierUnavailableMessage,
  SYNTHETIC_MODEL,
  SYNTHETIC_MESSAGES,
  isSyntheticMessage,
  wrapInSystemReminder,
  wrapMessagesInSystemReminder,
} from './messages/constants.js'

export {
  wrapPeerOriginText,
  wrapObserverOriginText,
  wrapPluginOriginText,
  wrapChannelOriginText,
  TASK_NOTIFICATION_DISCLAIMER_PREFIX,
  wrapTaskNotificationDisclaimer,
  wrapTaskNotificationForApi,
  hardenTaskNotificationForApi,
  isSidechainVisibleOrigin,
  isMetaVisibleOrigin,
  isInSessionPeerOrObserverOrigin,
  looksLikeAgentMessageEnvelope,
  shouldPaintAgentInboundRow,
  isPeerInboundExpandClickable,
  isTeammateMessageExpandClickable,
  stripPeerOverflowFrame,
  peerMessageHasCollapsedWhitespace,
  looksLikeCrossSessionMessageEnvelope,
  isEnvelopeWrapOverflowClickable,
  isUserTextExpandClickable,
  isPeerHandbackOrFlaggedOrigin,
  peerOrObserverDisplayName,
  isHumanLikeOrigin,
  uiRenderUserMessageOrigin,
  stampQueueOriginOnUserMessages,
  applyTurnStartOriginFraming,
  wrapCommandText,
  wrapResumePromptOrigin,
} from './messages/originFraming.js'
export type {
  WrapPeerOriginOpts,
  UiRenderUserMessageOrigin,
  ResumePromptOrigin,
} from './messages/originFraming.js'

export {
  mergeUserMessagesAndToolResults,
  mergeAssistantMessages,
  mergeUserMessages,
  mergeUserContentBlocks,
} from './messages/messageMerging.js'

export {
  isToolUseRequestMessage,
  isToolUseResultMessage,
  reorderMessagesInUI,
  hasUnresolvedHooks,
  getToolResultIDs,
  getSiblingToolUseIDs,
  buildMessageLookups,
  updateMessageLookupsIncremental,
  computeMessageStructureKey,
  EMPTY_LOOKUPS,
  EMPTY_STRING_SET,
  buildSubagentLookups,
  getSiblingToolUseIDsFromLookup,
  getProgressMessagesFromLookup,
  hasUnresolvedHooksFromLookup,
  getToolUseIDs,
  getToolUseID,
} from './messages/lookups.js'
export type {
  MessageLookups,
  UpdateMessageLookupsOptions,
} from './messages/lookups.js'

export {
  UNPARSED_TOOL_INPUT_KEY,
  isUnparsedToolInput,
  describeUnparsedToolInput,
  normalizeContentFromAPI,
  isNarrationThinkingBlock,
  estimateThinkingTokensFromText,
  thinkingSignatureMetricChars,
  extractMessageDeltaOutputTokens,
  handleMessageFromStream,
} from './messages/streamHandler.js'
export type {
  NormalizeContentFromAPIMeta,
  StreamingToolUse,
  StreamingThinking,
  StreamApiMetricsEvent,
  StreamMessageDisplayTransform,
  RefusalContinuationStreamEvent,
  StreamYEtHandlers,
} from './messages/streamHandler.js'

export {
  createAssistantMessage,
  createAssistantAPIErrorMessage,
  createUserMessage,
  isCompanionOrToolUserMessage,
  isUserMessageWithPairedToolResultsOnly,
  prepareUserContent,
  createUserInterruptionMessage,
  isShutdownInterruptedToolResultMessage,
  rewriteShutdownInterruptedToolResult,
  rewriteResumedSubagentShutdownToolResults,
  collectMcpOnlyUnresolvedToolUseIds,
  rewriteMcpShutdownInterruptedToolResults,
  createSyntheticUserCaveatMessage,
  formatCommandInputTags,
  createModelSwitchBreadcrumbs,
  createProgressMessage,
  createToolResultStopMessage,
  createSystemMessage,
  formatPermissionRetryPrefix,
  formatPermissionRetrySuffix,
  createPermissionRetryMessage,
  createBridgeStatusMessage,
  createScheduledTaskFireMessage,
  createStopHookSummaryMessage,
  createTurnDurationMessage,
  createAwaySummaryMessage,
  createMemorySavedMessage,
  createAgentsKilledMessage,
  createApiMetricsMessage,
  createCommandInputMessage,
  createCompactBoundaryMessage,
  createMicrocompactBoundaryMessage,
  createSystemAPIErrorMessage,
  createToolUseSummaryMessage,
} from './messages/factories.js'
export type {
  LocalCommandRun,
  ApiErrorRetrySource,
} from './messages/factories.js'

export {
  collectLastAssistantTextsForEditor,
  getLastAssistantMessage,
  hasToolCallsInLastAssistantTurn,
  extractTag,
  isNotEmptyMessage,
  isSystemLocalCommandMessage,
  filterUnresolvedToolUses,
  getAssistantMessageText,
  getUserMessageText,
  textForResubmit,
  extractTextContent,
  getContentText,
  isCompactBoundaryMessage,
  findLastCompactBoundaryIndex,
  getMessagesAfterCompactBoundary,
  shouldShowUserMessage,
  isThinkingMessage,
  countToolCalls,
  hasSuccessfulToolCall,
} from './messages/messageQueries.js'

export {
  filterWhitespaceOnlyAssistantMessages,
  filterOrphanedThinkingOnlyMessages,
  filterOrphanedThinkingAndWhitespaceMessages,
  stripSignatureBlocks,
} from './messages/thinkingFilter.js'

export {
  decomposeBatchedToolUses,
  reassembleBatchedToolUses,
  hideUnderlyingV1Tools,
} from './messages/batchToolUses.js'

export {
  ensureToolResultPairing,
  UNSUPPORTED_TOOL_CONTENT_SPACER,
  API_TOOL_NAME_MAX_CODE_POINTS,
  dropApiInvalidAssistantBlocks,
  mergeAdvisorStripPlans,
  buildAdvisorStripPlanFromMessages,
  stripAdvisorBlocksFromMessageIds,
  stripAdvisorBlocks,
} from './messages/apiSanitizer.js'
export type { AdvisorStripPlan } from './messages/apiSanitizer.js'

export { PLAN_PHASE4_CONTROL } from './messages/modeInstructions.js'

export {
  deriveUUID,
  IncrementalNormalizer,
  normalizeMessages,
} from './messages/uiNormalizer.js'
export type { IncrementalNormalizerOptions } from './messages/uiNormalizer.js'

export { normalizeAttachmentForAPI } from './messages/attachmentNormalizer.js'

export {
  reorderAttachmentsForAPI,
  stripToolReferenceBlocksFromUserMessage,
  stripCallerFieldFromAssistantMessage,
  isPromptHookAdditionalContextAttachment,
  normalizeMessagesForAPI,
} from './messages/apiNormalizer.js'
