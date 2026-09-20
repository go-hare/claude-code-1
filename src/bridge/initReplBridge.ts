/**
 * REPL-specific wrapper around initBridgeCore. Owns the parts that read
 * bootstrap state — gates, cwd, session ID, git context, OAuth, title
 * derivation — then delegates to the bootstrap-free core.
 *
 * Split out of replBridge.ts because the sessionStorage import
 * (getCurrentSessionTitle) transitively pulls in src/commands.ts → the
 * entire slash command + React component tree (~1300 modules). Keeping
 * initBridgeCore in a file that doesn't touch sessionStorage lets
 * daemonBridge.ts import the core without bloating the Agent SDK bundle.
 *
 * Called via dynamic import by useReplBridge (auto-start) and print.ts
 * (SDK -p mode via query.enableRemoteControl).
 */

import { feature } from 'bun:bundle'
import { hostname } from 'os'
import { basename } from 'path'
import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'
import type { SDKMessage } from '../entrypoints/agentSdkTypes.js'
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js'
import {
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_WITH_REFRESH,
} from '../services/analytics/growthbook.js'
import { getOrganizationUUID } from '../services/oauth/client.js'
import {
  isPolicyAllowed,
  waitForPolicyLimitsToLoad,
} from '../services/policyLimits/index.js'
import type { Message } from '../types/message.js'
import type { ContentBlockParam } from '@anthropic-ai/sdk/resources/index.js'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  getOauthAccountInfoFromDisk,
  handleOAuth401Error,
} from '../utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from '../utils/config.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { stripDisplayTagsAllowEmpty } from '../utils/displayTags.js'
import { isEnvTruthy } from '../utils/envUtils.js'
import { getBranch, getRemoteUrl } from '../utils/git.js'
import { toSDKMessages } from '../utils/messages/mappers.js'
import {
  getContentText,
  getMessagesAfterCompactBoundary,
  isSyntheticMessage,
} from '../utils/messages.js'
import type { PermissionMode } from '../utils/permissions/PermissionMode.js'
import {
  clearBridgeSession,
  getCurrentSessionAiTitle,
  getCurrentSessionBridge,
  getCurrentSessionTitle,
  getForeignBoundSid,
  getProject,
  getTranscriptPathForSession,
  isForeignSessionBinding,
  clearScanUncertaintyHoldSid,
  isKnownTaintedSession,
  isPrecautionarySuppressed,
  isSessionHistorySuppressed,
  applyScanPrecautionHold,
  releaseScanPrecautionHold,
  probeActiveSessionHistorySuppression,
  isScanUncertaintyHeld,
  markPrecautionarySessionSuppression,
  markResilientPrecautionSid,
  markSessionHistorySuppressed,
  saveAgentName,
  saveCustomTitle,
  shouldSuppressSessionTitleHistory,
  writeHistorySuppression,
} from '../utils/sessionStorage.js'
import { startTranscriptPersistenceBackfill } from '../utils/sessionPersistenceSync.js'
import { applyLeftoverS8nUserName } from '../utils/sessionNameUniqueness.js'
import { getPinnedStorageV5 } from '../utils/storageV5/index.js'
import {
  extractConversationText,
  generateSessionTitle,
} from '../utils/sessionTitle.js'
import { sanitizeSessionTitle } from '../utils/sessionTitleSanitize.js'
import { isTeammate } from '../utils/teammate.js'
import { generateShortWordSlug } from '../utils/words.js'
import {
  getBridgeAccessToken,
  getBridgeBaseUrl,
  getBridgeTokenOverride,
  isSelfHostedBridge,
} from './bridgeConfig.js'
import {
  checkBridgeMinVersion,
  isBridgeEnabledBlocking,
  isCseShimEnabled,
  isEnvLessBridgeEnabled,
} from './bridgeEnabled.js'
import {
  archiveBridgeSession,
  createBridgeSession,
  getBridgeSession,
} from './createSession.js'
import { createTitleWriteScheduler } from './titleWriteScheduler.js'
import { getPersistedBridgeSession } from './bridgeSessionMeta.js'
import { HOST_ACCOUNT_CHANGED_HINT } from './hostSignedOut.js'
import { logBridgeSkip } from './debugUtils.js'
import { checkEnvLessBridgeMinVersion } from './envLessBridgeConfig.js'
import { getPollIntervalConfig } from './pollConfig.js'
import type { BridgeState, ReplBridgeHandle } from './replBridge.js'
import { createOnGetWorkspaceDiff } from './createOnGetWorkspaceDiff.js'
import { initBridgeCore } from './replBridge.js'
import { setCseShimGate, toCompatSessionId } from './sessionIdCompat.js'
import type { BridgeWorkerType } from './types.js'

export type InitBridgeOptions = {
  onInboundMessage?: (msg: SDKMessage) => void | Promise<void>
  onPermissionResponse?: (response: SDKControlResponse) => void
  onInterrupt?: () => void
  onStopTask?: (taskId: string) => Promise<unknown>
  onSetModel?: (
    model: string | undefined,
    // biome-ignore lint/suspicious/noConfusingVoidType: load-bearing, see bridgeMessaging.ts
  ) => void | { ok: true } | { ok: false; error: string }
  onSetMaxThinkingTokens?: (maxTokens: number | null) => void
  onSetPermissionMode?: (
    mode: PermissionMode,
  ) => { ok: true } | { ok: false; error: string }
  onSetMcpPermissionModeOverride?: (
    serverName: string,
    mode: string | null,
  ) => { ok: true; warning?: string } | { ok: false; error: string }
  onStateChange?: (
    state: BridgeState,
    detail?: string,
    kind?: 'auth' | 'terminal',
  ) => void
  initialMessages?: Message[]
  // Explicit session name from `/remote-control <name>`. When set, overrides
  // the title derived from the conversation or /rename.
  initialName?: string
  // Fresh view of the full conversation at call time. Used by onUserMessage's
  // count-3 derivation to call generateSessionTitle over the full conversation.
  // Optional — print.ts's SDK enableRemoteControl path has no REPL message
  // array; count-3 falls back to the single message text when absent.
  getMessages?: () => Message[]
  // UUIDs already flushed in a prior bridge session. Messages with these
  // UUIDs are excluded from the initial flush to avoid poisoning the
  // server (duplicate UUIDs across sessions cause the WS to be killed).
  // Mutated in place — newly flushed UUIDs are added after each flush.
  previouslyFlushedUUIDs?: Set<string>
  /** See BridgeCoreParams.perpetual. */
  perpetual?: boolean
  /**
   * When true, the bridge only forwards events outbound (no SSE inbound
   * stream). Used by CCR mirror mode — local sessions visible on claude.ai
   * without enabling inbound control.
   */
  outboundOnly?: boolean
  tags?: string[]
  /**
   * densable reattachSessionId (P/q) — optional explicit reattach override.
   * Env CLAUDE_BRIDGE_REATTACH_SESSION takes precedence and is consumed
   * (deleted) when present so child re-init does not loop.
   */
  reattachSessionId?: string
  /**
   * densable reattachOrFail (Si / ae) — hook/revive pin; owner-match may set it.
   */
  reattachOrFail?: boolean
  /**
   * densable reattachSequenceNum (O/V) — high-water for SSE resume.
   * Env CLAUDE_BRIDGE_REATTACH_SEQ overrides when REATTACH_SESSION is set.
   */
  reattachSequenceNum?: number
  /**
   * densable sessionGroupingId (k/Q) — project grouping for create + rit.
   * Env CLAUDE_BRIDGE_REATTACH_GROUPING used when reattaching from env.
   */
  sessionGroupingId?: string
  /**
   * densable 2.1.243 #58 `localHolderGuard` — when a restored pointer is
   * still served by another live local pid, decline (notice) or take over.
   */
  localHolderGuard?: {
    mode: 'decline' | 'observe'
    onDeclined?: (holder: LocalBridgeSessionHolder) => void
  }
  /**
   * densable reviveInitiated (Yn / _i) — auth-revive watcher re-enable.
   */
  reviveInitiated?: boolean
  /**
   * densable expectedAccount (jn / Dr) — account the watcher validated.
   */
  expectedAccount?: {
    accountUuid?: string
    organizationUuid?: string
  }
  /**
   * densable leftover `$n` / `suppressHistoryBackfill`.
   * Official hook `et||Dt||Mo` host is not local — do not invent those refs.
   */
  suppressHistoryBackfill?: boolean
  /**
   * densable leftover `an` / `onHistoryBackfillSuppressed`.
   * `Xn` → `{uncertaintyOnly:true}` or `undefined`.
   */
  onHistoryBackfillSuppressed?: (info?: { uncertaintyOnly?: true }) => void
  /**
   * densable 2.1.247 `host` — `ns().host`. Falsy omits onGetWorkspaceDiff
   * (the /remote-control 246 gap).
   */
  host?: object
  /**
   * densable 2.1.247 `getToolPermissionContext`.
   */
  getToolPermissionContext?: () => import('../Tool.js').ToolPermissionContext
  /**
   * densable 2.1.247 `workspaceDiffComputeBudget`.
   */
  workspaceDiffComputeBudget?: import('./workspaceDiffBudget.js').WorkspaceDiffComputeBudget
}

