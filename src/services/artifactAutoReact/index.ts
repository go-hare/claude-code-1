/**
 * densable Artifact autoReact product surface (2.1.239) — tip 1:1 port.
 * @see docs/upstream-extraction/v2.1.239/snippets/gold-autoReact-product-239.txt
 */
export {
  createArtifactAutoReactStore,
  getArtifactAutoReactHolder,
  resetArtifactAutoReactStoreForTests,
  StopLatches,
  un,
  type ArtifactAutoReactStore,
  type ArtifactShareStatus,
  type AutoReactWiring,
  type BootingWiredArm,
  type CommentMonitorIntentLine,
  type DurableWatchRow,
  type LedgerArtifactSnapshot,
  type LedgerThreadSnapshot,
  type PendingLedger,
  type Supervisor,
  type NoticeCoalesceEntry,
  type NoticeCoalesceFamily,
} from './store.js'

export {
  disarmAutoReactUser,
  Gso,
  Jj,
  Lge,
  M2,
  MAm,
  mI,
  OAm,
  registerAutoReactAvailability,
  SN,
  Stn,
  Uqe,
  vkl,
  wtn,
} from './gates.js'

export {
  bindSupervisorTaskId,
  clearCommentCensus,
  Dso,
  EHw,
  getCommentCensus,
  getCommentCensusGeneration,
  markCommentCensusDirty,
  M3i,
  registerSupervisor,
  setBootingWiredArm,
  Y4n,
  type RegisterSupervisorInput,
} from './supervisors.js'

export {
  applyStoppedIntents,
  armCommentMonitorIntent,
  dollarSo,
  forgetCommentMonitorIntent,
  getCommentMonitorIntentState,
  getTornStops,
  seedAdoptPendingFrameLive,
  stopAllArmedCommentMonitorIntents,
  stopCommentMonitorIntent,
} from './intent.js'

export {
  monitorSocketRegistry,
  oF,
  type OfOptions,
} from './oF.js'

export {
  addUnattendedReplies,
  bumpUnattendedReply,
  drainUnattendedReplies,
  formatUnattendedReplyNotice,
  getUnattendedReplies,
  seedUnattendedFromFrameLive,
  stampUnattendedIntoFrameLive,
  takeUnattendedReplies,
  UNATTENDED_REPLY_CAP,
  type DrainedUnattended,
} from './reply.js'

export {
  DURABLE_ORPHAN_CAP,
  DURABLE_REGISTRY_CAP,
  flushPendingRestoredRow,
  invalidateDurableRegistryPublished,
  parseDurableRegistry,
  publishDurableRegistry,
  reapStopLatchedDurableRow,
  restoreDurableRegistry,
  setDurableRegistrySink,
  upsertDurableWatchRow,
  type DurableRegistryPayload,
  type RegistrySink,
} from './durable.js'

export {
  FRAME_LIVE_ENTRY_CAP,
  FRAME_LIVE_MERGE_CAP,
  markStaleFrameLive,
  mergeFrameLiveEntries,
  parkUnresumedFrameLive,
  rearmCarriedFrameLive,
  rearmCarriedFrameLiveViaAgi,
  releaseUnresumedFrameLive,
  type FrameLiveEntry,
  type RearmCarriedOpts,
  type RearmCarriedResult,
  type RearmSkipReason,
} from './frameLive.js'

export {
  buildLedgerEnvelope,
  claimLedgerOwnership,
  ensureLedgerHydrated,
  flushLedgerNow,
  hydratePendingLedger,
  interruptLedgerSlug,
  interruptedLedgerArtifact,
  LEDGER_ARTIFACT_CAP,
  LEDGER_DEBOUNCE_MS,
  ledgerFilePath,
  retireLedger,
  scheduleLedgerWrite,
  seedPendingLedgerForTests,
  truncateLedgerArtifact,
  truncatePendingLedgerSlug,
  writeLedgerEnvelope,
  type AutoreactLedgerEnvelope,
} from './ledger.js'

