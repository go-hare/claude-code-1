import axios from 'axios'
import { createHash } from 'crypto'
import memoize from 'lodash-es/memoize.js'
import { gzipSync } from 'zlib'
import { getOrCreateUserID } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { logError } from '../../utils/log.js'
import { getCanonicalName } from '../../utils/model/model.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from '../../utils/model/providers.js'
import { MODEL_COSTS } from '../../utils/modelCost.js'
import { isAnalyticsDisabled } from './config.js'
import { getEventMetadata } from './metadata.js'

/**
 * densable 2.1.289 Datadog logs intake (SEA `P` / `IZn`).
 * Gold is hardcoded — leftover-none 对齐 dropped DATADOG_* analog override.
 */
const DATADOG_LOGS_ENDPOINT =
  'https://http-intake.logs.us5.datadoghq.com/api/v2/logs'
const DATADOG_CLIENT_TOKEN = 'pubea5604404508cdd34afb69e6f42a05bc'
const DEFAULT_FLUSH_INTERVAL_MS = 15000
const MAX_BATCH_SIZE = 100
const NETWORK_TIMEOUT_MS = 5000

/** densable 2.1.289 Datadog allowlist (`I` at SEA ~182900400). */
const DATADOG_ALLOWED_EVENTS = new Set([
  'tengu_feature_ok',
  'tengu_feature_bad',
  'tengu_feature_sad',
  'tengu_teleport_menu',
  'tengu_tether_decision',
  'tengu_tether_live_outcome',
  'tengu_tether_echo_audit',
  'tengu_tether_unrecognised_400',
  'chrome_bridge_connection_succeeded',
  'chrome_bridge_connection_failed',
  'chrome_bridge_disconnected',
  'chrome_bridge_tool_call_completed',
  'chrome_bridge_tool_call_error',
  'chrome_bridge_tool_call_started',
  'chrome_bridge_tool_call_timeout',
  'tengu_api_error',
  'tengu_api_fallback_last_resort',
  'tengu_api_success',
  'tengu_artifact_disabled_session',
  'tengu_artifact_reject_breaker',
  'tengu_artifact_tool_recovered',
  'tengu_artifact_tool_withheld',
  'tengu_auto_mode_decision',
  'tengu_auto_mode_denial_limit_exceeded',
  'tengu_auto_mode_fallback_to_ask',
  'tengu_auto_mode_malformed_tool_input',
  'tengu_auto_mode_env_onboarding_accept',
  'tengu_auto_mode_env_onboarding_dismiss',
  'tengu_auto_mode_env_onboarding_later',
  'tengu_auto_mode_env_onboarding_shown',
  'tengu_auto_mode_outcome',
  'tengu_auto_mode_setup_wizard_answers',
  'tengu_auto_mode_setup_wizard_resolved',
  'tengu_auto_mode_setup_wizard_shown',
  'tengu_auto_mode_subsequent_approval',
  'tengu_bridge_token_absence_classified',
  'tengu_insights_auto_mode_recommendation',
  'tengu_brief_mode_enabled',
  'tengu_brief_mode_toggled',
  'tengu_brief_send',
  'tengu_cancel',
  'tengu_compact_failed',
  'tengu_copper_lantern',
  'tengu_exit',
  'tengu_flicker',
  'tengu_headless_mcp_first_turn_join',
  'tengu_headless_mcp_launch_named_wait',
  'tengu_headless_mcp_prewait',
  'tengu_init',
  'tengu_mcp_degraded',
  'tengu_mcp_list_changed',
  'tengu_mcp_listen_reopen',
  'tengu_mcp_listing_prior_rejected',
  'tengu_mcp_sdk_generation',
  'tengu_mcp_server_connection_failed',
  'tengu_mcp_server_connection_succeeded',
  'tengu_mcp_tools_refreshed_mid_turn',
  'tengu_mcp_tripwire',
  'tengu_model_catalog_compare',
  'tengu_model_fallback_triggered',
  'tengu_live_model_switch',
  'tengu_refusal_fallback_triggered',
  'tengu_refusal_fallback_prompt_shown',
  'tengu_refusal_fallback_prompt_choice',
  'tengu_refusal_fallback_preference_prompt',
  'tengu_refusal_fallback_setting_changed',
  'tengu_refusal_fallback_suppressed',
  'tengu_refusal_fallback_dialog_suppressed',
  'tengu_refusal_fallback_supersedes',
  'tengu_refusal_fallback_route_declined',
  'tengu_refusal_fallback_notice_collapsed',
  'tengu_convolute_arcades_retry',
  'tengu_convolute_arcades_retry_outcome',
  'tengu_rotunda_pennant_applied',
  'tengu_rotunda_pennant_malformed',
  'tengu_rotunda_pennant_strip',
  'tengu_rotunda_pennant_credit_echoed',
  'tengu_rotunda_pennant_tools',
  'tengu_rotunda_pennant_chain_exhausted',
  'tengu_rotunda_pennant_esc',
  'tengu_refusal_retraction_evicted',
  'tengu_refusal_retraction_late_drop',
  'tengu_refusal_retraction_history_dropped',
  'tengu_refusal_retraction_orphan_tool_result',
  'tengu_refusal_retraction_truncation_harvest',
  'tengu_refusal_retraction_unauthenticated_signal',
  'tengu_oauth_error',
  'tengu_oauth_success',
  'tengu_oauth_token_refresh_failure',
  'tengu_oauth_token_refresh_success',
  'tengu_oauth_token_refresh_lock_acquiring',
  'tengu_oauth_token_refresh_lock_acquired',
  'tengu_oauth_token_refresh_starting',
  'tengu_oauth_token_refresh_completed',
  'tengu_oauth_token_refresh_lock_releasing',
  'tengu_oauth_token_refresh_lock_released',
  'tengu_oauth_token_refresh_lock_dead_holder_takeover',
  'tengu_policy_limits_cache_state_at_first_prompt',
  'tengu_policy_limits_fetch',
  'tengu_policy_limits_verdict_recovered',
  'tengu_ptl_surfaced_to_user',
  'tengu_query_error',
  'tengu_remote_tool_targets',
  'tengu_sdk_oauth_refresh_unfulfilled',
  'tengu_rc_pill_clicked',
  'tengu_ranch_rc_shown',
  'tengu_ranch_rc_link_shown',
  'tengu_ccr_init_park_report',
  'tengu_orphaned_permission_applied',
  'tengu_orphaned_permission_unapplied_turn_end',
  'tengu_orphaned_permission_unapplied_turn_resumed',
  'tengu_turn_handoff_run',
  'tengu_turn_handoff_flag_wait',
  'tengu_turn_handoff_files_by_name',
  'tengu_turn_handoff_carried_writes',
  'tengu_pending_action_republished',
  'tengu_resume_interrupted_turn',
  'tengu_resume_parked_permission',
  'tengu_resume_stale_prompt_cancel',
  'tengu_resume_stale_turn_suppressed',
  'tengu_turn_end_classifier_hold',
  'tengu_request_user_dialog_implicit_cancel',
  'tengu_request_user_dialog_late_answer',
  'tengu_request_user_dialog_requires_action',
  'tengu_request_user_dialog_response_ignored',
  'tengu_request_user_dialog_timeout',
  'tengu_review_remote_teleport_failed',
  'tengu_supported_dialog_kinds_restored',
  'tengu_sdk_init_handshake',
  'tengu_sdk_mcp_false_unavailable',
  'tengu_sdk_result',
  'tengu_shutdown_pending_state',
  'tengu_sdk_schema_violation',
  'tengu_sdk_session_crash',
  'tengu_sdk_stall',
  'tengu_sdk_ttft',
  'tengu_session_file_read',
  'tengu_started',
  'tengu_tool_use_error',
  'tengu_tool_use_granted_in_prompt_permanent',
  'tengu_transcript_write_failed',
  'tengu_transcript_writer_recovered',
  'tengu_persistence_suppressed',
  'tengu_tool_use_granted_in_prompt_temporary',
  'tengu_tool_use_rejected_in_prompt',
  'tengu_tool_use_success',
  'tengu_bash_tool_command_executed',
  'tengu_bash_tool_command_failed',
  'tengu_uncaught_exception',
  'tengu_uncaught_exception_loop',
  'tengu_unhandled_rejection',
  'tengu_voice_recording_started',
  'tengu_voice_toggled',
  'tengu_vscode_sdk_stream_ended_no_result',
  'tengu_team_mem_sync_started',
  'tengu_timer',
  'tengu_bg_adopt',
  'tengu_bg_agent_action',
  'tengu_bg_agent_dispatch',
  'tengu_bg_agent_notification',
  'tengu_bg_agent_terminal',
  'tengu_bg_attach',
  'tengu_bg_attach_first_frame',
  'tengu_bg_attach_legacy_autorespawn',
  'tengu_bg_attach_outcome',
  'tengu_bg_classify',
  'tengu_bg_daemon_cold_start_ask',
  'tengu_bg_daemon_cold_start_ask_answer',
  'tengu_bg_daemon_install',
  'tengu_bg_daemon_service_poll_fallthrough',
  'tengu_bg_daemon_service_stale_exec',
  'tengu_bg_daemon_spawn_failed',
  'tengu_bg_daemon_wmi_fallback',
  'tengu_bg_daemon_zombie_false_positive',
  'tengu_bg_daemon_zombie_restart',
  'tengu_bg_dispatch',
  'tengu_bg_dispatch_fallback',
  'tengu_bg_dispatch_low_mem',
  'tengu_bg_dispatch_rescued',
  'tengu_bg_dispatch_sigkill_escalate',
  'tengu_bg_dispatch_stale_drop',
  'tengu_bg_exec_no_lastline',
  'tengu_bg_killjob_ctrl_fallback',
  'tengu_bg_orphan_reap',
  'tengu_bg_proto_mismatch',
  'tengu_bg_pty_unavailable',
  'tengu_bg_reply_outcome',
  'tengu_bg_respawn',
  'tengu_bg_respawn_downgrade_refused',
  'tengu_bg_respawn_exhausted',
  'tengu_bg_respawn_resume_conflict',
  'tengu_bg_prewarm_burst',
  'tengu_bg_respawn_stale',
  'tengu_bg_respawn_unconfirmed_bail',
  'tengu_bg_retired',
  'tengu_bg_roster_parse_failed',
  'tengu_bg_skew_nudge',
  'tengu_bg_spare_claim',
  'tengu_bg_spare_claim_fail',
  'tengu_bg_spare_spawn',
  'tengu_bg_worker_exit',
  'tengu_bg_worker_spawn',
  'tengu_daemon_cold_start_prompt',
  'tengu_daemon_config_reload',
  'tengu_daemon_exit',
  'tengu_daemon_idle_exit',
  'tengu_daemon_install_prompt_answer',
  'tengu_daemon_lease',
  'tengu_daemon_peer_uid_reject',
  'tengu_daemon_self_restart_on_upgrade',
  'tengu_daemon_start',
  'tengu_daemon_startup_crash',
  'tengu_daemon_upgrade_refused_stale_binary',
  'tengu_daemon_worker_crash',
  'tengu_daemon_worker_permanent_exit',
  'tengu_daemon_yield',
  'tengu_daemon_yield_takeover',
])

