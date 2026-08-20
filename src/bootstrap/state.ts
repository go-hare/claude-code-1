import type { BetaMessageStreamParams } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { Attributes, Meter, MetricOptions } from '@opentelemetry/api'
import type { logs } from '@opentelemetry/api-logs'
import type { LoggerProvider } from '@opentelemetry/sdk-logs'
import type { MeterProvider } from '@opentelemetry/sdk-metrics'
import type { BasicTracerProvider } from '@opentelemetry/sdk-trace-base'
import { realpathSync } from 'fs'
import sumBy from 'lodash-es/sumBy.js'
import { cwd } from 'process'
import type { HookEvent, ModelUsage } from 'src/entrypoints/agentSdkTypes.js'
import type { AgentColorName } from '@claude-code/builtin-tools/tools/AgentTool/agentColorManager.js'
import type { HookCallbackMatcher } from 'src/types/hooks.js'
// Indirection for browser-sdk build (package.json "browser" field swaps
// crypto.ts for crypto.browser.ts). Pure leaf re-export of node:crypto —
// zero circular-dep risk. Path-alias import bypasses bootstrap-isolation
// (rule only checks ./ and / prefixes); explicit disable documents intent.
// eslint-disable-next-line custom-rules/bootstrap-isolation
import { randomUUID } from 'src/utils/crypto.js'
import type { ModelSetting } from 'src/utils/model/model.js'
import type { ModelStrings } from 'src/utils/model/modelStrings.js'
import type { SettingSource } from 'src/utils/settings/constants.js'
import { resetSettingsCache } from 'src/utils/settings/settingsCache.js'
import type { PluginHookMatcher } from 'src/utils/settings/types.js'
import { createSignal } from 'src/utils/signal.js'

// Union type for registered hooks - can be SDK callbacks or native plugin hooks
type RegisteredHookMatcher = HookCallbackMatcher | PluginHookMatcher

import type { SessionId } from 'src/types/ids.js'

// DO NOT ADD MORE STATE HERE - BE JUDICIOUS WITH GLOBAL STATE

// dev: true on entries that came via --dangerously-load-development-channels.
// The allowlist gate checks this per-entry (not the session-wide
// hasDevChannels bit) so passing both flags doesn't let the dev dialog's
// acceptance leak allowlist-bypass to the --channels entries.
export type ChannelEntry =
  | { kind: 'plugin'; name: string; marketplace: string; dev?: boolean }
  | { kind: 'server'; name: string; dev?: boolean }

export type AttributedCounter = {
  add(value: number, additionalAttributes?: Attributes): void
}