export {
  aGi,
  armLiveSubscribe,
  describeArmSkipReason,
  getArtifactLiveArmDeps,
  isArtifactLiveArmDepsInstalled,
  isAutoReactGateOpen,
  isPublishContextWatchable,
  isValidArtifactSlug,
  liveSubscribeGateReason,
  Lkm,
  resetArtifactLiveArmDepsForTests,
  setArtifactLiveArmDeps,
  type ArmOutcome,
  type ArmSkipReason,
  type AGiInput,
  type ArmLiveDeps,
  type PublishContext,
} from './arm.js'

export {
  extractSubscriptionToken,
  fetchFrameBoot,
  FRAME_VER_RE,
  frameControlPlaneHeaders,
  isSubscriptionTokenGateOpen,
  mintSubscriptionToken,
  renewWatchToken,
  type RenewWatchTokenResult,
} from './mint.js'

export {
  createFrameLiveTransform,
  FRAME_LIVE_KEEPALIVE_MS,
  FRAME_LIVE_MAX_PAYLOAD,
  FRAME_LIVE_PROTOCOL,
  frameLiveWsUrl,
  openFrameLiveSocket,
  parseFrameLiveMessage,
  type FrameLiveMessage,
  type FrameLiveTransformOpts,
  type OpenFrameLiveSocketInput,
} from './cji.js'

export {
  callWatchUrlTool,
  classifyWatchUrlWithhold,
  extractLabeledField,
  extractTriggerId,
  isNoOriginatorMessage,
  isTriggerLimitMessage,
  isValidWebhookFireUrl,
  mcpResultToText,
  mintWatchUrl,
  parseWatchUrlMint,
  releaseOrphanTriggers,
  resetWatchUrlDepsForTests,
  setWatchUrlDeps,
  TRIGGER_ID_RE,
  UNWATCH_URL_TOOL,
  WATCH_URL_TOOL,
  WEBHOOK_FIRE_SUFFIX,
  WEBHOOK_TRIGGERS_PATH_PREFIX,
  type WatchUrlCallTool,
  type WatchUrlDeps,
  type WatchUrlMinted,
  type WatchUrlToolResult,
} from './watchUrl.js'

export {
  COALESCE_DETAIL_CAP,
  COALESCE_MAX_SETTLE_MS,
  COALESCE_SETTLE_MS,
  coalesceNotice,
  flushAllCoalesceForTests,
  formatArtifactDisplayName,
  formatArtifactTaskNotification,
  formatCoalesceSummary,
  markCoalesceSuppressed,
  type CoalesceNoticeInput,
} from './coalesce.js'

export {
  notifyArtifactChanged,
  yWt,
  type YWtInput,
} from './wake.js'

export {
  commentLane,
  contentHostCommentsUrl,
  digestCommentThreads,
  parseFrameCommentsPayload,
  readArtifactComments,
  readArtifactCommentsControlPlane,
  type ArtifactComment,
  type ArtifactThread,
  type CommentsReadErr,
  type CommentsReadOk,
} from './commentRead.js'

export {
  postArtifactCommentReply,
  type PostCommentReplyResult,
} from './commentReply.js'

export {
  resolveArtifactCommentThread,
  type ResolveCommentResult,
} from './commentResolve.js'

export {
  ARTIFACT_LIST_DEFAULT_LIMIT,
  listArtifactFrames,
  type ListedArtifactRow,
  type ListFramesResult,
} from './listFrames.js'

export {
  Ttn,
  allowAllCanUseTool,
  defaultNztReply,
  getNztHost,
  resetNztRunnerForTests,
  setNztHost,
  setNztRunner,
  type NztHost,
  type NztRunner,
  type NztToolUse,
  type NztYield,
  type TtnResult,
} from './nzt.js'

export {
  ARTIFACT_COMPOSE_SYSTEM,
  composeFastAck,
  composeSubstantiveReply,
  defaultComposeAutoReply,
  formatThreadForCompose,
} from './compose.js'

export {
  FAST_ACK_OPTIONS,
  FAST_ACK_SELECT_DEADLINE_MS,
  KPW_SYSTEM,
  composeFastAckKPw,
  type FastAckTrigger,
} from './kpw.js'

export {
  artifactLiveEditVf,
  checkLiveEditPermissions,
  classifyLiveEdit,
  getArtifactLiveEditVf,
  getToolPermissionContextFromToolUse,
  planConsentMustDeny,
  resetArtifactLiveEditVfForTests,
  runLiveEditAction,
  setArtifactLiveEditVf,
  type ArtifactLiveEditVf,
  type LiveEditPermissionInput,
  type LiveEditPermissionOpts,
} from './liveEditPermissions.js'