export type LocalBridgeSessionHolder = {
  pid: number
  startedAt?: number
}

/** densable Fe / UG — live OAuth vs recorded pointer owner. */
function oauthAccountsMatch(
  live: { accountUuid?: string; organizationUuid?: string } | undefined,
  recorded: { accountUuid?: string; organizationUuid?: string },
): boolean {
  return (
    Boolean(live?.accountUuid) &&
    live?.accountUuid === recorded.accountUuid &&
    (live?.organizationUuid || undefined) ===
      (recorded.organizationUuid || undefined)
  )
}

/** densable Qe / zS — `Ms().project?.sessionFile??null`. */
function getProjectSessionFile(): string | null {
  return getProject().sessionFile ?? null
}

/** densable JJe — `eoe(t)===`${e}.jsonl``. */
function sessionFileMatchesId(sessionId: string, sessionFile: string): boolean {
  return basename(sessionFile) === `${sessionId}.jsonl`
}

/** densable xe — both defined and sessionFile is not `{sid}.jsonl`. */
function isTornEntryPair(): boolean {
  const sessionFile = getProjectSessionFile()
  return (
    sessionFile != null && !sessionFileMatchesId(getSessionId(), sessionFile)
  )
}

/** densable ze — both ids defined and equal after cse_/session_ compat. */
function sameBridgeSessionId(
  left: string | undefined,
  right: string | undefined,
): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    toCompatSessionId(left) === toCompatSessionId(right)
  )
}

/** densable Fr — `D("tengu_sequential_puffin", true)`. */
function isSequentialPuffinEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_sequential_puffin', true)
}

/** densable Mr — `D("tengu_bridge_resume_respects_local_owner", true)`. */
function isBridgeResumeRespectsLocalOwner(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_bridge_resume_respects_local_owner',
    true,
  )
}

/** densable 2.1.243 #58 `Ht` — live local pid advertising this bridge session. */
export async function findLocalBridgeSessionHolder(
  sessionId: string,
): Promise<LocalBridgeSessionHolder | null> {
  const { listAllLiveSessions } = await import('../utils/udsClient.js')
  const { toCompatSessionId } = await import('./sessionIdCompat.js')
  const want = toCompatSessionId(sessionId)
  const sessions = await listAllLiveSessions()
  for (const session of sessions) {
    if (session.pid === process.pid || !session.bridgeSessionId) continue
    if (session.alive === false) continue
    if (toCompatSessionId(session.bridgeSessionId) !== want) continue
    return { pid: session.pid, startedAt: session.startedAt }
  }
  return null
}