type State = {
  originalCwd: string
  // Stable project root - set once at startup (including by --worktree flag),
  // never updated by mid-session EnterWorktreeTool.
  // Use for project identity (history, skills, sessions) not file operations.
  projectRoot: string
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  turnHookDurationMs: number
  turnToolDurationMs: number
  turnClassifierDurationMs: number
  turnToolCount: number
  turnHookCount: number
  turnClassifierCount: number
  startTime: number
  lastInteractionTime: number
  totalLinesAdded: number
  totalLinesRemoved: number
  hasUnknownModelCost: boolean
  cwd: string
  modelUsage: { [modelName: string]: ModelUsage }
  mainLoopModelOverride: ModelSetting | undefined
  initialMainLoopModel: ModelSetting
  /**
   * Official resolvedOrgDefault (KVo/wgt) — session-level cache of the org
   * console default model. `undefined` = not yet resolved; `null` = no org
   * default; string = resolved model id/alias.
   */
  resolvedOrgDefault: string | null | undefined
  /**
   * densable 2.1.236 `Txs`/`vxs` — latched ANTHROPIC_DEFAULT_MODEL at startup
   * resolve. `undefined` = not latched (read live env); `null`/string = latched.
   */
  initialEnvDefaultModel: string | null | undefined
  /**
   * Fable overage consent latch for key-less sessions (API-key users).
   * Shared by query() and /model so a /model accept is honored on first
   * request. Cleared on logout / account switch.
   */
  fableSessionFallbackConsented: boolean
  /**
   * Official refusalFallbackOccurred (Ryn/F7e/X8o) — true after a refusal
   * fallback switch in this session. Cleared on session switch / clear.
   */
  refusalFallbackOccurred: boolean
  /**
   * Official refusalFallbackModelLatch (b$t/Y8o/rke/JUa) — remembers the
   * previous model override so session switch can restore it.
   */
  refusalFallbackModelLatch:
    | {
        fallbackModel: string
        previousOverride: ModelSetting | undefined
        previousAppStateModel?: ModelSetting | undefined
        previousModelForSession?: ModelSetting | undefined
      }
    | undefined
  modelStrings: ModelStrings | null
  isInteractive: boolean
  /**
   * densable kt.attacherCaps (uE/tii) — set when a terminal attaches to this
   * bg worker via rendezvous `attacher-caps`; null when detached. Pte() =
   * isBg && !attacherCaps gates interactive MCP/OAuth panels.
   */
  attacherCaps: Record<string, unknown> | null
  /**
   * Official mainLoopBusy (qGo/jGo) — true while the REPL query loop is
   * executing. Blocks bg shell memory-pressure reaping so we don't kill
   * shells mid-turn.
   */
  mainLoopBusy: boolean
  kairosActive: boolean
  // When true, ensureToolResultPairing throws on mismatch instead of
  // repairing with synthetic placeholders. HFI opts in at startup so
  // trajectories fail fast rather than conditioning the model on fake
  // tool_results.
  strictToolResultPairing: boolean
  sdkAgentProgressSummariesEnabled: boolean
  userMsgOptIn: boolean
  /**
   * densable launchOptions.todoToolsOptIn (#h) — forces Todo/Task tools through
   * uX even on model floors that disable them. Set by --tools/--allowedTools
   * including Task* or TodoWrite (densable Tds(rGp.some(...))).
   */
  todoToolsOptIn: boolean
  clientType: string
  sessionSource: string | undefined
  questionPreviewFormat: 'markdown' | 'html' | undefined
  flagSettingsPath: string | undefined
  flagSettingsInline: Record<string, unknown> | null
  /**
   * densable Bt.parentManagedSettings (tNi/rNi) — SDK parent tier /
   * `--managed-settings` JSON. Used by densable 2.1.222 #16 host model
   * overlay (Gfg) when CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST.
   */
  parentManagedSettings: Record<string, unknown> | null
  allowedSettingSources: SettingSource[]
  sessionIngressToken: string | null | undefined
  oauthTokenFromFd: string | null | undefined
  apiKeyFromFd: string | null | undefined
  // Telemetry state
  meter: Meter | null
  sessionCounter: AttributedCounter | null
  locCounter: AttributedCounter | null
  prCounter: AttributedCounter | null
  commitCounter: AttributedCounter | null
  costCounter: AttributedCounter | null
  tokenCounter: AttributedCounter | null
  codeEditToolDecisionCounter: AttributedCounter | null
  activeTimeCounter: AttributedCounter | null
  statsStore: { observe(name: string, value: number): void } | null
  sessionId: SessionId
  /**
   * densable Ot.mainAgentId — sticky main-thread AgentId for queue AL / BRt / Zeo.
   * Latched by mi() on first use to Qc(sessionId); NOT cleared on mJo/ZR.
   */
  mainAgentId: import('src/types/ids.js').AgentId | null
  // Parent session ID for tracking session lineage (e.g., plan mode -> implementation)
  parentSessionId: SessionId | undefined
  // Logger state
  loggerProvider: LoggerProvider | null
  eventLogger: ReturnType<typeof logs.getLogger> | null
  // Meter provider state
  meterProvider: MeterProvider | null
  // Tracer provider state
  tracerProvider: BasicTracerProvider | null
  // Agent color state
  agentColorMap: Map<string, AgentColorName>
  agentColorIndex: number
  /**
   * densable `Ft.foundryDeploymentCapabilities` — Map keyed by
   * `${foundryBaseUrl|resource}::canonicalModel` → Set of unsupported
   * capability names learned from Foundry 400s (`tool_search_server`,
   * `tool_search`, `structured_outputs`, …). Empty map → `$Fe` default-true.
   */
  foundryDeploymentCapabilities: Map<string, Set<string>>
  // Last API request for bug reports
  lastAPIRequest: Omit<BetaMessageStreamParams, 'messages'> | null
  // Messages from the last API request (ant-only; reference, not clone).
  // Captures the exact post-compaction, CLAUDE.md-injected message set sent
  // to the API so /share's serialized_conversation.json reflects reality.
  lastAPIRequestMessages: BetaMessageStreamParams['messages'] | null
  // Last auto-mode classifier request(s) for /share transcript
  lastClassifierRequests: unknown[] | null
  // CLAUDE.md content cached by context.ts for the auto-mode classifier.
  // Breaks the yoloClassifier → claudemd → filesystem → permissions cycle.
  cachedClaudeMdContent: string | null
  // In-memory error log for recent errors
  inMemoryErrorLog: Array<{ error: string; timestamp: string }>
  // Session-only plugins from --plugin-dir flag
  inlinePlugins: Array<string>
  // densable inlinePluginsNoMcp — --plugin-dir-no-mcp (load plugin, skip .mcp.json)
  inlinePluginsNoMcp: Array<string>
  // Explicit --chrome / --no-chrome flag value (undefined = not set on CLI)
  chromeFlagOverride: boolean | undefined
  // Full chrome system prompt active for this session (launch --chrome or /chrome This session On).
  // Mid-session Off clears this so subsequent turns drop chrome automation instructions.
  claudeInChromeSessionPromptActive: boolean
  // Use cowork_plugins directory instead of plugins (--cowork flag or env var)
  useCoworkPlugins: boolean
  // Session-only bypass permissions mode flag (not persisted)
  sessionBypassPermissionsMode: boolean
  // Session-only flag gating the .claude/scheduled_tasks.json watcher
  // (useScheduledTasks). Set by cronScheduler.start() when the JSON has
  // entries, or by CronCreateTool. Not persisted.
  scheduledTasksEnabled: boolean
  // Session-only cron tasks created via CronCreate with durable: false.
  // Fire on schedule like file-backed tasks but are never written to
  // .claude/scheduled_tasks.json — they die with the process. Typed via
  // SessionCronTask below (not importing from cronTasks.ts keeps
  // bootstrap a leaf of the import DAG).
  sessionCronTasks: SessionCronTask[]
  /**
   * densable `Ft.loopChainStartedAt` — per-prompt dynamic /loop chain
   * `{startedAt, lastScheduledFor, agedOut?}` for ScheduleWakeup max-age.
   */
  loopChainStartedAt: Record<
    string,
    { startedAt: number; lastScheduledFor: number; agedOut?: boolean }
  >
  /** densable `Ft.loopEnded` — ScheduleWakeup stop has ended the dynamic loop. */
  loopEnded: boolean
  /** densable `Ft.loopTickInFlightPrompt` — tick currently being delivered. */
  loopTickInFlightPrompt: string | null
  /** densable `Ft.loopConsecutiveKeepalives` — keepalive budget counter. */
  loopConsecutiveKeepalives: number
  // Teams created this session via TeamCreate. cleanupSessionTeams()
  // removes these on gracefulShutdown so subagent-created teams don't
  // persist on disk forever (gh-32730). TeamDelete removes entries to
  // avoid double-cleanup. Lives here (not teamHelpers.ts) so
  // resetStateForTests() clears it between tests.
  sessionCreatedTeams: Set<string>
  // Session-only trust flag for home directory (not persisted to disk)
  // When running from home dir, trust dialog is shown but not saved to disk.
  // This flag allows features requiring trust to work during the session.
  sessionTrustAccepted: boolean
  // Session-only flag to disable session persistence to disk
  sessionPersistenceDisabled: boolean
  // Track if user has exited plan mode in this session (for re-entry guidance)
  hasExitedPlanMode: boolean
  // Track if we need to show the plan mode exit attachment (one-time notification)
  needsPlanModeExitAttachment: boolean
  // Track if we need to show the auto mode exit attachment (one-time notification)
  needsAutoModeExitAttachment: boolean
  // Track if LSP plugin recommendation has been shown this session (only show once)
  lspRecommendationShownThisSession: boolean
  // SDK init event state - jsonSchema for structured output
  initJsonSchema: Record<string, unknown> | null
  // Registered hooks - SDK callbacks and plugin native hooks
  registeredHooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>> | null
  // Cache for plan slugs: sessionId -> wordSlug
  planSlugCache: Map<string, string>
  // Track teleported session for reliability logging
  teleportedSessionInfo: {
    isTeleported: boolean
    hasLoggedFirstMessage: boolean
    sessionId: string | null
  } | null
  /**
   * densable `rg().teleportedSessionIds` — session ids (Dm-normalized) that
   * have been teleported to cloud. Bridge remint/rebuild consults this via G7.
   * Cap 64 (FIFO) matches densable zNn.
   */
  teleportedSessionIds: Set<string>
  // Track invoked skills for preservation across compaction
  // Keys are composite: `${agentId ?? ''}:${skillName}` to prevent cross-agent overwrites
  invokedSkills: Map<
    string,
    {
      skillName: string
      skillPath: string
      content: string
      invokedAt: number
      agentId: string | null
    }
  >
  // Track slow operations for dev bar display (ant-only)
  slowOperations: Array<{
    operation: string
    durationMs: number
    timestamp: number
  }>
  // SDK-provided betas (e.g., context-1m-2025-08-07)
  sdkBetas: string[] | undefined
  /**
   * Official sdkSupportedDialogKinds (Pt) — kinds the SDK host declared it can
   * render for request_user_dialog. undefined = none declared.
   */
  sdkSupportedDialogKinds: string[] | undefined
  /** Official sdkSupportedDialogKindsSource — 'initialize' | 'restored' | … */
  sdkSupportedDialogKindsSource: string | undefined
  /** Official sdkDialogHostActive (Q8o/mht) — print requestDialog host armed. */
  sdkDialogHostActive: boolean
  // Main thread agent type (from --agent flag or settings)
  mainThreadAgentType: string | undefined
  /**
   * densable mainThreadAgentHooks (b1r/fne) — frontmatter hooks from the
   * session --agent definition, gated by origin trust (QEt/mvo).
   */
  mainThreadAgentHooks:
    | import('../utils/settings/types.js').HooksSettings
    | undefined
  // Remote mode (--remote flag)
  isRemoteMode: boolean
  /**
   * densable FC / eDe — true while REPL Remote Control bridge is connected
   * (or init succeeded and not yet torn down). Gates JT/enqueueSdkEvent so
   * interactive sessions still queue task_progress for mid-join RC clients.
   */
  replBridgeActive: boolean
  /**
   * densable env-less bridge session id (`cse_*`). Written when RC connects so
   * teleport zNn can mark the same id G7 remint checks (not only local UUID).
   */
  replBridgeSessionId: string | undefined
  /**
   * densable stickyBetas (GRe) — session sticky sent/rejected beta headers.
   * mid-conv o3 reject → rejected set (DV) until /clear.
   */
  stickyBetas: { sent: Set<string>; rejected: Set<string> }
  /**
   * densable midConvCachePromotionRejected (Gri/Vri) — proxy rejected
   * cache_control on api_system tail; demote breakpoint for this conversation.
   */
  midConvCachePromotionRejected: boolean
  // Direct connect server URL (for display in header)
  directConnectServerUrl: string | undefined
  // System prompt section cache state
  systemPromptSectionCache: Map<string, string | null>
  // Last date emitted to the model (for detecting midnight date changes)
  lastEmittedDate: string | null
  // Additional directories from --add-dir flag (for CLAUDE.md loading)
  additionalDirectoriesForClaudeMd: string[]
  // Channel server allowlist from --channels flag (servers whose channel
  // notifications should register this session). Parsed once in main.tsx —
  // the tag decides trust model: 'plugin' → marketplace verification +
  // allowlist, 'server' → allowlist always fails (schema is plugin-only).
  // Either kind needs entry.dev to bypass allowlist.
  allowedChannels: ChannelEntry[]
  // True if any entry in allowedChannels came from
  // --dangerously-load-development-channels (so ChannelsNotice can name the
  // right flag in policy-blocked messages)
  hasDevChannels: boolean
  // Dir containing the session's `.jsonl`; null = derive from originalCwd.
  sessionProjectDir: string | null
  // Cached prompt cache 1h TTL allowlist from GrowthBook (session-stable)
  promptCache1hAllowlist: string[] | null
  // Cached 1h TTL user eligibility (session-stable). Latched on first
  // evaluation so mid-session overage flips don't change the cache_control
  // TTL, which would bust the server-side prompt cache.
  promptCache1hEligible: boolean | null
  // Sticky-on latch for AFK_MODE_BETA_HEADER. Once auto mode is first
  // activated, keep sending the header for the rest of the session so
  // Shift+Tab toggles don't bust the ~50-70K token prompt cache.
  afkModeHeaderLatched: boolean | null
  // Sticky-on latch for FAST_MODE_BETA_HEADER. Once fast mode is first
  // enabled, keep sending the header so cooldown enter/exit doesn't
  // double-bust the prompt cache. The `speed` body param stays dynamic.
  fastModeHeaderLatched: boolean | null
  // Sticky-on latch for the cache-editing beta header. Once cached
  // microcompact is first enabled, keep sending the header so mid-session
  // GrowthBook/settings toggles don't bust the prompt cache.
  cacheEditingHeaderLatched: boolean | null
  // Current prompt ID (UUID) correlating a user prompt with subsequent OTel events
  promptId: string | null
  // Last API requestId for the main conversation chain (not subagents).
  // Updated after each successful API response for main-session queries.
  // Read at shutdown to send cache eviction hints to inference.
  lastMainRequestId: string | undefined
  // Timestamp (Date.now()) of the last successful API call completion.
  // Used to compute timeSinceLastApiCallMs in tengu_api_success for
  // correlating cache misses with idle time (cache TTL is ~5min).
  lastApiCompletionTimestamp: number | null
  // Set to true after compaction (auto or manual /compact). Consumed by
  // logAPISuccess to tag the first post-compaction API call so we can
  // distinguish compaction-induced cache misses from TTL expiry.
  pendingPostCompaction: boolean
  /**
   * densable Lt.pendingPrLinks / eNn — in-flight PR-link promises flushed
   * on process/session teardown (2.1.218 #16) so immediate exit does not
   * drop pr-link transcript metadata.
   */
  pendingPrLinks: Set<Promise<unknown>>
  /**
   * densable Lt.pendingBranchLinks / Lzr — branches pushed before a PR exists
   * (2.1.222 #7). Later gh/git/curl success retries `gh pr view` up to 5 times
   * so sessions still link when the PR is created after push (incl. REST).
   */
  pendingBranchLinks: Map<
    string,
    { cwd: string; branch: string; attempts: number }
  >
}

