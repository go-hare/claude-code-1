import { GrowthBook, helpers, setPolyfills } from '@growthbook/growthbook'
import { isEqual } from 'lodash-es'
import {
  getIsNonInteractiveSession,
  getPinnedFeatureValues,
  getSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { getGrowthBookClientKey } from '../../constants/keys.js'
import {
  checkHasTrustDialogAccepted,
  getGlobalConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { toError } from '../../utils/errors.js'
import { checkAndRefreshOAuthTokenIfNeeded } from '../../utils/auth.js'
import {
  decideGrowthBookAuthRefresh,
  formatGrowthBookAuthHeaderResolutionFailure,
  formatGrowthBookPreInitOAuthFailure,
  GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MESSAGE,
  GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MS,
} from '../../utils/growthbookAuthRefresh.js'
import {
  coalesceNullFeatureValue,
  processRemoteEvalFeatures,
} from '../../utils/growthbookRemoteEvalPayload.js'
import { getAuthHeaders } from '../../utils/http.js'
import { getProxyFetchOptions } from '../../utils/proxy.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { logError } from '../../utils/log.js'
import { resolveGbRefreshIntervalMsOrDefault } from '../../utils/residualFinalEnvGates.js'
import { createSignal, type Signal } from '../../utils/signal.js'
import { withTimeout } from '../../utils/sleep.js'
import { profileCheckpoint } from '../../utils/startupProfiler.js'
import { jsonParse, jsonStringify } from '../../utils/slowOperations.js'
import {
  exitSessionContext,
  getBootstrapSession,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../../utils/sessionHost.js'
import {
  type GitHubActionsMetadata,
  getUserForGrowthBook,
  resetUserCache,
} from '../../utils/user.js'
import { registerAccountOnHoldGateReader } from '../../utils/accountOnHold.js'
import { registerFileGateReader } from '../../utils/file.js'
import { i_ } from '../../utils/toolSchemaCache.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isTelemetryDisabled } from '../../utils/privacyLevel.js'
import { isGatewayPolicyOrServerProcess } from './config.js'
import {
  is1PEventLoggingEnabled,
  logGrowthBookExperimentTo1P,
} from './firstPartyEventLogger.js'

/**
 * User attributes sent to GrowthBook for targeting.
 * Uses UUID suffix (not Uuid) to align with GrowthBook conventions.
 */
export type GrowthBookUserAttributes = {
  id: string
  sessionId: string
  deviceID: string
  platform: 'win32' | 'darwin' | 'linux'
  apiBaseUrlHost?: string
  organizationUUID?: string
  accountUUID?: string
  userType?: string
  subscriptionType?: string
  rateLimitTier?: string
  firstTokenTime?: number
  email?: string
  appVersion?: string
  github?: GitHubActionsMetadata
  /** densable GB cacheKeyAttributes / targeting. */
  slackTagConnected?: boolean
  atisPin?: string | boolean
  ccrDerivedSurface?: string
}

type SavedFlagsSnapshot = {
  flags: Record<string, unknown>
  accountUuid?: string
  organizationUuid?: string
}

type GlobalConfigWithFeatureFlags = ReturnType<typeof getGlobalConfig> & {
  cachedFeatureFlags?: Record<string, unknown>
  cachedFeatureFlagsAt?: number
  cachedGrowthBookFeaturesAt?: number
}

// Store experiment data from payload for logging exposures later
type StoredExperimentData = {
  experimentId: string
  variationId: number
  inExperiment?: boolean
  hashAttribute?: string
  hashValue?: string
}

type GrowthBookRefreshListener = () => void | Promise<void>

type GrowthBookClientWrapper = {
  client: GrowthBook
  initialized: Promise<void>
} | null

type GrowthBookHostState = {
  client: GrowthBook | null
  // Track whether auth was available when the client was created
  // This allows us to detect when we need to recreate with fresh auth headers
  clientCreatedWithAuth: boolean
  // densable oji / iji / sji — stamped at client create so periodic refresh
  // can detect OAuth Authorization rotation (#34) without waiting for login.
  clientAuthAuthorization: string | undefined
  clientAuthAccountUuid: string | undefined
  clientAuthOrganizationUuid: string | undefined
  experimentDataByFeature: Map<string, StoredExperimentData>
  // Cache for remote eval feature values - workaround for SDK not respecting remoteEval response
  // The SDK's setForcedFeatures also doesn't work reliably with remoteEval
  remoteEvalFeatureValues: Map<string, unknown>
  // Official 2.1.328 `ownSavedFlags` (chunk@286370035.js @745000): carries the
  // account's previously fetched remote-eval flags across same-account OAuth
  // token rotation while the recreated client is still re-fetching.
  ownSavedFlags: SavedFlagsSnapshot | null
  // Track features accessed before init that need exposure logging
  pendingExposures: Set<string>
  // Track features that have already had their exposure logged this session (dedup)
  // This prevents firing duplicate exposure events when getFeatureValue_CACHED_MAY_BE_STALE
  // is called repeatedly in hot paths (e.g., isAutoMemoryEnabled in render loops)
  loggedExposures: Set<string>
  // Track re-initialization promise for security gate checks
  // When GrowthBook is re-initializing (e.g., after auth change), security gate checks
  // should wait for init to complete to avoid returning stale values
  reinitializingPromise: Promise<unknown> | null
  // densable QBi / ZBi / eji — one-shot logs for malformed payload skips (#15)
  loggedSkippedNonObjectFeatures: boolean
  loggedSkippedMalformedExperiments: boolean
  loggedSkippedValueLessFeatures: boolean
  // Listeners notified when GrowthBook feature values refresh (initial init or
  // periodic refresh). NOT cleared by resetGrowthBook — subscribers register
  // once (typically in init.ts) and must survive auth-change resets.
  refreshed: Signal
  envOverrides: Record<string, unknown> | null
  envOverridesRaw: string | undefined
  envOverridesParsed: boolean
  getGrowthBookClientCache: Map<unknown, GrowthBookClientWrapper>
  initializeGrowthBookCache: Map<unknown, Promise<GrowthBook | null>>
  refreshInterval: ReturnType<typeof setInterval> | null
  trackedInLiveStates: boolean
}

const liveGrowthBookHostStates = new Set<WeakRef<GrowthBookHostState>>()
let sharedGrowthBookProcessHooksInstalled = false

function pruneDeadGrowthBookHostStates(): void {
  for (const ref of liveGrowthBookHostStates) {
    if (ref.deref() === undefined) {
      liveGrowthBookHostStates.delete(ref)
    }
  }
}

function cleanupGrowthBookHostStateAtExit(state: GrowthBookHostState): void {
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval)
    state.refreshInterval = null
  }
  state.client?.destroy()
}

function onSharedGrowthBookBeforeExit(): void {
  for (const ref of liveGrowthBookHostStates) {
    const state = ref.deref()
    if (!state) {
      liveGrowthBookHostStates.delete(ref)
      continue
    }
    cleanupGrowthBookHostStateAtExit(state)
  }
}

function onSharedGrowthBookExit(): void {
  for (const ref of liveGrowthBookHostStates) {
    const state = ref.deref()
    if (!state) {
      liveGrowthBookHostStates.delete(ref)
      continue
    }
    cleanupGrowthBookHostStateAtExit(state)
  }
}

function ensureSharedGrowthBookProcessHooksInstalled(): void {
  if (sharedGrowthBookProcessHooksInstalled) return
  sharedGrowthBookProcessHooksInstalled = true
  process.on('beforeExit', onSharedGrowthBookBeforeExit)
  process.on('exit', onSharedGrowthBookExit)
}

function trackLiveGrowthBookHostState(state: GrowthBookHostState): void {
  if (state.trackedInLiveStates) return
  state.trackedInLiveStates = true
  if (liveGrowthBookHostStates.size > 64) {
    pruneDeadGrowthBookHostStates()
  }
  liveGrowthBookHostStates.add(new WeakRef(state))
  ensureSharedGrowthBookProcessHooksInstalled()
}

// Official 2.1.331 [W-115 l$s]: per-host GrowthBook state on SessionHost.
const growthBookHostSlot = new HostSlot<GrowthBookHostState>(() => ({
  client: null,
  clientCreatedWithAuth: false,
  clientAuthAuthorization: undefined,
  clientAuthAccountUuid: undefined,
  clientAuthOrganizationUuid: undefined,
  experimentDataByFeature: new Map(),
  remoteEvalFeatureValues: new Map(),
  ownSavedFlags: null,
  pendingExposures: new Set(),
  loggedExposures: new Set(),
  reinitializingPromise: null,
  loggedSkippedNonObjectFeatures: false,
  loggedSkippedMalformedExperiments: false,
  loggedSkippedValueLessFeatures: false,
  refreshed: createSignal(),
  envOverrides: null,
  envOverridesRaw: undefined,
  envOverridesParsed: false,
  getGrowthBookClientCache: new Map(),
  initializeGrowthBookCache: new Map(),
  refreshInterval: null,
  trackedInLiveStates: false,
}))

function getGrowthBookHostState(): GrowthBookHostState {
  return growthBookHostSlot.of(getBootstrapSessionHost())
}

type HostMemoizedZeroArg<Result> = (() => Result) & {
  cache: Map<unknown, Result>
}

function memoizePerHostField<Result>(
  fn: () => Result,
  getCache: (state: GrowthBookHostState) => Map<unknown, Result>,
  setCache: (state: GrowthBookHostState, next: Map<unknown, Result>) => void,
): HostMemoizedZeroArg<Result> {
  const memoized = (): Result => {
    const cache = getCache(getGrowthBookHostState())
    if (cache.has(undefined)) {
      return cache.get(undefined) as Result
    }
    const result = fn()
    cache.set(undefined, result)
    return result
  }
  Object.defineProperty(memoized, 'cache', {
    get: () => getCache(getGrowthBookHostState()),
    set: (next: Map<unknown, Result>) => {
      setCache(getGrowthBookHostState(), next)
    },
    configurable: true,
    enumerable: true,
  })
  return memoized as HostMemoizedZeroArg<Result>
}

/** Call a listener with sync-throw and async-rejection both routed to logError. */
function callSafe(listener: GrowthBookRefreshListener): void {
  try {
    // Promise.resolve() normalizes sync returns and Promises so both
    // sync throws (caught by outer try) and async rejections (caught
    // by .catch) hit logError. Without the .catch, an async listener
    // that rejects becomes an unhandled rejection — the try/catch
    // only sees the Promise, not its eventual rejection.
    void Promise.resolve(listener()).catch(e => {
      logError(e)
    })
  } catch (e) {
    logError(e)
  }
}

/**
 * Register a callback to fire when GrowthBook feature values refresh.
 * Returns an unsubscribe function.
 *
 * If init has already completed with features by the time this is called
 * (remoteEvalFeatureValues is populated), the listener fires once on the
 * next microtask. This catch-up handles the race where GB's network response
 * lands before the REPL's useEffect commits — on external builds with fast
 * networks and MCP-heavy configs, init can finish in ~100ms while REPL mount
 * takes ~600ms (see #20951 external-build trace at 30.540 vs 31.046).
 *
 * Change detection is on the subscriber: the callback fires on every refresh;
 * use isEqual against your last-seen config to decide whether to act.
 */
export function onGrowthBookRefresh(
  listener: GrowthBookRefreshListener,
): () => void {
  const state = getGrowthBookHostState()
  let subscribed = true
  const unsubscribe = state.refreshed.subscribe(() => callSafe(listener))
  if (state.remoteEvalFeatureValues.size > 0) {
    queueMicrotask(() => {
      // Re-check: listener may have been removed, or resetGrowthBook may have
      // cleared the Map, between registration and this microtask running.
      if (subscribed && state.remoteEvalFeatureValues.size > 0) {
        callSafe(listener)
      }
    })
  }
  return () => {
    subscribed = false
    unsubscribe()
  }
}

/**
 * Parse env var overrides for GrowthBook features.
 * Set CLAUDE_INTERNAL_FC_OVERRIDES to a JSON object mapping feature keys to values
 * to bypass remote eval and disk cache. Useful for eval harnesses and tests that
 * need deterministic feature flag configurations.
 *
 * Example: CLAUDE_INTERNAL_FC_OVERRIDES='{"my_feature": true, "my_config": {"key": "val"}}'
 */
function getEnvOverrides(): Record<string, unknown> | null {
  const state = getGrowthBookHostState()
  const raw = process.env.CLAUDE_INTERNAL_FC_OVERRIDES
  if (!state.envOverridesParsed || raw !== state.envOverridesRaw) {
    state.envOverridesParsed = true
    state.envOverridesRaw = raw
    state.envOverrides = null
    if (raw && raw.trim().length > 0) {
      try {
        const parsed: unknown = jsonParse(raw)
        if (
          parsed !== null &&
          typeof parsed === 'object' &&
          !Array.isArray(parsed)
        ) {
          state.envOverrides = parsed as Record<string, unknown>
        } else {
          logForDebugging(
            '[GrowthBook] Ignoring CLAUDE_INTERNAL_FC_OVERRIDES: expected JSON object',
            { level: 'warn' },
          )
        }
      } catch (e) {
        logForDebugging(
          `[GrowthBook] Failed to parse CLAUDE_INTERNAL_FC_OVERRIDES: ${toError(e).message}`,
          { level: 'warn' },
        )
      }
    }
  }
  return state.envOverrides
}

/**
 * Check if a feature has an env-var override (CLAUDE_INTERNAL_FC_OVERRIDES).
 * When true, _CACHED_MAY_BE_STALE will return the override without touching
 * disk or network — callers can skip awaiting init for that feature.
 */
export function hasGrowthBookEnvOverride(feature: string): boolean {
  const overrides = getEnvOverrides()
  return overrides !== null && feature in overrides
}

/**
 * Official 2.1.328 `hasGrowthBookOverride` (`RN` in chunk@286370035.js):
 * true when either an env override or a config override is set for `feature`.
 */
export function hasGrowthBookOverride(feature: string): boolean {
  if (hasGrowthBookEnvOverride(feature)) return true
  const configOverrides = getConfigOverrides()
  return configOverrides !== undefined && feature in configOverrides
}

/**
 * Local config overrides set via /config Gates tab. Checked after env-var
 * overrides — env wins so eval harnesses remain deterministic. Unlike
 * getEnvOverrides this is not memoized: the user can change overrides at
 * runtime, and getGlobalConfig() is already memory-cached (pointer-chase)
 * until the next saveGlobalConfig() invalidates it.
 */
function getConfigOverrides(): Record<string, unknown> | undefined {
  try {
    return getGlobalConfig().growthBookOverrides
  } catch {
    // getGlobalConfig() throws before configReadingAllowed is set (early
    // main.tsx startup path). Same degrade as the disk-cache fallback below.
    return undefined
  }
}

/**
 * Official 2.1.328 `o2` (`chunk@284735426.js`): prefer `cachedGrowthBookFeatures`,
 * falling back to `cachedFeatureFlags`.
 */
export function readSavedFeatureFlagsFromConfig(
  config: GlobalConfigWithFeatureFlags | undefined,
): Record<string, unknown> | undefined {
  if (!config) return undefined
  return config.cachedGrowthBookFeatures ?? config.cachedFeatureFlags
}

/**
 * Official 2.1.328 `readSavedFlags` (`chunk@286370035.js @735500`):
 * prefer same-account rotated `ownSavedFlags` carry before disk cache.
 */
function readSavedFlags(
  state: GrowthBookHostState = getGrowthBookHostState(),
): Record<string, unknown> | undefined {
  if (state.ownSavedFlags !== null) {
    return state.ownSavedFlags.flags
  }
  try {
    return readSavedFeatureFlagsFromConfig(
      getGlobalConfig() as GlobalConfigWithFeatureFlags,
    )
  } catch {
    return undefined
  }
}

/**
 * Enumerate all known GrowthBook features and their current resolved values
 * (not including overrides). In-memory payload first, carried/disk cache fallback —
 * same priority as the getters. Used by the /config Gates tab.
 */
export function getAllGrowthBookFeatures(): Record<string, unknown> {
  const state = getGrowthBookHostState()
  if (state.remoteEvalFeatureValues.size > 0) {
    return Object.fromEntries(state.remoteEvalFeatureValues)
  }
  return readSavedFlags(state) ?? {}
}

export function getGrowthBookConfigOverrides(): Record<string, unknown> {
  return getConfigOverrides() ?? {}
}

/**
 * Set or clear a single config override. Pass undefined to clear.
 * Fires onGrowthBookRefresh listeners so systems that bake gate values into
 * long-lived objects (useMainLoopModel, useSkillsChange, etc.) rebuild —
 * otherwise overriding e.g. tengu_ant_model_override wouldn't actually
 * change the model until the next periodic refresh.
 */
export function setGrowthBookConfigOverride(
  feature: string,
  value: unknown,
): void {
  try {
    saveGlobalConfig(c => {
      const current = c.growthBookOverrides ?? {}
      if (value === undefined) {
        if (!(feature in current)) return c
        const { [feature]: _, ...rest } = current
        if (Object.keys(rest).length === 0) {
          return { ...c, growthBookOverrides: undefined }
        }
        return { ...c, growthBookOverrides: rest }
      }
      if (isEqual(current[feature], value)) return c
      return { ...c, growthBookOverrides: { ...current, [feature]: value } }
    })
    // Subscribers do their own change detection (see onGrowthBookRefresh docs),
    // so firing on a no-op write is fine.
    getGrowthBookHostState().refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

export function clearGrowthBookConfigOverrides(): void {
  try {
    saveGlobalConfig(c => {
      if (
        !c.growthBookOverrides ||
        Object.keys(c.growthBookOverrides).length === 0
      ) {
        return c
      }
      return { ...c, growthBookOverrides: undefined }
    })
    getGrowthBookHostState().refreshed.emit()
  } catch (e) {
    logError(e)
  }
}

/**
 * Log experiment exposure for a feature if it has experiment data.
 * Deduplicates within a session - each feature is logged at most once.
 */
function logExposureForFeature(
  feature: string,
  state: GrowthBookHostState = getGrowthBookHostState(),
): void {
  // Skip if already logged this session (dedup)
  if (state.loggedExposures.has(feature)) {
    return
  }

  const expData = state.experimentDataByFeature.get(feature)
  if (expData) {
    state.loggedExposures.add(feature)
    logGrowthBookExperimentTo1P({
      experimentId: expData.experimentId,
      variationId: expData.variationId,
      userAttributes: getUserAttributes(),
      experimentMetadata: {
        feature_id: feature,
      },
    })
  }
}

/**
 * Process a remote eval payload from the GrowthBook server and populate
 * local caches. Called after both initial client.init() and after
 * client.refreshFeatures() so that _BLOCKS_ON_INIT callers see fresh values
 * across the process lifetime, not just init-time snapshots.
 *
 * Without this running on refresh, remoteEvalFeatureValues freezes at its
 * init-time snapshot and getDynamicConfig_BLOCKS_ON_INIT returns stale values
 * for the entire process lifetime — which broke the tengu_max_version_config
 * kill switch for long-running sessions.
 */
async function processRemoteEvalPayload(
  gbClient: GrowthBook,
  state: GrowthBookHostState = getGrowthBookHostState(),
): Promise<boolean> {
  // densable RUc — #15: null/malformed features must not crash or wipe cache.
  const payload = gbClient.getPayload()
  const processed = processRemoteEvalFeatures(
    payload?.features as Record<string, unknown> | undefined,
  )
  if (!processed.ok) {
    // empty payload / no values — leave prior remoteEvalFeatureValues + disk intact
    return false
  }

  // One-shot densable ke(...) logs for skipped entries
  if (
    processed.skippedNonObject.length > 0 &&
    !state.loggedSkippedNonObjectFeatures
  ) {
    state.loggedSkippedNonObjectFeatures = true
    logError(
      new Error(
        `processRemoteEvalPayload: skipped non-object features [${processed.skippedNonObject.join(', ')}]`,
      ),
    )
  }
  if (
    processed.skippedMalformedExperiment.length > 0 &&
    !state.loggedSkippedMalformedExperiments
  ) {
    state.loggedSkippedMalformedExperiments = true
    logError(
      new Error(
        `processRemoteEvalPayload: skipped malformed experiment entries [${processed.skippedMalformedExperiment.join(', ')}]`,
      ),
    )
  }
  if (
    processed.skippedValueLess.length > 0 &&
    !state.loggedSkippedValueLessFeatures
  ) {
    state.loggedSkippedValueLessFeatures = true
    logError(
      new Error(
        `processRemoteEvalPayload: skipped value-less entries [${processed.skippedValueLess.join(', ')}]`,
      ),
    )
  }

  // Re-set the payload with transformed features (only after we know values exist)
  await gbClient.setPayload({
    ...payload,
    features: processed.features,
  })
  // densable: if (mMe!==e) return !1 — client replaced mid-await
  if (state.client !== gbClient) {
    return false
  }

  // densable: only now clear + replace maps (prior cache stays if we returned false above)
  state.experimentDataByFeature.clear()
  for (const [key, exp] of processed.experiments) {
    state.experimentDataByFeature.set(key, exp)
  }
  state.remoteEvalFeatureValues.clear()
  for (const [key, value] of processed.values) {
    state.remoteEvalFeatureValues.set(key, value)
  }
  return true
}

/**
 * Write the complete remoteEvalFeatureValues map to disk. Called exactly
 * once per successful processRemoteEvalPayload — never from a failure path,
 * so init-timeout poisoning is structurally impossible (the .catch() at init
 * never reaches here).
 *
 * Wholesale replace (not merge): features deleted server-side are dropped
 * from disk on the next successful payload. Ant builds ⊇ external, so
 * switching builds is safe — the write is always a complete answer for this
 * process's SDK key.
 */
function syncRemoteEvalToDisk(
  state: GrowthBookHostState = getGrowthBookHostState(),
): void {
  const fresh = Object.fromEntries(state.remoteEvalFeatureValues)
  const config = getGlobalConfig() as GlobalConfigWithFeatureFlags
  if (
    isEqual(readSavedFeatureFlagsFromConfig(config), fresh) &&
    isEqual(config.cachedFeatureFlags, fresh)
  ) {
    return
  }
  const now = Date.now()
  saveGlobalConfig(current => {
    const cur = current as GlobalConfigWithFeatureFlags
    return {
      ...cur,
      cachedFeatureFlags: fresh,
      cachedFeatureFlagsAt: now,
      ...(cur.cachedGrowthBookFeatures != null ||
      cur.cachedGrowthBookFeaturesAt != null ||
      cur.cachedFeatureFlagsAt == null
        ? {
            cachedGrowthBookFeatures: fresh,
            cachedGrowthBookFeaturesAt: now,
          }
        : {}),
    }
  })
}

/**
 * Local default overrides for GrowthBook feature gates.
 *
 * When GrowthBook is not connected (e.g. no 1P event logging, no adapter),
 * these values are used instead of the hard-coded defaults (usually false).
 * This allows enabling features that have real implementations without
 * requiring a GrowthBook server connection.
 *
 * Set CLAUDE_CODE_DISABLE_LOCAL_GATES=1 to bypass these defaults.
 *
 * Categories:
 *   P0 — Pure local features (no external dependencies)
 *   P1 — Requires Claude API (works with any valid API key)
 *   KS — Kill switches (default true, keep them true)
 */
const LOCAL_GATE_DEFAULTS: Record<string, unknown> = {
  // ── P0: Pure local features ──────────────────────────────────────
  tengu_keybinding_customization_release: true, // Custom keybindings
  tengu_streaming_tool_execution2: true, // Streaming tool execution
  tengu_kairos_cron: true, // Cron/scheduled tasks
  tengu_amber_json_tools: true, // Token-efficient JSON tools (~4.5% savings)
  tengu_immediate_model_command: true, // Instant /model, /fast, /effort during query
  tengu_basalt_3kr: true, // MCP instructions delta (send only changes)
  tengu_pebble_leaf_prune: true, // Session storage leaf pruning
  tengu_chair_sermon: true, // Message smooshing (merge adjacent blocks)
  tengu_lodestone_enabled: true, // Deep link protocol (claude://)
  tengu_auto_background_agents: true, // Auto-background agents after 120s
  tengu_fleet_needs_input_nudge: true, // Footer "← N agent(s)" when fleet jobs need input
  tengu_fgts: true, // Fine-grained tool state in system prompt
  // Resume-return dialog (rXg / iXg). Official GB default is false; self-hosted
  // forks never get remote true, so overnight /resume stays silent.
  tengu_gleaming_fair: true,

  // ── P1: API-dependent features ───────────────────────────────────
  tengu_session_memory: true, // Session memory (cross-session persistence)
  tengu_passport_quail: true, // Auto memory extraction
  tengu_moth_copse: true, // Skip memory index, use prefetched memories
  tengu_coral_fern: true, // "Searching past context" section
  tengu_chomp_inflection: true, // Prompt suggestions
  tengu_hive_evidence: true, // Verification agent
  tengu_kairos_brief: true, // Brief mode
  tengu_kairos_brief_config: { enable_slash_command: true }, // Brief /slash command visibility
  tengu_sedge_lantern: true, // Away summary
  tengu_onyx_plover: { enabled: true }, // Auto dream (memory consolidation)
  // Team memory product surface + sync watcher (requires TEAMMEM compile flag +
  // auto-memory + OAuth + GitHub remote). Without this local default, densable
  // GB key defaults false and TEAMMEM build ON is a no-op on self-hosted forks.
  tengu_herring_clock: true,

  // ── Kill switches (keep true to prevent remote disable) ──────────
  tengu_turtle_carbon: true, // Ultrathink extended thinking
  tengu_amber_stoat: true, // Built-in Explore/Plan agents
  tengu_amber_flint: true, // Agent teams/swarms
  tengu_birch_trellis: true, // Tree-sitter bash security analysis
  tengu_collage_kaleidoscope: true, // macOS clipboard image reading
  tengu_compact_cache_prefix: true, // Reuse prompt cache during compaction
  // densable reactive-only experiment: when true + REACTIVE_COMPACT, shouldAutoCompact
  // returns false (proactive auto-compact off). Anthropic GB often ships true to
  // external clients; self-hosted / custom ANTHROPIC_BASE_URL users still need
  // proactive compact (Grok/gateway PTL shapes differ). LOCAL wins over disk/remote.
  tengu_cobalt_raccoon: false,
  tengu_kairos_assistant: true, // KAIROS assistant mode activation
  tengu_kairos_cron_durable: true, // Persistent cron tasks
  // KAIROS periphery: RC "session ready" push (remoteControlReadyPush nZp).
  // Without local defaults, KAIROS_PUSH_NOTIFICATION compile ON still leaves
  // ready-nudge dead when remote GB is absent (self-hosted fork).
  // densable: I0e = tengu_kairos_push_notifications; ready_nudge true → full nudge.
  // Do NOT default tengu_ccr_bridge — PushNotification/SendUserFile isEnabled
  // stays RC/self-host bound (isBridgeEnabled), not forced on Anthropic-hosted path.
  tengu_kairos_push_notifications: true,
  tengu_kairos_ready_nudge: true,
  tengu_attribution_header: true, // API request attribution header
  tengu_slate_prism: true, // Agent progress summaries

  // densable 2.1.289 Qbn / silent auto-default: k("tengu_harbor_willow", !0) and
  // k("tengu_moss_anchor", !0). Without local true, hollow GB leaves no-defaultMode
  // sessions on `default` instead of auto (fork / 3P / telemetry-off parity).
  tengu_harbor_willow: true,
  tengu_moss_anchor: true,
  // densable 2.1.289 u7e / k("tengu_lively_waffle", !0) — SubagentHandback Ut.
  // Hollow GB must not leave parent-auto Explore without qw (Image 34 Wr).
  tengu_lively_waffle: true,
  // densable 2.1.289 k("tengu_purring_pine", !0) — endsTurn after a successful report.
  tengu_purring_pine: true,
  // densable 2.1.289 k("tengu_gentle_hummingbird", !0) — linux remote
  // list_directory /proc/self/fd host. Default true matches gold.
  tengu_gentle_hummingbird: true,
  // densable 2.1.289 k("tengu_swirling_meteor", !0) — print task-notification
  // coalesce (hold shouldQuery for follower notifications / owed empty prompt).
  tengu_swirling_meteor: true,
  // densable gbo `k("tengu_event_loop_stall", !1)`. Disk cache true must not
  // wrap stdout with mbo on public TTY start.
  tengu_event_loop_stall: false,
  // densable eD/syr `k("tengu_native_cursor", !1)`. Disk cache true must not
  // pin nativeCursor on public TTY start.
  tengu_native_cursor: false,
  // densable x6 `k("tengu_marlin_porch", !1)`. Disk cache true must not
  // pin DECSTBM renderer (and thereby `!x6()` native-cursor) on public TTY.
  tengu_marlin_porch: false,
  // densable 2.1.289 gAe / k("tengu_omelette_fouet", !1). Gold default is
  // false; hollow GB would leave ClaudeDesign + `/design` hub off.
  tengu_omelette_fouet: true,

  // densable 2.1.289 kBe / TQt / RQt child grant gates (SXn/$6r/bXn/wXn/EXn).
  // Hollow GB must not disable sdk-host lane apply or RC-child grants.
  tengu_bridge_apply_server_session_config: true,
  tengu_bridge_child_auto_mode: true,
  tengu_bridge_child_auto_over_settings: true,
  tengu_bridge_rc_child_artifact: true,
  tengu_bridge_child_machine_settings: true,
  tengu_bridge_rc_child_auto_compact: true,

  // ── Ultrareview (cloud code review via CCR) ─────────────────────
  tengu_review_bughunter_config: { enabled: true }, // /ultrareview command visibility
  tengu_ccr_bundle_seed_enabled: true, // Bundle seed: skip GitHub App check for branch mode

  // ── Computer Use (Chicago MCP) ──────────────────────────────────
  tengu_malort_pedway: { enabled: true }, // Computer Use MCP (Chicago) — fork-enabled; sub-gates fall back to gates.ts DEFAULTS
}

/**
 * Look up a local gate default. Returns undefined if not configured,
 * allowing the caller to fall through to the original defaultValue.
 */
function getLocalGateDefault(feature: string): unknown | undefined {
  // Official DISABLE_LOCAL_GATES densable.
  try {
    const { isLocalGatesDisabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    if (isLocalGatesDisabled()) return undefined
  } catch {
    if (process.env.CLAUDE_CODE_DISABLE_LOCAL_GATES) {
      return undefined
    }
  }
  return LOCAL_GATE_DEFAULTS[feature]
}

/**
 * densable $nb — non-firstParty provider blocks live GrowthBook unless the
 * host owns provider routing (CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST).
 * Dynamic require avoids growthbook → providers → settings cycles.
 */
function isNonFirstPartyUnlessHostManaged(): boolean {
  if (isEnvTruthy(process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST)) {
    return false
  }
  if (isGatewayPolicyOrServerProcess()) {
    return true
  }
  try {
    const { getAPIProvider } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/model/providers.js') as typeof import('../../utils/model/providers.js')
    return getAPIProvider() !== 'firstParty'
  } catch {
    return false
  }
}

/**
 * densable Mg() !== null — gateway auth session present.
 */
function hasGatewayAuthSession(): boolean {
  try {
    const { getGatewayAuth } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/gatewayEnv.js') as typeof import('../../utils/gatewayEnv.js')
    return getGatewayAuth() != null
  } catch {
    return false
  }
}

/**
 * densable KJ — any reason to suppress 1P GrowthBook evaluation.
 * `$nb() || Mg()!=null || _0e()`
 */
function isGrowthBookBlockedByProviderOrPrivacy(): boolean {
  return (
    isNonFirstPartyUnlessHostManaged() ||
    hasGatewayAuthSession() ||
    isTelemetryDisabled()
  )
}

/**
 * Official 2.1.319 `Ete()` (#1705): returns the env var disabling feature flags
 * without turning off telemetry (`CLAUDE_CODE_DISABLE_FEATURE_FLAGS` or
 * `DISABLE_GROWTHBOOK`), or `null` when feature flags are allowed.
 */
export function getFeatureFlagsDisabledEnvVar(
  env: NodeJS.ProcessEnv = process.env,
): 'CLAUDE_CODE_DISABLE_FEATURE_FLAGS' | 'DISABLE_GROWTHBOOK' | null {
  if (isEnvTruthy(env.CLAUDE_CODE_DISABLE_FEATURE_FLAGS)) {
    return 'CLAUDE_CODE_DISABLE_FEATURE_FLAGS'
  }
  if (isEnvTruthy(env.DISABLE_GROWTHBOOK)) {
    return 'DISABLE_GROWTHBOOK'
  }
  return null
}

/**
 * densable KIt / __e — GrowthBook live evaluation gate.
 * `Ete() === null && !KJ()` (plus tip NODE_ENV=test via 1P logger).
 * Adapter URL must NOT bypass 3P / telemetry-off / DISABLE_GROWTHBOOK /
 * CLAUDE_CODE_DISABLE_FEATURE_FLAGS.
 */
export function isGrowthBookEnabled(): boolean {
  if (getFeatureFlagsDisabledEnvVar() !== null) {
    return false
  }
  // densable __e = !KJ
  if (isGrowthBookBlockedByProviderOrPrivacy()) {
    return false
  }
  // Tip: NODE_ENV=test and remaining analytics opt-outs (1P logger).
  // 3P/telemetry already covered above; this keeps test isolation.
  return is1PEventLoggingEnabled()
}

/**
 * Official 2.1.326 #56 (`Qve`): whether the on-disk GrowthBook cache may be
 * read while live GrowthBook evaluation is disabled due to telemetry-off.
 */
export function isDiskCacheReadableWhileDisabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEnvTruthy(env.CLAUDE_CODE_GB_DISK_CACHE_WHEN_TELEMETRY_OFF)) {
    return false
  }
  if (getFeatureFlagsDisabledEnvVar(env) !== null) {
    return false
  }
  if (!isTelemetryDisabled()) {
    return false
  }
  try {
    const { getAPIProvider } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/model/providers.js') as typeof import('../../utils/model/providers.js')
    return getAPIProvider() === 'firstParty'
  } catch {
    return false
  }
}

/**
 * Hostname of ANTHROPIC_BASE_URL when it points at a non-Anthropic proxy.
 *
 * Enterprise-proxy deployments (Epic, Marble, etc.) typically use
 * apiKeyHelper auth, which means isAnthropicAuthEnabled() returns false and
 * organizationUUID/accountUUID/email are all absent from GrowthBook
 * attributes. Without this, there's no stable attribute to target them on
 * — only per-device IDs. See src/utils/auth.ts isAnthropicAuthEnabled().
 *
 * Returns undefined for unset/default (api.anthropic.com) so the attribute
 * is absent for direct-API users. Hostname only — no path/query/creds.
 */
export function getApiBaseUrlHost(): string | undefined {
  const baseUrl = process.env.ANTHROPIC_BASE_URL
  if (!baseUrl) return undefined
  try {
    const host = new URL(baseUrl).host
    if (host === 'api.anthropic.com') return undefined
    return host
  } catch {
    return undefined
  }
}

/**
 * Official `Qf` identity pin — oauth first, then env.
 * AUTH_TOKEN sessions have no oauth account; enterprises set
 * `CLAUDE_CODE_ORGANIZATION_UUID` / `CLAUDE_CODE_ACCOUNT_UUID` so usage
 * telemetry and data-handling settings still attach to the org.
 * Official also wrote `a?.organizationUuid || t?.organizationUuid` but both
 * bindings are `void 0` in 2.1.243 (no JWT parse).
 */
export function resolveGrowthBookIdentityIds(user: {
  organizationUuid?: string
  accountUuid?: string
}): { organizationUUID?: string; accountUUID?: string } {
  const accountUUID =
    user.accountUuid || process.env.CLAUDE_CODE_ACCOUNT_UUID || undefined
  const organizationUUID =
    user.organizationUuid ||
    process.env.CLAUDE_CODE_ORGANIZATION_UUID ||
    undefined
  return {
    ...(organizationUUID && { organizationUUID }),
    ...(accountUUID && { accountUUID }),
  }
}

/**
 * Get user attributes for GrowthBook from CoreUserData
 */
function getUserAttributes(): GrowthBookUserAttributes {
  const user = getUserForGrowthBook()

  // For ants, always try to include email from OAuth config even if ANTHROPIC_API_KEY is set.
  // This ensures GrowthBook targeting by email works regardless of auth method.
  let email = user.email
  if (!email && false) {
    email = getGlobalConfig().oauthAccount?.emailAddress
  }

  const apiBaseUrlHost = getApiBaseUrlHost()
  const identity = resolveGrowthBookIdentityIds(user)

  const rawAtis = getClientDataAtis()
  const attributes = {
    id: user.deviceId,
    sessionId: user.sessionId,
    deviceID: user.deviceId,
    platform: user.platform,
    ...(apiBaseUrlHost && { apiBaseUrlHost }),
    ...identity,
    ...(user.userType && { userType: user.userType }),
    ...(user.subscriptionType && { subscriptionType: user.subscriptionType }),
    ...(user.rateLimitTier && { rateLimitTier: user.rateLimitTier }),
    ...(user.firstTokenTime && { firstTokenTime: user.firstTokenTime }),
    ...(email && { email }),
    ...(user.appVersion && { appVersion: user.appVersion }),
    ...(user.githubActionsMetadata && {
      githubActionsMetadata: user.githubActionsMetadata,
    }),
    slackTagConnected: false,
    atisPin: rawAtis ? atisPin(rawAtis) : false,
  }
  return attributes
}

/**
 * Official `@282138941` (`rn.fetchRemoteEvalCall` / `setPolyfills`) (2.1.300 #796):
 * Route GrowthBook SDK HTTP requests through CLI's proxy + TLS/OS-cert-store
 * fetch options so feature flags stay fresh behind TLS-inspecting proxies.
 */
export function growthbookFetch(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url
  const fetchOpts = getProxyFetchOptions({ url })
  return globalThis.fetch(input, { ...init, ...fetchOpts } as RequestInit)
}

let growthbookFetchConfigured = false

export function configureGrowthBookFetchPolyfill(): void {
  if (growthbookFetchConfigured) return
  growthbookFetchConfigured = true
  setPolyfills({ fetch: growthbookFetch })
  helpers.fetchRemoteEvalCall = ({ host, clientKey, payload, headers }) =>
    growthbookFetch(`${host}/api/eval/${clientKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: jsonStringify(payload),
    })
}

/**
 * Get or create the GrowthBook client instance
 */
const getGrowthBookClient = memoizePerHostField<GrowthBookClientWrapper>(
  (): GrowthBookClientWrapper => {
    if (!isGrowthBookEnabled()) {
      return null
    }

    const host = getBootstrapSessionHost()
    const state = growthBookHostSlot.of(host)
    const attributes = getUserAttributes()
    const clientKey = getGrowthBookClientKey()
    const baseUrl =
      process.env.CLAUDE_GB_ADAPTER_URL ||
      (false
        ? process.env.CLAUDE_CODE_GB_BASE_URL || 'https://api.anthropic.com/'
        : 'https://api.anthropic.com/')
    const isAdapterMode = !!(
      process.env.CLAUDE_GB_ADAPTER_URL && process.env.CLAUDE_GB_ADAPTER_KEY
    )

    // Skip auth if trust hasn't been established yet
    // This prevents executing apiKeyHelper commands before the trust dialog
    // Non-interactive sessions implicitly have workspace trust
    // getSessionTrustAccepted() covers the case where the TrustDialog auto-resolved
    // without persisting trust for the specific CWD (e.g., home directory) —
    // showSetupScreens() sets this after the trust dialog flow completes.
    const hasTrust =
      checkHasTrustDialogAccepted() ||
      getSessionTrustAccepted() ||
      getIsNonInteractiveSession()
    // densable createClient: try getAuthHeaders after pre-init refresh; on throw
    // continue without auth and stamp error:"auth resolution failed".
    let authHeaders: { headers: Record<string, string>; error?: string } =
      hasTrust
        ? { headers: {}, error: 'trust not established' }
        : { headers: {}, error: 'trust not established' }
    if (hasTrust) {
      try {
        authHeaders = getAuthHeaders()
      } catch (e) {
        logForDebugging(formatGrowthBookAuthHeaderResolutionFailure(e))
        authHeaders = { headers: {}, error: 'auth resolution failed' }
      }
    }
    // 适配器模式下不需要 auth，GrowthBook Cloud 用 clientKey 即可
    const hasAuth = isAdapterMode || !authHeaders.error
    state.clientCreatedWithAuth = hasAuth
    // densable rji: q8n=i; oji=i?Authorization:void 0; iji/sji from oauthAccount
    state.clientAuthAuthorization =
      hasAuth && !authHeaders.error
        ? authHeaders.headers.Authorization
        : undefined
    try {
      const oauth = getGlobalConfig().oauthAccount
      state.clientAuthAccountUuid = oauth?.accountUuid
      state.clientAuthOrganizationUuid = oauth?.organizationUuid
    } catch {
      state.clientAuthAccountUuid = undefined
      state.clientAuthOrganizationUuid = undefined
    }

    // Capture in local variable so the init callback operates on THIS client,
    // not a later client if reinitialization happens before init completes
    configureGrowthBookFetchPolyfill()
    const thisClient = new GrowthBook({
      apiHost: baseUrl,
      clientKey,
      attributes,
      // remoteEval only works with Anthropic internal API, GrowthBook Cloud doesn't support it
      remoteEval: !isAdapterMode,
      // cacheKeyAttributes only valid with remoteEval
      ...(!isAdapterMode
        ? {
            cacheKeyAttributes: [
              'id',
              'organizationUUID',
              'slackTagConnected',
              'atisPin',
              'ccrDerivedSurface',
            ],
          }
        : {}),
      apiHostRequestHeaders: {
        'User-Agent': getClaudeCodeUserAgent(),
        ...(!authHeaders.error ? authHeaders.headers : {}),
      },
      // Debug logging for Ants
      ...(false
        ? {
            log: (msg: string, ctx: Record<string, unknown>) => {
              logForDebugging(`GrowthBook: ${msg} ${jsonStringify(ctx)}`)
            },
          }
        : {}),
    })
    state.client = thisClient
    // Register this host state under the single process-wide shared exit hook
    // pair (WeakRef-backed so ephemeral hosts GC cleanly with 0 listener growth).
    trackLiveGrowthBookHostState(state)

    if (!hasAuth) {
      // No auth available yet — skip HTTP init, rely on disk-cached values.
      // initializeGrowthBook() will reset and re-create with auth when available.
      return { client: thisClient, initialized: Promise.resolve() }
    }

    const initialized = thisClient
      .init({ timeout: 5000 })
      .then(async _result => {
        // Guard: if this client was replaced by a newer one, skip processing
        if (state.client !== thisClient) {
          return
        }

        const hadFeatures = await processRemoteEvalPayload(thisClient, state)
        // Re-check: processRemoteEvalPayload yields at `await setPayload`.
        // Microtask-only today (no encryption, no sticky-bucket service), but
        // the guard at the top of this callback runs before that await;
        // this runs after.
        if (state.client !== thisClient) return

        if (hadFeatures) {
          for (const feature of state.pendingExposures) {
            logExposureForFeature(feature, state)
          }
          state.pendingExposures.clear()
          syncRemoteEvalToDisk(state)
          // Notify subscribers: remoteEvalFeatureValues is populated and
          // disk is freshly synced. _CACHED_MAY_BE_STALE reads memory first
          // (#22295), so subscribers see fresh values immediately.
          state.refreshed.emit()
        }

        // Log what features were loaded
      })
      .catch(_error => {})

    return { client: thisClient, initialized }
  },
  state => state.getGrowthBookClientCache,
  (state, next) => {
    state.getGrowthBookClientCache = next
  },
)

/**
 * Initialize GrowthBook client (blocks until ready)
 *
 * densable 2.1.227 createClient: when workspace trust is established, await
 * `Al(refreshOAuthTokenIfNeeded(), DPS=5000, Sbf="timeout")` BEFORE stamping
 * attributes / auth headers so subscriptionType + rateLimitTier land for
 * feature-flag targeting (expired login token → wrong Max/Fable credits prompt).
 */
export const initializeGrowthBook = memoizePerHostField<
  Promise<GrowthBook | null>
>(
  async (): Promise<GrowthBook | null> => {
    if (!isGrowthBookEnabled()) {
      return null
    }
    const state = getGrowthBookHostState()
    const hasTrust =
      checkHasTrustDialogAccepted() ||
      getSessionTrustAccepted() ||
      getIsNonInteractiveSession()

    // densable createClient pre-init OAuth refresh (only when trust established)
    if (hasTrust) {
      let refreshed = false
      try {
        refreshed = await withTimeout(
          checkAndRefreshOAuthTokenIfNeeded(),
          GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MS,
          GROWTHBOOK_PRE_INIT_OAUTH_TIMEOUT_MESSAGE,
        )
      } catch (e) {
        logForDebugging(formatGrowthBookPreInitOAuthFailure(e))
      }
      if (refreshed) {
        // Re-read user attributes so subscription tier / rateLimitTier are fresh
        resetUserCache()
      }
      // densable always creates the client *after* pre-init refresh. Drop any
      // premature memoized client so getUserAttributes + Authorization stamp
      // post-refresh values (without clearing this initializeGrowthBook memo).
      if (state.client !== null) {
        stopPeriodicGrowthBookRefresh()
        state.client?.destroy()
        state.client = null
        state.clientCreatedWithAuth = false
        state.clientAuthAuthorization = undefined
        state.clientAuthAccountUuid = undefined
        state.clientAuthOrganizationUuid = undefined
        getGrowthBookClient.cache?.clear?.()
      }
    }

    let clientWrapper = getGrowthBookClient()
    if (!clientWrapper) {
      return null
    }

    // Check if auth has become available since the client was created
    // If so, we need to recreate the client with fresh auth headers
    // Only check if trust is established to avoid triggering apiKeyHelper before trust dialog
    if (!state.clientCreatedWithAuth && hasTrust) {
      let currentAuth: { headers: Record<string, string>; error?: string }
      try {
        currentAuth = getAuthHeaders()
      } catch (e) {
        logForDebugging(formatGrowthBookAuthHeaderResolutionFailure(e))
        currentAuth = { headers: {}, error: 'auth resolution failed' }
      }
      if (!currentAuth.error) {
        // Use resetGrowthBook to properly destroy old client and stop periodic refresh
        // This prevents double-init where old client's init promise continues running
        resetGrowthBook()
        clientWrapper = getGrowthBookClient()
        if (!clientWrapper) {
          return null
        }
      }
    }

    await clientWrapper.initialized

    // Set up periodic refresh after successful initialization
    // This is called here (not separately) so it's always re-established after any reinit
    setupPeriodicGrowthBookRefresh()

    return clientWrapper.client
  },
  state => state.initializeGrowthBookCache,
  (state, next) => {
    state.initializeGrowthBookCache = next
  },
)

/**
 * Get a feature value with a default fallback - blocks until initialized.
 * @internal Used by both deprecated and cached functions.
 */
async function getFeatureValueInternal<T>(
  feature: string,
  defaultValue: T,
  logExposure: boolean,
): Promise<T> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled()) {
    const localDefault = getLocalGateDefault(feature)
    return localDefault !== undefined ? (localDefault as T) : defaultValue
  }

  const growthBookClient = await initializeGrowthBook()
  if (!growthBookClient) {
    const localDefault = getLocalGateDefault(feature)
    return localDefault !== undefined ? (localDefault as T) : defaultValue
  }

  // Use cached remote eval values if available (workaround for SDK bug)
  // densable nji: explicit null feature value → caller default (no crash)
  const state = getGrowthBookHostState()
  let result: T
  if (state.remoteEvalFeatureValues.has(feature)) {
    result = coalesceNullFeatureValue(
      state.remoteEvalFeatureValues.get(feature),
      defaultValue,
    )
  } else {
    result = growthBookClient.getFeatureValue(feature, defaultValue) as T
  }

  // Log experiment exposure using stored experiment data
  if (logExposure) {
    logExposureForFeature(feature, state)
  }

  return result
}

/**
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE instead, which is non-blocking.
 * This function blocks on GrowthBook initialization which can slow down startup.
 */
export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValueInternal(feature, defaultValue, true)
}

/**
 * Get a feature value from disk cache immediately. Pure read — disk is
 * populated by syncRemoteEvalToDisk on every successful payload (init +
 * periodic refresh), not by this function.
 *
 * This is the preferred method for startup-critical paths and sync contexts.
 * The value may be stale if the cache was written by a previous process.
 */
/**
 * densable 2.1.243 `getFeatureValueWithSource` / `wd`.
 * Official sources: override | disabled | payload | disk | fallback.
 */
export type FeatureValueSource =
  | 'override'
  | 'disabled'
  | 'payload'
  | 'disk'
  | 'fallback'

export type FeatureValueWithSource<T> = {
  value: T
  source: FeatureValueSource
}

/**
 * densable `Rr` — env/config already supply flags, so startup must not wait
 * on GrowthBook init before resolving permission mode.
 */
export function hasAnyGrowthBookOverrides(): boolean {
  const overrides = getEnvOverrides()
  if (overrides && Object.keys(overrides).length > 0) return true
  const configOverrides = getConfigOverrides()
  return (
    configOverrides !== undefined && Object.keys(configOverrides).length > 0
  )
}

/**
 * Official `wd` / class `getFeatureValueWithSource`. Same priority as the
 * cached getter, but the caller can tell disk-stale disable from a live
 * payload (243 #13 killswitch recheck).
 */
export function getFeatureValueWithSource<T>(
  feature: string,
  defaultValue: T,
): FeatureValueWithSource<T> {
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return { value: overrides[feature] as T, source: 'override' }
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return { value: configOverrides[feature] as T, source: 'override' }
  }

  if (!isGrowthBookEnabled() && !isDiskCacheReadableWhileDisabled()) {
    return { value: defaultValue, source: 'disabled' }
  }

  const state = getGrowthBookHostState()
  if (state.experimentDataByFeature.has(feature)) {
    logExposureForFeature(feature, state)
  }

  if (state.remoteEvalFeatureValues.has(feature)) {
    return {
      value: coalesceNullFeatureValue(
        state.remoteEvalFeatureValues.get(feature),
        defaultValue,
      ),
      source: 'payload',
    }
  }

  // Official 2.1.326 #56 (`holdsAnswer()`): once a live remote-eval payload is
  // held, a flag absent from that payload falls back to `defaultValue` instead
  // of reading a stale value left behind in the on-disk cache.
  if (state.remoteEvalFeatureValues.size > 0) {
    return { value: defaultValue, source: 'fallback' }
  }

  try {
    const cached = readSavedFlags(state)?.[feature]
    if (cached !== undefined) {
      state.pendingExposures.add(feature)
      return {
        value: coalesceNullFeatureValue(cached, defaultValue),
        source: 'disk',
      }
    }
  } catch {
    // Config not yet initialized — fall through to fallback
  }
  return { value: defaultValue, source: 'fallback' }
}

/** Official `Un(Pd(), 1500, n)` budget before `qc` / permission-mode resolve. */
export const GROWTHBOOK_PERMISSION_MODE_WAIT_MS = 1500

/**
 * Official `Vo` — wait up to 1500ms for GrowthBook init, swallow failure.
 */
export async function awaitGrowthBookInitForPermissionMode(
  mark: string,
  checkpoints: { before: string; after: string },
): Promise<void> {
  profileCheckpoint(checkpoints.before)
  await withTimeout(
    initializeGrowthBook(),
    GROWTHBOOK_PERMISSION_MODE_WAIT_MS,
    mark,
  ).catch(() => {})
  profileCheckpoint(checkpoints.after)
}

/**
 * Official startup before `qc` / `initialPermissionModeFromCLI`:
 * empty disk cache → `gb-before-mode`; disk-sourced
 * `tengu_auto_mode_config.enabled === "disabled"` → `gb-killswitch-recheck`.
 */
export async function awaitGrowthBookBeforePermissionMode(): Promise<void> {
  if (!isGrowthBookEnabled() || hasAnyGrowthBookOverrides()) {
    return
  }

  let cachedFeatures: Record<string, unknown> = {}
  try {
    cachedFeatures = readSavedFlags() ?? {}
  } catch {
    cachedFeatures = {}
  }

  if (Object.keys(cachedFeatures).length === 0) {
    await awaitGrowthBookInitForPermissionMode('gb-before-mode', {
      before: 'before_growthbook_init',
      after: 'after_growthbook_init',
    })
  }

  const config = getFeatureValueWithSource<{ enabled?: string }>(
    'tengu_auto_mode_config',
    {},
  )
  if (config.value?.enabled === 'disabled' && config.source === 'disk') {
    await awaitGrowthBookInitForPermissionMode('gb-killswitch-recheck', {
      before: 'before_gb_killswitch_recheck',
      after: 'after_gb_killswitch_recheck',
    })
  }
}

/**
 * Official 2.1.328 `getFeatureValue_SESSION_PINNED` (`Gt` in chunk@286370035.js @1087900
 * / chunk@309099536.js @7500) — pin the first GrowthBook evaluation for this session.
 */
export function getFeatureValue_SESSION_PINNED<T>(
  feature: string,
  defaultValue: T,
): T {
  const pinned = getPinnedFeatureValues()
  if (!pinned.has(feature)) {
    pinned.set(
      feature,
      getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue),
    )
  }
  return pinned.get(feature) as T
}

/**
 * Official 2.1.328 `peekSessionPinnedFeatureValue` (`E8` in chunk@286370035.js):
 * read an already-pinned session value without evaluating or pinning.
 */
export function peekSessionPinnedFeatureValue<T = unknown>(
  feature: string,
): T | undefined {
  return getPinnedFeatureValues().get(feature) as T | undefined
}

/**
 * Official 2.1.328 `peekFeatureValue_SESSION_PINNED` (`iPi` in chunk@286370035.js):
 * return the session-pinned value if already latched, otherwise read cached without pinning.
 */
export function peekFeatureValue_SESSION_PINNED<T>(
  feature: string,
  defaultValue: T,
): T {
  const pinned = getPinnedFeatureValues()
  return pinned.has(feature)
    ? (pinned.get(feature) as T)
    : getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

/**
 * densable 2.1.248 `zce(e,t)` — alias for `getFeatureValue_SESSION_PINNED`.
 */
export function getPinnedFeatureValue<T>(feature: string, defaultValue: T): T {
  return getFeatureValue_SESSION_PINNED(feature, defaultValue)
}

export function getFeatureValue_CACHED_MAY_BE_STALE(
  feature: string,
  defaultValue: boolean,
): boolean
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T
export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue: T,
): T {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && feature in overrides) {
    return overrides[feature] as T
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && feature in configOverrides) {
    return configOverrides[feature] as T
  }

  if (!isGrowthBookEnabled() && !isDiskCacheReadableWhileDisabled()) {
    const localDefault = getLocalGateDefault(feature)
    return localDefault !== undefined ? (localDefault as T) : defaultValue
  }

  // LOCAL_GATE_DEFAULTS take priority over remote values and disk cache.
  // In fork/self-hosted deployments, the GrowthBook server may push false
  // for gates we intentionally enable. Local defaults represent the
  // project's intentional configuration and override everything except
  // env/config overrides (which are explicit user intent).
  const localDefault = getLocalGateDefault(feature)
  if (localDefault !== undefined) {
    return localDefault as T
  }

  const state = getGrowthBookHostState()
  // Log experiment exposure if data is available, otherwise defer until after init
  if (state.experimentDataByFeature.has(feature)) {
    logExposureForFeature(feature, state)
  } else {
    state.pendingExposures.add(feature)
  }

  // In-memory payload is authoritative once processRemoteEvalPayload has run.
  // densable nji: null → defaultValue
  if (state.remoteEvalFeatureValues.has(feature)) {
    return coalesceNullFeatureValue(
      state.remoteEvalFeatureValues.get(feature),
      defaultValue,
    )
  }

  // Official 2.1.326 #56 (`holdsAnswer()`): once a live payload has arrived,
  // do not fall back to stale on-disk cache entries for flags removed from it.
  if (state.remoteEvalFeatureValues.size > 0) {
    return defaultValue
  }

  // Fall back to carried ownSavedFlags / disk cache (cachedGrowthBookFeatures ?? cachedFeatureFlags)
  try {
    const cached = readSavedFlags(state)?.[feature]
    if (cached !== undefined) {
      return coalesceNullFeatureValue(cached, defaultValue)
    }
  } catch {
    // Config not yet initialized — fall through to defaultValue
  }
  return defaultValue
}

/**
 * @deprecated Disk cache is now synced on every successful payload load
 * (init + 20min/6h periodic refresh). The per-feature TTL never fetched
 * fresh data from the server — it only re-wrote in-memory state to disk,
 * which is now redundant. Use getFeatureValue_CACHED_MAY_BE_STALE directly.
 */
export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

/**
 * Check a Statsig feature gate value via GrowthBook, with fallback to Statsig cache.
 *
 * **MIGRATION ONLY**: This function is for migrating existing Statsig gates to GrowthBook.
 * For new features, use `getFeatureValue_CACHED_MAY_BE_STALE()` instead.
 *
 * - Checks GrowthBook disk cache first
 * - Falls back to Statsig's cachedStatsigGates during migration
 * - The value may be stale if the cache hasn't been updated recently
 *
 * @deprecated Use getFeatureValue_CACHED_MAY_BE_STALE() for new code. This function
 * exists only to support migration of existing Statsig gates.
 */
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    const localDefault = getLocalGateDefault(gate)
    return localDefault !== undefined ? Boolean(localDefault) : false
  }

  const state = getGrowthBookHostState()
  // Log experiment exposure if data is available, otherwise defer until after init
  if (state.experimentDataByFeature.has(gate)) {
    logExposureForFeature(gate, state)
  } else {
    state.pendingExposures.add(gate)
  }

  // Return cached value immediately from carried flags or disk
  // First check GrowthBook / cachedFeatureFlags cache, then fall back to Statsig cache for migration
  try {
    const config = getGlobalConfig() as GlobalConfigWithFeatureFlags
    const gbCached =
      state.ownSavedFlags?.flags?.[gate] ??
      readSavedFeatureFlagsFromConfig(config)?.[gate]
    if (gbCached !== undefined) {
      return Boolean(gbCached)
    }
    // Fallback to Statsig cache for migration period
    const statsigCached = config.cachedStatsigGates?.[gate]
    if (statsigCached !== undefined) {
      return statsigCached
    }
  } catch {
    // Config not yet initialized — fall through to local gate defaults
  }
  // Neither cache has a value (or config not initialized) — use local gate defaults
  const localDefault = getLocalGateDefault(gate)
  return localDefault !== undefined ? Boolean(localDefault) : false
}

/**
 * Check a security restriction gate, waiting for re-init if in progress.
 *
 * Use this for security-critical gates where we need fresh values after auth changes.
 *
 * Behavior:
 * - If GrowthBook is re-initializing (e.g., after login), waits for it to complete
 * - Otherwise, returns cached value immediately (Statsig cache first, then GrowthBook)
 *
 * Statsig cache is checked first as a safety measure for security-related checks:
 * if the Statsig cache indicates the gate is enabled, we honor it.
 */
export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    return false
  }

  const state = getGrowthBookHostState()
  // If re-initialization is in progress, wait for it to complete
  // This ensures we get fresh values after auth changes
  if (state.reinitializingPromise) {
    await state.reinitializingPromise
  }

  // Check Statsig cache first - it may have correct value from previous logged-in session
  const config = getGlobalConfig() as GlobalConfigWithFeatureFlags
  const statsigCached = config.cachedStatsigGates?.[gate]
  if (statsigCached !== undefined) {
    return Boolean(statsigCached)
  }

  // Then check carried ownSavedFlags / GrowthBook / cachedFeatureFlags cache
  const gbCached =
    state.ownSavedFlags?.flags?.[gate] ??
    readSavedFeatureFlagsFromConfig(config)?.[gate]
  if (gbCached !== undefined) {
    return Boolean(gbCached)
  }

  // No cache - return false (don't block on init for uncached gates)
  return false
}

/**
 * Check a boolean entitlement gate with fallback-to-blocking semantics.
 *
 * Fast path: if the disk cache already says `true`, return it immediately.
 * Slow path: if disk says `false`/missing, await GrowthBook init and fetch the
 * fresh server value (max ~5s). Disk is populated by syncRemoteEvalToDisk
 * inside init, so by the time the slow path returns, disk already has the
 * fresh value — no write needed here.
 *
 * Use for user-invoked features (e.g. /remote-control) that are gated on
 * subscription/org, where a stale `false` would unfairly block access but a
 * stale `true` is acceptable (the server is the real gatekeeper).
 */
export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  // Check env var overrides first (for eval harnesses)
  const overrides = getEnvOverrides()
  if (overrides && gate in overrides) {
    return Boolean(overrides[gate])
  }
  const configOverrides = getConfigOverrides()
  if (configOverrides && gate in configOverrides) {
    return Boolean(configOverrides[gate])
  }

  if (!isGrowthBookEnabled()) {
    const localDefault = getLocalGateDefault(gate)
    return localDefault !== undefined ? Boolean(localDefault) : false
  }

  const state = getGrowthBookHostState()
  // Fast path: in-memory remote eval already says true
  if (state.remoteEvalFeatureValues.get(gate) === true) {
    logExposureForFeature(gate, state)
    return true
  }

  // Fast path: carried ownSavedFlags or disk cache already says true — trust it
  const cached =
    state.ownSavedFlags?.flags?.[gate] === true
      ? true
      : readSavedFeatureFlagsFromConfig(
          getGlobalConfig() as GlobalConfigWithFeatureFlags,
        )?.[gate]
  if (cached === true) {
    // Log experiment exposure if data is available, otherwise defer
    if (state.experimentDataByFeature.has(gate)) {
      logExposureForFeature(gate, state)
    } else {
      state.pendingExposures.add(gate)
    }
    return true
  }

  // Slow path: disk says false/missing — may be stale, fetch fresh
  return getFeatureValueInternal(gate, false, true)
}

export type GrowthBookResetOptions = {
  /**
   * densable preservePendingExposures — keep V8n pending exposure set across
   * hard recreate so features accessed mid-rotation still log once after reinit.
   */
  preservePendingExposures?: boolean
  /**
   * densable preserveLoggedExposures — keep W8n logged exposure dedup when the
   * OAuth token rotates for the *same* account (avoid re-firing exposures).
   * Cleared on account switch / explicit logout.
   */
  preserveLoggedExposures?: boolean
  /**
   * Official 2.1.328 `keepsOwnSavedFlags` (`chunk@286370035.js @745000`):
   * carry the current remote-eval flags across same-account OAuth token
   * rotation while the recreated client re-fetches.
   */
  keepsOwnSavedFlags?: boolean
}

/**
 * Refresh GrowthBook after auth changes (login/logout/OAuth rotation).
 *
 * Official 2.1.328 (`chunk@286370035.js @745000`): snapshots `ownSavedFlags`
 * when `keepsOwnSavedFlags === true`, destroys/recreates the client, emits
 * `refreshed`, and drops `ownSavedFlags` after re-init if auth/account changed.
 */
export function refreshGrowthBookAfterAuthChange(
  options?: GrowthBookResetOptions,
): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  const state = getGrowthBookHostState()
  try {
    let carried: SavedFlagsSnapshot | null = null
    if (options?.keepsOwnSavedFlags === true) {
      carried =
        state.remoteEvalFeatureValues.size > 0
          ? {
              flags: Object.fromEntries(state.remoteEvalFeatureValues),
              accountUuid: state.clientAuthAccountUuid,
              organizationUuid: state.clientAuthOrganizationUuid,
            }
          : state.ownSavedFlags
    }

    // densable Iwe always preservePendingExposures:true on auth-change path
    resetGrowthBook({
      preservePendingExposures: true,
      preserveLoggedExposures: options?.preserveLoggedExposures,
    })
    state.ownSavedFlags = carried

    // resetGrowthBook cleared remoteEvalFeatureValues. If re-init below
    // times out (hadFeatures=false) or short-circuits on !hasAuth (logout),
    // the init-callback notify never fires — subscribers stay synced to the
    // previous account's memoized state. Notify here so they re-read now
    // (falls to carried ownSavedFlags / disk cache).
    state.refreshed.emit()

    // Reinitialize with fresh auth headers and attributes
    const reinitPromise = initializeGrowthBook()
      .catch(error => {
        logError(toError(error))
        return null
      })
      .finally(() => {
        if (state.reinitializingPromise === reinitPromise) {
          state.reinitializingPromise = null
        }
        if (
          state.ownSavedFlags !== null &&
          (!state.clientCreatedWithAuth ||
            state.clientAuthAccountUuid !== state.ownSavedFlags.accountUuid ||
            state.clientAuthOrganizationUuid !==
              state.ownSavedFlags.organizationUuid)
        ) {
          state.ownSavedFlags = null
          state.refreshed.emit()
        }
      })
    state.reinitializingPromise = reinitPromise
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

/**
 * Reset GrowthBook client state.
 * densable mYt(e) — optional preservePendingExposures / preserveLoggedExposures.
 */
export function resetGrowthBook(options?: GrowthBookResetOptions): void {
  const state = getGrowthBookHostState()
  stopPeriodicGrowthBookRefresh()
  state.client?.destroy()
  state.client = null
  state.clientCreatedWithAuth = false
  state.clientAuthAuthorization = undefined
  state.clientAuthAccountUuid = undefined
  state.clientAuthOrganizationUuid = undefined
  state.reinitializingPromise = null
  state.experimentDataByFeature.clear()
  if (!options?.preservePendingExposures) {
    state.pendingExposures.clear()
  }
  if (!options?.preserveLoggedExposures) {
    state.loggedExposures.clear()
    // densable mYt: !preserveLoggedExposures → clear QBi/ZBi/eji one-shot flags
    state.loggedSkippedNonObjectFeatures = false
    state.loggedSkippedMalformedExperiments = false
    state.loggedSkippedValueLessFeatures = false
  }
  state.remoteEvalFeatureValues.clear()
  state.ownSavedFlags = null
  getGrowthBookClient.cache?.clear?.()
  initializeGrowthBook.cache?.clear?.()
  state.envOverrides = null
  state.envOverridesRaw = undefined
  state.envOverridesParsed = false
}

// Periodic refresh interval — official RSh hardcode 6h (21600000) with
// densable CLAUDE_CODE_GB_REFRESH_INTERVAL_MS override via OrDefault.
function getGrowthBookRefreshIntervalMs(): number {
  return resolveGbRefreshIntervalMsOrDefault()
}

/**
 * Light refresh - re-fetch features from server without recreating client.
 * densable X8n: first detect OAuth Authorization rotation (#34); if rotated,
 * hard-recreate via refreshGrowthBookAfterAuthChange (with `keepsOwnSavedFlags`
 * on same-account rotation). Else refreshFeatures.
 */
export async function refreshGrowthBookFeatures(): Promise<void> {
  if (!isGrowthBookEnabled()) {
    return
  }

  const state = getGrowthBookHostState()
  try {
    // densable X8n: if (q8n) { checkAndRefreshOAuth…; if Authorization rotated → Iwe }
    if (state.clientCreatedWithAuth) {
      try {
        const { checkAndRefreshOAuthTokenIfNeeded } = await import(
          '../../utils/auth.js'
        )
        await checkAndRefreshOAuthTokenIfNeeded().catch(() => {})
      } catch {
        // auth module load / refresh failure — still compare current headers
      }
      const currentAuth = getAuthHeaders()
      const currentAuthorization = currentAuth.error
        ? undefined
        : currentAuth.headers.Authorization
      let currentAccountUuid: string | undefined
      let currentOrganizationUuid: string | undefined
      try {
        const oauth = getGlobalConfig().oauthAccount
        currentAccountUuid = oauth?.accountUuid
        currentOrganizationUuid = oauth?.organizationUuid
      } catch {
        // config unavailable
      }
      const decision = decideGrowthBookAuthRefresh({
        clientCreatedWithAuth: state.clientCreatedWithAuth,
        stamped: {
          authorization: state.clientAuthAuthorization,
          accountUuid: state.clientAuthAccountUuid,
          organizationUuid: state.clientAuthOrganizationUuid,
        },
        currentAuthorization,
        currentAccountUuid,
        currentOrganizationUuid,
      })
      if (decision.action === 'recreate') {
        // densable: if (!s) gLe() — reset user cache on account switch
        if (!decision.sameAccount) {
          resetUserCache()
        }
        refreshGrowthBookAfterAuthChange({
          preserveLoggedExposures: decision.preserveLoggedExposures,
          keepsOwnSavedFlags:
            decision.sameAccount && currentAccountUuid !== undefined,
        })
        return
      }
    } else if (state.client) {
      // Official 2.1.323 (#2001): sessions opened before sign-in created a
      // signed-out GrowthBook client (`clientCreatedWithAuth === false`).
      // When auth headers appear later (e.g. after /login), re-read user
      // attributes and recreate GrowthBook so signed-out flags are replaced.
      const prevClient = state.client
      try {
        const { checkAndRefreshOAuthTokenIfNeeded } = await import(
          '../../utils/auth.js'
        )
        await checkAndRefreshOAuthTokenIfNeeded().catch(() => {})
      } catch {
        // ignore
      }
      const currentAuth = getAuthHeaders()
      if (
        prevClient === state.client &&
        !currentAuth.error &&
        (currentAuth.headers.Authorization ||
          Object.keys(currentAuth.headers).length > 0)
      ) {
        resetUserCache()
        refreshGrowthBookAfterAuthChange()
        return
      }
    }

    const growthBookClient = await initializeGrowthBook()
    if (!growthBookClient) {
      return
    }

    // densable: e.refreshFeatures({ skipCache: !0 })
    await growthBookClient.refreshFeatures({ skipCache: true })

    // Guard: if this client was replaced during the in-flight refresh
    // (e.g. refreshGrowthBookAfterAuthChange ran), skip processing the
    // stale payload. Mirrors the init-callback guard above.
    if (growthBookClient !== state.client) {
      return
    }

    // Rebuild remoteEvalFeatureValues from the refreshed payload so that
    // _BLOCKS_ON_INIT callers (e.g. getMaxVersion for the auto-update kill
    // switch) see fresh values, not the stale init-time snapshot.
    const hadFeatures = await processRemoteEvalPayload(growthBookClient, state)
    // Same re-check as init path: covers the setPayload yield inside
    // processRemoteEvalPayload (the guard above only covers refreshFeatures).
    if (growthBookClient !== state.client) return

    // Gate on hadFeatures: if the payload was empty/malformed,
    // remoteEvalFeatureValues wasn't rebuilt — skip both the no-op disk
    // write and the spurious subscriber churn (clearCommandMemoizationCaches
    // + getCommands + 4× model re-renders).
    if (hadFeatures) {
      syncRemoteEvalToDisk(state)
      state.refreshed.emit()
    }
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      throw error
    }
    logError(toError(error))
  }
}

// ============================================================================
// Official 2.1.328 ATIS Request Header & Conversation Latch
// (chunk@286370035.js @1088500 / chunk@309099536.js @7093-8023)
// ============================================================================

/** Official `aPi` — request header carrying the conversation ATIS token. */
export const ATIS_REQUEST_HEADER = 'x-cc-atis'

const ATIS_TOKEN_RE = /^[\x21-\x7e]+$/

/** Official `Xnn` — read the `atis` string from cached client data. */
export function getClientDataAtis(): string | undefined {
  try {
    const raw = getGlobalConfig().clientDataCache?.atis
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined
  } catch {
    return undefined
  }
}

/**
 * Official `Ghr` — extract the pin segment from a structured `v1.<pin>.<a>.<b>.<c>`
 * ATIS token, or return the raw string if it does not match that shape.
 */
export function atisPin(raw: string): string {
  const [prefix, pin, ...rest] = raw.split('.')
  return prefix === 'v1' &&
    pin !== undefined &&
    pin !== '' &&
    rest.length === 3 &&
    rest.every(part => part !== '')
    ? pin
    : raw
}

/** Official `ivl` — GrowthBook gate for latching conversation ATIS (`tengu_kestrel_moor`). */
export function isConversationAtisLatchEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kestrel_moor', true)
}

/**
 * Official `lPi` — resolve the ATIS header value to send on API requests.
 * When conversation latching is enabled and latched, returns the latched value
 * (or `undefined` if latched empty); otherwise falls back to live client data.
 */
export function getRequestAtis(): string | undefined {
  if (!isConversationAtisLatchEnabled()) {
    return getClientDataAtis()
  }
  const latched = getBootstrapSession().conversationLatches.atisLatch()
  if (typeof latched !== 'string') {
    return getClientDataAtis()
  }
  return latched.length > 0 ? latched : undefined
}

/**
 * Official `dPi` — latch the current client-data ATIS value into the active
 * conversation once (first non-undefined write wins; invalid / non-ASCII tokens
 * latch as empty string `""` so subsequent requests omit the header).
 */
export function latchConversationAtis(): void {
  const latches = getBootstrapSession().conversationLatches
  if (latches.atisLatch() === undefined) {
    const atis = getClientDataAtis()
    latches.replaceAtisLatch(
      atis !== undefined && ATIS_TOKEN_RE.test(atis) ? atis : '',
    )
  }
}

/**
 * Set up periodic refresh of GrowthBook features.
 * Uses light refresh (refreshGrowthBookFeatures) to re-fetch without recreating client.
 *
 * Call this after initialization for long-running sessions to ensure
 * feature values stay fresh. Matches Statsig's 6-hour refresh interval.
 */
export function setupPeriodicGrowthBookRefresh(): void {
  if (!isGrowthBookEnabled()) {
    return
  }

  const state = getGrowthBookHostState()
  const rootSessionRef = new WeakRef(getBootstrapSession().root)

  // Clear any existing interval to avoid duplicates
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval)
    state.refreshInterval = null
  }

  const interval = setInterval(() => {
    const session = rootSessionRef.deref()
    if (!session) {
      clearInterval(interval)
      return
    }
    const hostState = growthBookHostSlot.peek(session.host)
    if (!hostState || hostState.refreshInterval !== interval) {
      clearInterval(interval)
      return
    }
    runWithSession(session, () => {
      void refreshGrowthBookFeatures()
    })
  }, getGrowthBookRefreshIntervalMs())
  // Allow process to exit naturally - this timer shouldn't keep the process alive
  interval.unref?.()
  state.refreshInterval = interval

  // Track this host state under the single process-wide shared exit hook pair
  // (no per-host process.once('beforeExit') listener accumulation).
  trackLiveGrowthBookHostState(state)
}

/**
 * Stop periodic refresh (for testing or cleanup)
 */
export function stopPeriodicGrowthBookRefresh(): void {
  const state = getGrowthBookHostState()
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval)
    state.refreshInterval = null
  }
}

// ============================================================================
// Dynamic Config Functions
// These are semantic wrappers around feature functions for Statsig API parity.
// In GrowthBook, dynamic configs are just features with object values.
// ============================================================================

/**
 * Get a dynamic config value - blocks until GrowthBook is initialized.
 * Prefer getFeatureValue_CACHED_MAY_BE_STALE for startup-critical paths.
 */
export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_DEPRECATED(configName, defaultValue)
}

/**
 * Get a dynamic config value from disk cache immediately. Pure read — see
 * getFeatureValue_CACHED_MAY_BE_STALE.
 * This is the preferred method for startup-critical paths and sync contexts.
 *
 * In GrowthBook, dynamic configs are just features with object values.
 */
export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}

// densable `de` — Gx `wx` / `he` reads `tengu_lively_beaver` through this slot.
exitSessionContext(() => {
  registerAccountOnHoldGateReader(gate =>
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE(gate),
  )
})

// file.ts reads `tengu_compact_line_prefix_killswitch` through this slot
// instead of importing this module — that import was the edge that dragged
// analytics/auth into file.ts and settings.ts.
// See docs/task/task-017-session-storage-hub-split.md.
registerFileGateReader((gate, fallback) =>
  getFeatureValue_CACHED_MAY_BE_STALE(gate, fallback),
)

// densable i_/Bl — tengu_still_kestrel (default false). Leaf cache
// reads GB through this slot so auth.ts does not import this module.
i_((gate, fallback) => getFeatureValue_CACHED_MAY_BE_STALE(gate, fallback))
