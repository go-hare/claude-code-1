// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Headless print-mode orchestrator & backwards-compatible re-export barrel.
 *
 * Implementation is modularized into strictly acyclic submodules under
 * `src/cli/print/*.ts`. External callers may continue importing from
 * `src/cli/print.js` with 100% API compatibility.
 */
import {
  type HeadlessAppState,
  type HeadlessSetAppState,
  handleRewindFiles,
} from 'src/cli/headless/HeadlessControlPlane.js'
import type { Command } from 'src/commands.js'
import { type Tools, toolMatchesName } from 'src/Tool.js'
import type { McpSdkServerConfig } from 'src/services/mcp/types.js'
import {
  type AgentDefinition,
  isBuiltInAgent,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { ThinkingConfig } from 'src/utils/thinking.js'
import {
  type processSessionStartHooks,
  processSetupHooks,
  takeInitialUserMessage,
} from 'src/utils/sessionStart.js'
import type { SDKStatus, SDKMessage } from 'src/entrypoints/agentSdkTypes.js'
import type { AppState } from 'src/state/AppStateStore.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import {
  reportHeadlessSettingsValidationErrors,
  isDeferredToolResumeDisabled,
  restoreCostStateFromWorker,
  waitForCachedAccountDataBeforePrint,
  warnOAuthExpiryBeforePrint,
  handlePrintFullDiskExit,
} from './print/startupAndAccount.js'
import { setHeadlessPluginOutputFormat } from '../utils/plugins/functionHooksModules.js'
import {
  formatPrintEndedClaudeAiLoginWarning,
  PrintTextResults,
  PrintRetryNoticeWriter,
  PrintPeerHoldNoticeWriter,
  countsAsHeadlessLastMessage,
  type PrintTextResultMessage,
  hasAutoModeNoCheckDenial,
} from './print/outputFormatting.js'
import { feature } from 'bun:bundle'
import {
  getIsRemoteMode,
  getSessionId,
  getReplBridgeSessionId,
  getMainThreadAgentType,
} from 'src/bootstrap/state.js'
import { downloadUserSettings } from 'src/services/settingsSync/index.js'
import { settingsChangeDetector } from 'src/utils/settings/changeDetector.js'
import { applySettingsChange } from 'src/utils/settings/applySettingsChange.js'
import { isFastModeEnabled } from 'src/utils/fastMode.js'
import { proactiveModule } from './print/featureLoaders.js'
import {
  headlessProfilerStartTurn,
  headlessProfilerCheckpoint,
  logHeadlessProfilerTurn,
} from 'src/utils/headlessProfiler.js'
import { setSdkEventQueueKey, drainSdkEvents } from '../utils/sdkEventQueue.js'
import { setOwnBridgeHopAddressResolver } from '../utils/peerAdmission.js'
import {
  isQualifiedForGrove,
  checkGroveForNonInteractive,
} from 'src/services/api/grove.js'
import { initializeGrowthBook } from '../services/analytics/growthbook.js'
import { gracefulShutdownSync } from 'src/utils/gracefulShutdown.js'
import {
  getStructuredIO,
  loadInitialMessages,
  restoreHeadlessSep2663Tasks,
} from './print/sessionBootstrap.js'
import { StructuredIO, setCurrentStructuredIO } from 'src/cli/structuredIO.js'
import { RemoteIO } from 'src/cli/remoteIO.js'
import {
  shouldRegisterSdkOauthRefreshCallback,
  shouldRegisterSdkHostAuthRefreshCallback,
} from 'src/utils/residualFinalEnvGates.js'
import { setSdkOauthTokenRefreshCallback } from 'src/utils/sdkOauthTokenRefresh.js'
import {
  getHostAuthRefreshTimeoutMs,
  setHostAuthTokenRefreshCallback,
} from 'src/utils/hostCredsFile.js'
import { installStreamJsonStdoutGuard } from 'src/utils/streamJsonStdoutGuard.js'
import { SandboxManager } from 'src/utils/sandbox/sandbox-adapter.js'
import { isEvalConfined } from 'src/utils/permissions/evalConfined.js'
import {
  SANDBOX_REQUIRED_UNAVAILABLE,
  buildErrorDuringExecutionResult,
  SANDBOX_FAIL_IF_UNAVAILABLE_HINT,
} from 'src/cli/spareClaim.js'
import { logForDebugging } from 'src/utils/debug.js'
import type { StdoutMessage } from 'src/entrypoints/sdk/controlTypes.js'
import { errorMessage } from '../utils/errors.js'
import { registerHookEventHandler } from 'src/utils/hooks/hookEvents.js'
import { randomUUID, type UUID } from 'crypto'
import { SYNTHETIC_OUTPUT_TOOL_NAME } from '@claude-code/builtin-tools/tools/SyntheticOutputTool/SyntheticOutputTool.js'
import { getTools, filterToolsByDenyRules } from 'src/tools.js'
import { restoreAgentFromSession } from 'src/utils/sessionRestore.js'
import { saveAgentSetting } from 'src/utils/sessionStorage.js'
import { formatRewindSkippedLinksCliWarning } from 'src/utils/fileHistory.js'
import {
  type RequiresActionDetails,
  notifySessionStateChanged,
  enableWorkerPermissionModeRecord,
  notifyInternalMetadataChanged,
  settleUltracodeActive,
} from 'src/utils/sessionState.js'
import { getCanUseToolFn } from './print/hooksAndPermissions.js'
import { restoreTaskListOnSelfHostedRunnerResume } from 'src/utils/tasks.js'
import {
  registerProcessOutputErrorHandlers,
  writeToStdout,
} from 'src/utils/process.js'
import { restoreMemoryToggleFromWorkerState } from 'src/utils/restoreMemoryToggle.js'
import {
  restoreCcrSessionRules,
  evaluateCcrKeepsSessionRules,
} from 'src/state/onChangeAppState.js'
import {
  syncWorkerPermissionModeRecord,
  isRestartedWorker,
} from 'src/utils/permissions/planModeResume.js'
import { getMainLoopModel } from 'src/utils/model/model.js'
import { isUltracodeModeActive, pdSessionEffort } from 'src/utils/effort.js'
import { createUserMessage } from 'src/utils/messages.js'
import { sleep } from 'src/utils/sleep.js'
import { ensureModelStringsInitialized } from 'src/utils/model/modelStrings.js'
import { createStreamlinedTransformer } from 'src/utils/streamlinedTransform.js'
import { runHeadlessStreaming } from './print/streamingSession.js'
import { formatHeadlessPluginErrors } from '../types/plugin.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { isExtractModeActive } from '../memdir/paths.js'
import { waitForHeadlessPluginInstallDrain } from '../utils/plugins/headlessPluginInstall.js'