// ALSO HERE - THINK THRICE BEFORE MODIFYING
function getInitialState(): State {
  // Resolve symlinks in cwd to match behavior of shell.ts setCwd
  // This ensures consistency with how paths are sanitized for session storage
  let resolvedCwd = ''
  if (
    typeof process !== 'undefined' &&
    typeof process.cwd === 'function' &&
    typeof realpathSync === 'function'
  ) {
    const rawCwd = cwd()
    try {
      resolvedCwd = realpathSync(rawCwd).normalize('NFC')
    } catch {
      // File Provider EPERM on CloudStorage mounts (lstat per path component).
      resolvedCwd = rawCwd.normalize('NFC')
    }
  }
  const state: State = {
    originalCwd: resolvedCwd,
    projectRoot: resolvedCwd,
    totalCostUSD: 0,
    totalAPIDuration: 0,
    totalAPIDurationWithoutRetries: 0,
    totalToolDuration: 0,
    turnHookDurationMs: 0,
    turnToolDurationMs: 0,
    turnClassifierDurationMs: 0,
    turnToolCount: 0,
    turnHookCount: 0,
    turnClassifierCount: 0,
    startTime: Date.now(),
    lastInteractionTime: Date.now(),
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    hasUnknownModelCost: false,
    cwd: resolvedCwd,
    modelUsage: {},
    mainLoopModelOverride: undefined,
    initialMainLoopModel: null,
    resolvedOrgDefault: undefined,
    initialEnvDefaultModel: undefined,
    fableSessionFallbackConsented: false,
    refusalFallbackOccurred: false,
    refusalFallbackModelLatch: undefined,
    modelStrings: null,
    isInteractive: false,
    attacherCaps: null,
    mainLoopBusy: false,
    kairosActive: false,
    strictToolResultPairing: false,
    sdkAgentProgressSummariesEnabled: false,
    userMsgOptIn: false,
    todoToolsOptIn: false,
    clientType: 'cli',
    sessionSource: undefined,
    questionPreviewFormat: undefined,
    sessionIngressToken: undefined,
    oauthTokenFromFd: undefined,
    apiKeyFromFd: undefined,
    flagSettingsPath: undefined,
    flagSettingsInline: null,
    parentManagedSettings: null,
    allowedSettingSources: [
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ],
    // Telemetry state
    meter: null,
    sessionCounter: null,
    locCounter: null,
    prCounter: null,
    commitCounter: null,
    costCounter: null,
    tokenCounter: null,
    codeEditToolDecisionCounter: null,
    activeTimeCounter: null,
    statsStore: null,
    sessionId: randomUUID() as SessionId,
    mainAgentId: null,
    parentSessionId: undefined,
    // Logger state
    loggerProvider: null,
    eventLogger: null,
    // Meter provider state
    meterProvider: null,
    tracerProvider: null,
    // Agent color state
    agentColorMap: new Map(),
    agentColorIndex: 0,
    // densable Ft.foundryDeploymentCapabilities
    foundryDeploymentCapabilities: new Map(),
    // Last API request for bug reports
    lastAPIRequest: null,
    lastAPIRequestMessages: null,
    // Last auto-mode classifier request(s) for /share transcript
    lastClassifierRequests: null,
    cachedClaudeMdContent: null,
    // In-memory error log for recent errors
    inMemoryErrorLog: [],
    // Session-only plugins from --plugin-dir flag
    inlinePlugins: [],
    // densable --plugin-dir-no-mcp
    inlinePluginsNoMcp: [],
    // Explicit --chrome / --no-chrome flag value (undefined = not set on CLI)
    chromeFlagOverride: undefined,
    claudeInChromeSessionPromptActive: false,
    // Use cowork_plugins directory instead of plugins
    useCoworkPlugins: false,
    // Session-only bypass permissions mode flag (not persisted)
    sessionBypassPermissionsMode: false,
    // Scheduled tasks disabled until flag or dialog enables them
    scheduledTasksEnabled: false,
    sessionCronTasks: [],
    // densable loop/ScheduleWakeup session fields
    loopChainStartedAt: {},
    loopEnded: false,
    loopTickInFlightPrompt: null,
    loopConsecutiveKeepalives: 0,
    sessionCreatedTeams: new Set(),
    // Session-only trust flag (not persisted to disk)
    sessionTrustAccepted: false,
    // Session-only flag to disable session persistence to disk
    sessionPersistenceDisabled: false,
    // Track if user has exited plan mode in this session
    hasExitedPlanMode: false,
    // Track if we need to show the plan mode exit attachment
    needsPlanModeExitAttachment: false,
    // Track if we need to show the auto mode exit attachment
    needsAutoModeExitAttachment: false,
    // Track if LSP plugin recommendation has been shown this session
    lspRecommendationShownThisSession: false,
    // SDK init event state
    initJsonSchema: null,
    registeredHooks: null,
    // Cache for plan slugs
    planSlugCache: new Map(),
    // Track teleported session for reliability logging
    teleportedSessionInfo: null,
    teleportedSessionIds: new Set(),
    // Track invoked skills for preservation across compaction
    invokedSkills: new Map(),
    // Track slow operations for dev bar display
    slowOperations: [],
    // SDK-provided betas
    sdkBetas: undefined,
    sdkSupportedDialogKinds: undefined,
    sdkSupportedDialogKindsSource: undefined,
    sdkDialogHostActive: false,
    // Main thread agent type
    mainThreadAgentType: undefined,
    // densable mainThreadAgentHooks
    mainThreadAgentHooks: undefined,
    // Remote mode
    isRemoteMode: false,
    // densable FC — REPL Remote Control bridge live flag
    replBridgeActive: false,
    replBridgeSessionId: undefined,
    stickyBetas: { sent: new Set(), rejected: new Set() },
    midConvCachePromotionRejected: false,
    // Direct connect server URL
    directConnectServerUrl: undefined,
    // System prompt section cache state
    systemPromptSectionCache: new Map(),
    // Last date emitted to the model
    lastEmittedDate: null,
    // Additional directories from --add-dir flag (for CLAUDE.md loading)
    additionalDirectoriesForClaudeMd: [],
    // Channel server allowlist from --channels flag
    allowedChannels: [],
    hasDevChannels: false,
    // Session project dir (null = derive from originalCwd)
    sessionProjectDir: null,
    // Prompt cache 1h allowlist (null = not yet fetched from GrowthBook)
    promptCache1hAllowlist: null,
    // Prompt cache 1h eligibility (null = not yet evaluated)
    promptCache1hEligible: null,
    // Beta header latches (null = not yet triggered)
    afkModeHeaderLatched: null,
    fastModeHeaderLatched: null,
    cacheEditingHeaderLatched: null,
    // Current prompt ID
    promptId: null,
    lastMainRequestId: undefined,
    lastApiCompletionTimestamp: null,
    pendingPostCompaction: false,
    // densable eNn — PR-link promise set flushed on teardown (2.1.218 #16)
    pendingPrLinks: new Set<Promise<unknown>>(),
    // densable Lzr — post-push PR discovery retries (2.1.222 #7)
    pendingBranchLinks: new Map(),
  }

  return state
}

// AND ESPECIALLY HERE
const STATE: State = getInitialState()

export function getSessionId(): SessionId {
  return STATE.sessionId
}

/**
 * densable eNn() — process-global Set of in-flight PR-link promises.
 */
export function getPendingPrLinks(): Set<Promise<unknown>> {
  return STATE.pendingPrLinks
}

/**
 * densable Lzr() — process-global Map of branches awaiting PR discovery after push.
 */
export function getPendingBranchLinks(): Map<
  string,
  { cwd: string; branch: string; attempts: number }
> {
  return STATE.pendingBranchLinks
}

/**
 * densable `mi()` — main-thread AgentId for queue AL / BRt / Zeo (2.1.211).
 *
 * Gold:
 * ```
 * function mi(){
 *   let e = VO()?.sessionId;
 *   if (e) return Qc(e);
 *   return Ot.mainAgentId ??= Qc(Ot.sessionId), Ot.mainAgentId
 * }
 * ```
 * VO is an optional process overlay (default `() => {}` → no sessionId); CLI
 * path latches sticky `Ot.mainAgentId` on first call and never clears it on
 * mJo(/clear) or ZR(/resume). Queue IT/cf do not auto-stamp or rewrite agentId
 * on session rebind — callers that omit agentId leave AL miss (official).
 * Call sites that need live session as string still use getSessionId().
 */
export function getMainThreadAgentId(): import('src/types/ids.js').AgentId {
  // Inline brand — bootstrap is a DAG leaf; avoid importing asAgentId here.
  if (STATE.mainAgentId === null) {
    STATE.mainAgentId =
      STATE.sessionId as unknown as import('src/types/ids.js').AgentId
  }
  return STATE.mainAgentId
}

/**
 * densable `AL(cmd)`: main-thread queue entry is `cmd.agentId === mi()`.
 * Not dual-OR with undefined — callers must stamp mi() for main (enqueue does
 * not auto-stamp in densable; local withMainThreadAgentId is a local fortify).
 */
export function isMainThreadQueuedCommand(cmd: {
  agentId?: string | null
}): boolean {
  return cmd.agentId === getMainThreadAgentId()
}

export function regenerateSessionId(
  options: { setCurrentAsParent?: boolean } = {},
): SessionId {
  if (options.setCurrentAsParent) {
    STATE.parentSessionId = STATE.sessionId
  }
  // Drop the outgoing session's plan-slug entry so the Map doesn't
  // accumulate stale keys. Callers that need to carry the slug across
  // (REPL.tsx clearContext) read it before calling clearConversation.
  STATE.planSlugCache.delete(STATE.sessionId)
  // Official X8o + JUa densable on session clear/regenerate.
  STATE.refusalFallbackOccurred = false
  // Fable key-less consent is conversation-session scoped (/clear starts fresh).
  STATE.fableSessionFallbackConsented = false
  const latchReset = consumeRefusalFallbackModelLatch()
  // Regenerated sessions live in the current project: reset projectDir to
  // null so getTranscriptPath() derives from originalCwd.
  STATE.sessionId = randomUUID() as SessionId
  STATE.sessionProjectDir = null
  // Official BMg densable — pure rebind plan available via latchReset for
  // callers with setAppState; override already restored by consume above.
  if (latchReset) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { planRefusalFallbackAppStateRebind } =
        require('../utils/refusalFallback.js') as typeof import('../utils/refusalFallback.js')
      // Override already restored; emit plan for optional AppState hosts.
      void planRefusalFallbackAppStateRebind({
        appStateModel: latchReset.appStateModel,
        forSessionValue: latchReset.forSessionValue,
        overrideValue: latchReset.overrideValue,
      })
    } catch {
      // densable optional
    }
  }
  return STATE.sessionId
}

export function getParentSessionId(): SessionId | undefined {
  return STATE.parentSessionId
}

/**
 * Atomically switch the active session. `sessionId` and `sessionProjectDir`
 * always change together — there is no separate setter for either, so they
 * cannot drift out of sync (CC-34).
 *
 * @param projectDir — directory containing `<sessionId>.jsonl`. Omit (or
 *   pass `null`) for sessions in the current project — the path will derive
 *   from originalCwd at read time. Pass `dirname(transcriptPath)` when the
 *   session lives in a different project directory (git worktrees,
 *   cross-project resume). Every call resets the project dir; it never
 *   carries over from the previous session.
 */
export function switchSession(
  sessionId: SessionId,
  projectDir: string | null = null,
): void {
  // Drop the outgoing session's plan-slug entry so the Map stays bounded
  // across repeated /resume. Only the current session's slug is ever read
  // (plans.ts getPlanSlug defaults to getSessionId()).
  STATE.planSlugCache.delete(STATE.sessionId)
  // Official: when session id changes, clear refusalFallbackOccurred and
  // consume latch (JUa restores previous override if still on fallback).
  // Fable key-less consent is also conversation-session scoped (/resume).
  if (STATE.sessionId !== sessionId) {
    STATE.refusalFallbackOccurred = false
    STATE.fableSessionFallbackConsented = false
    void consumeRefusalFallbackModelLatch()
    STATE.parentSessionId = undefined
  }
  STATE.sessionId = sessionId
  STATE.sessionProjectDir = projectDir
  sessionSwitched.emit(sessionId)
}