export async function initReplBridge(
  options?: InitBridgeOptions,
): Promise<ReplBridgeHandle | null> {
  const {
    onInboundMessage,
    onPermissionResponse,
    onInterrupt,
    onStopTask,
    onSetModel,
    onSetMaxThinkingTokens,
    onSetPermissionMode,
    onSetMcpPermissionModeOverride,
    onStateChange,
    initialMessages,
    getMessages,
    previouslyFlushedUUIDs,
    initialName,
    perpetual,
    outboundOnly: outboundOnlyOpt,
    tags,
    reattachSessionId: reattachSessionIdOpt,
    reattachSequenceNum: reattachSequenceNumOpt,
    reattachOrFail: reattachOrFailOpt,
    sessionGroupingId: sessionGroupingIdOpt,
    localHolderGuard,
    expectedAccount,
    suppressHistoryBackfill = false,
    onHistoryBackfillSuppressed,
    host,
    getToolPermissionContext,
    workspaceDiffComputeBudget,
  } = options ?? {}
  const onGetWorkspaceDiff = createOnGetWorkspaceDiff(
    host,
    getToolPermissionContext,
    workspaceDiffComputeBudget,
  )

  // densable initReplBridge: consume CLAUDE_BRIDGE_REATTACH_* once at entry
  // (W/q/j/B/V + OWNER_ACCT/ORG/NO_BACKFILL) so left-arrow child reattach
  // cannot loop on re-init. Then densable wXr: if no explicit reattach,
  // resume process-local CXr meta.
  const envReattachSession = process.env.CLAUDE_BRIDGE_REATTACH_SESSION
  const envReattachSeq = process.env.CLAUDE_BRIDGE_REATTACH_SEQ
  const envReattachGrouping = process.env.CLAUDE_BRIDGE_REATTACH_GROUPING
  const envOutboundOnly = process.env.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY
  const envOwnerAcct = process.env.CLAUDE_BRIDGE_REATTACH_OWNER_ACCT
  const envOwnerOrg = process.env.CLAUDE_BRIDGE_REATTACH_OWNER_ORG
  const envNoBackfill = process.env.CLAUDE_BRIDGE_REATTACH_NO_BACKFILL
  if (envReattachSession) {
    delete process.env.CLAUDE_BRIDGE_REATTACH_SESSION
    delete process.env.CLAUDE_BRIDGE_REATTACH_SEQ
    delete process.env.CLAUDE_BRIDGE_REATTACH_OUTBOUND_ONLY
    delete process.env.CLAUDE_BRIDGE_REATTACH_GROUPING
    delete process.env.CLAUDE_BRIDGE_REATTACH_OWNER_ACCT
    delete process.env.CLAUDE_BRIDGE_REATTACH_OWNER_ORG
    delete process.env.CLAUDE_BRIDGE_REATTACH_NO_BACKFILL
  }
  let reattachSessionId = envReattachSession ?? reattachSessionIdOpt
  let reattachSequenceNum = envReattachSession
    ? envReattachSeq
      ? Number.parseInt(envReattachSeq, 10) || undefined
      : undefined
    : reattachSequenceNumOpt
  // densable leftover `b=B(k())`. `R=Boolean($n)||ie()||re(b)||on(b)`.
  const historySid = getSessionId()
  let forceNoHistoryBackfill =
    Boolean(suppressHistoryBackfill) ||
    isSessionHistorySuppressed() ||
    isPrecautionarySuppressed(historySid) ||
    isKnownTaintedSession(historySid)
  // densable leftover `Le` — Kn owner veto latch.
  let ownerVetoLatched = false
  // densable: if (!q) { let Me=wXr(); if(Me) q=Me.id, V=Me.seq }
  if (!reattachSessionId) {
    const persisted = getPersistedBridgeSession()
    if (persisted) {
      reattachSessionId = persisted.id
      reattachSequenceNum = persisted.seq
      if (persisted.noHistoryBackfill) forceNoHistoryBackfill = true
      logForDebugging(
        `[bridge:repl] Reattaching to persisted bridge session ${persisted.id} at seq ${persisted.seq}`,
      )
    }
  }
  // densable 2.1.246: if (!Z) { if (S) { Fe/Fr/ze owner-match; qn only on Bkn adopt } }
  // Occupancy is `sn&&qn&&T&&Mr()`. Env / CXr / hook-passed id must not set qn.
  let restoredPointerOccupancy = false
  // densable ae=Si, de=Z?"env":zn?"option":void 0
  let reattachOrFail = reattachOrFailOpt === true
  let reattachOrigin: string | undefined = envReattachSession
    ? 'env'
    : reattachSessionIdOpt
      ? 'option'
      : undefined
  let hostTargetOwner:
    | { accountUuid?: string; organizationUuid?: string }
    | undefined
  // densable xe — mid-/resume sessionFile vs live sid. Kn reads this latch.
  const tornEntryPair = isTornEntryPair()
  const applyOwnerVetoTaint = (
    carrier: string,
    cause: 'restored_owner_mismatch' | 'env_owner_mismatch',
    vetoedAccount?: string,
  ): void => {
    forceNoHistoryBackfill = true
    ownerVetoLatched = true
    if (tornEntryPair) {
      logEvent('rc_cross_account_suppression', {
        reason:
          'torn_entry_pair' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      logForDebugging(
        `[bridge:repl] ${carrier} veto under a TORN entry pair (mid-/resume window): precautionary suppression only, no permanent taint write`,
        { level: 'warn' },
      )
      // Official leftover Kn: if(xe) L(b),_e(b). L=qXs, _e=ZXs.
      markPrecautionarySessionSuppression(getSessionId())
      clearScanUncertaintyHoldSid(getSessionId())
      return
    }
    logEvent('rc_cross_account_suppression', {})
    writeHistorySuppression(
      getSessionId() as import('crypto').UUID,
      getProjectSessionFile() ?? undefined,
      cause,
      vetoedAccount,
    )
  }
  const restored = getCurrentSessionBridge()
  if (!envReattachSession && restored) {
    const hasRecordedOwner = Boolean(restored.ownerAccountUuid)
    // Disk, not getGlobalConfig's cache — same reason as the env-handoff and
    // hostTargetOwner checks below. The cache is refreshed by a non-blocking
    // watcher, so an account switch in another process leaves a stale
    // oauthAccount here and this veto waves through the window it exists to close.
    const live = hasRecordedOwner ? getOauthAccountInfoFromDisk() : undefined
    const ownerVeto =
      hasRecordedOwner &&
      live?.accountUuid &&
      !oauthAccountsMatch(live, {
        accountUuid: restored.ownerAccountUuid,
        organizationUuid: restored.ownerOrganizationUuid,
      })
    if (ownerVeto) {
      const carrier = reattachSessionId ? 'Host-directed' : 'Restored-pointer'
      logForDebugging(
        `[bridge:repl] ${carrier} reattach vetoed: the credential store account changed since this conversation\u2019s pointer was persisted \u2014 minting fresh, history channels suppressed`,
        { level: 'warn' },
      )
      reattachSessionId = undefined
      reattachSequenceNum = undefined
      reattachOrigin = undefined
      // leftoverGt / hook pin must not refuse the mint this arm just promised
      reattachOrFail = false
      applyOwnerVetoTaint(carrier, 'restored_owner_mismatch', live?.accountUuid)
    } else {
      const ownerConfirmed =
        hasRecordedOwner &&
        oauthAccountsMatch(live, {
          accountUuid: restored.ownerAccountUuid,
          organizationUuid: restored.ownerOrganizationUuid,
        })
      if (restored.noHistoryBackfill) forceNoHistoryBackfill = true
      if (
        reattachSessionId &&
        sameBridgeSessionId(reattachSessionId, restored.id)
      ) {
        reattachSessionId = restored.id
      }
      if (!reattachSessionId) {
        reattachSessionId = restored.id
        reattachSequenceNum = restored.seq
        if (!ownerConfirmed || !isSequentialPuffinEnabled()) {
          reattachOrFail = true
        }
        if (!ownerConfirmed) {
          // Fail closed, matching the host-directed arm below: a pointer whose
          // owner is absent (pre-2.1.246 writes, or a swallowed account read)
          // or unreadable is not proof that this login owns the cse_* session,
          // so don't forward initialMessages into it.
          forceNoHistoryBackfill = true
        }
        const origin = ownerConfirmed
          ? reattachOrFail
            ? 'restored_owner_match_pinned'
            : 'restored_owner_match'
          : hasRecordedOwner
            ? 'restored_identity_unreadable'
            : 'restored_owner_unknown'
        restoredPointerOccupancy = true
        reattachOrigin = origin
        logForDebugging(
          `[bridge:repl] Reattaching to persisted bridge session ${restored.id} at seq ${restored.seq} (${reattachOrFail ? 'reattach-or-fail' : 'fresh-mint fallback'}, ${origin})`,
        )
      } else if (ownerConfirmed) {
        if (!sameBridgeSessionId(reattachSessionId, restored.id)) {
          hostTargetOwner = {
            accountUuid: restored.ownerAccountUuid,
            organizationUuid: restored.ownerOrganizationUuid,
          }
        }
      } else if (!ownerConfirmed) {
        if (sameBridgeSessionId(reattachSessionId, restored.id)) {
          reattachOrFail = true
          // Same fail-closed as the adopt arm above and the different-id arm
          // below: unconfirmed owner is not proof this login owns the cse_*
          // session, so do not forward initialMessages into it.
          forceNoHistoryBackfill = true
          logForDebugging(
            `[bridge:repl] Reattaching to the recorded bridge session ${restored.id} as named by the carrier; owner unconfirmed \u2014 reattach-or-fail, history suppressed`,
          )
        } else {
          forceNoHistoryBackfill = true
          logForDebugging(
            '[bridge:repl] Host-directed reattach: this conversation\u2019s recorded owner could not be confirmed as the current login \u2014 attaching with history channels suppressed',
            { level: 'warn' },
          )
        }
      }
    }
  }
  // densable env-handoff: NO_BACKFILL → force history suppression before
  // unarchive/reuse (prevents title/history leak into connected RC session).
  if (envReattachSession && isEnvTruthy(envNoBackfill)) {
    forceNoHistoryBackfill = true
  }
  // densable env-handoff owner check (dBe): when OWNER_ACCT is present and the
  // live OAuth account differs, drop reattach id and mint fresh with
  // suppression. densable dBe also requires (live.org||undefined)===(handoff.org||undefined),
  // which falsely vetoes when handoff only stamped OWNER_ACCT (no ORG) but live
  // has an org. Product fix: if OWNER_ORG was recorded, both must match; if
  // handoff omitted ORG, compare account only (missing org ≠ "must be empty").
  if (envReattachSession && reattachSessionId && envOwnerAcct) {
    try {
      const live = getOauthAccountInfoFromDisk()
      if (live?.accountUuid) {
        const sameAcct = live.accountUuid === envOwnerAcct
        const sameOrg =
          envOwnerOrg === undefined || envOwnerOrg === ''
            ? true
            : (live.organizationUuid || undefined) === envOwnerOrg
        if (!(sameAcct && sameOrg)) {
          logForDebugging(
            '[bridge:repl] Env-handoff reattach vetoed: the credential store account changed since the handoff was recorded — minting fresh, history channels suppressed',
            { level: 'warn' },
          )
          reattachSessionId = undefined
          reattachSequenceNum = undefined
          reattachOrigin = undefined
          reattachOrFail = false
          applyOwnerVetoTaint(
            'Env-handoff',
            'env_owner_mismatch',
            live.accountUuid,
          )
        }
      } else {
        // densable: owner identity unavailable → reattach-or-fail (keep id)
        reattachOrFail = true
        reattachOrigin = 'env_or_fail'
        logForDebugging(
          '[bridge:repl] Env-handoff reattach: owner identity unavailable — reattach-or-fail',
        )
      }
    } catch {
      // densable Y(w).catch → treat as unreadable identity (fail-closed)
      reattachOrFail = true
      reattachOrigin = 'env_or_fail'
      logForDebugging(
        '[bridge:repl] Env-handoff reattach: owner identity unavailable — reattach-or-fail',
      )
    }
  }
  // densable: if ae === sEe()?.id && sEe()?.noHistoryBackfill → ie
  if (reattachSessionId) {
    const liveMeta = getPersistedBridgeSession()
    if (
      liveMeta?.id === reattachSessionId &&
      liveMeta.noHistoryBackfill === true
    ) {
      forceNoHistoryBackfill = true
    }
    const restored = getCurrentSessionBridge()
    if (
      restored?.id === reattachSessionId &&
      restored.noHistoryBackfill === true
    ) {
      forceNoHistoryBackfill = true
    }
  }
  // densable leftover `Xn` / `if(R)Ce=Xn(),an?.(Ce)` before occupancy.
  const historyPointer = getCurrentSessionBridge()
  const leftoverXn = (): { uncertaintyOnly: true } | undefined =>
    isScanUncertaintyHeld(historySid) &&
    !suppressHistoryBackfill &&
    !ownerVetoLatched &&
    !isSessionHistorySuppressed() &&
    !isKnownTaintedSession(historySid) &&
    historyPointer?.noHistoryBackfill !== true &&
    getSessionId() === historySid
      ? { uncertaintyOnly: true }
      : undefined
  if (forceNoHistoryBackfill) {
    onHistoryBackfillSuppressed?.(leftoverXn())
  }
  // densable Q: if (q) Q=W?B:wXr()?.groupingId; else Q=k
  // When reattaching from env use GROUPING env; from wXr use meta grouping;
  // when creating fresh use option k.
  let sessionGroupingId: string | undefined
  if (reattachSessionId) {
    if (envReattachSession) {
      sessionGroupingId = envReattachGrouping || undefined
    } else {
      sessionGroupingId =
        getPersistedBridgeSession()?.groupingId ??
        getCurrentSessionBridge()?.groupingId ??
        sessionGroupingIdOpt
    }
  } else {
    sessionGroupingId = sessionGroupingIdOpt
  }
  // Env OUTBOUND_ONLY forces outbound when set; else honor option.
  const outboundOnly =
    envReattachSession && isEnvTruthy(envOutboundOnly) ? true : outboundOnlyOpt

  // Wire the cse_ shim kill switch so toCompatSessionId respects the
  // GrowthBook gate. Daemon/SDK paths skip this — shim defaults to active.
  setCseShimGate(isCseShimEnabled)

  // 1. Runtime gate
  if (!(await isBridgeEnabledBlocking())) {
    logBridgeSkip('not_enabled', '[bridge:repl] Skipping: bridge not enabled')
    return null
  }

  // 1b. Minimum version check — deferred to after the v1/v2 branch below,
  // since each implementation has its own floor (tengu_bridge_min_version
  // for v1, tengu_bridge_repl_v2_config.min_version for v2).

  // 2. Check OAuth — must be signed in with claude.ai. Runs before the
  // policy check so console-auth users get the actionable "/login" hint
  // instead of a misleading policy error from a stale/wrong-org cache.
  if (!getBridgeAccessToken()) {
    logBridgeSkip('no_oauth', '[bridge:repl] Skipping: no OAuth tokens')
    onStateChange?.('failed', '/login', 'auth')
    return null
  }

  // densable Jn(jn): revive identity re-check before policy. Same helper as
  // host-directed ln; do not invent watcher internals here.
  if (expectedAccount) {
    const live = getOauthAccountInfoFromDisk()
    if (!oauthAccountsMatch(live, expectedAccount)) {
      logBridgeSkip(
        'revive_identity_recheck_failed',
        '[bridge:repl] Skipping: revive identity re-check failed (store changed or unreadable since the watcher validated)',
      )
      onStateChange?.('failed', HOST_ACCOUNT_CHANGED_HINT, 'terminal')
      return null
    }
  }

  // 3. Check organization policy — remote control may be disabled
  await waitForPolicyLimitsToLoad()
  if (!isPolicyAllowed('allow_remote_control')) {
    logBridgeSkip(
      'policy_denied',
      '[bridge:repl] Skipping: allow_remote_control policy not allowed',
    )
    onStateChange?.('failed', "disabled by your organization's policy")
    return null
  }

  // densable 2.1.243 #58 / 2.1.246 qn — occupancy `sn&&qn&&T&&Mr()`.
  // Zn latches takeover; Ye fires immediately before Yr, not here
  // (later skip paths must not emit the event).
  let restoredPointerTakeover = false
  if (
    localHolderGuard &&
    restoredPointerOccupancy &&
    reattachSessionId &&
    isBridgeResumeRespectsLocalOwner()
  ) {
    const holder = await findLocalBridgeSessionHolder(reattachSessionId)
    if (holder) {
      if (localHolderGuard.mode === 'decline') {
        logBridgeSkip(
          'restored_pointer_held_locally',
          `[bridge:repl] Skipping: bridge session ${reattachSessionId} from the resumed transcript is still served by local pid ${holder.pid} — not taking it over (/remote-control here moves it)`,
        )
        localHolderGuard.onDeclined?.(holder)
        return null
      }
      logForDebugging(
        `[bridge:repl] Explicit enable is taking over bridge session ${reattachSessionId} from local pid ${holder.pid}`,
      )
      restoredPointerTakeover = true
    }
  }

  // densable leftover ci=UXs / De=HXs / li=JXs / Me=YXs.
  // After Zn takeover, before oauth dead skip. torn/gone 不调 Me.
  const scanSid = historySid
  if (!isSessionHistorySuppressed()) {
    const scan = await probeActiveSessionHistorySuppression(
      getPinnedStorageV5(),
    )
    if (scan === 'found') {
      markSessionHistorySuppressed(scanSid as import('crypto').UUID)
    } else if (scan === 'clean') {
      releaseScanPrecautionHold(scanSid)
    } else if (scan === 'torn') {
      logEvent('rc_cross_account_suppression', {
        reason:
          'scan_torn' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    } else {
      logEvent('rc_cross_account_suppression', {
        reason: (scan === 'budget-exhausted'
          ? 'scan_budget_exhausted'
          : 'scan_read_error') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      applyScanPrecautionHold(scanSid)
    }
  }
  // densable leftover `if(!R&&(ie()||re(b)||on(b)||k()!==b))R=!0,Ce=Xn(),an?.(Ce)`
  if (
    !forceNoHistoryBackfill &&
    (isSessionHistorySuppressed() ||
      isPrecautionarySuppressed(scanSid) ||
      isKnownTaintedSession(scanSid) ||
      getSessionId() !== scanSid)
  ) {
    forceNoHistoryBackfill = true
    onHistoryBackfillSuppressed?.(leftoverXn())
  }

  // When CLAUDE_BRIDGE_OAUTH_TOKEN is set (ant-only local dev), the bridge
  // uses that token directly via getBridgeAccessToken() — keychain state is
  // irrelevant. Skip 2b/2c to preserve that decoupling: an expired keychain
  // token shouldn't block a bridge connection that doesn't use it.
  if (!getBridgeTokenOverride()) {
    // 2a. Cross-process backoff. If N prior processes already saw this exact
    // dead token (matched by expiresAt), skip silently — no event, no refresh
    // attempt. The count threshold tolerates transient refresh failures (auth
    // server 5xx, lockfile errors per auth.ts:1437/1444/1485): each process
    // independently retries until 3 consecutive failures prove the token dead.
    // Mirrors useReplBridge's MAX_CONSECUTIVE_INIT_FAILURES for in-process.
    // The expiresAt key is content-addressed: /login → new token → new expiresAt
    // → this stops matching without any explicit clear.
    const cfg = getGlobalConfig()
    if (
      cfg.bridgeOauthDeadExpiresAt != null &&
      (cfg.bridgeOauthDeadFailCount ?? 0) >= 3 &&
      getClaudeAIOAuthTokens()?.expiresAt === cfg.bridgeOauthDeadExpiresAt
    ) {
      logForDebugging(
        `[bridge:repl] Skipping: cross-process backoff (dead token seen ${cfg.bridgeOauthDeadFailCount} times)`,
      )
      return null
    }

    // 2b. Proactively refresh if expired. Mirrors bridgeMain.ts:2096 — the REPL
    // bridge fires at useEffect mount BEFORE any v1/messages call, making this
    // usually the first OAuth request of the session. Without this, ~9% of
    // registrations hit the server with a >8h-expired token → 401 → withOAuthRetry
    // recovers, but the server logs a 401 we can avoid. VPN egress IPs observed
    // at 30:1 401:200 when many unrelated users cluster at the 8h TTL boundary.
    //
    // Fresh-token cost: one memoized read + one Date.now() comparison (~µs).
    // checkAndRefreshOAuthTokenIfNeeded clears its own cache in every path that
    // touches the keychain (refresh success, lockfile race, throw), so no
    // explicit clearOAuthTokenCache() here — that would force a blocking
    // keychain spawn on the 91%+ fresh-token path.
    await checkAndRefreshOAuthTokenIfNeeded()

    // 2c. Skip if token is still expired post-refresh-attempt. Env-var / FD
    // tokens (auth.ts:894-917) have expiresAt=null → never trip this. But a
    // keychain token whose refresh token is dead (password change, org left,
    // token GC'd) has expiresAt<now AND refresh just failed — the client would
    // otherwise loop 401 forever: withOAuthRetry → handleOAuth401Error →
    // refresh fails again → retry with same stale token → 401 again.
    // Datadog 2026-03-08: single IPs generating 2,879 such 401s/day. Skip the
    // guaranteed-fail API call; useReplBridge surfaces the failure.
    //
    // Intentionally NOT using isOAuthTokenExpired here — that has a 5-minute
    // proactive-refresh buffer, which is the right heuristic for "should
    // refresh soon" but wrong for "provably unusable". A token with 3min left
    // + transient refresh endpoint blip (5xx/timeout/wifi-reconnect) would
    // falsely trip a buffered check; the still-valid token would connect fine.
    // Check actual expiry instead: past-expiry AND refresh-failed → truly dead.
    const tokens = getClaudeAIOAuthTokens()
    if (tokens && tokens.expiresAt !== null && tokens.expiresAt <= Date.now()) {
      logBridgeSkip(
        'oauth_expired_unrefreshable',
        '[bridge:repl] Skipping: OAuth token expired and refresh failed (re-login required)',
      )
      onStateChange?.('failed', '/login', 'auth')
      // Persist for the next process. Increments failCount when re-discovering
      // the same dead token (matched by expiresAt); resets to 1 for a different
      // token. Once count reaches 3, step 2a's early-return fires and this path
      // is never reached again — writes are capped at 3 per dead token.
      // Local const captures the narrowed type (closure loses !==null narrowing).
      const deadExpiresAt = tokens.expiresAt
      saveGlobalConfig(c => ({
        ...c,
        bridgeOauthDeadExpiresAt: deadExpiresAt,
        bridgeOauthDeadFailCount:
          c.bridgeOauthDeadExpiresAt === deadExpiresAt
            ? (c.bridgeOauthDeadFailCount ?? 0) + 1
            : 1,
      }))
      return null
    }
  }

  // 4. Compute baseUrl — needed by both v1 (env-based) and v2 (env-less)
  // paths. Hoisted above the v2 gate so both can use it.
  const baseUrl = getBridgeBaseUrl()

  // 5. Derive session title. Precedence: explicit initialName → /rename
  // (session storage) → last meaningful user message → generated slug.
  // Cosmetic only (claude.ai session list); the model never sees it.
  // Two flags: `hasExplicitTitle` (initialName or /rename — never auto-
  // overwrite) vs. `hasTitle` (any title, including auto-derived — blocks
  // the count-1 re-derivation but not count-3). The onUserMessage callback
  // (wired to both v1 and v2 below) derives from the 1st prompt and again
  // from the 3rd so mobile/web show a title that reflects more context.
  // The slug fallback (e.g. "remote-control-graceful-unicorn") makes
  // auto-started sessions distinguishable in the claude.ai list before the
  // first prompt.
  // Official Ae leftover @233518704:
  //   Ae=(e)=>{if(R||He()||Ne())return;let n=k();return n?e(n):void 0}
  // He = t9s. Ne = en(B(k())). B = Xg = identity, so B(k()) is k().
  // Ne leftover: Jre||Sno||xno.noHistoryBackfill||Ano||Cno||_4t||y4t.
  const sessionTitleUnlessHistorySuppressed = (
    reader: (sid: ReturnType<typeof getSessionId>) => string | undefined,
  ): string | undefined => {
    if (
      forceNoHistoryBackfill ||
      isForeignSessionBinding() ||
      shouldSuppressSessionTitleHistory(getSessionId())
    ) {
      return undefined
    }
    const sid = getSessionId()
    return sid ? reader(sid) : undefined
  }
  let title = `remote-control-${generateShortWordSlug()}`
  let hasTitle = false
  let hasExplicitTitle = false
  if (initialName) {
    title = initialName
    hasTitle = true
    hasExplicitTitle = true
  } else if (!forceNoHistoryBackfill) {
    // densable R: do not stamp this conversation's title onto a
    // suppressed / host-directed attach. Official also L(b)/_e(b);
    // those helpers are not locked locally — skip derivation only.
    const customTitle = sessionTitleUnlessHistorySuppressed(
      getCurrentSessionTitle,
    )
    const aiTitle = sessionTitleUnlessHistorySuppressed(
      getCurrentSessionAiTitle,
    )
    if (customTitle) {
      title = customTitle
      hasTitle = true
      hasExplicitTitle = true
    } else if (aiTitle) {
      title = aiTitle
      hasTitle = true
    } else if (initialMessages && initialMessages.length > 0) {
      // Find the last user message that has meaningful content. Skip meta
      // (nudges), tool results, compact summaries ("This session is being
      // continued…"), non-human origins (task notifications, channel pushes),
      // and synthetic interrupts ([Request interrupted by user]) — none are
      // human-authored. Same filter as extractTitleText + isSyntheticMessage.
      for (let i = initialMessages.length - 1; i >= 0; i--) {
        const msg = initialMessages[i]!
        if (
          msg.type !== 'user' ||
          msg.isMeta ||
          msg.toolUseResult ||
          msg.isCompactSummary ||
          (msg.origin && (msg.origin as { kind?: string }).kind !== 'human') ||
          isSyntheticMessage(msg)
        )
          continue
        const rawContent = getContentText(
          msg.message!.content as string | ContentBlockParam[],
        )
        if (!rawContent) continue
        const derived = deriveTitle(rawContent)
        if (!derived) continue
        title = derived
        hasTitle = true
        break
      }
    }
  }

  // Shared by both v1 and v2 — fires on every title-worthy user message until
  // it returns true. Official Ii @233528249:
  //   H||Bi(n)||ne===n → done; Ae(X) → done; it(n) → done; then G++
  //   G===1&&!V → rt (Haiku only; no Xo/deriveTitle)
  //   G===3 → rt over the conversation (even when V)
  //   done: G>=3&&(V||H)||G>=8
  // Count-3 may overwrite our own derived title. Official rt @233526302:
  //   ei → ct (H / $e / pn / custom / foreign AI title) → rn →
  //   Pe===null abort / Pe.title&&!Re → ne / else hn.
  // Bi latch + Ae leftover locked. Do not invent Ln/W/He.
  let userMessageCount = 0
  let lastBridgeSessionId: string | undefined
  let genSeq = 0
  // densable 2.1.239 #39 `_ts` — coalesce + rate-limit title PATCH.
  const ownTitles = new Set<string>(title ? [title] : [])
  // Official leftover tt=Promise.resolve() — serialize Pi → Kr(s8n).
  let titlePropagateChain = Promise.resolve()
  // densable `et` — mint-after-gone slug, distinct from derived `z`.
  const neutralFallbackTitle = `remote-control-${generateShortWordSlug()}`
  const titleWriter = createTitleWriteScheduler({
    isOwnTitle: (_sessionId, ownTitle) => ownTitles.has(ownTitle),
    onRemoteTitleAdopted: sessionId => {
      lastAdoptedRemoteSession = sessionId
    },
  })
  // Official Re=(e,n)=>q.has(n)||x.hasSent(e,n). Not isKnownTitle.
  const isOwnOrSentTitle = (sessionId: string, value: string): boolean =>
    ownTitles.has(value) || titleWriter.hasSent(sessionId, value)
  const patch = (
    derived: string,
    bridgeSessionId: string,
    atCount: number,
  ): void => {
    hasTitle = true
    title = derived
    ownTitles.add(derived)
    logForDebugging(
      `[bridge:repl] derived title from message ${atCount}: ${derived}`,
    )
    void titleWriter
      .update(bridgeSessionId, derived, {
        baseUrl,
        getAccessToken: getBridgeAccessToken,
        // Official hn shouldSend: ue=()=>!gn. Do not invent Ln/W/He.
        shouldSend: () => !teardownStarted,
      })
      .catch(() => {})
  }
  // Fire-and-forget Haiku generation with post-await guards. Re-checks /rename
  // (sessionStorage), v1 env-lost (lastBridgeSessionId), and same-session
  // out-of-order resolution (genSeq — count-1's Haiku resolving after count-3
  // would clobber the richer title). generateSessionTitle never rejects.
  const generateAndPatch = (input: string, bridgeSessionId: string): void => {
    if (teardownStarted) {
      return
    }
    const gen = ++genSeq
    const atCount = userMessageCount
    void generateSessionTitle(input, AbortSignal.timeout(15_000)).then(
      async generated => {
        const stale = (): boolean => {
          const stored = getCurrentSessionTitle(getSessionId())
          const aiTitle = getCurrentSessionAiTitle(getSessionId())
          return (
            teardownStarted ||
            gen !== genSeq ||
            lastBridgeSessionId !== bridgeSessionId ||
            hasExplicitTitle ||
            Boolean(stored && !ownTitles.has(stored)) ||
            Boolean(aiTitle && !ownTitles.has(aiTitle))
          )
        }
        if (!generated || stale()) {
          return
        }
        const remote = await getBridgeSession(bridgeSessionId, {
          baseUrl,
          getAccessToken: getBridgeAccessToken,
        }).catch(() => null)
        if (stale()) {
          return
        }
        if (remote === null) {
          return
        }
        if (remote.title && !isOwnOrSentTitle(bridgeSessionId, remote.title)) {
          titleWriter.noteRemoteTitle(bridgeSessionId, remote.title)
          lastAdoptedRemoteSession = bridgeSessionId
          return
        }
        patch(generated, bridgeSessionId, atCount)
      },
    )
  }
  const onUserMessage = (text: string, bridgeSessionId: string): boolean => {
    // Official Ii: if(H||Bi(n)||ne===n)return!0.
    // Bi=(e)=>mn?.bridgeSessionId===e&&mn.sessionId===k()
    if (
      hasExplicitTitle ||
      alreadyAdoptedLocalAi(bridgeSessionId) ||
      lastAdoptedRemoteSession === bridgeSessionId
    ) {
      return true
    }
    // Official Ae(X) leftover @233527944 — mid-session /rename that has
    // not yet set H. He() = foreign binding. Ne() leftover Jre/Sno/xno/y4t.
    const customTitle = sessionTitleUnlessHistorySuppressed(
      getCurrentSessionTitle,
    )
    if (customTitle) {
      if (!isOwnOrSentTitle(bridgeSessionId, customTitle)) {
        void getBridgeSession(bridgeSessionId, {
          baseUrl,
          getAccessToken: getBridgeAccessToken,
        })
          .catch(() => null)
          .then(remote => {
            if (
              hasExplicitTitle ||
              getCurrentSessionTitle(getSessionId()) !== customTitle
            ) {
              return
            }
            if (remote === null) {
              return
            }
            if (
              remote.title &&
              !isOwnOrSentTitle(bridgeSessionId, remote.title)
            ) {
              titleWriter.noteRemoteTitle(bridgeSessionId, remote.title)
              lastAdoptedRemoteSession = bridgeSessionId
              return
            }
            patch(customTitle, bridgeSessionId, userMessageCount)
            hasExplicitTitle = true
          })
      }
      return true
    }
    // Official it(n) before increment — REPL AI title → CCR PATCH.
    if (syncLocalAiTitle(bridgeSessionId)) {
      return true
    }
    // v1 env-lost re-creates the session with a new ID. Reset the count so
    // the new session gets its own count-3 derivation; hasTitle stays true
    // (new session was created via getCurrentTitle(), which reads the count-1
    // title from this closure), so count-1 of the fresh cycle correctly skips.
    if (
      lastBridgeSessionId !== undefined &&
      lastBridgeSessionId !== bridgeSessionId
    ) {
      userMessageCount = 0
    }
    lastBridgeSessionId = bridgeSessionId
    userMessageCount++
    if (userMessageCount === 1 && !hasTitle) {
      generateAndPatch(text, bridgeSessionId)
    } else if (userMessageCount === 3) {
      // densable Ii: `R||He()||Ne() ? void 0 : p?.()` — bounce sets R so
      // count-3 must not title the minted cse_* from this conversation.
      const msgs =
        forceNoHistoryBackfill ||
        isForeignSessionBinding() ||
        shouldSuppressSessionTitleHistory(getSessionId())
          ? undefined
          : getMessages?.()
      const input = msgs
        ? extractConversationText(getMessagesAfterCompactBoundary(msgs))
        : text
      generateAndPatch(input, bridgeSessionId)
    }
    // Official: G>=3&&(V||H) || G>=8
    return (
      (userMessageCount >= 3 && (hasTitle || hasExplicitTitle)) ||
      userMessageCount >= 8
    )
  }

  // densable 2.1.246 `it` / `Ui` — REPL Haiku title → CCR PATCH.
  let handleRef: ReplBridgeHandle | null = null
  let teardownStarted = false
  let lastAdoptedRemoteSession: string | undefined
  let adoptedLocalAi: { bridgeSessionId: string; sessionId: string } | undefined
  const alreadyAdoptedLocalAi = (bridgeSessionId: string): boolean =>
    adoptedLocalAi?.bridgeSessionId === bridgeSessionId &&
    adoptedLocalAi.sessionId === getSessionId()
  const syncLocalAiTitle = (bridgeSessionId: string): boolean => {
    // Official it: if(!Ae(we)||Re(e,Ae(we)))return!1
    const aiTitle = sessionTitleUnlessHistorySuppressed(
      getCurrentSessionAiTitle,
    )
    if (!aiTitle || isOwnOrSentTitle(bridgeSessionId, aiTitle)) {
      return false
    }
    const sessionId = getSessionId()
    void getBridgeSession(bridgeSessionId, {
      baseUrl,
      getAccessToken: getBridgeAccessToken,
    })
      .catch(() => null)
      .then(remote => {
        if (
          hasExplicitTitle ||
          teardownStarted ||
          lastAdoptedRemoteSession === bridgeSessionId ||
          getCurrentSessionTitle(getSessionId())
        ) {
          return
        }
        if (remote === null) return
        if (remote.title && !isOwnOrSentTitle(bridgeSessionId, remote.title)) {
          titleWriter.noteRemoteTitle(bridgeSessionId, remote.title)
          lastAdoptedRemoteSession = bridgeSessionId
          return
        }
        if (
          getSessionId() !== sessionId ||
          getCurrentSessionAiTitle(sessionId) !== aiTitle
        ) {
          return
        }
        ownTitles.add(aiTitle)
        // Official it: pn++ before hn so in-flight rt aborts.
        genSeq++
        adoptedLocalAi = { bridgeSessionId, sessionId }
        void titleWriter
          .update(bridgeSessionId, aiTitle, {
            baseUrl,
            getAccessToken: getBridgeAccessToken,
            shouldSend: () => !teardownStarted,
          })
          .catch(() => {})
      })
    return true
  }
  const adoptLocalAiTitle = (): void => {
    const e = handleRef?.bridgeSessionId
    if (
      !e ||
      hasExplicitTitle ||
      teardownStarted ||
      lastAdoptedRemoteSession === e ||
      getCurrentSessionTitle(getSessionId())
    ) {
      return
    }
    syncLocalAiTitle(e)
  }
  const attachAdoptLocalAiTitle = <T extends ReplBridgeHandle>(
    handle: T | null,
  ): T | null => {
    if (!handle) return null
    handleRef = handle
    const originalTeardown = handle.teardown.bind(handle)
    handle.teardown = async opts => {
      teardownStarted = true
      titleWriter.forget(handle.bridgeSessionId)
      await originalTeardown(opts)
    }
    handle.adoptLocalAiTitle = adoptLocalAiTitle
    // Official leftover after Yr: M.selfTitle=z
    handle.selfTitle = title
    handle.titleWriter = titleWriter
    return handle
  }

  // Official Pi @233526810 leftover. Cr = leftover sanitize (local uge).
  // Or = Jxc = isTeammate. Kr = s8n leftover 3-arg (zd/u8n/p8n/rTe/ZAt/J0/doe).
  // BQ=Li / VAt=Ti / Pm=Oi / mhe=u8o / storageV5=w leftover.
  const onRenameSession = (
    rawTitle: string,
  ): { ok: true } | { ok: false; error: string } => {
    const n = sanitizeSessionTitle(rawTitle)
    if (!n) {
      return { ok: false, error: 'title must be non-empty' }
    }
    title = n
    hasTitle = true
    hasExplicitTitle = true
    ownTitles.add(n)
    ownTitles.add(rawTitle)
    if (handleRef) {
      handleRef.selfTitle = n
      titleWriter.noteRemoteTitle(handleRef.bridgeSessionId, n)
      if (rawTitle !== n) {
        titleWriter.noteRemoteTitle(handleRef.bridgeSessionId, rawTitle)
      }
    }
    const foreign = isForeignSessionBinding()
    const sid = foreign ? getForeignBoundSid() : getSessionId()
    if (sid) {
      void saveCustomTitle(
        sid as import('crypto').UUID,
        n,
        foreign ? getTranscriptPathForSession(sid) : undefined,
        'remote',
        getPinnedStorageV5(),
      ).catch(err => {
        logForDebugging(
          `saveCustomTitle: transcript append failed: ${errorMessage(err)}`,
        )
      })
    } else {
      logForDebugging(
        '[bridge:repl] Dropping inbound rename mirror: foreign binding with no bound-sid exposure \u2014 the live conversation is not the one the phone renamed',
      )
    }
    // Official leftover: if(!Or()&&!u) tt.then(Kr(n,"user",w))
    if (!isTeammate() && !foreign) {
      titlePropagateChain = titlePropagateChain.then(async () => {
        try {
          await applyLeftoverS8nUserName(n, {
            persistAgentName: async name => {
              const liveSid = getSessionId()
              if (!liveSid) return
              await saveAgentName(liveSid as import('crypto').UUID, name)
            },
            storageV5: getPinnedStorageV5(),
          })
        } catch (err) {
          logForDebugging(
            `onRenameSession: name propagation failed: ${errorMessage(err)}`,
          )
        }
      })
    }
    return { ok: true }
  }

  const initialHistoryCap = getFeatureValue_CACHED_WITH_REFRESH(
    'tengu_bridge_initial_history_cap',
    200,
    5 * 60 * 1000,
  )

  // Fetch orgUUID before the v1/v2 branch — both paths need it. v1 for
  // environment registration; v2 for archive (which lives at the compat
  // /v1/sessions/{id}/archive, not /v1/code/sessions). Without it, v2
  // archive 404s and sessions stay alive in CCR after /exit.
  // Self-hosted bridges skip this check — the local server doesn't require
  // org-based auth.
  const orgUUID = isSelfHostedBridge()
    ? 'self-hosted'
    : await getOrganizationUUID()
  if (!orgUUID) {
    logBridgeSkip('no_org_uuid', '[bridge:repl] Skipping: no org UUID')
    onStateChange?.('failed', '/login')
    return null
  }

  // ── GrowthBook gate: env-less bridge ──────────────────────────────────
  // When enabled, skips the Environments API layer entirely (no register/
  // poll/ack/heartbeat) and connects directly via POST /bridge → worker_jwt.
  // See server PR #292605 (renamed in #293280). REPL-only — daemon/print stay
  // on env-based.
  //
  // NAMING: "env-less" is distinct from "CCR v2" (the /worker/* transport).
  // The env-based path below can ALSO use CCR v2 via CLAUDE_CODE_USE_CCR_V2.
  // tengu_bridge_repl_v2 gates env-less (no poll loop), not transport version.
  //
  // densable 2.1.211 init is env-less-only (always Hzu). Local still keeps
  // the v1 env-based path for GrowthBook-off / perpetual (KAIROS pointer).
  // Reattach (rit / wXr) MUST use env-less: v1 cannot unarchive + resume Se.
  // Force env-less when reattachSessionId is set (even if GB gate is off).
  //
  // perpetual (assistant-mode session continuity via bridge-pointer.json) is
  // env-coupled and not yet implemented on env-less — fall back to env-based
  // when set so KAIROS users don't silently lose cross-restart continuity
  // (reattach overrides perpetual: left-arrow child reattach is densable Hzu).
  const forceEnvLessReattach = Boolean(reattachSessionId)
  if ((isEnvLessBridgeEnabled() || forceEnvLessReattach) && !perpetual) {
    const versionError = await checkEnvLessBridgeMinVersion()
    if (versionError) {
      logBridgeSkip(
        'version_too_old',
        `[bridge:repl] Skipping: ${versionError}`,
        true,
      )
      onStateChange?.('failed', 'run `claude update` to upgrade')
      return null
    }
    logForDebugging(
      forceEnvLessReattach && !isEnvLessBridgeEnabled()
        ? `[bridge:repl] Forcing env-less path for reattach ${reattachSessionId}`
        : '[bridge:repl] Using env-less bridge path (tengu_bridge_repl_v2)',
    )
    // densable Jn(ln): host-directed target on a recorded conversation —
    // re-verify Fe immediately before Yr. Do not invent jn/revive recheck.
    if (hostTargetOwner) {
      // densable Jn: We() fresh store read, not the getGlobalConfig cache.
      const live = getOauthAccountInfoFromDisk()
      if (!oauthAccountsMatch(live, hostTargetOwner)) {
        logBridgeSkip(
          'host_target_owner_recheck_failed',
          '[bridge:repl] Skipping: the login changed (or became unreadable) between adjudicating this conversation\u2019s owner and connecting \u2014 not attaching it to the host\u2019s session.',
        )
        onStateChange?.('failed', HOST_ACCOUNT_CHANGED_HINT)
        return null
      }
      logForDebugging(
        '[bridge:repl] Host-directed target on a recorded conversation: owner re-verified immediately before connecting',
      )
    }
    // densable `if(Zn)Ye("tengu_bridge_restored_pointer_takeover",{})` — after
    // Jn, immediately before Yr. Do not invent env-based / v1 emit.
    if (restoredPointerTakeover) {
      logEvent('tengu_bridge_restored_pointer_takeover', {})
    }
    const { initEnvLessBridgeCore } = await import('./remoteBridgeCore.js')
    return attachAdoptLocalAiTitle(
      await initEnvLessBridgeCore({
        baseUrl,
        orgUUID,
        title,
        getAccessToken: getBridgeAccessToken,
        onAuth401: handleOAuth401Error,
        toSDKMessages,
        initialHistoryCap,
        // densable initialMessages: R ? void 0 : J
        initialMessages: forceNoHistoryBackfill ? undefined : initialMessages,
        // densable Hzu: reattachSessionId / reattachSequenceNum reuse Se when set.
        // Fresh sessions mint a new cse_* id (no previouslyFlushedUUIDs — the set
        // would block history across enable→disable→re-enable). Reattach skips
        // initial history flush the same way (server already has events).
        // densable noHistoryBackfill:ie — q5o/NO_BACKFILL forces Ge skip (#5).
        onInboundMessage,
        onUserMessage,
        onPermissionResponse,
        onInterrupt,
        onStopTask,
        onSetModel,
        onSetMaxThinkingTokens,
        onSetPermissionMode,
        onSetMcpPermissionModeOverride,
        onRenameSession,
        onGetWorkspaceDiff,
        onStateChange,
        outboundOnly,
        tags,
        sessionGroupingId,
        reattachSessionId,
        reattachSequenceNum,
        reattachOrFail,
        reattachOrigin,
        // densable u: q.add(et), R=!0, an?.(), L(b), te(b), _e(b).
        // an hook 未锁. L=qXs, te=KXs, _e=ZXs.
        onReattachGoneBounce: () => {
          ownTitles.add(neutralFallbackTitle)
          forceNoHistoryBackfill = true
          const sid = getSessionId()
          markPrecautionarySessionSuppression(sid)
          markResilientPrecautionSid(sid)
          clearScanUncertaintyHoldSid(sid)
        },
        onReattachPointerDead: () => {
          const sid = getSessionId()
          markPrecautionarySessionSuppression(sid)
          markResilientPrecautionSid(sid)
          clearScanUncertaintyHoldSid(sid)
          // densable pi(b,cn,…) only when !xe — torn pair must not tombstone
          // the other session's pointer.
          if (!tornEntryPair) {
            const sessionFile = getProjectSessionFile()
            clearBridgeSession(
              sid as import('crypto').UUID,
              sessionFile ?? undefined,
              sessionFile ? { targetExists: true } : undefined,
            )
          }
        },
        // densable leftover `Ei.onTransportPersistenceReady`.
        // `R||Ne()` → skip `ur`, still `ii`/`si`. `l=await zr(w); await ur(...)`.
        onTransportPersistenceReady: (writer, readers) => {
          startTranscriptPersistenceBackfill(
            forceNoHistoryBackfill ||
              shouldSuppressSessionTitleHistory(getSessionId()),
            writer,
            readers,
            getPinnedStorageV5(),
          )
        },
        noHistoryBackfill: forceNoHistoryBackfill || undefined,
        // densable mOp neutralFallbackTitle:jt — same `et` bounce adds to q.
        neutralFallbackTitle,
      }),
    )
  }

  // ── v1 path: env-based (register/poll/ack/heartbeat) ──────────────────
  // Not used for reattach (see forceEnvLessReattach above).

  const versionError = checkBridgeMinVersion()
  if (versionError) {
    logBridgeSkip('version_too_old', `[bridge:repl] Skipping: ${versionError}`)
    onStateChange?.('failed', 'run `claude update` to upgrade')
    return null
  }

  // Gather git context — this is the bootstrap-read boundary.
  // Everything from here down is passed explicitly to bridgeCore.
  const branch = await getBranch()
  const gitRepoUrl = await getRemoteUrl()
  const sessionIngressUrl =
    process.env.CLAUDE_BRIDGE_SESSION_INGRESS_URL || baseUrl

  // Assistant-mode sessions advertise a distinct worker_type so the web UI
  // can filter them into a dedicated picker. KAIROS guard keeps the
  // assistant module out of external builds entirely.
  let workerType: BridgeWorkerType = 'claude_code'
  if (feature('KAIROS')) {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { isAssistantMode } =
      require('../assistant/index.js') as typeof import('../assistant/index.js')
    /* eslint-enable @typescript-eslint/no-require-imports */
    if (isAssistantMode()) {
      workerType = 'claude_code_assistant'
    }
  }

  // 6. Delegate. BridgeCoreHandle is a structural superset of
  // ReplBridgeHandle (adds writeSdkMessages which REPL callers don't use),
  // so no adapter needed — just the narrower type on the way out.
  return attachAdoptLocalAiTitle(
    await initBridgeCore({
      dir: getOriginalCwd(),
      machineName: hostname(),
      branch,
      gitRepoUrl,
      title,
      baseUrl,
      sessionIngressUrl,
      workerType,
      getAccessToken: getBridgeAccessToken,
      createSession: opts =>
        createBridgeSession({
          ...opts,
          events: [],
          baseUrl,
          getAccessToken: getBridgeAccessToken,
        }),
      archiveSession: async sessionId => {
        const ok = await archiveBridgeSession(sessionId, {
          baseUrl,
          getAccessToken: getBridgeAccessToken,
          // gracefulShutdown.ts:407 races runCleanupFunctions against 2s.
          // Teardown also does stopWork (parallel) + deregister (sequential),
          // so archive can't have the full budget. 1.5s matches v2's
          // teardown_archive_timeout_ms default.
          timeoutMs: 1500,
        })
        if (!ok) {
          logForDebugging(
            `[bridge:repl] archiveBridgeSession failed for ${sessionId}`,
            { level: 'error' },
          )
        }
      },
      // getCurrentTitle is read on reconnect-after-env-lost to re-title the new
      // session. /rename writes to session storage; onUserMessage mutates
      // `title` directly — both paths are picked up here. Same R gate as v2:
      // owner-veto / no-backfill must not stamp this conversation's title onto
      // a freshly minted remote session.
      getCurrentTitle: () =>
        sessionTitleUnlessHistorySuppressed(getCurrentSessionTitle) ?? title,
      onUserMessage,
      toSDKMessages,
      onAuth401: handleOAuth401Error,
      getPollIntervalConfig,
      initialHistoryCap,
      // densable initialMessages: R ? void 0 : J — v1 must honor the same
      // withhold as env-less. Owner veto clears reattachSessionId so this
      // path is the default (GB v2 off / perpetual).
      initialMessages: forceNoHistoryBackfill ? undefined : initialMessages,
      previouslyFlushedUUIDs,
      onInboundMessage,
      onPermissionResponse,
      onInterrupt,
      onStopTask,
      onSetModel,
      onSetMaxThinkingTokens,
      onSetPermissionMode,
      onSetMcpPermissionModeOverride,
      onRenameSession,
      onGetWorkspaceDiff,
      onStateChange,
      perpetual,
      // densable classic Qt: B / He pass-through for left-arrow rit
      outboundOnly,
      sessionGroupingId,
    }),
  )
}

const TITLE_MAX_LEN = 50

/**
 * Quick placeholder title: strip display tags, take the first sentence,
 * collapse whitespace, truncate to 50 chars. Returns undefined if the result
 * is empty (e.g. message was only <local-command-stdout>). Replaced by
 * generateSessionTitle once Haiku resolves (~1-15s).
 */
function deriveTitle(raw: string): string | undefined {
  // Strip <ide_opened_file>, <session-start-hook>, etc. — these appear in
  // user messages when IDE/hooks inject context. stripDisplayTagsAllowEmpty
  // returns '' (not the original) so pure-tag messages are skipped.
  const clean = stripDisplayTagsAllowEmpty(raw)
  // First sentence is usually the intent; rest is often context/detail.
  // Capture group instead of lookbehind — keeps YARR JIT happy.
  const firstSentence = /^(.*?[.!?])\s/.exec(clean)?.[1] ?? clean
  // Collapse newlines/tabs — titles are single-line in the claude.ai list.
  const flat = firstSentence.replace(/\s+/g, ' ').trim()
  if (!flat) return undefined
  return flat.length > TITLE_MAX_LEN
    ? flat.slice(0, TITLE_MAX_LEN - 1) + '\u2026'
    : flat
}

export {
  HEADLESS_BRIDGE_WORKSPACE_DIFF_COMPUTE_BUDGET,
  REPL_WORKSPACE_DIFF_COMPUTE_BUDGET,
} from './workspaceDiffBudget.js'
