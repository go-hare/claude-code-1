// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
/**
 * Env-less Remote Control bridge core.
 *
 * "Env-less" = no Environments API layer. Distinct from "CCR v2" (the
 * /worker/* transport protocol) — the env-based path (replBridge.ts) can also
 * use CCR v2 transport via CLAUDE_CODE_USE_CCR_V2. This file is about removing
 * the poll/dispatch layer, not about which transport protocol is underneath.
 *
 * Unlike initBridgeCore (env-based, ~2400 lines), this connects directly
 * to the session-ingress layer without the Environments API work-dispatch
 * layer:
 *
 *   1. POST /v1/code/sessions              (OAuth, no env_id)  → session.id
 *   2. POST /v1/code/sessions/{id}/bridge  (OAuth)             → {worker_jwt, expires_in, api_base_url, worker_epoch}
 *      Each /bridge call bumps epoch — it IS the register. No separate /worker/register.
 *   3. createV2ReplTransport(worker_jwt, worker_epoch)         → SSE + CCRClient
 *   4. createTokenRefreshScheduler                             → proactive /bridge re-call (new JWT + new epoch)
 *   5. 401 on SSE → rebuild transport with fresh /bridge credentials (same seq-num)
 *
 * No register/poll/ack/stop/heartbeat/deregister environment lifecycle.
 * The Environments API historically existed because CCR's /worker/*
 * endpoints required a session_id+role=worker JWT that only the work-dispatch
 * layer could mint. Server PR #292605 (renamed in #293280) adds the /bridge endpoint as a direct
 * OAuth→worker_jwt exchange, making the env layer optional for REPL sessions.
 *
 * Gated by `tengu_bridge_repl_v2` GrowthBook flag in initReplBridge.ts.
 * REPL-only — daemon/print stay on env-based.
 */

import { feature } from 'bun:bundle'
import axios from 'axios'
import {
  createV2ReplTransport,
  type ReplBridgeTransport,
} from './replBridgeTransport.js'
import { buildCCRv2SdkUrl } from './workSecret.js'
import { toCompatSessionId } from './sessionIdCompat.js'
import { FlushGate } from './flushGate.js'
import { createTokenRefreshScheduler } from './jwtUtils.js'
import {
  CLOSE_CODE_RECOVERY,
  computeRecoveryLeakCeilingMs,
  createHeartbeatRecoveryBudget,
  createRecoveryFlight,
  type DeferredClose,
  disposeTransportClose,
  evaluateEpochStaleRecoveryBudget,
  evaluateRecoverableCloseBudgets,
  formatCloseCause,
  formatOAuthAdoptRetryStatus,
  formatRemintExhaustedMessage,
  formatRemintRetryStatus,
  isEpochStaleRecoverableClose,
  isRecoverableCloseCode,
  noteHealthyAuthBeat,
  noteRecoverySuccess,
  OAUTH_REAUTH_REQUIRED_DETAIL,
  oauthAdoptBackoffMs,
  type RecoveryBudgetCounters,
  REMINT_EXHAUSTED_DETAIL,
  remintBackoffMs,
  SESSION_TELEPORTED_DETAIL,
} from './remintRecovery.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js'
import {
  getReplBridgeSessionId,
  isTeleportedSessionId,
  setReplBridgeSessionId,
} from '../bootstrap/state.js'
import { getTrustedDeviceToken } from './trustedDevice.js'
import {
  getEnvLessBridgeConfig,
  type EnvLessBridgeConfig,
} from './envLessBridgeConfig.js'
import {
  handleIngressMessage,
  handleServerControlRequest,
  makeResultMessage,
  makeWorkerShuttingDownMessage,
  isEligibleBridgeMessage,
  extractTitleText,
  shouldReportRunningForMessage,
  shouldReportRunningForMessages,
  BoundedUUIDSet,
} from './bridgeMessaging.js'
import {
  clearBridgeSessionMeta,
  saveBridgeSessionMeta,
} from './bridgeSessionMeta.js'
import {
  isArchiveSuccessStatus,
  registerBridgePlaceholder,
  removeBridgePlaceholder,
  sweepBridgePlaceholders,
} from './bridgePlaceholders.js'
import { logBridgeSkip } from './debugUtils.js'
import { logForDebugging } from '../utils/debug.js'
import { logForDiagnosticsNoPII } from '../utils/diagLogs.js'
import { isInProtectedNamespace } from '../utils/envUtils.js'
import { errorMessage } from '../utils/errors.js'
import { sleep } from '../utils/sleep.js'
import { registerCleanup } from '../utils/cleanupRegistry.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type {
  ReplBridgeHandle,
  BridgeState,
  ReplBridgeTeardownOpts,
} from './replBridge.js'
import type { Message } from '../types/message.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type {
  SDKControlRequest,
  SDKControlResponse,
} from '../entrypoints/sdk/controlTypes.js'
import type { StdoutMessage } from '../entrypoints/sdk/controlTypes.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import { setSessionMetadataChangedListener } from '../utils/sessionState.js'
import { generateShortWordSlug } from '../utils/words.js'

/**
 * StdoutMessage with optional session_id. The transport layer accepts
 * StdoutMessage but we add session_id at runtime. Using optional because
 * the type system can't verify that adding session_id to a union type
 * is always valid, even though it is at runtime.
 *
 * We need to use 'as StdoutMessage' when passing to transport because
 * TypeScript can't verify that objects with session_id are valid StdoutMessage.
 */
type TransportMessage = StdoutMessage & { session_id?: string }

const ANTHROPIC_VERSION = '2023-06-01'

// Telemetry discriminator for ws_connected. 'initial' is the default and
// never passed to rebuildTransport (which can only be called post-init);
// Exclude<> makes that constraint explicit at both signatures.
type ConnectCause = 'initial' | 'proactive_refresh' | 'auth_401_recovery'

function oauthHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  }
}

export type EnvLessBridgeParams = {
  baseUrl: string
  orgUUID: string
  title: string
  getAccessToken: () => string | undefined
  onAuth401?: (staleAccessToken: string) => Promise<boolean>
  /**
   * Converts internal Message[] → SDKMessage[] for writeMessages() and the
   * initial-flush/drain paths. Injected rather than imported — mappers.ts
   * transitively pulls in src/commands.ts (entire command registry + React
   * tree) which would bloat bundles that don't already have it.
   */
  toSDKMessages: (messages: Message[]) => SDKMessage[]
  initialHistoryCap: number
  initialMessages?: Message[]
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  /**
   * Fired on each title-worthy user message seen in writeMessages() until
   * the callback returns true (done). Mirrors replBridge.ts's onUserMessage —
   * caller derives a title and PATCHes /v1/sessions/{id} so auto-started
   * sessions don't stay at the generic fallback. The caller owns the
   * derive-at-count-1-and-3 policy; the transport just keeps calling until
   * told to stop. sessionId is the raw cse_* — updateBridgeSessionTitle
   * retags internally.
   */
  onUserMessage?: (text: string, sessionId: string) => boolean
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onSetModel?: (model: string | undefined) => void
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onSetMcpPermissionModeOverride?: (
    serverName: string,
    mode: string | null,
  ) => { ok: true; warning?: string } | { ok: false; error: string }
  onStateChange?: (state: BridgeState, detail?: string) => void
  /**
   * When true, skip opening the SSE read stream — only the CCRClient write
   * path is activated. Threaded to createV2ReplTransport and
   * handleServerControlRequest.
   */
  outboundOnly?: boolean
  /** Free-form tags for session categorization (e.g. ['ccr-mirror']). */
  tags?: string[]
  /**
   * densable sessionGroupingId (He) → handle.sessionGroupingId → rit GROUPING.
   * Optional until bootstrap currentSessionBridgeGroupingId is fully densified.
   */
  sessionGroupingId?: string
  /**
   * densable reattachSessionId (se) — resume an existing cse_* session
   * (left-arrow / teleport child). Unarchives then reuses the id; on gone
   * falls back to createCodeSession.
   */
  reattachSessionId?: string
  /**
   * densable reattachSequenceNum (ie) → createV2ReplTransport initialSequenceNum
   * so SSE resumes from the parent high-water mark (CLAUDE_BRIDGE_REATTACH_SEQ).
   */
  reattachSequenceNum?: number
  /**
   * densable noHistoryBackfill (ie from q5o / NO_BACKFILL env) — force skip of
   * initial history flush + stamp handle/meta so title/history cannot leak into
   * a connected RC session on non-owner / suppressed reattach (2.1.228 #5).
   */
  noHistoryBackfill?: boolean
  /**
   * densable mOp `neutralFallbackTitle:c` — when unarchive is `gone` and we mint
   * a fresh server session, createCodeSession title is reset to this (or a new
   * slug) so the resumed conversation title is not stamped onto the new remote
   * session. densable: `Pe=c??\`${xAt()}-${Aet()}\``. Owner-mismatch mint in
   * init keeps the caller-supplied title (same as densable).
   */
  neutralFallbackTitle?: string
}