const sessionSwitched = createSignal<[id: SessionId]>()

/**
 * Register a callback that fires when switchSession changes the active
 * sessionId. bootstrap can't import listeners directly (DAG leaf), so
 * callers register themselves. concurrentSessions.ts uses this to keep the
 * PID file's sessionId in sync with --resume.
 */
export const onSessionSwitch = sessionSwitched.subscribe

/**
 * Project directory the current session's transcript lives in, or `null` if
 * the session was created in the current project (common case — derive from
 * originalCwd). See `switchSession()`.
 */
export function getSessionProjectDir(): string | null {
  return STATE.sessionProjectDir
}

export function getOriginalCwd(): string {
  return STATE.originalCwd
}

/**
 * Get the stable project root directory.
 * Unlike getOriginalCwd(), this is never updated by mid-session EnterWorktreeTool
 * (so skills/history stay stable when entering a throwaway worktree).
 * It IS set at startup by --worktree, since that worktree is the session's project.
 * Use for project identity (history, skills, sessions) not file operations.
 */
export function getProjectRoot(): string {
  return STATE.projectRoot
}

export function setOriginalCwd(cwd: string): void {
  STATE.originalCwd = cwd.normalize('NFC')
}

/**
 * Only for --worktree startup flag. Mid-session EnterWorktreeTool must NOT
 * call this — skills/history should stay anchored to where the session started.
 */
export function setProjectRoot(cwd: string): void {
  STATE.projectRoot = cwd.normalize('NFC')
}

export function getCwdState(): string {
  return STATE.cwd
}

export function setCwdState(cwd: string): void {
  STATE.cwd = cwd.normalize('NFC')
}

export function getDirectConnectServerUrl(): string | undefined {
  return STATE.directConnectServerUrl
}

export function setDirectConnectServerUrl(url: string): void {
  STATE.directConnectServerUrl = url
}

export function addToTotalDurationState(
  duration: number,
  durationWithoutRetries: number,
): void {
  STATE.totalAPIDuration += duration
  STATE.totalAPIDurationWithoutRetries += durationWithoutRetries
}

export function resetTotalDurationStateAndCost_FOR_TESTS_ONLY(): void {
  STATE.totalAPIDuration = 0
  STATE.totalAPIDurationWithoutRetries = 0
  STATE.totalCostUSD = 0
}

export function addToTotalCostState(
  cost: number,
  modelUsage: ModelUsage,
  model: string,
): void {
  STATE.modelUsage[model] = modelUsage
  STATE.totalCostUSD += cost
}

export function getTotalCostUSD(): number {
  return STATE.totalCostUSD
}

export function getTotalAPIDuration(): number {
  return STATE.totalAPIDuration
}

export function getTotalDuration(): number {
  return Date.now() - STATE.startTime
}

export function getTotalAPIDurationWithoutRetries(): number {
  return STATE.totalAPIDurationWithoutRetries
}

export function getTotalToolDuration(): number {
  return STATE.totalToolDuration
}

export function addToToolDuration(duration: number): void {
  STATE.totalToolDuration += duration
  STATE.turnToolDurationMs += duration
  STATE.turnToolCount++
}

export function getTurnHookDurationMs(): number {
  return STATE.turnHookDurationMs
}

export function addToTurnHookDuration(duration: number): void {
  STATE.turnHookDurationMs += duration
  STATE.turnHookCount++
}

export function resetTurnHookDuration(): void {
  STATE.turnHookDurationMs = 0
  STATE.turnHookCount = 0
}

export function getTurnHookCount(): number {
  return STATE.turnHookCount
}

export function getTurnToolDurationMs(): number {
  return STATE.turnToolDurationMs
}

export function resetTurnToolDuration(): void {
  STATE.turnToolDurationMs = 0
  STATE.turnToolCount = 0
}

export function getTurnToolCount(): number {
  return STATE.turnToolCount
}

export function getTurnClassifierDurationMs(): number {
  return STATE.turnClassifierDurationMs
}

export function addToTurnClassifierDuration(duration: number): void {
  STATE.turnClassifierDurationMs += duration
  STATE.turnClassifierCount++
}

export function resetTurnClassifierDuration(): void {
  STATE.turnClassifierDurationMs = 0
  STATE.turnClassifierCount = 0
}

export function getTurnClassifierCount(): number {
  return STATE.turnClassifierCount
}

export function getStatsStore(): {
  observe(name: string, value: number): void
} | null {
  return STATE.statsStore
}

export function setStatsStore(
  store: { observe(name: string, value: number): void } | null,
): void {
  STATE.statsStore = store
}

/**
 * Marks that an interaction occurred.
 *
 * By default the actual Date.now() call is deferred until the next Ink render
 * frame (via flushInteractionTime()) so we avoid calling Date.now() on every
 * single keypress.
 *
 * Pass `immediate = true` when calling from React useEffect callbacks or
 * other code that runs *after* the Ink render cycle has already flushed.
 * Without it the timestamp stays stale until the next render, which may never
 * come if the user is idle (e.g. permission dialog waiting for input).
 */
let interactionTimeDirty = false

export function updateLastInteractionTime(immediate?: boolean): void {
  if (immediate) {
    flushInteractionTime_inner()
  } else {
    interactionTimeDirty = true
  }
}

/**
 * If an interaction was recorded since the last flush, update the timestamp
 * now. Called by Ink before each render cycle so we batch many keypresses into
 * a single Date.now() call.
 */
export function flushInteractionTime(): void {
  if (interactionTimeDirty) {
    flushInteractionTime_inner()
  }
}

function flushInteractionTime_inner(): void {
  STATE.lastInteractionTime = Date.now()
  interactionTimeDirty = false
  // densable toi.emit — notify onInteraction subscribers (Dkr = toi.subscribe)
  interactionSignal.emit()
}

/**
 * densable Dkr = toi.subscribe. Fires when user interaction is flushed
 * (keypress/click → updateLastInteractionTime → flush).
 * useReplBridge uses this as the A.current latch for ready-push suppression.
 */
const interactionSignal = createSignal()
export const onInteraction = interactionSignal.subscribe

export function addToTotalLinesChanged(added: number, removed: number): void {
  STATE.totalLinesAdded += added
  STATE.totalLinesRemoved += removed
}

export function getTotalLinesAdded(): number {
  return STATE.totalLinesAdded
}

export function getTotalLinesRemoved(): number {
  return STATE.totalLinesRemoved
}

export function getTotalInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'inputTokens')
}

export function getTotalOutputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'outputTokens')
}

export function getTotalCacheReadInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'cacheReadInputTokens')
}

export function getTotalCacheCreationInputTokens(): number {
  return sumBy(Object.values(STATE.modelUsage), 'cacheCreationInputTokens')
}

export function getTotalWebSearchRequests(): number {
  return sumBy(Object.values(STATE.modelUsage), 'webSearchRequests')
}

let outputTokensAtTurnStart = 0
let currentTurnTokenBudget: number | null = null
export function getTurnOutputTokens(): number {
  return getTotalOutputTokens() - outputTokensAtTurnStart
}
export function getCurrentTurnTokenBudget(): number | null {
  return currentTurnTokenBudget
}
let budgetContinuationCount = 0
export function snapshotOutputTokensForTurn(budget: number | null): void {
  outputTokensAtTurnStart = getTotalOutputTokens()
  currentTurnTokenBudget = budget
  budgetContinuationCount = 0
}
export function getBudgetContinuationCount(): number {
  return budgetContinuationCount
}
export function incrementBudgetContinuationCount(): void {
  budgetContinuationCount++
}

export function setHasUnknownModelCost(): void {
  STATE.hasUnknownModelCost = true
}

export function hasUnknownModelCost(): boolean {
  return STATE.hasUnknownModelCost
}

export function getLastMainRequestId(): string | undefined {
  return STATE.lastMainRequestId
}

export function setLastMainRequestId(requestId: string): void {
  STATE.lastMainRequestId = requestId
}

export function getLastApiCompletionTimestamp(): number | null {
  return STATE.lastApiCompletionTimestamp
}

export function setLastApiCompletionTimestamp(timestamp: number): void {
  STATE.lastApiCompletionTimestamp = timestamp
}

/** Mark that a compaction just occurred. The next API success event will
 *  include isPostCompaction=true, then the flag auto-resets. */
export function markPostCompaction(): void {
  STATE.pendingPostCompaction = true
}

/** Consume the post-compaction flag. Returns true once after compaction,
 *  then returns false until the next compaction. */
export function consumePostCompaction(): boolean {
  const was = STATE.pendingPostCompaction
  STATE.pendingPostCompaction = false
  return was
}

export function getLastInteractionTime(): number {
  return STATE.lastInteractionTime
}

/** Official qGo — main query loop is mid-turn. */
export function getMainLoopBusy(): boolean {
  return STATE.mainLoopBusy ?? false
}

/** Official jGo — set while REPL onQuery owns the queryGuard. */
export function setMainLoopBusy(value: boolean): void {
  if (STATE.mainLoopBusy === value) return
  STATE.mainLoopBusy = value
}

// Scroll drain suspension — background intervals check this before doing work
// so they don't compete with scroll frames for the event loop. Set by
// ScrollBox scrollBy/scrollTo, cleared SCROLL_DRAIN_IDLE_MS after the last
// scroll event. Module-scope (not in STATE) — ephemeral hot-path flag, no
// test-reset needed since the debounce timer self-clears.
let scrollDraining = false
let scrollDrainTimer: ReturnType<typeof setTimeout> | undefined
const SCROLL_DRAIN_IDLE_MS = 150

/** True while scroll is actively draining (within 150ms of last event).
 *  Intervals should early-return when this is set — the work picks up next
 *  tick after scroll settles. */
export function getIsScrollDraining(): boolean {
  return scrollDraining
}

/** Await this before expensive one-shot work (network, subprocess) that could
 *  coincide with scroll. Resolves immediately if not scrolling; otherwise
 *  polls at the idle interval until the flag clears. */
export async function waitForScrollIdle(): Promise<void> {
  while (scrollDraining) {
    // bootstrap-isolation forbids importing sleep() from src/utils/
    // eslint-disable-next-line no-restricted-syntax
    await new Promise(r => setTimeout(r, SCROLL_DRAIN_IDLE_MS).unref?.())
  }
}