// ---------------------------------------------------------------------------
// 100% backwards-compatible re-export barrel
// ---------------------------------------------------------------------------
export { classifyProxyConnectError } from 'src/bridge/remoteControlEndpointReason.js'
export {
  formatNonInteractiveBgTimeoutGuidance,
  formatNonInteractiveBgTimeoutToolDescription,
  resolveNonInteractiveBgTimeoutMs,
} from 'src/QueryEngine.js'
export { readPersistedSep2663TaskMetas } from 'src/tasks/McpTask/McpTask.js'
export type {
  DynamicMcpState,
  HeadlessAppState,
  HeadlessSetAppState,
  McpSetServersResult,
  SdkMcpState,
} from 'src/cli/headless/HeadlessControlPlane.js'
export {
  HeadlessControlPlane,
  handleMcpSetServers,
  handleOrphanedPermissionResponse,
  permissionPoliciesFromDynamicMcpConfigs,
  reconcileMcpServers,
  shouldInterruptParkedQuestionOnStreamClose,
} from 'src/cli/headless/HeadlessControlPlane.js'
export {
  AUTO_MODE_NO_CHECK_EXIT_CODES,
  enforceAutoModeNoCheckResultFailure,
  finalizeHeldBackResultForShutdown,
  formatApiRetryStatusLabel,
  formatPrintEndedClaudeAiLoginWarning,
  formatPrintWaitNotice,
  hasAutoModeNoCheckDenial,
  normalizeInformationalSdkMessage,
  PRINT_WAIT_NOTICE_DELAY_MS,
  PrintPeerHoldNoticeWriter,
  PrintRetryNoticeWriter,
  PrintTextResults,
  type PrintTextResultMessage,
  sanitizePrintTextForTty,
  serializePrintWireMessage,
  shouldFlushHeldBackResultOnAbort,
  shouldWriteWaitNoticeOnStderr,
} from './print/outputFormatting.js'
export {
  ASK_USER_QUESTION_AFK_TIMEOUT_DENY_MESSAGE,
  CcrFolderRestorer,
  type CcrFolderStageDeps,
  CostMetadataPusher,
  filterCloudSlashCommands,
  guardAskUserQuestionAfkTimeout,
  handlePrintFullDiskExit,
  hasCachedOAuthAccountData,
  isDeferredToolResumeDisabled,
  isHeadlessCronLoading,
  isRemoteControlOriginForSetCwd,
  PendingReRunSendsTracker,
  PRINT_ACCOUNT_DATA_WAIT_TIMEOUT_MS,
  reportHeadlessSettingsValidationErrors,
  reportPrintStartupFatalToJobDir,
  type RescueQueuedItemLike,
  type RescueYieldCommandHead,
  resizeInboundImageBlocks,
  resolveRescueYieldErrorKind,
  restoreCostStateFromWorker,
  shouldRescueYieldToPersonPrompt,
  validateAskUserQuestionPermissionAnswer,
  waitForCachedAccountDataBeforePrint,
  warnOAuthExpiryBeforePrint,
} from './print/startupAndAccount.js'
export {
  buildHeadlessInterruptReceipt,
  handleHeadlessCancelAsyncMessage,
  handleIncomingControlCancelRequest,
  type HeadlessInterruptReceipt,
  interruptAndWaitForRewindSettlement,
  removeInterruptedMessage,
} from './print/interruptAndCancel.js'
export {
  appendHookAdditionalContextToPromptContent,
  createCanUseToolWithPermissionPrompt,
  createMidTurnHookRunner,
  evaluateMidTurnCloudUserPromptSubmitHooks,
  getCanUseToolFn,
  type MidTurnCloudHookOutcome,
} from './print/hooksAndPermissions.js'
export { restoreHeadlessSep2663Tasks } from './print/sessionBootstrap.js'