/** densable `F` — ddtags allowlist (gold H_t). */
const TAG_FIELDS = [
  'arch',
  'attach_cold',
  'daemon_booted',
  'first_frame_kind',
  'surface',
  'via',
  'classifierModel',
  'classifierStage',
  'clientType',
  'decision',
  'entrypoint',
  'errorKind',
  'errorType',
  'failureKind',
  'fastPath',
  'sessionKind',
  'http_status_range',
  'http_status',
  'model',
  'op',
  'outcome',
  'platform',
  'projectsRole',
  'remoteControlLane',
  'projectsSession',
  'provider',
  'reason',
  'coachMode',
  'server_reason',
  'server_type',
  'source',
  'subscriptionType',
  'toolName',
  'uncoveredTailReason',
  'userBucket',
  'userType',
  'version',
  'versionBase',
]

/** densable `O`/`N` — strip high-cardinality / server-id fields before enqueue. */
const DATADOG_STRIP_FIELDS = [
  'mcpServerName',
  'mcpServerBaseUrl',
  'mcpServerId',
  'toolUseContentLengths',
  'toolSchemaCharLengths',
  'toolSchemasHash',
  'errorMessageHash',
  'mcpServerKeyHash',
  'mcpToolName',
  'attributionMcpServer',
  'attributionMcpTool',
  'attributionSkill',
  'attributionMcpServerHash',
  'attributionMcpToolHash',
  'attributionSkillHash',
  'attributionAgentHash',
  'attributionPluginHash',
  'mcpServerNameHash',
  'mcpToolNameHash',
  'toolNameHash',
  'errorDetailsHash',
  'mcp_server_sha12',
  'rh',
  'baseUrl',
  'skill_name_hash',
  'plugin_id_hash',
  'plugin_name_redacted',
  'marketplace_name_redacted',
  'plugin_name_previous',
  'plugin_id_hash_previous',
  'plugin_version_sha',
  'skill_name_hashes',
  'parent_skill_name_hash',
  'item_name_hash',
]
const DATADOG_STRIP_SNAKE = new Set(
  DATADOG_STRIP_FIELDS.map(camelToSnakeCaseEarly),
)