export function getModelUsage(): { [modelName: string]: ModelUsage } {
  return STATE.modelUsage
}

export function getUsageForModel(model: string): ModelUsage | undefined {
  return STATE.modelUsage[model]
}

/**
 * Gets the model override set from the --model CLI flag or after the user
 * updates their configured model.
 */
export function getMainLoopModelOverride(): ModelSetting | undefined {
  return STATE.mainLoopModelOverride
}

export function getInitialMainLoopModel(): ModelSetting {
  return STATE.initialMainLoopModel
}

export function setMainLoopModelOverride(
  model: ModelSetting | undefined,
): void {
  STATE.mainLoopModelOverride = model
}

export function setInitialMainLoopModel(model: ModelSetting): void {
  STATE.initialMainLoopModel = model
}

/** Official KVo — session-resolved org default model. */
export function getResolvedOrgDefault(): string | null | undefined {
  return STATE.resolvedOrgDefault
}

/** Official wgt — set session-resolved org default model. */
export function setResolvedOrgDefault(model: string | null | undefined): void {
  STATE.resolvedOrgDefault = model
}

/** densable `vxs` — latched ANTHROPIC_DEFAULT_MODEL (undefined = read live env). */
export function getInitialEnvDefaultModel(): string | null | undefined {
  return STATE.initialEnvDefaultModel
}

/** densable `Txs` — latch ANTHROPIC_DEFAULT_MODEL at startup resolve. */
export function setInitialEnvDefaultModel(
  model: string | null | undefined,
): void {
  STATE.initialEnvDefaultModel = model
}

/** Session latch for Fable consent when no org/account consent key exists. */
export function getFableSessionFallbackConsented(): boolean {
  return STATE.fableSessionFallbackConsented
}

export function setFableSessionFallbackConsented(value: boolean): void {
  STATE.fableSessionFallbackConsented = value
}

/** Official Ryn — mark that a refusal fallback switch occurred. */
export function markRefusalFallbackOccurred(): void {
  STATE.refusalFallbackOccurred = true
}

/** Official F7e — whether a refusal fallback switch occurred this session. */
export function hasRefusalFallbackOccurred(): boolean {
  return STATE.refusalFallbackOccurred
}

/** Official X8o — clear refusalFallbackOccurred. */
export function clearRefusalFallbackOccurred(): void {
  STATE.refusalFallbackOccurred = false
}

export type RefusalFallbackModelLatch = {
  fallbackModel: string
  previousOverride: ModelSetting | undefined
  previousAppStateModel?: ModelSetting | undefined
  previousModelForSession?: ModelSetting | undefined
}

/**
 * Official b$t — set/update the refusal fallback model latch.
 * When already latched to the current override, only update fallbackModel.
 */
export function setRefusalFallbackModelLatch(
  latch: RefusalFallbackModelLatch,
): void {
  const cur = STATE.refusalFallbackModelLatch
  if (cur && STATE.mainLoopModelOverride === cur.fallbackModel) {
    STATE.refusalFallbackModelLatch = {
      ...cur,
      fallbackModel: latch.fallbackModel,
    }
    return
  }
  STATE.refusalFallbackModelLatch = latch
}

/** Official rke — clear latch without restoring override. */
export function clearRefusalFallbackModelLatch(): void {
  STATE.refusalFallbackModelLatch = undefined
}

/** Official Y8o — read latch. */
export function getRefusalFallbackModelLatch():
  | RefusalFallbackModelLatch
  | undefined {
  return STATE.refusalFallbackModelLatch
}

/**
 * Official J8o — if latched, update previousOverride (user changed model
 * while latched).
 */
export function updateRefusalFallbackLatchPreviousOverride(
  previousOverride: ModelSetting | undefined,
): void {
  if (!STATE.refusalFallbackModelLatch) return
  STATE.refusalFallbackModelLatch = {
    ...STATE.refusalFallbackModelLatch,
    previousOverride,
  }
}

export type RefusalFallbackLatchResetResult = {
  appStateModel: ModelSetting | undefined
  forSessionValue: ModelSetting | undefined
  overrideValue: ModelSetting | undefined
  restoredToExplicitOverride: boolean
  fallbackModel: string
}

/**
 * Official JUa densable — clear latch and restore mainLoopModelOverride when
 * it still equals the latched fallback model. Returns restore payload for
 * AppState rebinding (BMg denser consumer).
 */
export function consumeRefusalFallbackModelLatch():
  | RefusalFallbackLatchResetResult
  | undefined {
  const latch = STATE.refusalFallbackModelLatch
  STATE.refusalFallbackModelLatch = undefined
  if (!latch || STATE.mainLoopModelOverride !== latch.fallbackModel) {
    return undefined
  }
  STATE.mainLoopModelOverride = latch.previousOverride
  return {
    appStateModel: latch.previousAppStateModel,
    forSessionValue: latch.previousModelForSession,
    overrideValue: latch.previousOverride,
    restoredToExplicitOverride: latch.previousOverride !== undefined,
    fallbackModel: latch.fallbackModel,
  }
}

export function getSdkBetas(): string[] | undefined {
  return STATE.sdkBetas
}

export function setSdkBetas(betas: string[] | undefined): void {
  STATE.sdkBetas = betas
}

/**
 * Official hht — declared request_user_dialog kinds the SDK host supports.
 */
export function getSdkSupportedDialogKinds(): string[] | undefined {
  return STATE.sdkSupportedDialogKinds
}

/**
 * Official xyn — set declared dialog kinds + source ('initialize' | 'restored').
 * Pass undefined to clear.
 */
export function setSdkSupportedDialogKinds(
  kinds: string[] | undefined,
  source?: string,
): void {
  STATE.sdkSupportedDialogKinds = kinds
  STATE.sdkSupportedDialogKindsSource =
    kinds === undefined ? undefined : (source ?? 'initialize')
}

/** Official Z8o — source of declared kinds, or 'none' when unset. */
export function getSdkSupportedDialogKindsSource(): string {
  if (STATE.sdkSupportedDialogKinds === undefined) return 'none'
  return STATE.sdkSupportedDialogKindsSource ?? 'none'
}

/** Official Q8o — mark print requestDialog host active. */
export function setSdkDialogHostActive(active: boolean): void {
  STATE.sdkDialogHostActive = active
}

/** Official mht — whether createPrintRequestDialog host is armed. */
export function isSdkDialogHostActive(): boolean {
  return STATE.sdkDialogHostActive
}

export function resetCostState(): void {
  STATE.totalCostUSD = 0
  STATE.totalAPIDuration = 0
  STATE.totalAPIDurationWithoutRetries = 0
  STATE.totalToolDuration = 0
  STATE.startTime = Date.now()
  STATE.totalLinesAdded = 0
  STATE.totalLinesRemoved = 0
  STATE.hasUnknownModelCost = false
  STATE.modelUsage = {}
  STATE.promptId = null
}

/**
 * Sets cost state values for session restore.
 * Called by restoreCostStateForSession in cost-tracker.ts.
 */
export function setCostStateForRestore({
  totalCostUSD,
  totalAPIDuration,
  totalAPIDurationWithoutRetries,
  totalToolDuration,
  totalLinesAdded,
  totalLinesRemoved,
  lastDuration,
  modelUsage,
}: {
  totalCostUSD: number
  totalAPIDuration: number
  totalAPIDurationWithoutRetries: number
  totalToolDuration: number
  totalLinesAdded: number
  totalLinesRemoved: number
  lastDuration: number | undefined
  modelUsage: { [modelName: string]: ModelUsage } | undefined
}): void {
  STATE.totalCostUSD = totalCostUSD
  STATE.totalAPIDuration = totalAPIDuration
  STATE.totalAPIDurationWithoutRetries = totalAPIDurationWithoutRetries
  STATE.totalToolDuration = totalToolDuration
  STATE.totalLinesAdded = totalLinesAdded
  STATE.totalLinesRemoved = totalLinesRemoved

  // Restore per-model usage breakdown
  if (modelUsage) {
    STATE.modelUsage = modelUsage
  }

  // Adjust startTime to make wall duration accumulate
  if (lastDuration) {
    STATE.startTime = Date.now() - lastDuration
  }
}

// Only used in tests
export function resetStateForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('resetStateForTests can only be called in tests')
  }
  Object.entries(getInitialState()).forEach(([key, value]) => {
    STATE[key as keyof State] = value as never
  })
  outputTokensAtTurnStart = 0
  currentTurnTokenBudget = null
  budgetContinuationCount = 0
  sessionSwitched.clear()
  interactionSignal.clear()
}

// You shouldn't use this directly. See src/utils/model/modelStrings.ts::getModelStrings()
export function getModelStrings(): ModelStrings | null {
  return STATE.modelStrings
}

// You shouldn't use this directly. See src/utils/model/modelStrings.ts
export function setModelStrings(modelStrings: ModelStrings): void {
  STATE.modelStrings = modelStrings
}

// Test utility function to reset model strings for re-initialization.
// Separate from setModelStrings because we only want to accept 'null' in tests.
export function resetModelStringsForTestingOnly() {
  STATE.modelStrings = null
}

export function setMeter(
  meter: Meter,
  createCounter: (name: string, options: MetricOptions) => AttributedCounter,
): void {
  STATE.meter = meter

  // Initialize all counters using the provided factory
  STATE.sessionCounter = createCounter('claude_code.session.count', {
    description: 'Count of CLI sessions started',
  })
  STATE.locCounter = createCounter('claude_code.lines_of_code.count', {
    description:
      "Count of lines of code modified, with the 'type' attribute indicating whether lines were added or removed",
  })
  STATE.prCounter = createCounter('claude_code.pull_request.count', {
    description: 'Number of pull requests created',
  })
  STATE.commitCounter = createCounter('claude_code.commit.count', {
    description: 'Number of git commits created',
  })
  STATE.costCounter = createCounter('claude_code.cost.usage', {
    description: 'Cost of the Claude Code session',
    unit: 'USD',
  })
  STATE.tokenCounter = createCounter('claude_code.token.usage', {
    description: 'Number of tokens used',
    unit: 'tokens',
  })
  STATE.codeEditToolDecisionCounter = createCounter(
    'claude_code.code_edit_tool.decision',
    {
      description:
        'Count of code editing tool permission decisions (accept/reject) for Edit, Write, and NotebookEdit tools',
    },
  )
  STATE.activeTimeCounter = createCounter('claude_code.active_time.total', {
    description: 'Total active time in seconds',
    unit: 's',
  })
}