export async function runHeadless<TState extends HeadlessAppState = AppState>(
  inputPrompt: string | AsyncIterable<string>,
  getAppStateParam: () => TState,
  setAppStateParam: HeadlessSetAppState<TState>,
  commands: Command[],
  tools: Tools,
  sdkMcpConfigs: Record<string, McpSdkServerConfig>,
  agents: AgentDefinition[],
  options: {
    continue: boolean | undefined
    resume: string | boolean | undefined
    resumeSessionAt: string | undefined
    verbose: boolean | undefined
    outputFormat: string | undefined
    jsonSchema: Record<string, unknown> | undefined
    permissionPromptToolName: string | undefined
    allowedTools: string[] | undefined
    thinkingConfig: ThinkingConfig | undefined
    maxTurns: number | undefined
    maxBudgetUsd: number | undefined
    taskBudget: { total: number } | undefined
    systemPrompt: string | undefined
    appendSystemPrompt: string | undefined
    /** Official --append-subagent-system-prompt (Task-tool subagents only). */
    appendSubagentSystemPrompt?: string | undefined
    userSpecifiedModel: string | undefined
    fallbackModel: string | undefined
    teleport: string | true | null | undefined
    subscribeAppState?: (listener: () => void) => () => void
    sdkUrl: string | undefined
    replayUserMessages: boolean | undefined
    includePartialMessages: boolean | undefined
    /** densable 2.1.283 — SDK sessionStore transcript_mirror frames */
    sessionMirror?: boolean | undefined
    /** densable 2.1.219 #6 — nested subagent text/thinking on stream-json */
    forwardSubagentText?: boolean | undefined
    forkSession: boolean | undefined
    /**
     * Official --reply-on-resume: when resuming a transcript that ends in a
     * user-role message (bg mid-turn fork), auto-continue the interrupted turn
     * without requiring CLAUDE_CODE_RESUME_INTERRUPTED_TURN.
     */
    replyOnResume: boolean | undefined
    rewindFiles: string | undefined
    enableAuthStatus: boolean | undefined
    agent: string | undefined
    workload: string | undefined
    setupTrigger?: 'init' | 'maintenance' | undefined
    sessionStartHooksPromise?: ReturnType<typeof processSessionStartHooks>
    setSDKStatus?: (status: SDKStatus) => void
    /**
     * Official `fu`: hydrate transcript plan when this is false (CLI did
     * not pass `--permission-mode`). pL treats missing as true.
     */
    permissionModeSuppliedOnInvocation?: boolean
  },
): Promise<void> {
  const getAppState = getAppStateParam as unknown as () => AppState
  const setAppState = setAppStateParam as unknown as (
    f: (prev: AppState) => AppState,
  ) => void
  // Official EXIT_AFTER_FIRST_RENDER densable — ant-only startup bench exit.
  try {
    const { isExitAfterFirstRenderEnabled } = await import(
      '../utils/residualFinalEnvGates.js'
    )
    if (process.env.USER_TYPE === 'ant' && isExitAfterFirstRenderEnabled()) {
      process.stderr.write(
        `\nStartup time: ${Math.round(process.uptime() * 1000)}ms\n`,
      )
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(0)
    }
  } catch {
    // Official EXIT_AFTER_FIRST_RENDER densable.
    let exitAfterFirstRender = isEnvTruthy(
      process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER,
    )
    try {
      const { isExitAfterFirstRenderEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
      exitAfterFirstRender = isExitAfterFirstRenderEnabled()
    } catch {
      // keep raw env fallback
    }
    if (process.env.USER_TYPE === 'ant' && exitAfterFirstRender) {
      process.stderr.write(
        `\nStartup time: ${Math.round(process.uptime() * 1000)}ms\n`,
      )
      // eslint-disable-next-line custom-rules/no-process-exit
      process.exit(0)
    }
  }

  reportHeadlessSettingsValidationErrors(options.outputFormat)
  // Official 2.1.323 #2053: notify headless plugin hooks of resolved outputFormat
  // so buffered `--plugin-dir` (`@inline`) mod stderr flushes in text mode.
  setHeadlessPluginOutputFormat(options.outputFormat ?? 'text')

  // Official 2.1.323 #2133 & #2134: in `claude -p` text output, warn on stderr
  // when settings block the requested model and another model is used instead,
  // without printing generic `deniedModels`/`availableModels` notes on every run.
  if (
    options.userSpecifiedModel &&
    (options.outputFormat === undefined || options.outputFormat === 'text')
  ) {
    try {
      const { formatPrintBlockedModelStderrWarning } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/model/modelAllowlist.js') as typeof import('../utils/model/modelAllowlist.js')
      const { getMainLoopModel } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/model/model.js') as typeof import('../utils/model/model.js')
      const effectiveModel = getMainLoopModel()
      const warn = formatPrintBlockedModelStderrWarning(
        options.userSpecifiedModel,
        effectiveModel,
      )
      if (warn !== null) {
        process.stderr.write(warn)
      }
    } catch {
      // optional model allowlist check
    }
  }

  // Official 2.1.323 #2008: when `claude -p` falls back to `ant auth login`
  // after an ended claude.ai login, warn on stderr that `claude auth logout`
  // also removes saved MCP server logins and plugin secrets.
  if (!options.sdkUrl) {
    try {
      const { getAuthStatus } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../commands/login/getAuthStatus.js') as typeof import('../commands/login/getAuthStatus.js')
      const status = getAuthStatus() as {
        endedClaudeAiFellBackToProfile?: boolean
        organizationName?: string
      }
      if (status?.endedClaudeAiFellBackToProfile) {
        process.stderr.write(
          `${formatPrintEndedClaudeAiLoginWarning(status.organizationName || 'your organization')}\n`,
        )
      }
    } catch {
      // optional auth status check
    }
  }

  // Fire user settings download now so it overlaps with the MCP/tool setup
  // below. Managed settings already started in main.tsx preAction; this gives
  // user settings a similar head start. The cached promise is joined in
  // installPluginsAndApplyMcpInBackground before plugin install reads
  // enabledPlugins.
  // Official REMOTE densable.
  let isRemoteDownload = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
  try {
    const { isRemoteEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    isRemoteDownload = isRemoteEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (
    feature('DOWNLOAD_USER_SETTINGS') &&
    (isRemoteDownload || getIsRemoteMode())
  ) {
    void downloadUserSettings()
  }

  // In headless mode there is no React tree, so the useSettingsChange hook
  // never runs. Subscribe directly so that settings changes (including
  // managed-settings / policy updates) are fully applied.
  settingsChangeDetector.subscribe((source, extra) => {
    applySettingsChange(source, setAppState, extra)

    // In headless mode, also sync the denormalized fastMode field from
    // settings. The TUI manages fastMode via the UI so it skips this.
    if (isFastModeEnabled()) {
      setAppState(prev => {
        const s = prev.settings as Record<string, unknown>
        const fastMode = s.fastMode === true && !s.fastModePerSessionOptIn
        return { ...prev, fastMode }
      })
    }
  })

  // Proactive activation is now handled in main.tsx before getTools() so
  // SleepTool passes isEnabled() filtering. This fallback covers the case
  // where CLAUDE_CODE_PROACTIVE is set but main.tsx's check didn't fire
  // (e.g. env was injected by the SDK transport after argv parsing).
  // Official PROACTIVE densable.
  let proactiveEnv = isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE)
  try {
    const { isProactiveEnvEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    proactiveEnv = isProactiveEnvEnabled()
  } catch {
    // keep raw env fallback
  }
  if (
    (feature('PROACTIVE') || feature('KAIROS')) &&
    proactiveModule &&
    !proactiveModule.isProactiveActive() &&
    proactiveEnv
  ) {
    proactiveModule.activateProactive('command')
  }

  // Periodically run GC to keep memory usage in check.
  // Uses a memory threshold to trigger a forced (major) GC when RSS grows
  // beyond 350MB — the incremental GC may not reclaim enough during peaks
  // (compact, long sessions with many mounted DOM nodes).
  if (typeof Bun !== 'undefined') {
    const gcTimer = setInterval(() => {
      const rss = process.memoryUsage.rss()
      if (rss > 350 * 1024 * 1024) {
        Bun.gc(true)
      } else {
        Bun.gc(false)
      }
    }, 1000)
    gcTimer.unref()
  }

  // Start headless profiler for first turn
  headlessProfilerStartTurn()
  headlessProfilerCheckpoint('runHeadless_entry')

  // densable 2.1.289 setQueueKey — pin SDK event lane to session id (not default "cli").
  setSdkEventQueueKey(() => getSessionId())
  // densable jUt(Sjt) — print/SDK RC hop token for K2r.
  setOwnBridgeHopAddressResolver(() => {
    const id = getReplBridgeSessionId()
    return id ? `bridge:${id}` : undefined
  })

  // Check Grove requirements for non-interactive consumer subscribers
  if (await isQualifiedForGrove()) {
    await checkGroveForNonInteractive()
  }
  headlessProfilerCheckpoint('after_grove_check')

  // Initialize GrowthBook so feature flags take effect in headless mode.
  // Without this, the disk cache is empty and all flags fall back to defaults.
  void initializeGrowthBook()

  if (options.resumeSessionAt && !options.resume) {
    process.stderr.write(`Error: --resume-session-at requires --resume\n`)
    gracefulShutdownSync(1)
    return
  }

  if (options.rewindFiles && !options.resume) {
    process.stderr.write(`Error: --rewind-files requires --resume\n`)
    gracefulShutdownSync(1)
    return
  }

  if (options.rewindFiles && inputPrompt) {
    process.stderr.write(
      `Error: --rewind-files is a standalone operation and cannot be used with a prompt\n`,
    )
    gracefulShutdownSync(1)
    return
  }

  const structuredIO = getStructuredIO(inputPrompt, options)
  if (structuredIO instanceof StructuredIO) {
    setCurrentStructuredIO(structuredIO)
  }

  // densable 2.1.219 `_Is(_)`: register stream-json/SDK writer so async bg
  // agents (runAgent isAsync) can emit agent_progress via Yud() without the
  // parent onProgress path.
  if (options.sdkUrl || options.outputFormat === 'stream-json') {
    const { setStreamJsonStdoutWriter } = await import(
      '../utils/streamJsonStdoutWriter.js'
    )
    setStreamJsonStdoutWriter(structuredIO)
  }

  // Official working-sync densable: sdkUrl + REMOTE_SESSION_ID + !ENVIRONMENT_KIND
  // + !DISABLE_WORKING_SYNC → fire-and-forget startSyncedFileSyncer.
  // CCR j6o put host is wired when RemoteIO exposes requestSyncedFile.
  try {
    const { maybeStartWorkingSync } = await import(
      '../utils/workingSyncGate.js'
    )
    const remote =
      structuredIO instanceof RemoteIO ? (structuredIO as RemoteIO) : undefined
    const ccrHost = remote?.getWorkingFilestoreHost?.()
    maybeStartWorkingSync({
      sdkUrl: options.sdkUrl,
      ...(ccrHost
        ? {
            requestSyncedFile: args => ccrHost.requestSyncedFile(args),
            workerEpoch: ccrHost.workerEpoch,
          }
        : {}),
    })
  } catch {
    // densable optional
  }

  // Official BYi/UYi — wire session activity mainLoopRefcount → Imn + drop chain.
  try {
    const {
      setMainLoopRefcountListener,
      setDropNestedBlockedChainListener,
      getMainLoopRefcount,
    } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/sessionActivity.js') as typeof import('../utils/sessionActivity.js')
    const { setMainLoopRefcount, dropNestedBlockedChain } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/sessionState.js') as typeof import('../utils/sessionState.js')
    setMainLoopRefcountListener(n => setMainLoopRefcount(n))
    setMainLoopRefcount(getMainLoopRefcount())
    setDropNestedBlockedChainListener(agentId =>
      dropNestedBlockedChain(agentId),
    )
  } catch {
    // densable optional
  }

  // Official createPrintRequestDialog densable (cvf) — arm requestDialog host
  // for refusal_fallback / fable_overage / mcp_url_elicitation parks.
  let printRequestDialog:
    | ((
        spec: { kind: string; default: unknown },
        payload: unknown,
        options?: { signal?: AbortSignal },
      ) => Promise<unknown>)
    | undefined
  try {
    const { createPrintRequestDialog } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/printRequestDialog.js') as typeof import('../utils/printRequestDialog.js')
    const { setSdkDialogHostActive } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
    const { peek } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/messageQueueManager.js') as typeof import('../utils/messageQueueManager.js')
    setSdkDialogHostActive(true)
    printRequestDialog = createPrintRequestDialog({
      handleElicitation: (
        serverName,
        message,
        _schema,
        signal,
        mode,
        url,
        elicitationId,
      ) =>
        structuredIO.handleElicitation(
          serverName,
          message,
          undefined,
          signal,
          mode,
          url,
          elicitationId,
        ),
      requestUserDialog: (kind, payload, opts) =>
        structuredIO.requestUserDialog(kind, payload, opts),
      peekQueuedCommand: () => peek(),
      cancelPendingUserDialogs: (kind, reason) =>
        structuredIO.cancelPendingUserDialogs(kind, reason),
    })
  } catch {
    // densable optional
  }

  // Official: when SDK host owns OAuth refresh (desktop/local-agent/vscode),
  // register structuredIO.requestOAuthTokenRefresh as the 401 recovery callback.
  if (shouldRegisterSdkOauthRefreshCallback()) {
    setSdkOauthTokenRefreshCallback(() =>
      structuredIO.requestOAuthTokenRefresh(),
    )
  }
  // Official: HAS_HOST_AUTH_REFRESH + host entrypoint → host auth refresh callback.
  if (shouldRegisterSdkHostAuthRefreshCallback()) {
    const timeoutMs = getHostAuthRefreshTimeoutMs()
    setHostAuthTokenRefreshCallback(() =>
      structuredIO.requestHostAuthTokenRefresh(timeoutMs),
    )
  }

  // When emitting NDJSON for SDK clients, any stray write to stdout (debug
  // prints, dependency console.log, library banners) breaks the client's
  // line-by-line JSON parser. Install a guard that diverts non-JSON lines to
  // stderr so the stream stays clean. Must run before the first
  // structuredIO.write below.
  if (options.outputFormat === 'stream-json') {
    installStreamJsonStdoutGuard()
  }

  // Official 2.1.325 #2374: mark hosted tool containers (Claude Code on the
  // web, cloud scheduled tasks, Cowork cloud sessions) before checking sandbox
  // requirements so `sandbox.failIfUnavailable` is set aside with a warning
  // instead of exiting fatally in a container that has no command sandbox.
  const isHostedToolContainer =
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND === undefined &&
    (isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) ||
      Boolean(
        process.env.CLAUDE_CODE_CONTAINER_ID ||
          process.env.CLAUDE_CODE_REMOTE_SESSION_ID ||
          process.env.CLAUDE_CODE_REMOTE_SESSION_ORIGIN === 'cowork',
      ))
  if (isHostedToolContainer) {
    SandboxManager.markHostedToolContainer()
  }

  // #34044: if user explicitly set sandbox.enabled=true but deps are missing,
  // isSandboxingEnabled() returns false silently. Surface the reason so users
  // know their security config isn't being enforced.
  const sandboxUnavailableReason = SandboxManager.getSandboxUnavailableReason()
  if (sandboxUnavailableReason) {
    if (SandboxManager.isSandboxRequired()) {
      // densable @199034114: stream-json writes O6 then stderr/yo(1).
      // Tg(e) omits host detail when the process is a confined eval child.
      if (options.outputFormat === 'stream-json') {
        const prefix = isEvalConfined()
          ? SANDBOX_REQUIRED_UNAVAILABLE
          : `${SANDBOX_REQUIRED_UNAVAILABLE}: ${sandboxUnavailableReason}`
        if (isEvalConfined()) {
          logForDebugging(
            `sandbox unavailable detail: ${sandboxUnavailableReason}`,
            { level: 'error' },
          )
        }
        await structuredIO.write(
          buildErrorDuringExecutionResult(getSessionId(), [
            `${prefix}. ${SANDBOX_FAIL_IF_UNAVAILABLE_HINT}`,
          ]) as StdoutMessage,
        )
      }
      process.stderr.write(
        `\nError: sandbox required but unavailable: ${sandboxUnavailableReason}\n` +
          `  sandbox.failIfUnavailable is set — refusing to start without a working sandbox.\n\n`,
      )
      gracefulShutdownSync(1)
      return
    }
    if (SandboxManager.isSandboxRequirementSetAsideInHostedWorker()) {
      logForDebugging(
        `[sandbox] Hosted container has no command sandbox (${sandboxUnavailableReason}); setting aside sandbox.failIfUnavailable`,
        { level: 'warn' },
      )
      process.stderr.write(
        `\n⚠ Hosted container has no command sandbox: ${sandboxUnavailableReason}\n` +
          `  sandbox.failIfUnavailable was set aside because this hosted container provides outer isolation without a command sandbox.\n\n`,
      )
    } else {
      process.stderr.write(
        `\n⚠ Sandbox disabled: ${sandboxUnavailableReason}\n` +
          `  Commands will run WITHOUT sandboxing. Network and filesystem restrictions will NOT be enforced.\n\n`,
      )
    }
  } else if (SandboxManager.isSandboxingEnabled()) {
    // densable W4g(createSandboxAskCallback(...), getCtx, messagesRef, toolsRef)
    // — mode allow/deny/classify before SDK ask; sessionAllowedHosts on allow.
    try {
      const { wrapSandboxAskCallbackWithPermissionMode } = await import(
        '../utils/sandbox/sandboxNetworkDecision.js'
      )
      const {
        setSandboxNetworkHeadlessMessages,
        setSandboxNetworkHeadlessTools,
        getSandboxNetworkHeadlessMessages,
        getSandboxNetworkHeadlessTools,
      } = await import('../utils/sandbox/sandboxNetworkHeadlessRefs.js')
      // densable T.current=[] / k.current=s before loadInitialMessages
      setSandboxNetworkHeadlessMessages([])
      setSandboxNetworkHeadlessTools(tools)
      await SandboxManager.initialize(
        wrapSandboxAskCallbackWithPermissionMode({
          ask: structuredIO.createSandboxAskCallback(),
          getPermissionContext: () => getAppState().toolPermissionContext,
          getMessages: getSandboxNetworkHeadlessMessages,
          getTools: getSandboxNetworkHeadlessTools,
        }),
      )
    } catch (err) {
      process.stderr.write(`\n❌ Sandbox Error: ${errorMessage(err)}\n`)
      gracefulShutdownSync(1, 'other')
      return
    }
  }

  // densable tuu/o0g: only when unavailable is absent; needs getConfig after init.
  if (!sandboxUnavailableReason) {
    const maskCredentialWarning = SandboxManager.getMaskCredentialWarning()
    if (maskCredentialWarning) {
      process.stderr.write(`\n⚠ ${maskCredentialWarning}\n`)
    }
  }

  if (options.outputFormat === 'stream-json' && options.verbose) {
    registerHookEventHandler(event => {
      const message: StdoutMessage = (() => {
        switch (event.type) {
          case 'started':
            return {
              type: 'system' as const,
              subtype: 'hook_started' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
          case 'progress':
            return {
              type: 'system' as const,
              subtype: 'hook_progress' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              stdout: event.stdout,
              stderr: event.stderr,
              output: event.output,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
          case 'response':
            return {
              type: 'system' as const,
              subtype: 'hook_response' as const,
              hook_id: event.hookId,
              hook_name: event.hookName,
              hook_event: event.hookEvent,
              output: event.output,
              stdout: event.stdout,
              stderr: event.stderr,
              exit_code: event.exitCode,
              outcome: event.outcome,
              uuid: randomUUID(),
              session_id: getSessionId(),
            }
        }
      })()
      void structuredIO.write(message)
    })
  }

  if (options.setupTrigger) {
    await processSetupHooks(options.setupTrigger)
  }

  headlessProfilerCheckpoint('before_loadInitialMessages')
  const appState = getAppState()
  const {
    messages: initialMessages,
    turnInterruptionState,
    agentSetting: resumedAgentSetting,
    planModeOnResume,
    deferredToolUse: loadedDeferredToolUse,
    overdueSessionStartHooks,
    codeModeWaitForNextPrompt,
    codeModeSwitched,
  } = await loadInitialMessages(setAppState, {
    continue: options.continue,
    teleport: options.teleport,
    resume: options.resume,
    resumeSessionAt: options.resumeSessionAt,
    forkSession: options.forkSession,
    outputFormat: options.outputFormat,
    sdkUrl: options.sdkUrl,
    permissionModeSuppliedOnInvocation:
      options.permissionModeSuppliedOnInvocation,
    sessionStartHooksPromise: options.sessionStartHooksPromise,
    restoredWorkerState: structuredIO.restoredWorkerState,
    // densable hydratePrefetch from RemoteIO when --resume CCR v2
    hydratePrefetch:
      structuredIO instanceof RemoteIO
        ? (structuredIO as RemoteIO).hydratePrefetch
        : null,
  })
  // Official 2.1.328: if --continue/--resume switched Code Mode state, rebuild
  // the built-in tool pool so headless execution uses the updated tool set.
  if (codeModeSwitched) {
    const syntheticTool = tools.find(t => t.name === SYNTHETIC_OUTPUT_TOOL_NAME)
    const rebuilt = getTools(getAppState().toolPermissionContext)
    tools =
      syntheticTool && !rebuilt.some(t => t.name === SYNTHETIC_OUTPUT_TOOL_NAME)
        ? [...rebuilt, syntheticTool]
        : rebuilt
  }
  // Official 2.1.328 (#545): skip resuming hook-deferred tool calls when
  // CLAUDE_CODE_DISABLE_DEFERRED_TOOL_RESUME is set.
  const deferredToolUse = isDeferredToolResumeDisabled()
    ? undefined
    : loadedDeferredToolUse

  // SessionStart hooks can emit initialUserMessage — the first user turn for
  // headless orchestrator sessions where stdin is empty and additionalContext
  // alone (an attachment, not a turn) would leave the REPL with nothing to
  // respond to. The hook promise is awaited inside loadInitialMessages, so the
  // module-level pending value is set by the time we get here.
  const hookInitialUserMessage = takeInitialUserMessage()
  if (hookInitialUserMessage) {
    structuredIO.prependUserMessage(hookInitialUserMessage)
  }

  // Restore agent setting from the resumed session (if not overridden by current --agent flag
  // or settings-based agent, which would already have set mainThreadAgentType in main.tsx)
  if (!options.agent && !getMainThreadAgentType() && resumedAgentSetting) {
    const { agentDefinition: restoredAgent } = restoreAgentFromSession(
      resumedAgentSetting,
      undefined,
      { activeAgents: agents, allAgents: agents },
    )
    if (restoredAgent) {
      setAppState(prev => ({ ...prev, agent: restoredAgent.agentType }))
      // Apply the agent's system prompt for non-built-in agents (mirrors main.tsx initial --agent path)
      if (!options.systemPrompt && !isBuiltInAgent(restoredAgent)) {
        const agentSystemPrompt = restoredAgent.getSystemPrompt()
        if (agentSystemPrompt) {
          options.systemPrompt = agentSystemPrompt
        }
      }
      // Re-persist agent setting so future resumes maintain the agent
      saveAgentSetting(restoredAgent.agentType)
    }
  }

  // gracefulShutdownSync schedules an async shutdown and sets process.exitCode.
  // If a loadInitialMessages error path triggered it, bail early to avoid
  // unnecessary work while the process winds down.
  if (initialMessages.length === 0 && process.exitCode !== undefined) {
    return
  }

  // Handle --rewind-files: restore filesystem and exit immediately
  if (options.rewindFiles) {
    // File history snapshots are only created for user messages,
    // so we require the target to be a user message
    const targetMessage = initialMessages.find(
      m => m.uuid === options.rewindFiles,
    )

    if (!targetMessage || targetMessage.type !== 'user') {
      process.stderr.write(
        `Error: --rewind-files requires a user message UUID, but ${options.rewindFiles} is not a user message in this session\n`,
      )
      gracefulShutdownSync(1)
      return
    }

    const currentAppState = getAppState()
    const result = await handleRewindFiles(
      options.rewindFiles as UUID,
      currentAppState,
      setAppState,
      false,
    )
    if (!result.canRewind) {
      process.stderr.write(`Error: ${result.error || 'Unexpected error'}\n`)
      gracefulShutdownSync(1)
      return
    }

    // densable: Warning on stderr with TYn when skippedLinks > 0; success line clean
    if (typeof result.skippedLinks === 'number' && result.skippedLinks > 0) {
      process.stderr.write(
        `${formatRewindSkippedLinksCliWarning(result.skippedLinks)}\n`,
      )
    }
    process.stdout.write(
      `Files rewound to state at message ${options.rewindFiles}\n`,
    )
    gracefulShutdownSync(0)
    return
  }

  // Official 2.1.239:
  //   typeof t==="string"&&t.trim()===""&&!te&&!Q&&!U
  // te=sdkUrl, Q=Jqy deferredToolUse, U=SLm() pendingInitialUserMessage.
  // --resume/--continue only pick the error string (X||c.continue).
  const isUsingSdkUrl = Boolean(options.sdkUrl)
  const hasDeferredToolUse = Boolean(deferredToolUse)
  const hasResumeOrContinue =
    (typeof options.resume === 'string' && options.resume.trim().length > 0) ||
    Boolean(options.continue)
  if (
    typeof inputPrompt === 'string' &&
    inputPrompt.trim() === '' &&
    !isUsingSdkUrl &&
    !hasDeferredToolUse &&
    !hookInitialUserMessage
  ) {
    process.stderr.write(
      inputPrompt !== ''
        ? `Error: Input contained only whitespace. Provide a prompt with text through stdin or as a prompt argument when using --print\n`
        : hasResumeOrContinue
          ? `Error: No deferred tool marker found in the resumed session. Either the session was not deferred, the marker is stale (tool already ran), or it exceeds the tail-scan window. Provide a prompt to continue the conversation.\n`
          : `Error: Input must be provided either through stdin or as a prompt argument when using --print\n`,
    )
    gracefulShutdownSync(1)
    return
  }

  if (options.outputFormat === 'stream-json' && !options.verbose) {
    process.stderr.write(
      'Error: When using --print, --output-format=stream-json requires --verbose\n',
    )
    gracefulShutdownSync(1)
    return
  }

  // Filter out MCP tools that are in the deny list
  const allowedMcpTools = filterToolsByDenyRules(
    appState.mcp.tools,
    appState.toolPermissionContext,
  )
  let filteredTools = [...tools, ...allowedMcpTools]

  // When using SDK URL, always use stdio permission prompting to delegate to the SDK
  const effectivePermissionPromptToolName = options.sdkUrl
    ? 'stdio'
    : options.permissionPromptToolName

  // Callback for when a permission prompt is shown
  const onPermissionPrompt = (details: RequiresActionDetails) => {
    notifySessionStateChanged('requires_action', details)
  }

  const canUseTool = getCanUseToolFn(
    effectivePermissionPromptToolName,
    structuredIO,
    () => getAppState().mcp.tools,
    onPermissionPrompt,
  )
  if (options.permissionPromptToolName) {
    // Remove the permission prompt tool from the list of available tools.
    filteredTools = filteredTools.filter(
      tool => !toolMatchesName(tool, options.permissionPromptToolName!),
    )
  }

  // densable k.current=s after filteredTools final (W4g classify uses live tool pool)
  void import('../utils/sandbox/sandboxNetworkHeadlessRefs.js').then(m => {
    m.setSandboxNetworkHeadlessTools(filteredTools)
  })

  // Official 2.1.328 #639 (`task_list_restore_on_runner`): when a self-hosted
  // runner session resumes in a new Claude config directory, restore its task
  // list from the resumed transcript before the first turn.
  if (
    (hasResumeOrContinue || initialMessages.length > 0) &&
    !options.forkSession
  ) {
    try {
      await restoreTaskListOnSelfHostedRunnerResume({
        sessionId: getSessionId(),
        messages: initialMessages,
      })
    } catch (err) {
      logForDebugging(
        `[print.ts] restoreTaskListOnSelfHostedRunnerResume failed: ${errorMessage(err)}`,
      )
    }
  }

  // Official 2.1.325 #1717: on headless `--resume` / `--continue`, read
  // persisted SEP-2663 MCP task sidecar metadata and re-attach pollers via
  // `restoreSep2663Tasks(...)`.
  if (
    hasResumeOrContinue &&
    !options.forkSession &&
    !isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_MCP_TASKS)
  ) {
    void restoreHeadlessSep2663Tasks({
      sessionId: getSessionId(),
      setAppState,
      getMcpClients: () => getAppState().mcp.clients,
    }).catch(err => {
      logForDebugging(
        `[print.ts] restoreHeadlessSep2663Tasks failed: ${errorMessage(err)}`,
      )
    })
  }

  // Install errors handlers to gracefully handle broken pipes (e.g., when parent process dies)
  registerProcessOutputErrorHandlers()

  headlessProfilerCheckpoint('after_loadInitialMessages')

  // Official EF(pt),AF(pt),DF(pt) after await restoredWorkerState.
  // EF = dialog-kinds in loadInitialMessages; AF here; DF is empty.
  const restoredWorker = await structuredIO.restoredWorkerState
  restoreMemoryToggleFromWorkerState(restoredWorker)
  restoreCostStateFromWorker(restoredWorker)

  // #1771 & #1816 (`ccr_kept_session_rules`): Restore session-scoped deny/ask
  // (and allow only when deny & ask are whole) from worker internal metadata
  // and latch keepsSessionRules before future AppState updates persist rules.
  if (restoredWorker?.internal) {
    const applyRules = restoreCcrSessionRules(
      restoredWorker.internal as Partial<
        import('src/state/onChangeAppState.js').CcrSessionRulesRecord
      >,
    )
    setAppState(prev => {
      const nextCtx = applyRules(prev.toolPermissionContext)
      return nextCtx === prev.toolPermissionContext
        ? prev
        : { ...prev, toolPermissionContext: nextCtx }
    })
  }
  evaluateCcrKeepsSessionRules(
    restoredWorker
      ? {
          internal: restoredWorker.internal as Partial<
            import('src/state/onChangeAppState.js').CcrSessionRulesRecord
          >,
        }
      : null,
    getAppState().toolPermissionContext,
  )

  // Official XWy — enable worker_permission_mode record; skip when this is a
  // restarted worker with no restored CCR metadata.
  try {
    const { resolveWorkerEpoch } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    syncWorkerPermissionModeRecord({
      enable: enableWorkerPermissionModeRecord,
      notifyInternal: notifyInternalMetadataChanged,
      currentMode: getAppState().toolPermissionContext.mode,
      planModeOnResume,
      restored: restoredWorker,
      restartedWorker: isRestartedWorker(resolveWorkerEpoch()),
    })
    // Official 2.1.325 `xRi(Ae.sessionState, r().ultracode, vr)` (#1373).
    const appStateNow = getAppState()
    const mainModelNow = getMainLoopModel()
    settleUltracodeActive(
      isUltracodeModeActive(
        mainModelNow,
        pdSessionEffort(appStateNow, mainModelNow),
        appStateNow.ultracode,
      ),
      restoredWorker,
    )
  } catch {
    // densable optional
  }

  // densable 2.1.289 print.ts — orphaned bg tasks after worker restart:
  // Di(id,"stopped",{summary:`Stopped by a worker restart: …`, reason:"worker_restart"})
  // Gated like densable on RESUME_INTERRUPTED_TURN (env / residual gate).
  {
    let resumeInterruptedTurnForOrphans = Boolean(
      process.env.CLAUDE_CODE_RESUME_INTERRUPTED_TURN,
    )
    try {
      const { isResumeInterruptedTurnEnabled } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
      resumeInterruptedTurnForOrphans = isResumeInterruptedTurnEnabled()
    } catch {
      // keep raw env fallback
    }
    if (resumeInterruptedTurnForOrphans) {
      const internal = restoredWorker?.internal ?? null
      const {
        mergeRestoredWorkerRestartOrphans,
        formatWorkerRestartOrphanReminder,
        emitWorkerRestartOrphanStopped,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/orphanAgentResume.js') as typeof import('../utils/orphanAgentResume.js')
      const orphans = mergeRestoredWorkerRestartOrphans(
        internal?.running_background_tasks,
        internal?.orphaned_background_tasks_pending_notification,
      )
      if (orphans.length > 0) {
        logForDebugging(
          `[print.ts] ${orphans.length} orphaned background task(s) after restart`,
        )
        initialMessages.push(
          createUserMessage({
            content: formatWorkerRestartOrphanReminder(orphans),
            isMeta: true,
          }),
        )
        for (const orphan of orphans) {
          emitWorkerRestartOrphanStopped(orphan.task_id, orphan.description)
        }
        let flushed = false
        try {
          for (const event of drainSdkEvents()) {
            await structuredIO.write(event as StdoutMessage)
          }
          flushed = await Promise.race([
            structuredIO.flushInternalEvents().then(() => true),
            sleep(20_000).then(() => false),
          ])
        } catch (err) {
          logForDebugging(
            `[print.ts] orphaned-task notification flush failed; keeping orphans pending for re-emit: ${errorMessage(err)}`,
          )
        }
        if (!flushed) {
          logForDebugging(
            '[print.ts] orphaned-task notification delivery unconfirmed; keeping orphans pending for re-emit.',
          )
        }
        // densable 2.1.289 CCR internal clear after orphan deliver attempt
        notifyInternalMetadataChanged({
          running_background_tasks: [],
          orphaned_background_tasks_pending_notification: flushed
            ? null
            : orphans,
          finished_background_tasks_pending_notification: null,
        })
      }
    }
  }

  // Official 2.1.325 #2376: when `claude -p` has no cached OAuth account data
  // yet (clean environment), wait for the account data fetch before sending
  // the first API request.
  if (!options.sdkUrl) {
    await waitForCachedAccountDataBeforePrint()
  }

  // Ensure model strings are initialized before generating model options.
  // For Bedrock users, this waits for the profile fetch to get correct region strings.
  await ensureModelStringsInitialized()
  headlessProfilerCheckpoint('after_modelStrings')

  // UDS inbox store registration is deferred until after `run` is defined
  // so we can pass `run` as the onEnqueue callback (see below).

  // Only `json` + `verbose` needs the full array (jsonStringify(messages) below).
  // For stream-json (SDK/CCR) and default text output, only the last message is
  // read for the exit code / final result. Avoid accumulating every message in
  // memory for the entire session.
  const needsFullArray = options.outputFormat === 'json' && options.verbose
  const isTextOutput =
    options.outputFormat !== 'json' && options.outputFormat !== 'stream-json'
  if (isTextOutput) {
    warnOAuthExpiryBeforePrint()
  }
  const textResults = new PrintTextResults({
    maxTurns: options.maxTurns,
    maxBudgetUsd: options.maxBudgetUsd,
  })
  const retryNoticeWriter = new PrintRetryNoticeWriter(options.outputFormat)
  const peerHoldNoticeWriter = new PrintPeerHoldNoticeWriter(
    options.outputFormat,
  )
  const messages: SDKMessage[] = []
  let lastMessage: SDKMessage | undefined
  // Streamlined mode transforms messages when CLAUDE_CODE_STREAMLINED_OUTPUT=true and using stream-json
  // Build flag gates this out of external builds; env var is the runtime opt-in for ant builds.
  // Official STREAMLINED_OUTPUT densable.
  let streamlinedOutput = isEnvTruthy(
    process.env.CLAUDE_CODE_STREAMLINED_OUTPUT,
  )
  try {
    const { isStreamlinedOutputEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
    streamlinedOutput = isStreamlinedOutputEnabled()
  } catch {
    // keep raw env fallback
  }
  const transformToStreamlined =
    feature('STREAMLINED_OUTPUT') &&
    streamlinedOutput &&
    options.outputFormat === 'stream-json'
      ? createStreamlinedTransformer()
      : null

  headlessProfilerCheckpoint('before_runHeadlessStreaming')
  let emittedHeadlessPluginErrors = false
  for await (const message of runHeadlessStreaming(
    structuredIO,
    appState.mcp.clients,
    [...commands, ...appState.mcp.commands],
    filteredTools,
    initialMessages,
    canUseTool,
    sdkMcpConfigs,
    getAppState,
    setAppState,
    agents,
    {
      ...options,
      planModeOnResume,
      deferredToolUse,
      overdueSessionStartHooks,
      codeModeWaitForNextPrompt,
    },
    turnInterruptionState,
    printRequestDialog,
  )) {
    // Official 2.1.326 #149: surface API retry status on stderr during long retries.
    retryNoticeWriter.observe(
      message as {
        type?: string
        subtype?: string
        attempt?: number
        max_retries?: number
        retry_delay_ms?: number
        error_status?: number | null
        error?: string
        no_response?: { waited_ms: number; retry_wait_ms: number }
      },
    )
    // Official 2.1.328 (#659): surface held/dropped cross-session peer message
    // notices on stderr in `-p` text output mode.
    peerHoldNoticeWriter.observe(
      message as {
        type?: string
        subtype?: string
        from?: string
        state?: string
        outcome?: string
        reason?: string
        cause?: string
      },
    )
    // Official 2.1.323 #2038: in `-p` text mode, write plugin load errors
    // (`plugin-not-installed` / `engine-range-unsatisfied`) to stderr once.
    if (
      isTextOutput &&
      !emittedHeadlessPluginErrors &&
      message.type === 'system' &&
      (message as { subtype?: string }).subtype === 'init'
    ) {
      emittedHeadlessPluginErrors = true
      const initPluginErrors = (
        message as {
          plugin_errors?: readonly { type?: string; message?: string }[]
        }
      ).plugin_errors
      const formatted = formatHeadlessPluginErrors(initPluginErrors)
      if (formatted) {
        process.stderr.write(formatted)
      }
    }
    // densable tao — one-shot billed-classifier notice on the drain
    try {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const {
        isThirdPartyServerClassifierRefused,
        takeServerClassifierFallbackAnnouncement,
      } =
        require('../bootstrap/state.js') as typeof import('../bootstrap/state.js')
      const {
        classifierGatewayHostPayload,
        formatAutoModeClassifierBillingNotice,
        sdkHostSupportsClassifierBillingNotice,
        shouldShowAutoModeClassifierBillingNotice,
      } =
        require('../services/api/autoModeServerFallbackNotice.js') as typeof import('../services/api/autoModeServerFallbackNotice.js')
      /* eslint-enable @typescript-eslint/no-require-imports */
      if (
        isThirdPartyServerClassifierRefused() &&
        !sdkHostSupportsClassifierBillingNotice() &&
        shouldShowAutoModeClassifierBillingNotice() &&
        takeServerClassifierFallbackAnnouncement()
      ) {
        const text = formatAutoModeClassifierBillingNotice(
          classifierGatewayHostPayload(),
        )
        // gold `$t(jr,"warning")` analog missing — else branch is stderr
        process.stderr.write(`${text}\n`)
      }
    } catch {
      // notice must never break the drain
    }
    if (transformToStreamlined) {
      // Streamlined mode: transform messages and stream immediately
      const transformed = transformToStreamlined(message)
      if (transformed) {
        await structuredIO.write(transformed)
      }
    } else if (options.outputFormat === 'stream-json' && options.verbose) {
      await structuredIO.write(message)
    }
    // Should not be getting control messages or stream events in non-stream mode.
    // Also filter out streamlined types since they're only produced by the transformer.
    // SDK-only system events are excluded so lastMessage stays at the result
    // (session_state_changed(idle) and any late task_notification drain after
    // result in the finally block). command_lifecycle is Official 2.1 ack
    // frames — not result content (densable oWK non-transcript).
    // Official PD skips these system subtypes and message types so lastMessage
    // stays on the result. thinking_tokens and model_fallback stay eligible.
    if (countsAsHeadlessLastMessage(message)) {
      if (needsFullArray) {
        messages.push(message)
      }
      lastMessage = message
      if (isTextOutput && message.type === 'result') {
        textResults.printAtTurnEnd(message as PrintTextResultMessage)
      }
    }
  }

  switch (options.outputFormat) {
    case 'json':
      if (!lastMessage || lastMessage.type !== 'result') {
        throw new Error('No messages returned')
      }
      if (options.verbose) {
        writeToStdout(jsonStringify(messages) + '\n')
        break
      }
      writeToStdout(jsonStringify(lastMessage) + '\n')
      break
    case 'stream-json':
      // already logged above
      break
    default:
      if (!lastMessage || lastMessage.type !== 'result') {
        throw new Error('No messages returned')
      }
      textResults.printAtExit(lastMessage as PrintTextResultMessage)
  }

  // Log headless latency metrics for the final turn
  logHeadlessProfilerTurn()

  // Drain any in-flight memory extraction before shutdown. The response is
  // already flushed above, so this adds no user-visible latency — it just
  // delays process exit so gracefulShutdownSync's 5s failsafe doesn't kill
  // the forked agent mid-flight. Gated by isExtractModeActive so the
  // tengu_slate_thimble flag controls non-interactive extraction end-to-end.
  if (feature('EXTRACT_MEMORIES') && isExtractModeActive()) {
    try {
      const { drainPendingExtraction } = await import(
        '../services/extractMemories/extractMemories.js'
      )
      await drainPendingExtraction()
    } catch {
      // Module load failure — non-critical at shutdown
    }
  }

  // Official 2.1.328 #644: wait (bounded 30s) for any in-flight headless
  // enabled-plugin record/fetch pass before exiting a short headless session.
  try {
    await waitForHeadlessPluginInstallDrain()
  } catch {
    // Non-critical at shutdown
  }

  let exitCode =
    lastMessage?.type === 'result' &&
    (lastMessage?.is_error || hasAutoModeNoCheckDenial(lastMessage))
      ? 1
      : 0
  const fullDiskResult = await handlePrintFullDiskExit({
    exitCode,
    outputFormat: options.outputFormat,
    sdkUrl: options.sdkUrl,
    writeStreamMessage: async msg => {
      await structuredIO.write(msg as unknown as StdoutMessage)
    },
  })
  exitCode = fullDiskResult.exitCode

  gracefulShutdownSync(exitCode)
}