/**
 * Create a session, fetch a worker JWT, connect the v2 transport.
 *
 * Returns null on any pre-flight failure (session create failed, /bridge
 * failed, transport setup failed). Caller (initReplBridge) surfaces this
 * as a generic "initialization failed" state.
 */
export async function initEnvLessBridgeCore(
  params: EnvLessBridgeParams,
): Promise<ReplBridgeHandle | null> {
  const {
    baseUrl,
    orgUUID,
    title,
    getAccessToken,
    onAuth401,
    toSDKMessages,
    initialHistoryCap,
    initialMessages,
    onInboundMessage,
    onUserMessage,
    onPermissionResponse,
    onInterrupt,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onSetMcpPermissionModeOverride,
    onStateChange,
    outboundOnly,
    tags,
    sessionGroupingId,
    reattachSessionId,
    reattachSequenceNum,
    noHistoryBackfill: noHistoryBackfillOpt,
    neutralFallbackTitle,
  } = params

  const cfg = await getEnvLessBridgeConfig()

  // ── 1. Create or reattach session ───────────────────────────────────────
  const initialAccessToken = getAccessToken()
  if (!initialAccessToken) {
    logForDebugging('[remote-bridge] No OAuth token')
    return null
  }
  // Stable non-undefined fallback for nested async paths (tsc control-flow).
  const fallbackAccessToken: string = initialAccessToken

  // densable Hzu: reattachSessionId → unarchive → reuse Se; gone → mint fresh.
  // `isReattaching` tracks whether the final sessionId is the reattached one
  // (affects archive-on-creds-fail: densable skips archive when reattaching).
  let isReattaching = Boolean(reattachSessionId)
  // densable Ge: set when unarchive is gone and we mint a *new* server session.
  // flushHistory of local prior conversation into that fresh session is the
  // 2.1.224 #19 bug (old history appears on a newly minted remote session).
  // densable 2.1.228 #5: q5o/NO_BACKFILL also forces Ge before connect.
  let skipInitialHistoryFlush = noHistoryBackfillOpt === true
  // densable Pe=n — createCodeSession title; reset to neutral on mint-after-gone.
  let sessionTitle = title
  let sessionId: string

  async function mintFreshSession(): Promise<string | null> {
    const created = await withRetry(
      () =>
        createCodeSession(
          baseUrl,
          // Prefer a fresh token if the caller refreshed mid-flight.
          getAccessToken() ?? fallbackAccessToken,
          sessionTitle,
          cfg.http_timeout_ms,
          tags,
          sessionGroupingId,
        ),
      'createCodeSession',
      cfg,
    )
    if (created) {
      logForDebugging(`[remote-bridge] Created session ${created}`)
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_session_created')
    }
    return created
  }

  if (reattachSessionId) {
    sessionId = reattachSessionId
    logForDebugging(`[remote-bridge] Reattaching to session ${sessionId}`)
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_session_reattached')
    const unarchiveResult = await withRetry(
      () =>
        unarchiveSession(
          sessionId,
          baseUrl,
          getAccessToken() ?? fallbackAccessToken,
          orgUUID,
          cfg.http_timeout_ms,
        ),
      'unarchiveSession',
      cfg,
    )
    if (unarchiveResult?.outcome === 'gone') {
      logForDebugging(
        `[remote-bridge] Reattach ${sessionId} gone (unarchive ${String(unarchiveResult.status)}); minting fresh session`,
      )
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_reattach_fallback')
      logEvent('tengu_bridge_repl_env_expired_fresh_session', {
        v2: true,
        via: 'unarchive' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      // densable Ge=!0 *before* mint: new server session must not receive
      // prior local history via initialMessages flush (#19).
      skipInitialHistoryFlush = true
      // densable Pe=c??`${xAt()}-${Aet()}` — drop resumed-derived title when
      // the remote session is gone and we mint a new cse_* (#5 title path).
      sessionTitle =
        neutralFallbackTitle ?? `remote-control-${generateShortWordSlug()}`
      const minted = await mintFreshSession()
      if (!minted) {
        onStateChange?.('failed', 'Session creation failed — see debug log')
        logBridgeSkip('v2_session_create_failed', undefined, true)
        return null
      }
      sessionId = minted
      isReattaching = false
    }
    // unarchiveResult null = transient failure after retries; still try
    // /bridge — server may accept without unarchive (409 already-active).
  } else {
    const minted = await mintFreshSession()
    if (!minted) {
      onStateChange?.('failed', 'Session creation failed — see debug log')
      logBridgeSkip('v2_session_create_failed', undefined, true)
      return null
    }
    sessionId = minted
  }

  // densable G7: mint-time write of cse_* so teleport zNn / remint suppress
  // do not depend on React ready/connected hooks (which race failed reconnect).
  setReplBridgeSessionId(sessionId)

  // densable 2.1.224 #28: if(!G)FLp(rt); ULp({skipSessionId:rt, archive:Zxr})
  // G = outboundOnly — mirror path does not claim placeholder ownership.
  // Register + sweep after session id is final, before /bridge credentials.
  if (!outboundOnly) {
    void registerBridgePlaceholder(sessionId)
  }
  void sweepBridgePlaceholders({
    baseUrl,
    getAccessToken: () => getAccessToken() ?? fallbackAccessToken,
    skipSessionId: sessionId,
    archive: id =>
      archiveSession(
        id,
        baseUrl,
        getAccessToken() ?? fallbackAccessToken,
        orgUUID,
        cfg.http_timeout_ms,
      ),
  })

  // Clear mint-time cse_* when abandoning this session (not transient reattach).
  // Keep cse_* on reattach fail so G7 teleport mark still matches for remint.
  const clearAbandonedBridgeSessionId = (): void => {
    if (getReplBridgeSessionId() === sessionId) {
      setReplBridgeSessionId(undefined)
    }
  }

  // ── 2. Fetch bridge credentials (POST /bridge → worker_jwt, expires_in, api_base_url) ──
  const credentialsResult = await withRetry(
    () =>
      fetchRemoteCredentials(
        sessionId,
        baseUrl,
        getAccessToken() ?? fallbackAccessToken,
        cfg.http_timeout_ms,
      ),
    'fetchRemoteCredentials',
    cfg,
  )
  if (!isRemoteCredentials(credentialsResult)) {
    if (isReattaching) {
      // densable: reattach /bridge fail is transient — surface retry prompt,
      // do NOT archive the parent session. Keep mint-time cse_* for G7.
      logForDebugging(
        `[remote-bridge] Reattach ${sessionId}: /bridge failed after unarchive; surfacing retry prompt`,
      )
      logForDiagnosticsNoPII('info', 'v2_remote_creds_reattach_transient')
      onStateChange?.(
        'failed',
        "Couldn't reconnect to your Remote Control session. Retry, or start a fresh session without --resume.",
      )
      logBridgeSkip('v2_remote_creds_reattach_transient', undefined, true)
      return null
    }
    const failDetail = isTerminalBridgeFailure(credentialsResult)
      ? `Remote credentials rejected (${credentialsResult.reason})`
      : isNonTerminalBridgeFailure(credentialsResult)
        ? OAUTH_REAUTH_REQUIRED_DETAIL
        : 'Remote credentials fetch failed — see debug log'
    onStateChange?.('failed', failDetail)
    logBridgeSkip('v2_remote_creds_failed', undefined, true)
    clearAbandonedBridgeSessionId()
    void archiveSession(
      sessionId,
      baseUrl,
      getAccessToken() ?? fallbackAccessToken,
      orgUUID,
      cfg.http_timeout_ms,
    )
    return null
  }
  // Narrowed: isRemoteCredentials check above
  const credentials = credentialsResult
  logForDebugging(
    `[remote-bridge] Fetched bridge credentials (expires_in=${credentials.expires_in}s)`,
  )

  // ── 3. Build v2 transport (SSETransport + CCRClient) ────────────────────
  const sessionUrl = buildCCRv2SdkUrl(credentials.api_base_url, sessionId)
  logForDebugging(`[remote-bridge] v2 session URL: ${sessionUrl}`)

  let transport: ReplBridgeTransport
  try {
    transport = await createV2ReplTransport({
      sessionUrl,
      ingressToken: credentials.worker_jwt,
      sessionId,
      epoch: credentials.worker_epoch,
      heartbeatIntervalMs: cfg.heartbeat_interval_ms,
      heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
      // densable: initialSequenceNum only when still reattaching (ne?ie:void 0)
      initialSequenceNum: isReattaching ? reattachSequenceNum : undefined,
      // Per-instance closure — keeps the worker JWT out of
      // process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN, which mcp/client.ts
      // reads ungatedly and would otherwise send to user-configured ws/http
      // MCP servers. Frozen-at-construction is correct: transport is fully
      // rebuilt on refresh (rebuildTransport below).
      getAuthToken: () => credentials.worker_jwt,
      outboundOnly,
    })
  } catch (err) {
    logForDebugging(
      `[remote-bridge] v2 transport setup failed: ${errorMessage(err)}`,
      { level: 'error' },
    )
    onStateChange?.('failed', `Transport setup failed: ${errorMessage(err)}`)
    logBridgeSkip('v2_transport_setup_failed', undefined, true)
    // densable: skip archive on failed reattach transport so parent session
    // remains recoverable. Keep mint-time cse_* for G7 on reattach.
    if (!isReattaching) {
      clearAbandonedBridgeSessionId()
      void archiveSession(
        sessionId,
        baseUrl,
        getAccessToken() ?? fallbackAccessToken,
        orgUUID,
        cfg.http_timeout_ms,
      )
    }
    return null
  }
  logForDebugging(
    `[remote-bridge] v2 transport created (epoch=${credentials.worker_epoch})`,
  )
  onStateChange?.('ready')

  // ── 4. State ────────────────────────────────────────────────────────────

  // Echo dedup: messages we POST come back on the read stream. Seeded with
  // initial message UUIDs so server echoes of flushed history are recognized.
  // Both sets cover initial UUIDs — recentPostedUUIDs is a 2000-cap ring buffer
  // and could evict them after enough live writes; initialMessageUUIDs is the
  // unbounded fallback. Defense-in-depth; mirrors replBridge.ts.
  const recentPostedUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)
  const initialMessageUUIDs = new Set<string>()
  if (initialMessages) {
    for (const msg of initialMessages) {
      initialMessageUUIDs.add(msg.uuid)
      recentPostedUUIDs.add(msg.uuid)
    }
  }

  // Defensive dedup for re-delivered inbound prompts (seq-num negotiation
  // edge cases, server history replay after transport swap).
  const recentInboundUUIDs = new BoundedUUIDSet(cfg.uuid_dedup_buffer_size)

  // FlushGate: queue live writes while the history flush POST is in flight,
  // so the server receives [history..., live...] in order.
  const flushGate = new FlushGate<Message>()

  let initialFlushDone = false
  let tornDown = false
  // densable Tr / Fi / Xn / To / Vo — recovery ownership (not bare bool).
  const recoveryFlight = createRecoveryFlight()
  const authRecoveryInFlight = () => recoveryFlight.state.inFlight
  /**
   * densable 232 #39 — transport generation for onClose filtering.
   * Bumped when wiring a new transport; stale callbacks (old gen) are ignored
   * so rebuild/close of the previous transport cannot fail the session.
   */
  let transportGeneration = 0
  /**
   * densable Ei — close observed on the *current* generation while recovery
   * is in flight. Re-dispatched after recovery clears authRecoveryInFlight
   * so a new transport that dies mid-rebuild is not swallowed.
   */
  let deferredClose: DeferredClose | undefined
  // densable ms — leak ceiling for authRecoveryInFlight (Ls).
  const recoveryLeakCeilingMs = computeRecoveryLeakCeilingMs(cfg)
  // densable Ua / _o / Ws / Ba — recovery budgets.
  const heartbeatBudget = createHeartbeatRecoveryBudget()
  let recoveryBudgets: RecoveryBudgetCounters = {
    consecutiveRecoveries: 0,
    cred4094WithoutBeat: 0,
    epochStaleTimestamps: [],
  }
  // densable Ot() = tengu_bridge_recover_stale_epoch, default **false**.
  const recoverStaleEpochEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_bridge_recover_stale_epoch',
    false,
  )
  // densable ut() = tengu_bridge_recovery_patience, default true.
  const recoveryPatienceEnabled = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_bridge_recovery_patience',
    true,
  )
  /** densable ul() + th onConnect `_o=0` after a live transport is up. */
  function onHealthyTransport(): void {
    recoveryBudgets = noteRecoverySuccess(
      noteHealthyAuthBeat(recoveryBudgets, heartbeatBudget),
    )
  }
  // Latch for onUserMessage — flips true when the callback returns true
  // (policy says "done deriving"). sessionId is const (no re-create path —
  // rebuildTransport swaps JWT/epoch, same session), so no reset needed.
  let userMessageCallbackDone = !onUserMessage

  // Telemetry: why did onConnect fire? Set by rebuildTransport before
  // wireTransportCallbacks; read asynchronously by onConnect. Race-safe
  // because authRecoveryInFlight serializes rebuild callers, and a fresh
  // initEnvLessBridgeCore() call gets a fresh closure defaulting to 'initial'.
  let connectCause: ConnectCause = 'initial'

  // Deadline for onConnect after transport.connect(). Cleared by onConnect
  // (connected) and onClose (got a close — not silent). If neither fires
  // before cfg.connect_timeout_ms, onConnectTimeout emits — the only
  // signal for the `started → (silence)` gap.
  let connectDeadline: ReturnType<typeof setTimeout> | undefined
  function onConnectTimeout(cause: ConnectCause): void {
    if (tornDown) return
    logEvent('tengu_bridge_repl_connect_timeout', {
      v2: true,
      elapsed_ms: cfg.connect_timeout_ms,
      cause:
        cause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }

  // Mirror external metadata updates from the live REPL into the bridge's
  // CCR worker channel. Without this, proactive wait/sleep only changes local
  // UI state and the web session detail falls back to the generic working
  // spinner because automation_state never reaches remote-control.
  setSessionMetadataChangedListener(
    metadata => {
      if (tornDown) return
      transport.reportMetadata(metadata)
    },
    { replayCurrent: true },
  )

  // ── 5. JWT refresh scheduler ────────────────────────────────────────────
  // Schedule a callback 5min before expiry (per response.expires_in). On fire,
  // re-fetch /bridge with OAuth → rebuild transport with fresh credentials.
  // Each /bridge call bumps epoch server-side, so a JWT-only swap would leave
  // the old CCRClient heartbeating with a stale epoch → 409 within 20s.
  // JWT is opaque — do not decode.
  const refresh = createTokenRefreshScheduler({
    refreshBufferMs: cfg.token_refresh_buffer_ms,
    getAccessToken: async () => {
      // Unconditionally refresh OAuth before calling /bridge — getAccessToken()
      // returns expired tokens as non-null strings (doesn't check expiresAt),
      // so truthiness doesn't mean valid. Pass the stale token to onAuth401
      // so handleOAuth401Error's keychain-comparison can detect parallel refresh.
      const stale = getAccessToken()
      if (onAuth401) await onAuth401(stale ?? '')
      return getAccessToken() ?? stale
    },
    onRefresh: (sid, oauthToken) => {
      void (async () => {
        // Laptop wake: overdue proactive timer + SSE 401 fire ~simultaneously.
        // Claim the flag BEFORE the /bridge fetch so the other path skips
        // entirely — prevents double epoch bump (each /bridge call bumps; if
        // both fetch, the first rebuild gets a stale epoch and 409s).
        if (authRecoveryInFlight() || tornDown) {
          logForDebugging(
            '[remote-bridge] Recovery already in flight, skipping proactive refresh',
          )
          return
        }
        const flightGen = recoveryFlight.begin()
        try {
          const result = await withRetry(
            () =>
              fetchRemoteCredentials(
                sid,
                baseUrl,
                oauthToken,
                cfg.http_timeout_ms,
              ),
            'fetchRemoteCredentials (proactive)',
            cfg,
          )
          if (tornDown) return
          // densable: only rebuild on real creds; null/Hde/mdt skip (timer will retry)
          if (!isRemoteCredentials(result)) return
          const rebuilt = await rebuildTransport(result, 'proactive_refresh')
          if (rebuilt === 'suppressed_teleported') {
            if (!tornDown) {
              onStateChange?.('failed', SESSION_TELEPORTED_DETAIL)
            }
            return
          }
          // densable: _o / Ws reset on connect (th/ul), not at rebuild return.
          logForDebugging(
            '[remote-bridge] Transport rebuilt (proactive refresh)',
          )
        } catch (err) {
          logForDebugging(
            `[remote-bridge] Proactive refresh rebuild failed: ${errorMessage(err)}`,
            { level: 'error' },
          )
          logForDiagnosticsNoPII(
            'error',
            'bridge_repl_v2_proactive_refresh_failed',
          )
          if (!tornDown) {
            onStateChange?.('failed', `Refresh failed: ${errorMessage(err)}`)
          }
        } finally {
          recoveryFlight.endIfOwner(flightGen)
        }
      })()
    },
    label: 'remote',
  })
  refresh.scheduleFromExpiresIn(sessionId, credentials.expires_in)

  // ── 6. Wire callbacks (extracted so transport-rebuild can re-wire) ──────
  function wireTransportCallbacks(): void {
    transport.setOnConnect(() => {
      clearTimeout(connectDeadline)
      logForDebugging('[remote-bridge] v2 transport connected')
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_transport_connected')
      logEvent('tengu_bridge_repl_ws_connected', {
        v2: true,
        cause:
          connectCause as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      // densable th(): _o=0; densable ul() via onRequestAuthOk: Ws=0 + noteHealthyBeat.
      // Local transport has no separate auth-ok hook — onConnect is the live signal.
      onHealthyTransport()

      // densable: !ur && f.length > 0 && !Ge — skip flush when Ge (mint-after-gone).
      if (
        !initialFlushDone &&
        initialMessages &&
        initialMessages.length > 0 &&
        !skipInitialHistoryFlush
      ) {
        initialFlushDone = true
        // Capture current transport — if 401/teardown happens mid-flush,
        // the stale .finally() must not drain the gate or signal connected.
        // (Same guard pattern as replBridge.ts:1119.)
        const flushTransport = transport
        void flushHistory(initialMessages)
          .catch(e =>
            logForDebugging(`[remote-bridge] flushHistory failed: ${e}`),
          )
          .finally(() => {
            // authRecoveryInFlight catches the v1-vs-v2 asymmetry: v1 nulls
            // transport synchronously in setOnClose (replBridge.ts:1175), so
            // transport !== flushTransport trips immediately. v2 doesn't null —
            // transport reassigned only at rebuildTransport:346, 3 awaits deep.
            // authRecoveryInFlight is set synchronously at rebuildTransport entry.
            if (
              transport !== flushTransport ||
              tornDown ||
              authRecoveryInFlight()
            ) {
              return
            }
            drainFlushGate()
            onStateChange?.('connected')
          })
      } else if (!flushGate.active) {
        onStateChange?.('connected')
      }
    })

    transport.setOnData((data: string) => {
      handleIngressMessage(
        data,
        recentPostedUUIDs,
        recentInboundUUIDs,
        onInboundMessage,
        // Remote client answered the permission prompt — the turn resumes.
        // Without this the server stays on requires_action until the next
        // user message or turn-end result.
        onPermissionResponse
          ? res => {
              transport.reportState('running')
              onPermissionResponse(res)
            }
          : undefined,
        req =>
          handleServerControlRequest(req, {
            transport,
            sessionId,
            onInterrupt,
            onSetModel,
            onSetMaxThinkingTokens,
            onSetPermissionMode,
            onSetMcpPermissionModeOverride,
            outboundOnly,
          }),
      )
    })

    // Capture generation for this wiring; rebuild bumps generation so this
    // callback becomes stale and cannot fail the session mid-rebuild.
    const myGen = ++transportGeneration
    transport.setOnClose((code?: number, cause?: string) => {
      clearTimeout(connectDeadline)
      // densable Ls($t, Jr): SSE may only have code; classified closes pass Jr
      // (epoch_conflict / token_expired / …) via causeTypedCloseCodes path.
      handleTransportClose(code, cause, {
        staleTransport: myGen !== transportGeneration,
        reentry: false,
      })
    })
  }

  /**
   * densable Ls($t, Jr, qo=!1) — onClose disposition with leak ceiling + budgets.
   * Structure: defer/leak gate → kd budgets+nn → else epoch_stale+Ot → else fail.
   */
  function handleTransportClose(
    code: number | undefined,
    cause: string | undefined,
    opts: { staleTransport: boolean; reentry: boolean },
  ): boolean {
    if (tornDown) return false
    if (!opts.reentry) {
      logForDebugging(
        `[remote-bridge] v2 transport closed (code=${code}, gen=${transportGeneration})`,
      )
      logEvent('tengu_bridge_repl_ws_closed', {
        code,
        v2: true,
        // densable Co(Jr)
        close_cause: formatCloseCause(
          cause,
        ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        recovery_in_flight: authRecoveryInFlight(),
      })
    }

    // densable: stale transport (our gen filter) is local; densable has no gen.
    // Treat stale as ignore before Tr/leak handling.
    if (opts.staleTransport) return false

    const disposition = disposeTransportClose({
      tornDown,
      staleTransport: false,
      authRecoveryInFlight: authRecoveryInFlight(),
      code,
      recoveryStartedAtMs: recoveryFlight.state.startedAtMs,
      leakCeilingMs: recoveryLeakCeilingMs,
      // recover disposition is unused below — we re-check kd / epoch_stale
      isRecoverable: () => false,
    })

    if (disposition === 'ignore') return false

    if (disposition === 'defer') {
      // densable: Ei={code: $t??4092, cause: Jr}
      deferredClose = { code: code ?? 4092, cause }
      return false
    }

    if (disposition === 'leak') {
      // densable: held > ms → treating as leaked, Vo(), continue handle.
      // qo (reentry) still false here — 4093/4094 budgets still charge.
      const started = recoveryFlight.state.startedAtMs
      const held = started ? Date.now() - started : recoveryLeakCeilingMs
      logForDebugging(
        `[remote-bridge] authRecoveryInFlight held ${Math.round(held / 1000)}s (> ceiling ${Math.round(recoveryLeakCeilingMs / 1000)}s) — treating as leaked, handling close directly`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_repl_v2_recovery_flag_leaked')
      recoveryFlight.forceClear()
      deferredClose = undefined
    }

    // densable: if(kd($t)) { budgets; _o++; nn($t) }
    if (code !== undefined && isRecoverableCloseCode(code)) {
      const budget = evaluateRecoverableCloseBudgets({
        code,
        reentry: opts.reentry,
        counters: recoveryBudgets,
        heartbeatBudget,
        recoveryPatienceEnabled,
      })
      if (!budget.ok) {
        logForDebugging(`[remote-bridge] ${budget.message}`, {
          level: 'error',
        })
        logForDiagnosticsNoPII('error', budget.diagnostic)
        logEvent(
          budget.event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          budget.eventMeta ?? {},
        )
        if (!tornDown) onStateChange?.('failed', budget.message)
        return false
      }
      recoveryBudgets = budget.counters
      void recoverFromCloseCode(code, budget.delayMs)
      return false
    }

    // densable: else if 4090+epoch_stale+Ot() { Ba; _o++; nn(4090, jitter) }
    // SSE path has no cause today — without cause this branch never fires
    // (matches densable: Jr must be "epoch_stale").
    if (isEpochStaleRecoverableClose(code, cause, recoverStaleEpochEnabled)) {
      const budget = evaluateEpochStaleRecoveryBudget({
        counters: recoveryBudgets,
      })
      if (!budget.ok) {
        logForDebugging(`[remote-bridge] ${budget.message}`, {
          level: 'error',
        })
        logForDiagnosticsNoPII('error', budget.diagnostic)
        logEvent(
          budget.event as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          budget.eventMeta ?? {},
        )
        if (!tornDown) onStateChange?.('failed', budget.message)
        return false
      }
      recoveryBudgets = budget.counters
      void recoverFromCloseCode(4090, budget.delayMs)
      return false
    }

    // densable fail path
    onStateChange?.(
      'failed',
      `Transport closed (code ${code}${cause ? `, ${cause}` : ''})`,
    )
    return false
  }

  // ── 7. Transport rebuild (shared by proactive refresh + 401 recovery) ──
  // Every /bridge call bumps epoch server-side. Both refresh paths must
  // rebuild the transport with the new epoch — a JWT-only swap leaves the
  // old CCRClient heartbeating stale epoch → 409. SSE resumes from the old
  // transport's high-water-mark seq-num so no server-side replay.
  // Caller MUST set authRecoveryInFlight = true before calling (synchronously,
  // before any await) and clear it in a finally. This function doesn't manage
  // the flag — moving it here would be too late to prevent a double /bridge
  // fetch, and each fetch bumps epoch.
  /**
   * densable Xl — rebuild transport after fresh /bridge creds.
   * Returns `suppressed_teleported` when densable G7(Er) (session teleported).
   */
  async function rebuildTransport(
    fresh: RemoteCredentials,
    cause: Exclude<ConnectCause, 'initial'>,
  ): Promise<'rebuilt' | 'suppressed_teleported'> {
    // densable Xl: if(G7(Er)) return "suppressed_teleported"
    if (isTeleportedSessionId(sessionId)) {
      logForDebugging(
        `[remote-bridge] Rebuild suppressed for teleported session ${sessionId}`,
      )
      return 'suppressed_teleported'
    }
    connectCause = cause
    // Queue writes during rebuild — once /bridge returns, the old transport's
    // epoch is stale and its next write/heartbeat 409s. Without this gate,
    // writeMessages adds UUIDs to recentPostedUUIDs then writeBatch silently
    // no-ops (closed uploader after 409) → permanent silent message loss.
    flushGate.start()
    try {
      const seq = transport.getLastSequenceNum()
      // Invalidate old onClose callbacks before close (sse.close may not fire
      // onClose, but epoch-mismatch / hybrid paths can). Stale gen → ignore.
      // densable keeps Ei across rebuild; stale gen onClose is ignored so it
      // cannot overwrite deferredClose — do NOT clear Ei here.
      transportGeneration++
      transport.close()
      transport = await createV2ReplTransport({
        sessionUrl: buildCCRv2SdkUrl(fresh.api_base_url, sessionId),
        ingressToken: fresh.worker_jwt,
        sessionId,
        epoch: fresh.worker_epoch,
        heartbeatIntervalMs: cfg.heartbeat_interval_ms,
        heartbeatJitterFraction: cfg.heartbeat_jitter_fraction,
        initialSequenceNum: seq,
        getAuthToken: () => fresh.worker_jwt,
        outboundOnly,
      })
      if (tornDown) {
        // Teardown fired during the async createV2ReplTransport window.
        // Don't wire/connect/schedule — we'd re-arm timers after cancelAll()
        // and fire onInboundMessage into a torn-down bridge.
        transport.close()
        return 'rebuilt'
      }
      wireTransportCallbacks()
      transport.connect()
      connectDeadline = setTimeout(
        onConnectTimeout,
        cfg.connect_timeout_ms,
        connectCause,
      )
      refresh.scheduleFromExpiresIn(sessionId, fresh.expires_in)
      // Drain queued writes into the new uploader. Runs before
      // ccr.initialize() resolves (transport.connect() is fire-and-forget),
      // but the uploader serializes behind the initial PUT /worker. If
      // init fails (4091), events drop — but only recentPostedUUIDs
      // (per-instance) is populated, so re-enabling the bridge re-flushes.
      drainFlushGate()
      return 'rebuilt'
    } finally {
      // End the gate on failure paths too — drainFlushGate already ended
      // it on success. Queued messages are dropped (transport still dead).
      flushGate.drop()
    }
  }

  // ── 8. Close-code recovery (401 + densable 232 #39 remint table) ──────────
  async function recoverFromAuthFailure(): Promise<void> {
    return recoverFromCloseCode(401)
  }

  /**
   * densable nn / oa/kd recovery for close codes 401/4090/4091/4093/4094.
   *
   * densable shape:
   *   Xn claim → optional pre-delay → OAuth (needsOAuthRefresh) → /bridge
   *   → if null/reject + needsOAuth + first refresh failed: adopt-loop
   *     (oauth_retry_max_attempts × backoff+jitter, wait for fresh login)
   *   → remintCap loop only when fetchFailure==="retry" && ut() patience
   *   → Xl rebuild; To(gen) finally + re-dispatch Ei
   *
   * Optional delayMs = densable epoch_stale jitter (nn($t, Jr)).
   */
  async function recoverFromCloseCode(
    code: number,
    delayMs?: number,
  ): Promise<void> {
    // densable nn: if(G7(Er)){Ds("Session teleported to cloud");return}
    // before Tr / Xn claim.
    if (isTeleportedSessionId(sessionId)) {
      logForDebugging(
        `[remote-bridge] ${SESSION_TELEPORTED_DETAIL} — remint suppressed`,
      )
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_remint_loop_teleported')
      if (!tornDown) {
        onStateChange?.('failed', SESSION_TELEPORTED_DETAIL)
      }
      return
    }
    // densable: if(Tr)return; let wi=Xn()
    if (authRecoveryInFlight() || tornDown) return
    const flightGen = recoveryFlight.begin()
    const policy = CLOSE_CODE_RECOVERY[code] ?? CLOSE_CODE_RECOVERY[401]!
    onStateChange?.('reconnecting', policy.reconnectingDetail)
    logForDebugging(
      `[remote-bridge] ${code} on transport — attempting credential refresh + rebuild`,
    )
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_remint_loop_entered')
    const startedAt = Date.now()
    let remintAttempts = 0
    try {
      if (delayMs !== undefined && delayMs > 0) {
        await sleep(delayMs)
        if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        // densable remint loop mid-check G7(Er)
        if (isTeleportedSessionId(sessionId)) {
          logForDiagnosticsNoPII(
            'info',
            'bridge_repl_v2_remint_loop_teleported',
          )
          if (!tornDown) onStateChange?.('failed', SESSION_TELEPORTED_DETAIL)
          return
        }
      }

      // densable: first OAuth refresh when needsOAuthRefresh (m)
      let firstOAuthOk = true
      const staleBefore = getAccessToken()
      if (policy.needsOAuthRefresh && onAuth401) {
        try {
          firstOAuthOk = (await onAuth401(staleBefore ?? '')) !== false
        } catch (err) {
          firstOAuthOk = false
          logForDebugging(
            `[remote-bridge] ${code} recovery OAuth refresh threw: ${errorMessage(err)}`,
            { level: 'error' },
          )
        }
      }
      if (tornDown || recoveryFlight.state.activeGen !== flightGen) return

      let oauthToken = getAccessToken() ?? staleBefore
      if (!oauthToken) {
        logForDiagnosticsNoPII('error', 'bridge_repl_v2_remint_loop_no_oauth')
        if (!tornDown) {
          onStateChange?.(
            'failed',
            policy.needsOAuthRefresh
              ? 'JWT refresh failed: no OAuth token'
              : 'Remote credentials fetch failed: no OAuth token',
          )
        }
        return
      }

      // densable: first /bridge fetch (RFr/Me) — typed BridgeCredentialResult
      let result = await withRetry(
        () =>
          fetchRemoteCredentials(
            sessionId,
            baseUrl,
            oauthToken!,
            cfg.http_timeout_ms,
          ),
        `fetchRemoteCredentials (${policy.cause})`,
        cfg,
      )
      if (tornDown || recoveryFlight.state.activeGen !== flightGen) return

      // densable adopt-loop: (!tu||Hde(tu)) && needsOAuthRefresh && m && !Va
      // Hde = terminal:false oauth_rejected; null is transient (not Hde alone).
      if (
        (!result || isNonTerminalBridgeFailure(result)) &&
        policy.needsOAuthRefresh &&
        onAuth401 &&
        !firstOAuthOk
      ) {
        let adopted = false
        const maxAdopt = cfg.oauth_retry_max_attempts
        for (let mt = 1; mt <= maxAdopt && !tornDown; mt++) {
          onStateChange?.(
            'reconnecting',
            formatOAuthAdoptRetryStatus(mt, maxAdopt),
          )
          await sleep(
            oauthAdoptBackoffMs(
              mt,
              cfg.oauth_retry_base_delay_ms,
              cfg.init_retry_jitter_fraction,
            ),
          )
          if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
          let nextToken: string | undefined
          try {
            const ok = await onAuth401(staleBefore ?? '')
            const candidate = getAccessToken()
            if (
              ok !== false &&
              candidate !== undefined &&
              candidate !== (staleBefore ?? '')
            ) {
              nextToken = candidate
            }
          } catch (err) {
            logForDebugging(
              `[remote-bridge] Adopt-loop token read threw (attempt ${mt}): ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
          if (!nextToken) continue
          adopted = true
          oauthToken = nextToken
          result = await withRetry(
            () =>
              fetchRemoteCredentials(
                sessionId,
                baseUrl,
                oauthToken!,
                cfg.http_timeout_ms,
              ),
            'fetchRemoteCredentials (recovery re-poll)',
            cfg,
          )
          break
        }
        if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        if (isNonTerminalBridgeFailure(result) && !adopted) {
          if (!tornDown) {
            onStateChange?.('failed', OAUTH_REAUTH_REQUIRED_DETAIL)
            logForDiagnosticsNoPII(
              'error',
              'bridge_repl_v2_recovery_reauth_required',
            )
          }
          return
        }
      }

      // densable: Hde after adopt without refresh success → reauth required already handled.
      // densable: Hde && !needsOAuth && m → late OAuth refresh once.
      if (
        isNonTerminalBridgeFailure(result) &&
        !policy.needsOAuthRefresh &&
        onAuth401
      ) {
        let lateOk = false
        try {
          lateOk = (await onAuth401(staleBefore ?? '')) !== false
        } catch (err) {
          logForDebugging(
            `[remote-bridge] ${code} late OAuth refresh threw: ${errorMessage(err)}`,
            { level: 'error' },
          )
        }
        if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        if (lateOk) {
          result = await withRetry(
            () =>
              fetchRemoteCredentials(
                sessionId,
                baseUrl,
                getAccessToken() ?? staleBefore ?? '',
                cfg.http_timeout_ms,
              ),
            `fetchRemoteCredentials (${code} late refresh)`,
            cfg,
          )
          if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        }
      }

      // densable: Hde(tu) still soft-rejected → recovery_credentials_rejected
      if (isNonTerminalBridgeFailure(result)) {
        logForDiagnosticsNoPII(
          'error',
          'bridge_repl_v2_recovery_credentials_rejected',
        )
        if (!tornDown) {
          onStateChange?.('failed', OAUTH_REAUTH_REQUIRED_DETAIL)
        }
        return
      }

      // densable mdt — terminal credential failure
      if (isTerminalBridgeFailure(result)) {
        logForDiagnosticsNoPII(
          'error',
          'bridge_repl_v2_recovery_credentials_rejected',
        )
        if (!tornDown) {
          onStateChange?.(
            'failed',
            `Remote credentials rejected (${result.reason})`,
          )
        }
        return
      }

      // densable: remintCap only when fetchFailure==="retry" && ut()
      // When patience off, a single null fetch fails without multi-attempt remint.
      const remintCap =
        policy.fetchFailure === 'retry' && recoveryPatienceEnabled
          ? policy.remintCap
          : undefined
      const maxAttempts = remintCap?.attempts ?? 1

      // Transient null only — remint loop (rh). Failures already returned.
      while (
        !isRemoteCredentials(result) &&
        remintAttempts < maxAttempts &&
        !tornDown
      ) {
        remintAttempts++
        if (remintCap && remintAttempts > 1) {
          const elapsed = Date.now() - startedAt
          onStateChange?.(
            'reconnecting',
            formatRemintRetryStatus(remintAttempts, elapsed),
          )
          await sleep(remintBackoffMs(remintAttempts - 1))
          if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        } else if (!remintCap) {
          // terminal single-shot already failed
          break
        }

        if (policy.needsOAuthRefresh && onAuth401) {
          const stale = getAccessToken()
          try {
            await onAuth401(stale ?? '')
          } catch (err) {
            logForDebugging(
              `[remote-bridge] ${code} remint OAuth refresh threw: ${errorMessage(err)}`,
              { level: 'error' },
            )
          }
        }
        oauthToken = getAccessToken()
        if (!oauthToken) {
          logForDiagnosticsNoPII('error', 'bridge_repl_v2_remint_loop_no_oauth')
          if (!tornDown) {
            onStateChange?.(
              'failed',
              'Remote credentials fetch failed: no OAuth token',
            )
          }
          return
        }
        result = await withRetry(
          () =>
            fetchRemoteCredentials(
              sessionId,
              baseUrl,
              oauthToken!,
              cfg.http_timeout_ms,
            ),
          `fetchRemoteCredentials (${policy.cause})`,
          cfg,
        )
        if (tornDown || recoveryFlight.state.activeGen !== flightGen) return
        // densable remint loop: Hde/mdt abort; null continues
        if (
          isTerminalBridgeFailure(result) ||
          isNonTerminalBridgeFailure(result)
        ) {
          logForDiagnosticsNoPII(
            'error',
            'bridge_repl_v2_recovery_credentials_rejected',
          )
          if (!tornDown) {
            onStateChange?.(
              'failed',
              isTerminalBridgeFailure(result)
                ? `Remote credentials rejected (${result.reason})`
                : OAUTH_REAUTH_REQUIRED_DETAIL,
            )
          }
          return
        }
        if (isRemoteCredentials(result)) break
        if (!remintCap) break
      }

      if (isRemoteCredentials(result)) {
        // densable: await Xl(...)==="suppressed_teleported" → Ds teleported
        if (isTeleportedSessionId(sessionId)) {
          logForDiagnosticsNoPII(
            'info',
            'bridge_repl_v2_remint_loop_teleported',
          )
          if (!tornDown) onStateChange?.('failed', SESSION_TELEPORTED_DETAIL)
          return
        }
        initialFlushDone = false
        const rebuilt = await rebuildTransport(
          result,
          code === 401 ? 'auth_401_recovery' : 'proactive_refresh',
        )
        if (rebuilt === 'suppressed_teleported') {
          if (!tornDown) onStateChange?.('failed', SESSION_TELEPORTED_DETAIL)
          return
        }
        // densable: _o=0 on connect (th), not at rebuild return.
        const attemptLabel = Math.max(1, remintAttempts)
        logForDebugging(
          `[remote-bridge] Transport rebuilt after ${code} (attempt ${attemptLabel})`,
        )
        logForDiagnosticsNoPII('info', policy.recoveredCode)
        logEvent(
          policy.recoveredCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          remintAttempts > 0
            ? {
                remint_attempts: attemptLabel,
              }
            : {},
        )
        return
      }

      // terminal fail or remint exhausted
      if (!remintCap) {
        logForDiagnosticsNoPII('error', policy.failureDiagnostic)
        if (!tornDown) {
          onStateChange?.(
            'failed',
            code === 401
              ? 'JWT refresh failed after 401'
              : `could not fetch fresh session credentials after code ${code}`,
          )
        }
        return
      }

      const elapsed = Date.now() - startedAt
      const detail = remintCap.exhaustedDetail ?? REMINT_EXHAUSTED_DETAIL
      logForDebugging(
        `[remote-bridge] ${formatRemintExhaustedMessage(code, remintAttempts, elapsed, detail)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', 'bridge_repl_v2_remint_loop_exhausted')
      logEvent('tengu_bridge_repl_v2_remint_loop_exhausted', {
        code,
        attempts: remintAttempts,
        elapsed_ms: elapsed,
      })
      if (!tornDown) {
        onStateChange?.(
          'failed',
          formatRemintExhaustedMessage(code, remintAttempts, elapsed, detail),
        )
      }
    } catch (err) {
      logForDebugging(
        `[remote-bridge] ${code} recovery failed: ${errorMessage(err)}`,
        { level: 'error' },
      )
      logForDiagnosticsNoPII('error', policy.failureDiagnostic)
      if (!tornDown) {
        onStateChange?.(
          'failed',
          `Transport recovery failed (${code}): ${errorMessage(err)}`,
        )
      }
    } finally {
      // densable To(wi): only owner clears; then re-dispatch Ei
      if (recoveryFlight.endIfOwner(flightGen)) {
        if (!tornDown && deferredClose !== undefined) {
          const deferred = deferredClose
          deferredClose = undefined
          handleTransportClose(deferred.code, deferred.cause, {
            staleTransport: false,
            reentry: true,
          })
        }
      }
    }
  }

  wireTransportCallbacks()

  // Start flushGate BEFORE connect so writeMessages() during handshake
  // queues instead of racing the history POST. densable Ge: no initial
  // history flush after mint-from-gone — leave gate inactive so connect
  // can signal connected without waiting on a flush that will not run.
  if (
    initialMessages &&
    initialMessages.length > 0 &&
    !skipInitialHistoryFlush
  ) {
    flushGate.start()
  }
  transport.connect()
  connectDeadline = setTimeout(
    onConnectTimeout,
    cfg.connect_timeout_ms,
    connectCause,
  )

  // ── 8. History flush + drain helpers ────────────────────────────────────
  function drainFlushGate(): void {
    const msgs = flushGate.end()
    if (msgs.length === 0) return
    for (const msg of msgs) recentPostedUUIDs.add(msg.uuid)
    const events: TransportMessage[] = toSDKMessages(msgs).map(m => ({
      ...m,
      session_id: sessionId,
    })) as TransportMessage[]
    if (shouldReportRunningForMessages(msgs)) {
      transport.reportState('running')
    }
    logForDebugging(
      `[remote-bridge] Drained ${msgs.length} queued message(s) after flush`,
    )
    void transport.writeBatch(events as StdoutMessage[])
  }

  async function flushHistory(msgs: Message[]): Promise<void> {
    // v2 always creates a fresh server session (unconditional createCodeSession
    // above) — no session reuse, no double-post risk. Unlike v1, we do NOT
    // filter by previouslyFlushedUUIDs: that set persists across REPL enable/
    // disable cycles (useRef), so it would wrongly suppress history on re-enable.
    const eligible = msgs.filter(isEligibleBridgeMessage)
    const capped =
      initialHistoryCap > 0 && eligible.length > initialHistoryCap
        ? eligible.slice(-initialHistoryCap)
        : eligible
    if (capped.length < eligible.length) {
      logForDebugging(
        `[remote-bridge] Capped initial flush: ${eligible.length} -> ${capped.length} (cap=${initialHistoryCap})`,
      )
    }
    const events: TransportMessage[] = toSDKMessages(capped).map(m => ({
      ...m,
      session_id: sessionId,
    })) as TransportMessage[]
    if (events.length === 0) return
    // Mid-turn init: if Remote Control is enabled while a query is running,
    // the last eligible message may be a real user prompt or tool_result.
    // Hidden slash-command scaffolding and pure reminder wrappers should not
    // resurrect a completed turn into "running". Check eligible (pre-cap),
    // not capped: the cap may truncate to a user message even when the actual
    // trailing message is assistant.
    const lastEligible = eligible.at(-1)
    if (lastEligible && shouldReportRunningForMessage(lastEligible)) {
      transport.reportState('running')
    }
    logForDebugging(`[remote-bridge] Flushing ${events.length} history events`)
    await transport.writeBatch(events as StdoutMessage[])
  }

  // ── 9. Teardown ───────────────────────────────────────────────────────────
  // On SIGINT/SIGTERM/⁠/exit, gracefulShutdown races runCleanupFunctions()
  // against a 2s cap before forceExit kills the process. Budget accordingly:
  //   - archive: teardown_archive_timeout_ms (default 1500, cap 2000)
  //   - result write: fire-and-forget, archive latency covers the drain
  //   - 401 retry: only if first archive 401s, shares the same budget
  // densable To/Ks: skipArchive → idle/result + close, no archive
  // (left-arrow rit reattach).
  let teardownPromise: Promise<void> | undefined
  let skipArchiveLatch = false
  let teardownReason: string | undefined
  async function teardown(opts?: ReplBridgeTeardownOpts): Promise<void> {
    if (opts?.skipArchive) skipArchiveLatch = true
    if (opts?.reason) teardownReason = opts.reason
    if (teardownPromise) return teardownPromise
    tornDown = true
    teardownPromise = runTeardown()
    return teardownPromise
  }
  async function runTeardown(): Promise<void> {
    refresh.cancelAll()
    clearTimeout(connectDeadline)
    flushGate.drop()

    // densable Ks: idle → optional mzu(reason) → qls(result) → skip or archive.
    transport.reportState('idle')
    if (teardownReason !== undefined) {
      const reasonMsg = {
        ...makeWorkerShuttingDownMessage(sessionId, teardownReason),
        session_id: sessionId,
      } as unknown as TransportMessage
      void transport.write(reasonMsg as StdoutMessage)
    }
    const resultMsg = {
      ...makeResultMessage(sessionId),
      session_id: sessionId,
    } as unknown as TransportMessage
    void transport.write(resultMsg as StdoutMessage)

    // densable Ks Kr: skipArchive → flush(300) only when reason set + close; no archive.
    // Leave CXr meta so child/re-init can wXr (hook kEo on left-arrow Rt).
    if (skipArchiveLatch) {
      try {
        const seq = transport.getLastSequenceNum()
        // Partial CXr (seq + grouping) — merge retains noHistoryBackfill / owner
        // stamped at connect so same-process wXr reattach keeps #5 suppress (C1).
        saveBridgeSessionMeta(sessionId, seq, {
          groupingId: sessionGroupingId,
        })
      } catch {
        /* best-effort CXr */
      }
      // densable: if (eo!==void 0) await Promise.race([flush, 300])
      if (teardownReason !== undefined) {
        try {
          await Promise.race([
            transport.flush?.() ?? Promise.resolve(),
            sleep(300),
          ])
        } catch {
          /* best-effort */
        }
      }
      transport.close()
      logForDebugging(
        `[remote-bridge] Teardown complete (skipArchive): session=${sessionId}`,
      )
      logForDiagnosticsNoPII('info', 'bridge_repl_v2_teardown')
      logEvent(
        feature('CCR_MIRROR') && outboundOnly
          ? 'tengu_ccr_mirror_teardown'
          : 'tengu_bridge_repl_teardown',
        {
          v2: true,
          archive_status:
            'skipped_teleport' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          archive_ok: false,
        },
      )
      return
    }

    // Full teardown: densable kEo — clear in-process bridge meta + mint-time cse_*.
    clearBridgeSessionMeta()
    clearAbandonedBridgeSessionId()

    let token = getAccessToken()
    let status = await archiveSession(
      sessionId,
      baseUrl,
      token,
      orgUUID,
      cfg.teardown_archive_timeout_ms,
    )

    // Token is usually fresh (refresh scheduler runs 5min before expiry) but
    // laptop-wake past the refresh window leaves getAccessToken() returning a
    // stale string. Retry once on 401 — onAuth401 (= handleOAuth401Error)
    // clears keychain cache + force-refreshes. No proactive refresh on the
    // happy path: handleOAuth401Error force-refreshes even valid tokens,
    // which would waste budget 99% of the time. try/catch mirrors
    // recoverFromAuthFailure: keychain reads can throw (macOS locked after
    // wake); an uncaught throw here would skip transport.close + telemetry.
    if (status === 401 && onAuth401) {
      try {
        await onAuth401(token ?? '')
        token = getAccessToken()
        status = await archiveSession(
          sessionId,
          baseUrl,
          token,
          orgUUID,
          cfg.teardown_archive_timeout_ms,
        )
      } catch (err) {
        logForDebugging(
          `[remote-bridge] Teardown 401 retry threw: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }
    }

    transport.close()

    const archiveStatus: ArchiveTelemetryStatus =
      status === 'no_token'
        ? 'skipped_no_token'
        : status === 'timeout' || status === 'error'
          ? 'network_error'
          : status >= 500
            ? 'server_5xx'
            : status >= 400
              ? 'server_4xx'
              : 'ok'

    logForDebugging(`[remote-bridge] Torn down (archive=${status})`)
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_teardown')
    logEvent(
      feature('CCR_MIRROR') && outboundOnly
        ? 'tengu_ccr_mirror_teardown'
        : 'tengu_bridge_repl_teardown',
      {
        v2: true,
        archive_status:
          archiveStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        archive_ok: typeof status === 'number' && status < 400,
        archive_http_status: typeof status === 'number' ? status : undefined,
        archive_timeout: status === 'timeout',
        archive_no_token: status === 'no_token',
      },
    )
  }
  const unregister = registerCleanup(() => teardown())

  if (feature('CCR_MIRROR') && outboundOnly) {
    logEvent('tengu_ccr_mirror_started', {
      v2: true,
      expires_in_s: credentials.expires_in,
    })
  } else {
    logEvent('tengu_bridge_repl_started', {
      has_initial_messages: !!(initialMessages && initialMessages.length > 0),
      v2: true,
      expires_in_s: credentials.expires_in,
      inProtectedNamespace: isInProtectedNamespace(),
    })
  }

  // ── 10. Handle ──────────────────────────────────────────────────────────
  // densable CXr: seed process meta so re-init / wXr can reattach without
  // REATTACH env (same-process disable→enable). skipArchive leaves this set.
  const effectiveGrouping = sessionGroupingId
  // densable CXr stamps owner uuids from live OAuth when available (sEe owner fields).
  let ownerAccountUuid: string | undefined
  let ownerOrganizationUuid: string | undefined
  try {
    const { getOauthAccountInfo } = await import('../utils/auth.js')
    const acct = getOauthAccountInfo()
    ownerAccountUuid = acct?.accountUuid || undefined
    ownerOrganizationUuid = acct?.organizationUuid || undefined
  } catch {
    // optional
  }
  saveBridgeSessionMeta(
    sessionId,
    isReattaching ? (reattachSequenceNum ?? 0) : 0,
    {
      groupingId: effectiveGrouping,
      // densable 2.1.225 #7 / 2.1.228 #5 — mint-after-gone + NO_BACKFILL.
      ...(skipInitialHistoryFlush ? { noHistoryBackfill: true } : {}),
      ...(ownerAccountUuid ? { ownerAccountUuid } : {}),
      ...(ownerOrganizationUuid ? { ownerOrganizationUuid } : {}),
    },
  )

  // densable Qt: sessionGroupingId:He, outboundOnly:B??!1,
  // getLastSequenceNum, flush for left-arrow rit CLAUDE_BRIDGE_REATTACH_SEQ.
  // outboundOnly must be a boolean on the handle so left-arrow rit() sees
  // false (omit env) when unset — not undefined (local rit treated as true).
  // densable noHistoryBackfill:a||tr — mint-after-gone / q5o sets Ge.
  return {
    bridgeSessionId: sessionId,
    environmentId: '',
    sessionIngressUrl: credentials.api_base_url,
    outboundOnly: outboundOnly ?? false,
    // densable He — pass-through from params / reattach bootstrap when present.
    sessionGroupingId: effectiveGrouping,
    // densable 2.1.225 #7 / 2.1.228 #5 — suppress history flush + compact re-upload.
    noHistoryBackfill: skipInitialHistoryFlush || undefined,
    getLastSequenceNum() {
      return transport.getLastSequenceNum()
    },
    getSSESequenceNum() {
      return transport.getLastSequenceNum()
    },
    flush() {
      return transport.flush?.() ?? Promise.resolve()
    },
    writeMessages(messages) {
      const filtered = messages.filter(
        m =>
          isEligibleBridgeMessage(m) &&
          !initialMessageUUIDs.has(m.uuid) &&
          !recentPostedUUIDs.has(m.uuid),
      )
      if (filtered.length === 0) return

      // Fire onUserMessage for title derivation. Scan before the flushGate
      // check — prompts are title-worthy even if they queue. Keeps calling
      // on every title-worthy message until the callback returns true; the
      // caller owns the policy (derive at 1st and 3rd, skip if explicit).
      if (!userMessageCallbackDone) {
        for (const m of filtered) {
          const text = extractTitleText(m)
          if (text !== undefined && onUserMessage?.(text, sessionId)) {
            userMessageCallbackDone = true
            break
          }
        }
      }

      if (flushGate.enqueue(...filtered)) {
        logForDebugging(
          `[remote-bridge] Queued ${filtered.length} message(s) during flush`,
        )
        return
      }

      for (const msg of filtered) recentPostedUUIDs.add(msg.uuid)
      const events: TransportMessage[] = toSDKMessages(filtered).map(m => ({
        ...m,
        session_id: sessionId,
      })) as TransportMessage[]
      // v2 does not derive worker_status from events server-side (unlike v1
      // session-ingress session_status_updater.go). Push it from here so the
      // CCR web session list shows Running instead of stuck on Idle. Only
      // work-starting user messages mark turn start; hidden local-command
      // scaffolding and pure reminders should not re-open a completed turn.
      // CCRClient.reportState dedupes consecutive same-state pushes.
      if (shouldReportRunningForMessages(filtered)) {
        transport.reportState('running')
      }
      logForDebugging(`[remote-bridge] Sending ${filtered.length} message(s)`)
      void transport.writeBatch(events as StdoutMessage[])
    },
    writeSdkMessages(messages: SDKMessage[]) {
      const filtered = messages.filter(
        m => !m.uuid || !recentPostedUUIDs.has(m.uuid as string),
      )
      if (filtered.length === 0) return
      for (const msg of filtered) {
        if (msg.uuid) recentPostedUUIDs.add(msg.uuid as string)
      }
      const events = filtered.map(m => ({
        ...m,
        session_id: sessionId,
      })) as StdoutMessage[]
      void transport.writeBatch(events)
    },
    sendControlRequest(request: SDKControlRequest) {
      if (authRecoveryInFlight()) {
        logForDebugging(
          `[remote-bridge] Dropping control_request during 401 recovery: ${request.request_id}`,
        )
        return
      }
      const event: TransportMessage = {
        ...request,
        session_id: sessionId,
      } as TransportMessage
      if (
        (request as { request?: { subtype?: string } }).request?.subtype ===
        'can_use_tool'
      ) {
        transport.reportState('requires_action')
      }
      void transport.write(event as StdoutMessage)
      logForDebugging(
        `[remote-bridge] Sent control_request request_id=${request.request_id}`,
      )
    },
    sendControlResponse(response: SDKControlResponse) {
      if (authRecoveryInFlight()) {
        logForDebugging(
          '[remote-bridge] Dropping control_response during 401 recovery',
        )
        return
      }
      const event: TransportMessage = {
        ...response,
        session_id: sessionId,
      } as TransportMessage
      transport.reportState('running')
      void transport.write(event as StdoutMessage)
      logForDebugging('[remote-bridge] Sent control_response')
    },
    sendControlCancelRequest(requestId: string) {
      if (authRecoveryInFlight()) {
        logForDebugging(
          `[remote-bridge] Dropping control_cancel_request during 401 recovery: ${requestId}`,
        )
        return
      }
      const event: TransportMessage = {
        type: 'control_cancel_request' as const,
        request_id: requestId,
        session_id: sessionId,
      } as TransportMessage
      // Hook/classifier/channel/recheck resolved the permission locally —
      // interactiveHandler calls only cancelRequest (no sendResponse) on
      // those paths, so without this the server stays on requires_action.
      transport.reportState('running')
      void transport.write(event as StdoutMessage)
      logForDebugging(
        `[remote-bridge] Sent control_cancel_request request_id=${requestId}`,
      )
    },
    sendResult() {
      if (authRecoveryInFlight()) {
        logForDebugging('[remote-bridge] Dropping result during 401 recovery')
        return
      }
      transport.reportState('idle')
      const resultMsg = {
        ...makeResultMessage(sessionId),
        session_id: sessionId,
      } as unknown as TransportMessage
      void transport.write(resultMsg as StdoutMessage)
      logForDebugging(`[remote-bridge] Sent result`)
    },
    async teardown(opts?: ReplBridgeTeardownOpts) {
      unregister()
      await teardown(opts)
    },
  }
}

// ─── Session API (v2 /code/sessions, no env) ─────────────────────────────────

/**
 * Retry an async init call with exponential backoff + jitter.
 * densable RFr: only **null** (transient) is retried. Terminal/oauth_rejected
 * objects and success values return immediately.
 */
async function withRetry<T>(
  fn: () => Promise<T | null>,
  label: string,
  cfg: EnvLessBridgeConfig,
): Promise<T | null> {
  const max = cfg.init_retry_max_attempts
  for (let attempt = 1; attempt <= max; attempt++) {
    const result = await fn()
    if (result !== null) return result
    if (attempt < max) {
      const base = cfg.init_retry_base_delay_ms * 2 ** (attempt - 1)
      const jitter =
        base * cfg.init_retry_jitter_fraction * (2 * Math.random() - 1)
      const delay = Math.min(base + jitter, cfg.init_retry_max_delay_ms)
      logForDebugging(
        `[remote-bridge] ${label} failed (attempt ${attempt}/${max}), retrying in ${Math.round(delay)}ms`,
      )
      await sleep(delay)
    }
  }
  return null
}

// Moved to codeSessionApi.ts so the SDK /bridge subpath can bundle them
// without pulling in this file's heavy CLI tree (analytics, transport).
export {
  createCodeSession,
  unarchiveCodeSession,
  type RemoteCredentials,
  type BridgeCredentialResult,
  isRemoteCredentials,
  isNonTerminalBridgeFailure,
  isTerminalBridgeFailure,
} from './codeSessionApi.js'
import {
  createCodeSession,
  fetchRemoteCredentials as fetchRemoteCredentialsRaw,
  isNonTerminalBridgeFailure,
  isRemoteCredentials,
  isTerminalBridgeFailure,
  type BridgeCredentialResult,
  type RemoteCredentials,
  unarchiveCodeSession,
} from './codeSessionApi.js'
import { getBridgeBaseUrlOverride } from './bridgeConfig.js'

// CLI-side wrapper that applies the CLAUDE_BRIDGE_BASE_URL dev override and
// injects the trusted-device token (both are env/GrowthBook reads that the
// SDK-facing codeSessionApi.ts export must stay free of).
export async function fetchRemoteCredentials(
  sessionId: string,
  baseUrl: string,
  accessToken: string,
  timeoutMs: number,
): Promise<BridgeCredentialResult> {
  const creds = await fetchRemoteCredentialsRaw(
    sessionId,
    baseUrl,
    accessToken,
    timeoutMs,
    getTrustedDeviceToken(),
  )
  if (!isRemoteCredentials(creds)) return creds
  return getBridgeBaseUrlOverride()
    ? { ...creds, api_base_url: baseUrl }
    : creds
}

type ArchiveStatus = number | 'timeout' | 'error' | 'no_token'

// Single categorical for BQ `GROUP BY archive_status`. The booleans on
// _teardown predate this and are redundant with it (except archive_timeout,
// which distinguishes ECONNABORTED from other network errors — both map to
// 'network_error' here since the dominant cause in a 1.5s window is timeout).
type ArchiveTelemetryStatus =
  | 'ok'
  | 'skipped_no_token'
  | 'network_error'
  | 'server_4xx'
  | 'server_5xx'
  | 'skipped_teleport'

/**
 * densable $Xg unarchive outcome for reattach.
 * - ok: 2xx or 409 (already active)
 * - gone: invalid id / 400 / 403 / 404 — mint fresh session
 * - null: transient failure — still try /bridge
 */
type UnarchiveOutcome =
  | { outcome: 'ok' }
  | { outcome: 'gone'; status: number | 'invalid' }
  | null

async function unarchiveSession(
  sessionId: string,
  baseUrl: string,
  accessToken: string | undefined,
  orgUUID: string,
  timeoutMs: number,
): Promise<UnarchiveOutcome> {
  // densable $Xg: missing token → treat as ok (skip unarchive).
  if (!accessToken) return { outcome: 'ok' }
  const status = await unarchiveCodeSession(
    sessionId,
    baseUrl,
    accessToken,
    orgUUID,
    timeoutMs,
    getTrustedDeviceToken(),
  )
  if (status === 'invalid') {
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_unarchive_invalid_id')
    return { outcome: 'gone', status: 'invalid' }
  }
  if (typeof status !== 'number') {
    logForDiagnosticsNoPII('info', 'bridge_repl_v2_unarchive_failed')
    return null
  }
  const ok = status < 300 || status === 409
  logForDiagnosticsNoPII(
    'info',
    ok ? 'bridge_repl_v2_unarchive_ok' : 'bridge_repl_v2_unarchive_failed',
  )
  if (ok) return { outcome: 'ok' }
  if (status === 400 || status === 403 || status === 404) {
    return { outcome: 'gone', status }
  }
  return null
}

async function archiveSession(
  sessionId: string,
  baseUrl: string,
  accessToken: string | undefined,
  orgUUID: string,
  timeoutMs: number,
): Promise<ArchiveStatus> {
  if (!accessToken) return 'no_token'
  // Archive lives at the compat layer (/v1/sessions/*, not /v1/code/sessions).
  // compat.parseSessionID only accepts TagSession (session_*), so retag cse_*.
  // anthropic-beta + x-organization-uuid are required — without them the
  // compat gateway 404s before reaching the handler.
  //
  // Unlike bridgeMain.ts (which caches compatId in sessionCompatIds to keep
  // in-memory titledSessions/logger keys consistent across a mid-session
  // gate flip), this compatId is only a server URL path segment — no
  // in-memory state. Fresh compute matches whatever the server currently
  // validates: if the gate is OFF, the server has been updated to accept
  // cse_* and we correctly send it.
  const compatId = toCompatSessionId(sessionId)
  let status: ArchiveStatus
  try {
    const response = await axios.post(
      `${baseUrl}/v1/sessions/${compatId}/archive`,
      {},
      {
        headers: {
          ...oauthHeaders(accessToken),
          'anthropic-beta': 'ccr-byoc-2025-07-29',
          'x-organization-uuid': orgUUID,
        },
        timeout: timeoutMs,
        validateStatus: () => true,
      },
    )
    logForDebugging(
      `[remote-bridge] Archive ${compatId} status=${response.status}`,
    )
    status = response.status
  } catch (err) {
    const msg = errorMessage(err)
    logForDebugging(`[remote-bridge] Archive failed: ${msg}`)
    status =
      axios.isAxiosError(err) && err.code === 'ECONNABORTED'
        ? 'timeout'
        : 'error'
  }
  // densable Zxr: if(Npa(s))BLp(e) — drop placeholder map entry on success.
  if (isArchiveSuccessStatus(status)) {
    void removeBridgePlaceholder(sessionId)
  }
  return status
}