export function getMeter(): Meter | null {
  return STATE.meter
}

export function getSessionCounter(): AttributedCounter | null {
  return STATE.sessionCounter
}

export function getLocCounter(): AttributedCounter | null {
  return STATE.locCounter
}

export function getPrCounter(): AttributedCounter | null {
  return STATE.prCounter
}

export function getCommitCounter(): AttributedCounter | null {
  return STATE.commitCounter
}

export function getCostCounter(): AttributedCounter | null {
  return STATE.costCounter
}

export function getTokenCounter(): AttributedCounter | null {
  return STATE.tokenCounter
}

export function getCodeEditToolDecisionCounter(): AttributedCounter | null {
  return STATE.codeEditToolDecisionCounter
}

export function getActiveTimeCounter(): AttributedCounter | null {
  return STATE.activeTimeCounter
}

export function getLoggerProvider(): LoggerProvider | null {
  return STATE.loggerProvider
}

export function setLoggerProvider(provider: LoggerProvider | null): void {
  STATE.loggerProvider = provider
}

export function getEventLogger(): ReturnType<typeof logs.getLogger> | null {
  return STATE.eventLogger
}

export function setEventLogger(
  logger: ReturnType<typeof logs.getLogger> | null,
): void {
  STATE.eventLogger = logger
}

export function getMeterProvider(): MeterProvider | null {
  return STATE.meterProvider
}

export function setMeterProvider(provider: MeterProvider | null): void {
  STATE.meterProvider = provider
}
export function getTracerProvider(): BasicTracerProvider | null {
  return STATE.tracerProvider
}
export function setTracerProvider(provider: BasicTracerProvider | null): void {
  STATE.tracerProvider = provider
}

/**
 * densable `vqr` — Foundry deployment capability map (unsupported features).
 */
export function getFoundryDeploymentCapabilities(): Map<string, Set<string>> {
  return STATE.foundryDeploymentCapabilities
}

export function getIsNonInteractiveSession(): boolean {
  return !STATE.isInteractive
}

export function getIsInteractive(): boolean {
  return STATE.isInteractive
}

export function setIsInteractive(value: boolean): void {
  STATE.isInteractive = value
}

/**
 * densable uE — truthy when a terminal is attached to this bg session.
 */
export function getAttacherCaps(): Record<string, unknown> | null {
  return STATE.attacherCaps
}

/** densable Tci listeners — REt = Tci.subscribe; Eci setAttacherCaps emits. */
const attacherCapsListeners = new Set<() => void>()

/**
 * densable REt / Tci.subscribe — fire when attacher caps change (attach/detach).
 * Used by CUt park restore: when SB() becomes false (terminal attached),
 * clear the parked needs and restore prior tempo.
 */
export function subscribeAttacherCaps(listener: () => void): () => void {
  attacherCapsListeners.add(listener)
  return () => {
    attacherCapsListeners.delete(listener)
  }
}

/**
 * densable tii / Eci — set/clear attacher caps from rendezvous `attacher-caps`.
 * Emits Tci so parked CUt restores prior job tempo on attach.
 */
export function setAttacherCaps(
  caps: Record<string, unknown> | null | undefined,
): void {
  STATE.attacherCaps = caps ?? null
  for (const l of attacherCapsListeners) {
    try {
      l()
    } catch {
      // ignore listener errors
    }
  }
}

export function getClientType(): string {
  return STATE.clientType
}

export function setClientType(type: string): void {
  STATE.clientType = type
}

export function getSdkAgentProgressSummariesEnabled(): boolean {
  return STATE.sdkAgentProgressSummariesEnabled
}

export function setSdkAgentProgressSummariesEnabled(value: boolean): void {
  STATE.sdkAgentProgressSummariesEnabled = value
}

export function getKairosActive(): boolean {
  return STATE.kairosActive
}

export function setKairosActive(value: boolean): void {
  STATE.kairosActive = value
}

export function getStrictToolResultPairing(): boolean {
  return STATE.strictToolResultPairing
}

export function setStrictToolResultPairing(value: boolean): void {
  STATE.strictToolResultPairing = value
}

// Field name 'userMsgOptIn' avoids excluded-string substrings ('BriefTool',
// 'SendUserMessage' — case-insensitive). All callers are inside feature()
// guards so these accessors don't need their own (matches getKairosActive).
export function getUserMsgOptIn(): boolean {
  return STATE.userMsgOptIn
}

export function setUserMsgOptIn(value: boolean): void {
  STATE.userMsgOptIn = value
}

/** densable Ads / todoToolsOptIn — host launch option residual */
export function getTodoToolsOptIn(): boolean {
  return STATE.todoToolsOptIn
}

/** densable replaceTodoToolsOptIn / Tds */
export function setTodoToolsOptIn(value: boolean): void {
  STATE.todoToolsOptIn = value
}

export function setSessionSource(source: string): void {
  STATE.sessionSource = source
}

export function getQuestionPreviewFormat(): 'markdown' | 'html' | undefined {
  return STATE.questionPreviewFormat
}

export function setQuestionPreviewFormat(format: 'markdown' | 'html'): void {
  STATE.questionPreviewFormat = format
}

export function getAgentColorMap(): Map<string, AgentColorName> {
  return STATE.agentColorMap
}

export function getFlagSettingsPath(): string | undefined {
  return STATE.flagSettingsPath
}

export function setFlagSettingsPath(path: string | undefined): void {
  STATE.flagSettingsPath = path
}

export function getFlagSettingsInline(): Record<string, unknown> | null {
  return STATE.flagSettingsInline
}

export function setFlagSettingsInline(
  settings: Record<string, unknown> | null,
): void {
  STATE.flagSettingsInline = settings
}

/** densable tNi — parent managed settings (SDK / --managed-settings). */
export function getParentManagedSettings(): Record<string, unknown> | null {
  return STATE.parentManagedSettings
}

/**
 * densable rNi — set parent managed settings and invalidate settings cache
 * so next policy load re-merges host model overlay.
 */
export function setParentManagedSettings(
  settings: Record<string, unknown> | null,
): void {
  STATE.parentManagedSettings = settings
  resetSettingsCache()
}

export function getSessionIngressToken(): string | null | undefined {
  return STATE.sessionIngressToken
}

export function setSessionIngressToken(token: string | null): void {
  STATE.sessionIngressToken = token
}

export function getOauthTokenFromFd(): string | null | undefined {
  return STATE.oauthTokenFromFd
}

export function setOauthTokenFromFd(token: string | null): void {
  STATE.oauthTokenFromFd = token
}

export function getApiKeyFromFd(): string | null | undefined {
  return STATE.apiKeyFromFd
}

export function setApiKeyFromFd(key: string | null): void {
  STATE.apiKeyFromFd = key
}

export function setLastAPIRequest(
  params: Omit<BetaMessageStreamParams, 'messages'> | null,
): void {
  STATE.lastAPIRequest = params
}

export function getLastAPIRequest(): Omit<
  BetaMessageStreamParams,
  'messages'
> | null {
  return STATE.lastAPIRequest
}

export function setLastAPIRequestMessages(
  messages: BetaMessageStreamParams['messages'] | null,
): void {
  STATE.lastAPIRequestMessages = messages
}

export function getLastAPIRequestMessages():
  | BetaMessageStreamParams['messages']
  | null {
  return STATE.lastAPIRequestMessages
}

export function setLastClassifierRequests(requests: unknown[] | null): void {
  STATE.lastClassifierRequests = requests
}

export function getLastClassifierRequests(): unknown[] | null {
  return STATE.lastClassifierRequests
}

export function setCachedClaudeMdContent(content: string | null): void {
  STATE.cachedClaudeMdContent = content
}

export function getCachedClaudeMdContent(): string | null {
  return STATE.cachedClaudeMdContent
}

export function addToInMemoryErrorLog(errorInfo: {
  error: string
  timestamp: string
}): void {
  const MAX_IN_MEMORY_ERRORS = 100
  if (STATE.inMemoryErrorLog.length >= MAX_IN_MEMORY_ERRORS) {
    STATE.inMemoryErrorLog.shift() // Remove oldest error
  }
  STATE.inMemoryErrorLog.push(errorInfo)
}

export function getAllowedSettingSources(): SettingSource[] {
  return STATE.allowedSettingSources
}

export function setAllowedSettingSources(sources: SettingSource[]): void {
  STATE.allowedSettingSources = sources
}

export function preferThirdPartyAuthentication(): boolean {
  // IDE extension should behave as 1P for authentication reasons.
  return getIsNonInteractiveSession() && STATE.clientType !== 'claude-vscode'
}

export function setInlinePlugins(plugins: Array<string>): void {
  STATE.inlinePlugins = plugins
}

export function getInlinePlugins(): Array<string> {
  return STATE.inlinePlugins
}

/** densable `mxr` — session plugins that skip MCP discovery. */
export function setInlinePluginsNoMcp(plugins: Array<string>): void {
  STATE.inlinePluginsNoMcp = plugins
}

/** densable `Hfe` — paths from `--plugin-dir-no-mcp`. */
export function getInlinePluginsNoMcp(): Array<string> {
  return STATE.inlinePluginsNoMcp
}

export function setChromeFlagOverride(value: boolean | undefined): void {
  STATE.chromeFlagOverride = value
}

export function getChromeFlagOverride(): boolean | undefined {
  return STATE.chromeFlagOverride
}

export function setClaudeInChromeSessionPromptActive(value: boolean): void {
  STATE.claudeInChromeSessionPromptActive = value
}

export function getClaudeInChromeSessionPromptActive(): boolean {
  return STATE.claudeInChromeSessionPromptActive
}

export function setUseCoworkPlugins(value: boolean): void {
  STATE.useCoworkPlugins = value
  resetSettingsCache()
}

export function getUseCoworkPlugins(): boolean {
  return STATE.useCoworkPlugins
}

export function setSessionBypassPermissionsMode(enabled: boolean): void {
  STATE.sessionBypassPermissionsMode = enabled
}

export function getSessionBypassPermissionsMode(): boolean {
  return STATE.sessionBypassPermissionsMode
}

export function setScheduledTasksEnabled(enabled: boolean): void {
  STATE.scheduledTasksEnabled = enabled
}

export function getScheduledTasksEnabled(): boolean {
  return STATE.scheduledTasksEnabled
}