function camelToSnakeCaseEarly(str: string): string {
  return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)
}

function stripDatadogCardinalityFields(data: Record<string, unknown>): void {
  for (const key of Object.keys(data)) {
    if (DATADOG_STRIP_SNAKE.has(camelToSnakeCaseEarly(key))) {
      delete data[key]
    }
  }
}

/** densable `C` — mcp__ prefix, or isMcp with a non-builtin name → `"mcp"`. */
function normalizeDatadogToolName(toolName: string, isMcp: boolean): string {
  if (toolName.startsWith('mcp__')) return 'mcp'
  if (isMcp && toolName !== 'mcp_tool') return 'mcp'
  return toolName
}

/** densable `B`/`H` — MCP connection events are peer-rate-limited. */
const PEER_RATE_EVENTS = [
  'tengu_mcp_list_changed',
  'tengu_mcp_degraded',
  'tengu_mcp_server_connection_succeeded',
  'tengu_mcp_server_connection_failed',
  'tengu_mcp_listen_reopen',
] as const
const PEER_RATE_MAX_PER_WINDOW = 10
const PEER_RATE_WINDOW_MS = 60_000
const PEER_RATE_MAP_CAP = 200

type PeerRateWindow = {
  windowStartMs: number
  forwardedInWindow: number
  droppedSinceForward: number
}