export {
  applyHtmlPatches,
  composeEditDecision,
  defaultAttemptEdit,
  parseEditDecision,
  publishArtifactHtml,
  readArtifactHtml,
  type EditDecision,
} from './edit.js'

export {
  SUMMON_FRESH_MS,
  VISIBLE_HANDOFF_GRACE_MS,
  allSummonsClaimed,
  claimSummonSeed,
  consumeVisibleHandoffClaims,
  hasSummonClaim,
  isDesktopEntrypoint,
  isIsoZTimestamp,
  isSummonFresh,
  isVisibleHandoffGateOpen,
  outstandingSummons,
  parseCommentTimestamp,
  summonAfterReference,
  summonClaimKey,
  waitForVisibleHandoffClaims,
} from './summon.js'

export {
  getArtifactScanState,
  getArtifactScanDeps,
  resetArtifactScanDepsForTests,
  runAutoReplyPipeline,
  runCommentScanNow,
  scheduleCommentScan,
  setArtifactScanDeps,
  UPw,
  zPw,
  type ArtifactScanState,
  type ScanDeps,
  type ThreadScanState,
  type WakeArgs,
} from './scan.js'

export {
  CONSECUTIVE_AUTO_BREAKER,
  FAST_ACK_TEXT,
  HOURLY_AUTO_TURN_CAP,
  HOURLY_CAP_MAX,
  HOURLY_CAP_MIN,
  MANUAL_REPLY_HINT,
  PIPELINE_DENIAL_CAP,
  formatGateNotice,
  formatGateSummary,
  maxAutoTurnsPerHour,
  underHourlyAutoCap,
  verdictFromPermissionMode,
  type GateNoticeKind,
  type PermissionModeLike,
  type ReplyPermissionVerdict,
} from './actGates.js'

export {
  durableSubscribe,
  refreshRestoredDurableWatches,
  type DurableSubscribeOutcome,
} from './durableSubscribe.js'

export {
  installArtifactAutoReactProduct,
  installDefaultArtifactLiveArmDeps,
  isArtifactAutoReactProductInstalled,
  resetArtifactAutoReactProductForTests,
  type InstallProductOpts,
  type InstallProductOpts as InstallLiveArmDepsOpts,
} from './bootstrap.js'

export {
  callArtifactStatus,
  callArtifactUnwatch,
  callArtifactWatch,
  formatArtifactWatchStatus,
  type StatusWatchRow,
  type UnwatchActionResult,
  type WatchActionResult,
} from './watchActions.js'

export {
  commentCensusStatusFields,
  formatCommentCensusStatusClause,
  isArtifactCommentsStatusEnabled,
  markCommentsReadForCensus,
  recountCommentCensus,
  refreshDirtyCommentCensuses,
  type CommentCensusStatusFields,
} from './commentCensus.js'

export {
  deleteArtifactAsset,
  deleteArtifactFrame,
  fetchArtifactAssetBytes,
  fetchArtifactFileBytes,
  fetchArtifactVerifyDiagnostics,
  getArtifactRoomHost,
  isArtifactDeleteSchemaOpen,
  isArtifactVerifyGateOpen,
  listArtifactAssets,
  listArtifactFiles,
  resetArtifactRoomHostForTests,
  sendArtifactRoomEvent,
  setArtifactRoomHost,
  uploadArtifactAsset,
  type ArtifactRoomHost,
  type AssetRow,
  type FileRow,
  type RoomSendResult,
} from './restApis.js'

export {
  assetAgentDeleteRoute,
  assetAgentListRoute,
  assetAgentUploadRoute,
  assetRxl,
  parseFrameContractLatest,
  setAssetRxlDepsForTests,
  ASSET_LIST_LIMIT,
  ASSET_SVG_CONTENT_TYPE,
  ASSET_SVG_UPLOAD_MAX_BYTES,
  ASSET_UPLOAD_MAX_BYTES,
} from './assetRxl.js'