export type SessionCronTask = {
  id: string
  cron: string
  prompt: string
  createdAt: number
  recurring?: boolean
  /**
   * densable `kind:"loop"` — ScheduleWakeup dynamic-loop one-shot wakeups.
   * Session-only; never written to disk.
   */
  kind?: 'loop'
  /**
   * When set, the task was created by an in-process teammate (not the team lead).
   * The scheduler routes fires to that teammate's pendingUserMessages queue
   * instead of the main REPL command queue. Session-only — never written to disk.
   */
  agentId?: string
}

export type LoopChainState = {
  startedAt: number
  lastScheduledFor: number
  agedOut?: boolean
}

export function getSessionCronTasks(): SessionCronTask[] {
  return STATE.sessionCronTasks
}

export function addSessionCronTask(task: SessionCronTask): void {
  STATE.sessionCronTasks.push(task)
}

/**
 * Returns the number of tasks actually removed. Callers use this to skip
 * downstream work (e.g. the disk read in removeCronTasks) when all ids
 * were accounted for here.
 */
export function removeSessionCronTasks(ids: readonly string[]): number {
  if (ids.length === 0) return 0
  const idSet = new Set(ids)
  const remaining = STATE.sessionCronTasks.filter(t => !idSet.has(t.id))
  const removed = STATE.sessionCronTasks.length - remaining.length
  if (removed === 0) return 0
  STATE.sessionCronTasks = remaining
  return removed
}

/** densable `kLi` */
export function getLoopChainStartedAt(
  prompt: string,
): LoopChainState | undefined {
  return STATE.loopChainStartedAt[prompt]
}

/** densable `$Wn` */
export function setLoopChainStartedAt(
  prompt: string,
  state: LoopChainState,
): void {
  STATE.loopChainStartedAt[prompt] = state
}

/** densable `CZt` */
export function clearLoopChainStartedAt(prompt: string): void {
  delete STATE.loopChainStartedAt[prompt]
}

/** densable `AZt` / `aPt` */
export function getLoopTickInFlightPrompt(): string | null {
  return STATE.loopTickInFlightPrompt
}

export function setLoopTickInFlightPrompt(prompt: string | null): void {
  STATE.loopTickInFlightPrompt = prompt
}

/** densable `FWn` / `RZt` */
export function getLoopConsecutiveKeepalives(): number {
  return STATE.loopConsecutiveKeepalives
}

export function setLoopConsecutiveKeepalives(n: number): void {
  STATE.loopConsecutiveKeepalives = n
}

/** densable `xLi` / `Dqr` */
export function getLoopEnded(): boolean {
  return STATE.loopEnded
}

export function setLoopEnded(ended: boolean): void {
  STATE.loopEnded = ended
}

export function setSessionTrustAccepted(accepted: boolean): void {
  STATE.sessionTrustAccepted = accepted
}

export function getSessionTrustAccepted(): boolean {
  return STATE.sessionTrustAccepted
}

export function setSessionPersistenceDisabled(disabled: boolean): void {
  STATE.sessionPersistenceDisabled = disabled
}

export function isSessionPersistenceDisabled(): boolean {
  // Official CLAUDE_CODE_FORCE_SESSION_PERSISTENCE — force writes on.
  if (
    (
      require('../utils/forceSessionPersistence.js') as typeof import('../utils/forceSessionPersistence.js')
    ).isForceSessionPersistenceEnabled()
  ) {
    return false
  }
  return STATE.sessionPersistenceDisabled
}

export function hasExitedPlanModeInSession(): boolean {
  return STATE.hasExitedPlanMode
}

export function setHasExitedPlanMode(value: boolean): void {
  STATE.hasExitedPlanMode = value
}

export function needsPlanModeExitAttachment(): boolean {
  return STATE.needsPlanModeExitAttachment
}

export function setNeedsPlanModeExitAttachment(value: boolean): void {
  STATE.needsPlanModeExitAttachment = value
}

export function handlePlanModeTransition(
  fromMode: string,
  toMode: string,
): void {
  // If switching TO plan mode, clear any pending exit attachment
  // This prevents sending both plan_mode and plan_mode_exit when user toggles quickly
  if (toMode === 'plan' && fromMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = false
  }

  // If switching out of plan mode, trigger the plan_mode_exit attachment
  if (fromMode === 'plan' && toMode !== 'plan') {
    STATE.needsPlanModeExitAttachment = true
  }
}

export function needsAutoModeExitAttachment(): boolean {
  return STATE.needsAutoModeExitAttachment
}

export function setNeedsAutoModeExitAttachment(value: boolean): void {
  STATE.needsAutoModeExitAttachment = value
}

export function handleAutoModeTransition(
  fromMode: string,
  toMode: string,
): void {
  // Auto↔plan transitions are handled by prepareContextForPlanMode (auto may
  // stay active through plan if opted in) and ExitPlanMode (restores mode).
  // Skip both directions so this function only handles direct auto transitions.
  if (
    (fromMode === 'auto' && toMode === 'plan') ||
    (fromMode === 'plan' && toMode === 'auto')
  ) {
    return
  }
  const fromIsAuto = fromMode === 'auto'
  const toIsAuto = toMode === 'auto'

  // If switching TO auto mode, clear any pending exit attachment
  // This prevents sending both auto_mode and auto_mode_exit when user toggles quickly
  if (toIsAuto && !fromIsAuto) {
    STATE.needsAutoModeExitAttachment = false
  }

  // If switching out of auto mode, trigger the auto_mode_exit attachment
  if (fromIsAuto && !toIsAuto) {
    STATE.needsAutoModeExitAttachment = true
  }
}

// LSP plugin recommendation session tracking
export function hasShownLspRecommendationThisSession(): boolean {
  return STATE.lspRecommendationShownThisSession
}

export function setLspRecommendationShownThisSession(value: boolean): void {
  STATE.lspRecommendationShownThisSession = value
}

// SDK init event state
export function setInitJsonSchema(schema: Record<string, unknown>): void {
  STATE.initJsonSchema = schema
}

export function getInitJsonSchema(): Record<string, unknown> | null {
  return STATE.initJsonSchema
}

export function registerHookCallbacks(
  hooks: Partial<Record<HookEvent, RegisteredHookMatcher[]>>,
): void {
  if (!STATE.registeredHooks) {
    STATE.registeredHooks = {}
  }

  // `registerHookCallbacks` may be called multiple times, so we need to merge (not overwrite)
  for (const [event, matchers] of Object.entries(hooks)) {
    const eventKey = event as HookEvent
    if (!STATE.registeredHooks[eventKey]) {
      STATE.registeredHooks[eventKey] = []
    }
    STATE.registeredHooks[eventKey]!.push(...(matchers ?? []))
  }
}

export function getRegisteredHooks(): Partial<
  Record<HookEvent, RegisteredHookMatcher[]>
> | null {
  return STATE.registeredHooks
}

export function clearRegisteredPluginHooks(): void {
  if (!STATE.registeredHooks) {
    return
  }

  const filtered: Partial<Record<HookEvent, RegisteredHookMatcher[]>> = {}
  for (const [event, matchers] of Object.entries(STATE.registeredHooks)) {
    // Keep only callback hooks (those without pluginRoot)
    const callbackHooks = (matchers ?? []).filter(m => !('pluginRoot' in m))
    if (callbackHooks.length > 0) {
      filtered[event as HookEvent] = callbackHooks
    }
  }

  STATE.registeredHooks = Object.keys(filtered).length > 0 ? filtered : null
}

export function resetSdkInitState(): void {
  STATE.initJsonSchema = null
  STATE.registeredHooks = null
}

export function getPlanSlugCache(): Map<string, string> {
  return STATE.planSlugCache
}

export function setPlanSlugCacheEntry(sessionId: string, slug: string): void {
  if (STATE.planSlugCache.size >= 50) {
    const firstKey = STATE.planSlugCache.keys().next().value
    if (firstKey !== undefined) {
      STATE.planSlugCache.delete(firstKey)
    }
  }
  STATE.planSlugCache.set(sessionId, slug)
}

export function getSessionCreatedTeams(): Set<string> {
  return STATE.sessionCreatedTeams
}

// Teleported session tracking for reliability logging
export function setTeleportedSessionInfo(info: {
  sessionId: string | null
}): void {
  STATE.teleportedSessionInfo = {
    isTeleported: true,
    hasLoggedFirstMessage: false,
    sessionId: info.sessionId,
  }
  // densable zNn: register id for bridge G7 remint suppression
  if (info.sessionId) {
    markTeleportedSessionId(info.sessionId)
  }
}

export function getTeleportedSessionInfo(): {
  isTeleported: boolean
  hasLoggedFirstMessage: boolean
  sessionId: string | null
} | null {
  return STATE.teleportedSessionInfo
}

export function markFirstTeleportMessageLogged(): void {
  if (STATE.teleportedSessionInfo) {
    STATE.teleportedSessionInfo.hasLoggedFirstMessage = true
  }
}

/** densable Dm — strip session_/cse_ prefix for teleportedSessionIds key. */
export function normalizeTeleportedSessionId(id: string): string {
  return id.replace(/^(?:session|cse)_/, '')
}

const TELEPORTED_SESSION_IDS_CAP = 64

/**
 * densable zNn — mark session as teleported to cloud (FIFO cap 64).
 * Call on teleport start (local id) and success/may-have-committed (remote id).
 */
export function markTeleportedSessionId(sessionId: string): void {
  if (!sessionId) return
  const key = normalizeTeleportedSessionId(sessionId)
  if (!key) return
  const set = STATE.teleportedSessionIds
  // Re-add to move to insertion end (freshest) when already present
  if (set.has(key)) set.delete(key)
  set.add(key)
  while (set.size > TELEPORTED_SESSION_IDS_CAP) {
    const oldest = set.values().next().value
    if (oldest === undefined) break
    set.delete(oldest)
  }
}

/** densable G7 — true if session was teleported to cloud. */
export function isTeleportedSessionId(sessionId: string): boolean {
  if (!sessionId) return false
  return STATE.teleportedSessionIds.has(normalizeTeleportedSessionId(sessionId))
}

/** densable Ljp — clear teleported mark (rare; tests / session recycle). */
export function clearTeleportedSessionId(sessionId: string): void {
  if (!sessionId) return
  STATE.teleportedSessionIds.delete(normalizeTeleportedSessionId(sessionId))
}