const peerRateWindows = new Map<string, PeerRateWindow>()

/** densable `K`. Never `export function K`. */
function admitPeerRate(
  eventName: string,
  serverKey: string | undefined,
  now: number,
): { admitted: boolean; droppedSinceLastForward: number } {
  const id = `${eventName}\0${serverKey ?? '(no-server)'}`
  let window = peerRateWindows.get(id)
  if (!window) {
    if (peerRateWindows.size >= PEER_RATE_MAP_CAP) {
      const first = peerRateWindows.keys().next().value
      if (first !== undefined) peerRateWindows.delete(first)
    }
    window = {
      windowStartMs: 0,
      forwardedInWindow: 0,
      droppedSinceForward: 0,
    }
    peerRateWindows.set(id, window)
  }
  if (now - window.windowStartMs >= PEER_RATE_WINDOW_MS) {
    window.windowStartMs = now
    window.forwardedInWindow = 0
  }
  if (window.forwardedInWindow >= PEER_RATE_MAX_PER_WINDOW) {
    window.droppedSinceForward++
    return { admitted: false, droppedSinceLastForward: 0 }
  }
  window.forwardedInWindow++
  const dropped = window.droppedSinceForward
  window.droppedSinceForward = 0
  return { admitted: true, droppedSinceLastForward: dropped }
}

/** densable `Z` — drop non-claude models; canonical or `"other"`. */
function normalizeDatadogModel(
  model: unknown,
  _onAnthropicHost: boolean,
): string | null {
  if (typeof model !== 'string') return null
  if (!model.toLowerCase().includes('claude')) {
    return null
  }
  const shortName = getCanonicalName(model.replace(/\[1m]$/i, ''))
  return shortName in MODEL_COSTS ? shortName : 'other'
}

/** densable `XXo` — BYOC kind skips Datadog unless explicitly re-enabled. */
function isByocDatadogOff(): boolean {
  return (
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND === 'byoc' &&
    !process.env.CLAUDE_CODE_BYOC_ENABLE_DATADOG
  )
}

/**
 * densable gzip `Li()` default when `CLAUDE_CODE_GZIP_DATADOG_LOGS` unset:
 * remote managed-cloud (`CLAUDE_CODE_REMOTE` && KIND unset).
 */
function defaultGzipDatadogLogs(): boolean {
  return (
    isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) &&
    process.env.CLAUDE_CODE_ENVIRONMENT_KIND === undefined
  )
}

function camelToSnakeCase(str: string): string {
  return camelToSnakeCaseEarly(str)
}

/** densable `y`/`p`/`m` named-op — not Datadog allowlist `I`. Dynamic import avoids index↔datadog cycle. */
function emitDatadogGzipTengu(success: boolean): void {
  void import('./index.js').then(({ logEvent }) => {
    logEvent('datadog_logs_gzip', { success })
  })
}