export {
  callArtifactReadAsset,
  callArtifactReadFile,
  type ReadAssetSaveResult,
  type ReadFileSaveResult,
} from './saveActions.js'

export {
  ARTIFACT_ASSET_CONTENT_TYPES,
  ARTIFACT_ASSET_ID_RE,
  ARTIFACT_SAVE_CONTENT_TYPE_RE,
  ARTIFACT_SAVE_MAX_BYTES,
  artifactJweWriteBlock,
  assetReadPathCandidates,
  defaultArtifactFilesDir,
  extensionForContentType,
  isNetworkOrDevicePath,
  isWindowsReservedPublishedSegment,
  normalizePublishedPath,
  outsideWorktreeMessage,
  readOutDirFields,
  resolveAssetOutStem,
  resolveFileOutDest,
  tempSiblingPath,
  writeBytesExclusive,
  type OutDirFields,
  type OutDirPin,
} from './outDirPaths.js'

export {
  Egr,
  Fee,
  ip,
  jnt,
  Jgl,
  Kgl,
  ownershipSuffix,
  probeArtifactOwnership,
  Sqe,
  Tgr,
  zIe,
  type ArtifactShareRole,
  type OwnershipProbeResult,
} from './ownership.js'

export {
  artifactRelayAssetHeaders,
  artifactRelayFramePath,
  artifactRelayServedPath,
  createCcrGatewayArtifactFrameRelayHost,
  declineFrameRelay,
  fetchViaArtifactFrameRelay,
  getArtifactFrameHostOverride,
  getArtifactFrameRelayHost,
  isAnthropicHostedRemoteSession,
  isArtifactFrameRelayOpen,
  isClaudeCodeRemoteEnv,
  isCobaltPlinthSorrelOpen,
  isFrameRelayDeclined,
  isFrameRelayServed,
  isSessionGatewayReady,
  markFrameRelayServed,
  resetArtifactFrameRelayHostForTests,
  resolveSessionGatewayBaseUrl,
  setArtifactFrameRelayHost,
  type ArtifactFrameRelayHost,
  type CcrGatewayArtifactFrameRelayHostDeps,
  type FrameRelayFetchResult,
} from './frameRelay.js'

export {
  DL,
  frameDlGet,
  frameDlGetRelayOnly,
  frameDlPost,
  frameDlPostRelayOnly,
  setFrameDlDepsForTests,
  type FrameDlResult,
} from './frameDl.js'

export {
  CGi,
  freezeReadPageDataSchemaNames,
  isReadPageDataAvailable,
  isReadPageDataSchemaAvailable,
  listEnabledInteractionSchemaNames,
  listRegisteredInteractionSchemaNames,
  registerInteractionSchema,
  registerReadPageDataAvailability,
  registerWorkshopDecisionsGate,
  resetInteractionSchemaGatesForTests,
  VRm,
  WORKSHOP_DECISIONS_DOC,
} from './interactionSchemas.js'

export {
  decodeIslandTextField,
  deriveWorkshopFromEntries,
  deriveWorkshopState,
  findIslandIdAttributeSpans,
  cQf,
  findDomNodesById,
  runSchemaDerive,
  uto,
  validateIslandJsonAgainstSchema,
  type UtoResult,
  type WorkshopDecisionEntry,
} from './islandExtract.js'

export {
  nestingBudgetExceeded,
  scanNestingCounters,
  scanNestingWithIwt,
  MAX_ESTIMATED_NESTING,
  MAX_TOTAL_OPEN_TAGS,
} from './nestingBudget.js'

export {
  Ixm,
  hxl,
  markWorkshopInvokeT0,
  markWorkshopInvokeT0Once,
  isFirstWorkshopPublish,
  markWorkshopPublishedSeen,
  createWorkshopTelemetryState,
  markWorkshopStartedSeen,
  markWorkshopCompletedSeen,
  workshopTelemetrySlug,
  workshopTelemetryVer,
  htmlLooksLikeWorkshop,
  type WorkshopTelemetryState,
  type WorkshopDeliverables,
} from './workshopTelemetry.js'

export {
  resolveFrameRelayFamily,
  type FrameRelayFamily,
} from './frameRelayFamily.js'

export { runReadPageData, type ReadPageDataResult } from './readPageData.js'