// Invoked skills tracking for preservation across compaction
export type InvokedSkillInfo = {
  skillName: string
  skillPath: string
  content: string
  invokedAt: number
  agentId: string | null
}

export function addInvokedSkill(
  skillName: string,
  skillPath: string,
  content: string,
  agentId: string | null = null,
): void {
  const key = `${agentId ?? ''}:${skillName}`
  STATE.invokedSkills.set(key, {
    skillName,
    skillPath,
    content,
    invokedAt: Date.now(),
    agentId,
  })
}

export function getInvokedSkillsForAgent(
  agentId: string | undefined | null,
): Map<string, InvokedSkillInfo> {
  const normalizedId = agentId ?? null
  const filtered = new Map<string, InvokedSkillInfo>()
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === normalizedId) {
      filtered.set(key, skill)
    }
  }
  return filtered
}

export function clearInvokedSkills(
  preservedAgentIds?: ReadonlySet<string>,
): void {
  if (!preservedAgentIds || preservedAgentIds.size === 0) {
    STATE.invokedSkills.clear()
    return
  }
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === null || !preservedAgentIds.has(skill.agentId)) {
      STATE.invokedSkills.delete(key)
    }
  }
}

export function clearInvokedSkillsForAgent(agentId: string): void {
  for (const [key, skill] of STATE.invokedSkills) {
    if (skill.agentId === agentId) {
      STATE.invokedSkills.delete(key)
    }
  }
}

// Slow operations tracking for dev bar
const MAX_SLOW_OPERATIONS = 10
const SLOW_OPERATION_TTL_MS = 10000

export function addSlowOperation(operation: string, durationMs: number): void {
  if (process.env.USER_TYPE !== 'ant') return
  // Skip tracking for editor sessions (user editing a prompt file in $EDITOR)
  // These are intentionally slow since the user is drafting text
  if (operation.includes('exec') && operation.includes('claude-prompt-')) {
    return
  }
  const now = Date.now()
  // Remove stale operations
  STATE.slowOperations = STATE.slowOperations.filter(
    op => now - op.timestamp < SLOW_OPERATION_TTL_MS,
  )
  // Add new operation
  STATE.slowOperations.push({ operation, durationMs, timestamp: now })
  // Keep only the most recent operations
  if (STATE.slowOperations.length > MAX_SLOW_OPERATIONS) {
    STATE.slowOperations = STATE.slowOperations.slice(-MAX_SLOW_OPERATIONS)
  }
}

const EMPTY_SLOW_OPERATIONS: ReadonlyArray<{
  operation: string
  durationMs: number
  timestamp: number
}> = []

export function getSlowOperations(): ReadonlyArray<{
  operation: string
  durationMs: number
  timestamp: number
}> {
  // Most common case: nothing tracked. Return a stable reference so the
  // caller's setState() can bail via Object.is instead of re-rendering at 2fps.
  if (STATE.slowOperations.length === 0) {
    return EMPTY_SLOW_OPERATIONS
  }
  const now = Date.now()
  // Only allocate a new array when something actually expired; otherwise keep
  // the reference stable across polls while ops are still fresh.
  if (
    STATE.slowOperations.some(op => now - op.timestamp >= SLOW_OPERATION_TTL_MS)
  ) {
    STATE.slowOperations = STATE.slowOperations.filter(
      op => now - op.timestamp < SLOW_OPERATION_TTL_MS,
    )
    if (STATE.slowOperations.length === 0) {
      return EMPTY_SLOW_OPERATIONS
    }
  }
  // Safe to return directly: addSlowOperation() reassigns STATE.slowOperations
  // before pushing, so the array held in React state is never mutated.
  return STATE.slowOperations
}

export function getMainThreadAgentType(): string | undefined {
  return STATE.mainThreadAgentType
}

export function setMainThreadAgentType(agentType: string | undefined): void {
  STATE.mainThreadAgentType = agentType
}

/** densable fne — main-thread agent frontmatter hooks (after QEt trust gate). */
export function getMainThreadAgentHooks():
  | import('../utils/settings/types.js').HooksSettings
  | undefined {
  return STATE.mainThreadAgentHooks
}

/** densable b1r */
export function setMainThreadAgentHooks(
  hooks: import('../utils/settings/types.js').HooksSettings | undefined,
): void {
  STATE.mainThreadAgentHooks = hooks
}

export function getIsRemoteMode(): boolean {
  return STATE.isRemoteMode
}

export function setIsRemoteMode(value: boolean): void {
  STATE.isRemoteMode = value
}

// System prompt section accessors

export function getSystemPromptSectionCache(): Map<string, string | null> {
  return STATE.systemPromptSectionCache
}

export function setSystemPromptSectionCacheEntry(
  name: string,
  value: string | null,
): void {
  if (STATE.systemPromptSectionCache.size >= 100) {
    const firstKey = STATE.systemPromptSectionCache.keys().next().value
    if (firstKey !== undefined) {
      STATE.systemPromptSectionCache.delete(firstKey)
    }
  }
  STATE.systemPromptSectionCache.set(name, value)
}

export function clearSystemPromptSectionState(): void {
  STATE.systemPromptSectionCache.clear()
}

// Last emitted date accessors (for detecting midnight date changes)

export function getLastEmittedDate(): string | null {
  return STATE.lastEmittedDate
}

export function setLastEmittedDate(date: string | null): void {
  STATE.lastEmittedDate = date
}

export function getAdditionalDirectoriesForClaudeMd(): string[] {
  return STATE.additionalDirectoriesForClaudeMd
}

export function setAdditionalDirectoriesForClaudeMd(
  directories: string[],
): void {
  STATE.additionalDirectoriesForClaudeMd = directories
}

export function getAllowedChannels(): ChannelEntry[] {
  return STATE.allowedChannels
}

export function setAllowedChannels(entries: ChannelEntry[]): void {
  STATE.allowedChannels = entries
}

export function getHasDevChannels(): boolean {
  return STATE.hasDevChannels
}

export function setHasDevChannels(value: boolean): void {
  STATE.hasDevChannels = value
}

export function getPromptCache1hAllowlist(): string[] | null {
  return STATE.promptCache1hAllowlist
}

export function setPromptCache1hAllowlist(allowlist: string[] | null): void {
  STATE.promptCache1hAllowlist = allowlist
}

export function getPromptCache1hEligible(): boolean | null {
  return STATE.promptCache1hEligible
}

export function setPromptCache1hEligible(eligible: boolean | null): void {
  STATE.promptCache1hEligible = eligible
}

export function getAfkModeHeaderLatched(): boolean | null {
  return STATE.afkModeHeaderLatched
}

export function setAfkModeHeaderLatched(v: boolean): void {
  STATE.afkModeHeaderLatched = v
}

export function getFastModeHeaderLatched(): boolean | null {
  return STATE.fastModeHeaderLatched
}

export function setFastModeHeaderLatched(v: boolean): void {
  STATE.fastModeHeaderLatched = v
}

export function getCacheEditingHeaderLatched(): boolean | null {
  return STATE.cacheEditingHeaderLatched
}

export function setCacheEditingHeaderLatched(v: boolean): void {
  STATE.cacheEditingHeaderLatched = v
}

/**
 * Reset beta header latches to null. Called on /clear and /compact so a
 * fresh conversation gets fresh header evaluation.
 * densable: also resets stickyBetas + midConvCachePromotionRejected so o3
 * and api_system cache promotion can be retried after /clear or /compact.
 * Callers that also need getAllModelBetas re-evaluation must clearBetasCaches().
 */
export function clearBetaHeaderLatches(): void {
  STATE.afkModeHeaderLatched = null
  STATE.fastModeHeaderLatched = null
  STATE.cacheEditingHeaderLatched = null
  STATE.stickyBetas = { sent: new Set(), rejected: new Set() }
  STATE.midConvCachePromotionRejected = false
}

export function getPromptId(): string | null {
  return STATE.promptId
}

export function setPromptId(id: string | null): void {
  STATE.promptId = id
}
/** densable FC — true while REPL Remote Control bridge is live. */
export function isReplBridgeActive(): boolean {
  return STATE.replBridgeActive ?? false
}

/** densable eDe — set when bridge connects / fails / tears down. */
export function setReplBridgeActive(active: boolean): void {
  if (STATE.replBridgeActive === active) return
  STATE.replBridgeActive = active
  // Do NOT clear replBridgeSessionId here — failed→ready reconnect must
  // keep the cse_* so teleport/G7 still match. Clear only on teardown via
  // setReplBridgeSessionId(undefined).
}

/** densable bridge cse_* id for G7 teleport mark + remint suppress. */
export function getReplBridgeSessionId(): string | undefined {
  return STATE.replBridgeSessionId
}

export function setReplBridgeSessionId(sessionId: string | undefined): void {
  STATE.replBridgeSessionId = sessionId
}

/** densable p1 stickyBetas */
export function getStickyBetas(): { sent: Set<string>; rejected: Set<string> } {
  return STATE.stickyBetas
}

/** densable GRe reset (session clear). */
export function resetStickyBetas(): void {
  STATE.stickyBetas = { sent: new Set(), rejected: new Set() }
}

/** densable DV — sticky-reject a beta until session clear. */
export function stickyRejectBeta(beta: string): void {
  STATE.stickyBetas.sent.delete(beta)
  STATE.stickyBetas.rejected.add(beta)
}

/** densable Iz — has beta been sticky-rejected? */
export function isStickyBetaRejected(beta: string): boolean {
  return STATE.stickyBetas.rejected.has(beta)
}

/**
 * densable tHe — mark beta as sent (if not already rejected).
 * Used by ekd/rkd when arming server-side-fallback / fallback-credit.
 */
export function stickySendBeta(beta: string): void {
  if (!STATE.stickyBetas.rejected.has(beta)) {
    STATE.stickyBetas.sent.add(beta)
  }
}

/**
 * densable uFe — beta was sent and is still active (not rejected).
 */
export function isStickyBetaSentActive(beta: string): boolean {
  return (
    STATE.stickyBetas.sent.has(beta) && !STATE.stickyBetas.rejected.has(beta)
  )
}

/** densable Gri */
export function getMidConvCachePromotionRejected(): boolean {
  return STATE.midConvCachePromotionRejected
}

/** densable Vri */
export function setMidConvCachePromotionRejected(rejected: boolean): void {
  STATE.midConvCachePromotionRejected = rejected
}