type DatadogLog = {
  ddsource: string
  ddtags: string
  message: string
  service: string
  hostname: string
  [key: string]: unknown
}

let logBatch: DatadogLog[] = []
let flushTimer: NodeJS.Timeout | null = null
let datadogInitialized: boolean | null = null
/** densable gzip state: untried → accepted | refused after a non-429 gzip reject. */
let datadogGzip: 'untried' | 'accepted' | 'refused' = 'untried'

function shouldGzipDatadogLogs(): boolean {
  if (datadogGzip === 'refused') return false
  const raw = process.env.CLAUDE_CODE_GZIP_DATADOG_LOGS
  if (raw === undefined) return defaultGzipDatadogLogs()
  if (raw === '0' || raw === 'false') return false
  if (raw === '1' || raw === 'true') return true
  return defaultGzipDatadogLogs()
}

async function postDatadogLogs(logsToSend: DatadogLog[]): Promise<boolean> {
  const gzip = shouldGzipDatadogLogs()
  const body = gzip
    ? gzipSync(Buffer.from(JSON.stringify(logsToSend)))
    : logsToSend
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'DD-API-KEY': DATADOG_CLIENT_TOKEN,
  }
  if (gzip) headers['Content-Encoding'] = 'gzip'
  try {
    await axios.post(DATADOG_LOGS_ENDPOINT, body, {
      headers,
      timeout: NETWORK_TIMEOUT_MS,
    })
    if (gzip && datadogGzip === 'untried') {
      datadogGzip = 'accepted'
      emitDatadogGzipTengu(true)
    }
    return true
  } catch (error) {
    logForDebugging(`Failed to flush logs to Datadog: ${error}`, {
      level: 'error',
    })
    const status = axios.isAxiosError(error)
      ? error.response?.status
      : undefined
    if (!gzip || status === 429) {
      return false
    }
    const reason = status === undefined ? 'no_response' : `http_${status}`
    logForDebugging(
      `Datadog did not take a gzipped log batch (${reason}); resending it uncompressed, and sending later batches from this process uncompressed`,
      { level: 'error' },
    )
    datadogGzip = 'refused'
    const retried = await postDatadogLogs(logsToSend)
    emitDatadogGzipTengu(retried)
    return retried
  }
}

async function flushLogs(): Promise<void> {
  if (logBatch.length === 0) return

  const logsToSend = logBatch
  logBatch = []

  await postDatadogLogs(logsToSend)
}

function scheduleFlush(): void {
  if (flushTimer) return

  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushLogs()
  }, getFlushIntervalMs()).unref()
}

export const initializeDatadog = memoize(async (): Promise<boolean> => {
  // Gold `Ih()||XXo()` — privacy/3P/custom-oauth OR BYOC kind.
  if (isAnalyticsDisabled() || isByocDatadogOff()) {
    datadogInitialized = false
    return false
  }

  try {
    datadogInitialized = true
    return true
  } catch (error) {
    logError(error)
    datadogInitialized = false
    return false
  }
})

/**
 * Flush remaining Datadog logs and shut down.
 * Called from gracefulShutdown() before process.exit() since
 * forceExit() prevents the beforeExit handler from firing.
 */
export async function shutdownDatadog(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushLogs()
}

// NOTE: use via src/services/analytics/index.ts > logEvent
export function isDatadogAllowedEvent(eventName: string): boolean {
  return DATADOG_ALLOWED_EVENTS.has(eventName)
}

export async function trackDatadogEvent(
  eventName: string,
  properties: { [key: string]: boolean | number | string | undefined },
): Promise<void> {
  // Gold H_t: He()!=="firstParty" return.
  if (getAPIProvider() !== 'firstParty') {
    return
  }

  // Fast path: use cached result if available to avoid await overhead
  let initialized = datadogInitialized
  if (initialized === null) {
    initialized = await initializeDatadog()
  }
  if (!initialized || !DATADOG_ALLOWED_EVENTS.has(eventName)) {
    return
  }

  let droppedSinceLastForward: number | undefined
  if ((PEER_RATE_EVENTS as readonly string[]).includes(eventName)) {
    const serverKey = properties.mcpServerKeyHash ?? properties.mcpServerBaseUrl
    const admitted = admitPeerRate(
      eventName,
      serverKey === undefined ? undefined : String(serverKey),
      Date.now(),
    )
    if (!admitted.admitted) return
    if (admitted.droppedSinceLastForward > 0) {
      droppedSinceLastForward = admitted.droppedSinceLastForward
    }
  }

  try {
    const metadata = await getEventMetadata({
      model: properties.model,
      betas: properties.betas,
    })
    // Gold Nrr strips `head_sha`; CURRENT EventMetadata has none.
    const { envContext, ...restMetadata } = metadata
    const allData: Record<string, unknown> = {
      ...restMetadata,
      ...envContext,
      ...properties,
      userBucket: getUserBucket(),
      ...(droppedSinceLastForward !== undefined && {
        droppedSinceLastForward,
      }),
    }

    stripDatadogCardinalityFields(allData)

    if (typeof allData.toolName === 'string') {
      allData.toolName = normalizeDatadogToolName(
        allData.toolName,
        allData.isMcp === true,
      )
    }

    if (allData.model !== undefined) {
      const normalized = normalizeDatadogModel(
        allData.model,
        isFirstPartyAnthropicBaseUrl(),
      )
      if (normalized === null) return
      allData.model = normalized
    }

    // Truncate dev/engine version to base + date (gold `Y`)
    if (typeof allData.version === 'string') {
      allData.version = allData.version.replace(
        /^(\d+\.\d+\.\d+-(?:dev|engine)\.\d{8})\.t\d+\.sha[a-f0-9]+$/,
        '$1',
      )
    }

    // Transform status to http_status and http_status_range to avoid Datadog reserved field
    if (allData.status !== undefined && allData.status !== null) {
      const statusCode = String(allData.status)
      allData.http_status = statusCode

      // Determine status range (1xx, 2xx, 3xx, 4xx, 5xx)
      const firstDigit = statusCode.charAt(0)
      if (firstDigit >= '1' && firstDigit <= '5') {
        allData.http_status_range = `${firstDigit}xx`
      }

      // Remove original status field to avoid conflict with Datadog's reserved field
      delete allData.status
    }

    // Build ddtags with high-cardinality fields for filtering.
    // event:<name> is prepended so the event name is searchable via the
    // log search API — the `message` field (where eventName also lives)
    // is a DD reserved field and is NOT queryable from dashboard widget
    // queries or the aggregation API. See scripts/release/MONITORING.md.
    const allDataRecord = allData
    const tags = [
      `event:${eventName}`,
      ...TAG_FIELDS.filter(
        field =>
          allDataRecord[field] !== undefined && allDataRecord[field] !== null,
      ).map(field => `${camelToSnakeCase(field)}:${allDataRecord[field]}`),
    ]

    const log: DatadogLog = {
      ddsource: 'nodejs',
      ddtags: tags.join(','),
      message: eventName,
      service: 'claude-code',
      hostname: 'claude-code',
      env: 'external',
    }

    // Add all fields as searchable attributes (not duplicated in tags)
    for (const [key, value] of Object.entries(allData)) {
      if (value !== undefined && value !== null) {
        log[camelToSnakeCase(key)] = value
      }
    }

    logBatch.push(log)

    // Flush immediately if batch is full, otherwise schedule
    if (logBatch.length >= MAX_BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      void flushLogs()
    } else {
      scheduleFlush()
    }
  } catch (error) {
    logError(error)
  }
}

const NUM_USER_BUCKETS = 30

/**
 * Gets a 'bucket' that the user ID falls into.
 *
 * For alerting purposes, we want to alert on the number of users impacted
 * by an issue, rather than the number of events- often a small number of users
 * can generate a large number of events (e.g. due to retries). To approximate
 * this without ruining cardinality by counting user IDs directly, we hash the user ID
 * and assign it to one of a fixed number of buckets.
 *
 * This allows us to estimate the number of unique users by counting unique buckets,
 * while preserving user privacy and reducing cardinality.
 */
const getUserBucket = memoize((): number => {
  const userId = getOrCreateUserID()
  const hash = createHash('sha256').update(userId).digest('hex')
  return parseInt(hash.slice(0, 8), 16) % NUM_USER_BUCKETS
})

function getFlushIntervalMs(): number {
  // Official DATADOG_FLUSH_INTERVAL_MS densable pure parse.
  try {
    const { resolveDatadogFlushIntervalMs } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
    return resolveDatadogFlushIntervalMs() ?? DEFAULT_FLUSH_INTERVAL_MS
  } catch {
    return (
      parseInt(process.env.CLAUDE_CODE_DATADOG_FLUSH_INTERVAL_MS || '', 10) ||
      DEFAULT_FLUSH_INTERVAL_MS
    )
  }
}
