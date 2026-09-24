import { feature } from 'bun:bundle';
import { type FSWatcher, watch } from 'fs';
import React, { useCallback, useEffect, useRef } from 'react';
import {
  getSessionId,
  onInteraction,
  setMainLoopModelOverride,
  setReplBridgeActive,
  setReplBridgeSessionId,
} from '../bootstrap/state.js';
import {
  type BridgePermissionCallbacks,
  type BridgePermissionResponse,
  parseBridgePermissionResponse,
} from '../bridge/bridgePermissionCallbacks.js';
import { handleRemoteInterrupt } from '../bridge/remoteInterruptHandling.js';
import { isTranscriptResetResultReady, shouldDeferBridgeResult } from '../bridge/bridgeResultScheduling.js';
import {
  buildBridgeConnectUrl,
  formatRemoteControlOccupancyNotice,
  REMOTE_CONTROL_NOT_STARTED_HERE,
} from '../bridge/bridgeStatusUtil.js';
import type { LocalBridgeSessionHolder } from '../bridge/initReplBridge.js';
import { REPL_WORKSPACE_DIFF_COMPUTE_BUDGET } from '../bridge/initReplBridge.js';
import { getReplDiffHost } from '../utils/replDiffTab.js';
import {
  clearBridgeSessionMeta,
  getPersistedBridgeSession,
  saveBridgeSessionMeta,
} from '../bridge/bridgeSessionMeta.js';
import { HOST_ACCOUNT_CHANGED_HINT } from '../bridge/hostSignedOut.js';
import {
  clearBridgeSession,
  clearBridgeSessionCache,
  clearScanUncertaintyHoldSid,
  getCurrentSessionBridge,
  getProject,
  isCurrentSessionPrecautionarySuppressed,
  isLiveBridgeSuppressed,
  isSessionHistorySuppressed,
  markPrecautionarySessionSuppression,
  markResilientPrecautionSid,
  registerLiveSuppressionProbe,
  saveBridgeSession,
  writeHistorySuppression,
} from '../utils/sessionStorage.js';
import { registerCleanup } from '../utils/cleanupRegistry.js';
import { isEligibleBridgeMessage } from '../bridge/bridgeMessaging.js';
import { forwardAgentProgressSdkFrames } from '../bridge/subagentSdkFrames.js';
import { extractInboundMessageFields } from '../bridge/inboundMessages.js';
import type { BridgeState, ReplBridgeHandle } from '../bridge/replBridge.js';
import { setReplBridgeHandle } from '../bridge/replBridgeHandle.js';
import type { Command } from '../commands.js';
import { getSlashCommandToolSkills, isBridgeSafeCommand } from '../commands.js';
import { getRemoteSessionUrl } from '../constants/product.js';
import { useNotifications } from '../context/notifications.js';
import type { PermissionMode, SDKMessage } from '../entrypoints/agentSdkTypes.js';
import type { SDKControlResponse } from '../entrypoints/sdk/controlTypes.js';
import { Text } from '@anthropic/ink';
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../services/analytics/growthbook.js';
import { useAppState, useAppStateStore, useSetAppState } from '../state/AppState.js';
import type { Message } from '../types/message.js';
import { getCwd } from '../utils/cwd.js';
import { logForDebugging } from '../utils/debug.js';
import { errorMessage } from '../utils/errors.js';
import { enqueue } from '../utils/messageQueueManager.js';
import { buildSystemInitMessage } from '../utils/messages/systemInit.js';
import { createBridgeStatusMessage, createSystemMessage } from '../utils/messages.js';
import {
  createReadyPushSdkMessage,
  loadRemoteControlReadyNudgeConfig,
  recordRemoteControlReadyPushSent,
  REMOTE_CONTROL_READY_PUSH_MESSAGE,
  shouldEmitReadyPushByProbability,
  shouldSendRemoteControlReadyPushLive,
} from '../utils/remoteControlReadyPush.js';
import {
  drainSdkEvents,
  hasMatchingQueuedSdkEvent,
  isBridgeForwardableSdkEvent,
  setSdkEventEnqueueListener,
} from '../utils/sdkEventQueue.js';
import { buildTaskStateMessage, getTaskStateSnapshotKey, shouldPublishTaskState } from '../utils/taskStateMessage.js';
import omit from 'lodash-es/omit.js';
import { getMcpConfigByName } from '../services/mcp/config.js';
import { parseMcpPermissionModeOverride } from '../utils/permissions/mcpPermissionMode.js';
import {
  getAutoModeUnavailableNotification,
  getAutoModeUnavailableReason,
  isAutoModeGateEnabled,
  isBypassPermissionsModeDisabled,
  transitionPermissionMode,
} from '../utils/permissions/permissionSetup.js';
import { getLeaderToolUseConfirmQueue } from '../utils/swarm/leaderPermissionBridge.js';
import { getTaskListId, getTasksDir, listTasks, onTasksUpdated } from '../utils/tasks.js';
import { ContentBlockParam } from '@anthropic-ai/sdk/resources';
import { basename } from 'path';

type ReplBridgeOauthAccount = {
  accountUuid?: string;
  organizationUuid?: string;
};

/** densable `sK` / `oB` — GrowthBook kill switch, default ON. */
function isBridgeAuthReviveEnabled(): boolean {
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_auth_revive', true);
}

/** densable leftover hook `Z_` — same Fe/UG fields as init oauthAccountsMatch. */
function replBridgeOauthAccountsMatch(
  live: ReplBridgeOauthAccount | undefined,
  recorded: ReplBridgeOauthAccount,
): boolean {
  return (
    Boolean(live?.accountUuid) &&
    live?.accountUuid === recorded.accountUuid &&
    (live?.organizationUuid || undefined) === (recorded.organizationUuid || undefined)
  );
}

/** densable leftover hook `Ki` / init `xe` torn pair. */
function isReplBridgeSessionTorn(sid: string): boolean {
  const sessionFile = getProject().sessionFile ?? null;
  return sessionFile != null && basename(sessionFile) !== `${sid}.jsonl`;
}

/** densable leftover hook `RKt` / `J_e`. */
function isCompactionOrSummaryMarker(m: Message): boolean {
  return (
    (m.type === 'system' && m.subtype === 'compact_boundary') ||
    (m.type === 'user' && (m as { isCompactSummary?: boolean }).isCompactSummary === true)
  );
}

/** densable leftover hook `Pno` / `Z_e`. */
function shouldSkipBridgeHistoryBackfill(): boolean {
  return (
    isSessionHistorySuppressed() ||
    getCurrentSessionBridge()?.noHistoryBackfill === true ||
    isLiveBridgeSuppressed() ||
    isCurrentSessionPrecautionarySuppressed()
  );
}

type ReplBridgeEligibleCursor = { index: number; uuid: string };
type DeferredArchiveCallback = { fire: () => Promise<void>; unregister: () => void };
type ReplBridgeTranscriptCursor = {
  head?: string;
  tail?: ReplBridgeEligibleCursor;
  eligible?: ReplBridgeEligibleCursor;
};

const TASK_STATE_DEBOUNCE_MS = 50;
const TASK_STATE_POLL_MS = 5000;

/**
 * densable 2.1.224 #22 / GKT=1e4 — after failure, auto-clear replBridgeEnabled
 * (stop retries) but KEEP replBridgeError as the persistent failure indicator.
 * Changelog: was "only an 8-second toast"; densable keeps error + reconnect copy.
 */
export const BRIDGE_FAILURE_DISMISS_MS = 10_000;

/** densable fuse / terminal fail copy (PCt). */
export const BRIDGE_FUSE_HINT = 'disabled after repeated failures · restart to retry';

/**
 * Max consecutive initReplBridge failures before the hook stops re-attempting
 * for the session lifetime. Guards against paths that flip replBridgeEnabled
 * back on after auto-disable (settings sync, /remote-control, config tool)
 * when the underlying OAuth is unrecoverable — each re-attempt is another
 * guaranteed 401 against POST /v1/environments/bridge. Datadog 2026-03-08:
 * top stuck client generated 2,879 × 401/day alone (17% of all 401s on the
 * route).
 */
const MAX_CONSECUTIVE_INIT_FAILURES = 3;

/** densable `$e` `Pe.current=oL` — in-flight snapshot, not a real token. */
const AUTH_FAIL_TOKEN_LOADING = Symbol('authFailTokenLoading');

/**
 * Hook that initializes an always-on bridge connection in the background
 * and writes new user/assistant messages to the bridge session.
 *
 * Silently skips if bridge is not enabled or user is not OAuth-authenticated.
 *
 * Watches AppState.replBridgeEnabled — when toggled off (via /config or footer),
 * the bridge is torn down. When toggled back on, it re-initializes.
 *
 * Inbound messages from claude.ai are injected into the REPL via queuedCommands.
 */
export function useReplBridge(
  messages: Message[],
  setMessages: (action: React.SetStateAction<Message[]>) => void,
  abortControllerRef: React.RefObject<AbortController | null>,
  commands: readonly Command[],
  mainLoopModel: string,
): { sendBridgeResult: () => void } {
  const handleRef = useRef<ReplBridgeHandle | null>(null);
  const teardownPromiseRef = useRef<Promise<void> | undefined>(undefined);
  const lastWrittenIndexRef = useRef(0);
  const pendingResultAfterFlushRef = useRef(false);
  const transcriptResetPendingRef = useRef(false);
  // Tracks UUIDs already flushed as initial messages. Persists across
  // bridge reconnections so Bridge #2+ only sends new messages — sending
  // duplicate UUIDs causes the server to kill the WebSocket.
  const flushedUUIDsRef = useRef(new Set<string>());
  const failureTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Persists across effect re-runs (unlike the effect's local state). Reset
  // only on successful init. Hits MAX_CONSECUTIVE_INIT_FAILURES → fuse blown
  // for the session, regardless of replBridgeEnabled re-toggling.
  const consecutiveFailuresRef = useRef(0);
  // Official 2.1.207: after reconnect / credential refresh, force one full
  // task_state publish even when the snapshot key + handle identity match.
  // Remote clients lose ephemeral task status across the transport rebuild.
  const forceTaskStatePublishRef = useRef<(() => void) | null>(null);
  // densable A.current — user-activity latch while bridge handle exists (Dkr/toi)
  const userActivityWhileConnectedRef = useRef(false);
  // densable w.current — already-sent ready-push for this connect cycle
  const readyPushSentRef = useRef(false);
  // densable x.current — reattach session treated like outboundOnly for oZp gate
  const bridgeReattachRef = useRef(process.env.CLAUDE_BRIDGE_REATTACH_SESSION !== undefined);
  // densable W.current — last live cse_* passed as reattachSessionId (Xn).
  // Occupancy qn only fires when this is empty and init fills from Bkn.
  const lastBridgeSessionIdRef = useRef<string | undefined>(undefined);
  // densable leftover hook `ie` / `Se` / `te` / `ee` / `K` / `de`.
  // Official hook import remap @229911522 (NOT `function HR(` hits):
  //   GUa as HR ← qXs as GUa = markPrecautionarySessionSuppression
  //   JUa as jR ← KXs as JUa = markResilientPrecautionSid
  //   MUa as FK ← ZXs as MUa = clearScanUncertaintyHoldSid
  //   ZUa as tC ← r9s as ZUa = b4t(Yn()) = clearBridgeSessionCache
  //   FUa as zc ← Xg as FUa = identity
  // fe / Z are hook-local refs (not imports).
  //   Z.current = F.current.eligible {index, uuid}
  //   fe.current = gt.archive ? {fire:Dt, unregister:Ja(Dt)} : void 0
  // xe/Pn/tC/fe/Z/F/Gi leftover-wired. Ja=`registerCleanup`. archive on handle.
  const stashOauthRef = useRef<ReplBridgeOauthAccount | undefined>(undefined);
  const liveOauthRef = useRef<ReplBridgeOauthAccount | undefined>(undefined);
  const suppressLatchSidRef = useRef<string | undefined>(undefined);
  const persistSuppressedRef = useRef(false);
  const firstMessageUuidRef = useRef<string | undefined>(undefined);
  const lastSeqRef = useRef<number | undefined>(undefined);
  const flushedAtTeardownRef = useRef<Set<string> | undefined>(undefined);
  const writtenLengthAtTeardownRef = useRef<number | undefined>(undefined);
  const eligibleCursorRef = useRef<ReplBridgeEligibleCursor | undefined>(undefined);
  const deferredArchiveRef = useRef<DeferredArchiveCallback | undefined>(undefined);
  const transcriptCursorRef = useRef<ReplBridgeTranscriptCursor>({});
  const giTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const leftoverEnRef = useRef(false);
  const leftoverGRef = useRef(false);
  const leftoverURef = useRef(false);
  const teardownSidRef = useRef<string | undefined>(undefined);

  /**
   * densable leftover hook `l_e` @230328570.
   * `!sessionActive && !outboundOnly && QK(conversation_reset)`.
   */
  const leftoverL_e = (handle: { outboundOnly?: boolean }, sessionActive: boolean): boolean => {
    return !sessionActive && !handle.outboundOnly && hasMatchingQueuedSdkEvent(o => o.type === 'conversation_reset');
  };

  /**
   * densable leftover hook `a_e` @230328395.
   * `zK().filter(S_e).map(iCe)` — drain already stamps uuid/session_id.
   */
  const leftoverA_e = (handle: { writeSdkMessages: (events: SDKMessage[]) => void }): void => {
    try {
      const t = drainSdkEvents().filter(isBridgeForwardableSdkEvent);
      if (t.length > 0) handle.writeSdkMessages(t as unknown as SDKMessage[]);
    } catch (err) {
      logForDebugging(`[bridge:repl] queued SDK event forward failed: ${errorMessage(err)}`, {
        level: 'error',
      });
    }
  };

  const leftoverXe = ({ archiveAbandoned: oe }: { archiveAbandoned: boolean }): boolean => {
    lastBridgeSessionIdRef.current = undefined;
    lastSeqRef.current = undefined;
    flushedAtTeardownRef.current = undefined;
    writtenLengthAtTeardownRef.current = undefined;
    firstMessageUuidRef.current = undefined;
    eligibleCursorRef.current = undefined;
    teardownSidRef.current = undefined;
    stashOauthRef.current = undefined;
    suppressLatchSidRef.current = undefined;
    const ge = deferredArchiveRef.current;
    deferredArchiveRef.current = undefined;
    if (!ge) return false;
    if (oe) {
      void ge.fire().finally(() => {
        ge.unregister();
      });
      return true;
    }
    ge.unregister();
    return false;
  };
  // densable ne/ve — one-shot auth-revive latch consumed at the next init.
  const reviveLatchRef = useRef(false);
  const reviveExpectedAccountRef = useRef<{ accountUuid?: string; organizationUuid?: string } | undefined>(undefined);
  const authFailTokenRef = useRef<string | undefined | typeof AUTH_FAIL_TOKEN_LOADING>(undefined);
  const authFailAccountRef = useRef<{ accountUuid?: string; organizationUuid?: string } | undefined>(undefined);
  const authFailGenerationRef = useRef(0);
  const authFailFetchEpochRef = useRef(0);
  /** densable `ye` — unattended revive count; cap `Qtt=10`. */
  const authReviveCountRef = useRef(0);
  const setAppState = useSetAppState();
  const commandsRef = useRef(commands);
  commandsRef.current = commands;
  const mainLoopModelRef = useRef(mainLoopModel);
  mainLoopModelRef.current = mainLoopModel;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const store = useAppStateStore();
  const { addNotification } = useNotifications();
  const replBridgeEnabledRaw = useAppState(s => s.replBridgeEnabled);
  const replBridgeEnabled = feature('BRIDGE_MODE') ? replBridgeEnabledRaw : false;
  const replBridgeConnectedRaw = useAppState(s => s.replBridgeConnected);
  const replBridgeConnected = feature('BRIDGE_MODE') ? replBridgeConnectedRaw : false;
  const replBridgeSessionActiveRaw = useAppState(s => s.replBridgeSessionActive);
  const replBridgeSessionActive = feature('BRIDGE_MODE') ? replBridgeSessionActiveRaw : false;
  const replBridgeOutboundOnlyRaw = useAppState(s => s.replBridgeOutboundOnly);
  const replBridgeOutboundOnly = feature('BRIDGE_MODE') ? replBridgeOutboundOnlyRaw : false;
  const replBridgeInitialNameRaw = useAppState(s => s.replBridgeInitialName);
  const replBridgeInitialName = feature('BRIDGE_MODE') ? replBridgeInitialNameRaw : undefined;
  const replBridgeExplicitRaw = useAppState(s => s.replBridgeExplicit);
  const replBridgeExplicit = feature('BRIDGE_MODE') ? replBridgeExplicitRaw : false;
  const replBridgeErrorRaw = useAppState(s => s.replBridgeError);
  const replBridgeError = feature('BRIDGE_MODE') ? replBridgeErrorRaw : undefined;
  const replBridgeErrorKindRaw = useAppState(s => s.replBridgeErrorKind);
  const replBridgeErrorKind = feature('BRIDGE_MODE') ? replBridgeErrorKindRaw : undefined;
  const authChangeGeneration = useAppState(s => s.authChangeGeneration);

  // densable: qE.useEffect(()=>Dkr(()=>{if(d.current)A.current=!0}),[])
  // Latch user activity while a bridge handle is live — suppress ready-push.
  useEffect(() => {
    if (feature('BRIDGE_MODE')) {
      return onInteraction(() => {
        if (handleRef.current) {
          userActivityWhileConnectedRef.current = true;
        }
      });
    }
  }, []);

  // Initialize/teardown bridge when enabled state changes.
  // Passes current messages as initialMessages so the remote session
  // starts with the existing conversation context (e.g. from /bridge).
  useEffect(() => {
    // feature() check must use positive pattern for dead code elimination —
    // negative pattern (if (!feature(...)) return) does NOT eliminate
    // dynamic imports below.
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeEnabled) return;

      // densable resets A/w latches per connect cycle (new effect run)
      userActivityWhileConnectedRef.current = false;
      readyPushSentRef.current = false;

      const outboundOnly = replBridgeOutboundOnly;

      /**
       * densable rt — toast/notification. wasConnected → "disconnected" vs "failed".
       */
      function notifyBridgeFailed(detail?: string, wasConnected = false): void {
        if (outboundOnly) return;
        addNotification({
          key: 'bridge-failed',
          jsx: (
            <>
              <Text color="error">{wasConnected ? 'Remote Control disconnected' : 'Remote Control failed'}</Text>
              <Text dimColor> · {detail || '/remote-control'}</Text>
            </>
          ),
          priority: 'immediate',
        });
      }

      /**
       * densable qe — system warning with reconnect shortcut unless detail already
       * embeds an action (/login, /remote-control, restart, policy, update).
       */
      function appendBridgeDisconnectMessage(detail?: string): void {
        if (outboundOnly) return;
        const hasAction =
          !!detail &&
          (detail.includes('/login') ||
            detail.includes('/remote-control') ||
            detail.includes('restart') ||
            detail.includes('policy') ||
            detail.includes('update'));
        const content = `Remote Control disconnected${detail ? ` — ${detail}` : ''}${
          hasAction ? '' : ' — run /remote-control to reconnect'
        }`;
        setMessages(prev => {
          const last = prev.at(-1);
          if (last?.type === 'system' && last.subtype === 'informational' && last.content === content) {
            return prev;
          }
          return [...prev, createSystemMessage(content, 'warning')];
        });
      }

      /**
       * densable nr — after GKT, disable bridge but KEEP replBridgeError (persistent
       * indicator). Local pre-224 cleared the error on the same timer (= toast-only).
       */
      function leftoverGi(): void {
        const Ge = transcriptCursorRef.current.head;
        const et = transcriptCursorRef.current.eligible;
        const s_e = 1e4;
        clearTimeout(giTimerRef.current);
        giTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          giTimerRef.current = undefined;
          const gt = handleRef.current;
          if (gt) {
            lastBridgeSessionIdRef.current = gt.bridgeSessionId;
            lastSeqRef.current = gt.getLastSequenceNum?.();
            suppressLatchSidRef.current = persistSuppressedRef.current ? getSessionId() : undefined;
            flushedAtTeardownRef.current =
              flushedUUIDsRef.current.size > 0 ? new Set(flushedUUIDsRef.current) : undefined;
            writtenLengthAtTeardownRef.current = lastWrittenIndexRef.current;
            firstMessageUuidRef.current = Ge;
            eligibleCursorRef.current = et;
            teardownSidRef.current = getSessionId();
            stashOauthRef.current = liveOauthRef.current;
            deferredArchiveRef.current?.unregister();
            const eo = stashOauthRef.current;
            const Dt = async (): Promise<void> => {
              if (eo?.accountUuid === undefined) return;
              let go: ReplBridgeOauthAccount | undefined;
              try {
                const { getOauthAccountInfoFromDisk } =
                  require('../utils/auth.js') as typeof import('../utils/auth.js');
                const live = getOauthAccountInfoFromDisk();
                if (live?.accountUuid) {
                  go = {
                    accountUuid: live.accountUuid,
                    organizationUuid: live.organizationUuid,
                  };
                }
              } catch {
                return;
              }
              if (!replBridgeOauthAccountsMatch(go, eo)) return;
              await gt.archive?.().catch((Mo: unknown) => {
                logForDebugging(`[bridge:repl] Deferred archive failed: ${errorMessage(Mo)}`, { level: 'error' });
              });
            };
            deferredArchiveRef.current = gt.archive ? { fire: Dt, unregister: registerCleanup(Dt) } : undefined;
          }
          leftoverEnRef.current = true;
          setAppState(prev => {
            if (!prev.replBridgeError) return prev;
            return {
              ...prev,
              replBridgeEnabled: false,
              replBridgeSessionGroupingId: undefined,
              ...(gt ? { replBridgeSkipNextArchive: true } : {}),
            };
          });
        }, s_e);
      }

      /**
       * densable nr — after GKT, disable bridge but KEEP replBridgeError (persistent
       * indicator). Local pre-224 cleared the error on the same timer (= toast-only).
       * Official `Gi` @230335123 is the same `s_e=1e4` timer + stash + disable.
       */
      function scheduleBridgeAutoDisable(): void {
        leftoverGi();
      }

      /**
       * densable nt — notify + transcript + set error/kind + schedule auto-disable.
       */
      function surfaceBridgeFailure(
        detail: string | undefined,
        opts?: { kind?: string; wasConnected?: boolean },
      ): void {
        const kind = opts?.kind ?? 'terminal';
        const wasConnected = opts?.wasConnected ?? false;
        if (kind === 'auth') {
          // densable `$e` @230333100 — Pe=oL immediately; abort token if
          // authChangeGeneration moved mid-flight.
          authFailTokenRef.current = AUTH_FAIL_TOKEN_LOADING;
          authFailGenerationRef.current = store.getState().authChangeGeneration;
          const fetchEpoch = ++authFailFetchEpochRef.current;
          const { getClaudeAIOAuthTokens, getOauthAccountInfoFromDisk } =
            require('../utils/auth.js') as typeof import('../utils/auth.js');
          void Promise.resolve()
            .then(() => {
              try {
                const tokens = getClaudeAIOAuthTokens();
                const acct = getOauthAccountInfoFromDisk();
                return {
                  token: tokens?.accessToken,
                  account: acct?.accountUuid
                    ? {
                        accountUuid: acct.accountUuid,
                        organizationUuid: acct.organizationUuid,
                      }
                    : undefined,
                };
              } catch {
                return { token: undefined, account: undefined };
              }
            })
            .then(snap => {
              if (authFailFetchEpochRef.current !== fetchEpoch) return;
              if (store.getState().authChangeGeneration !== authFailGenerationRef.current) {
                authFailAccountRef.current = snap.account;
                authFailTokenRef.current = undefined;
                return;
              }
              authFailAccountRef.current = snap.account;
              authFailTokenRef.current = snap.token;
            })
            .catch(() => {
              if (authFailFetchEpochRef.current !== fetchEpoch) return;
              authFailTokenRef.current = undefined;
            });
        }
        notifyBridgeFailed(detail, wasConnected);
        appendBridgeDisconnectMessage(detail);
        setAppState(prev => ({
          ...prev,
          replBridgeError: detail,
          replBridgeErrorKind: kind,
          replBridgeReconnecting: false,
          replBridgeSessionActive: false,
          replBridgeConnected: false,
        }));
        scheduleBridgeAutoDisable();
      }

      // densable: clear prior failure indicator when a new connect cycle starts
      if (!outboundOnly) {
        setAppState(prev => {
          if (prev.replBridgeError === undefined && prev.replBridgeErrorKind === undefined) {
            return prev;
          }
          return {
            ...prev,
            replBridgeError: undefined,
            replBridgeErrorKind: undefined,
          };
        });
      }

      if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_INIT_FAILURES) {
        logForDebugging(
          `[bridge:repl] Hook: ${consecutiveFailuresRef.current} consecutive init failures, not retrying this session`,
        );
        // Clear replBridgeEnabled so /remote-control doesn't mistakenly show
        // BridgeDisconnectDialog for a bridge that never connected.
        notifyBridgeFailed(BRIDGE_FUSE_HINT);
        appendBridgeDisconnectMessage(BRIDGE_FUSE_HINT);
        setAppState(prev => {
          if (
            prev.replBridgeError === BRIDGE_FUSE_HINT &&
            prev.replBridgeErrorKind === 'terminal' &&
            !prev.replBridgeEnabled
          ) {
            return prev;
          }
          return {
            ...prev,
            replBridgeError: BRIDGE_FUSE_HINT,
            replBridgeErrorKind: 'terminal',
            replBridgeEnabled: false,
          };
        });
        return;
      }

      let cancelled = false;
      // Capture messages.length now so we don't re-send initial messages
      // through writeMessages after the bridge connects.
      const initialMessageCount = messages.length;

      void (async () => {
        try {
          // Wait for any in-progress teardown to complete before registering
          // a new environment. Without this, the deregister HTTP call from
          // the previous teardown races with the new register call, and the
          // server may tear down the freshly-created environment.
          if (teardownPromiseRef.current) {
            logForDebugging('[bridge:repl] Hook: waiting for previous teardown to complete before re-init');
            await teardownPromiseRef.current;
            teardownPromiseRef.current = undefined;
            logForDebugging('[bridge:repl] Hook: previous teardown complete, proceeding with re-init');
          }
          if (cancelled) return;

          // Dynamic import so the module is tree-shaken in external builds
          const { initReplBridge } = await import('../bridge/initReplBridge.js');
          const { shouldShowAppUpgradeMessage } = await import('../bridge/envLessBridgeConfig.js');

          // Assistant mode: perpetual bridge session — claude.ai shows one
          // continuous conversation across CLI restarts instead of a new
          // session per invocation. initBridgeCore reads bridge-pointer.json
          // (the same crash-recovery file #20735 added) and reuses its
          // {environmentId, sessionId} via reuseEnvironmentId +
          // api.reconnectSession(). Teardown skips archive/deregister/
          // pointer-clear so the session survives clean exits, not just
          // crashes. Non-assistant bridges clear the pointer on teardown
          // (crash-recovery only).
          let perpetual = false;
          if (feature('KAIROS')) {
            const { isAssistantMode } = await import('../assistant/index.js');
            perpetual = isAssistantMode();
          }

          // When a user message arrives from claude.ai, inject it into the REPL.
          // Preserves the original UUID so that when the message is forwarded
          // back to CCR, it matches the original — avoiding duplicate messages.
          //
          // Async because file_attachments (if present) need a network fetch +
          // disk write before we enqueue with the @path prefix. Caller doesn't
          // await — messages with attachments just land in the queue slightly
          // later, which is fine (web messages aren't rapid-fire).
          async function handleInboundMessage(msg: SDKMessage): Promise<void> {
            try {
              const fields = extractInboundMessageFields(msg);
              if (!fields) return;

              const { uuid, clientPlatform } = fields;

              // Dynamic import keeps the bridge code out of non-BRIDGE_MODE builds.
              const { resolveAndPrepend } = await import('../bridge/inboundAttachments.js');
              const rawContent = fields.content;
              let sanitized: string | Array<{ type: string; [key: string]: unknown }> =
                typeof rawContent === 'string'
                  ? rawContent
                  : (rawContent as unknown as Array<{ type: string; [key: string]: unknown }>);
              if (feature('KAIROS_GITHUB_WEBHOOKS')) {
                /* eslint-disable @typescript-eslint/no-require-imports */
                const { sanitizeInboundWebhookContent } =
                  require('../bridge/webhookSanitizer.js') as typeof import('../bridge/webhookSanitizer.js');
                /* eslint-enable @typescript-eslint/no-require-imports */
                if (typeof sanitized === 'string') {
                  sanitized = sanitizeInboundWebhookContent(sanitized);
                }
              }
              const content = await resolveAndPrepend(msg, sanitized as string | ContentBlockParam[]);

              const preview = typeof content === 'string' ? content.slice(0, 80) : `[${content.length} content blocks]`;
              logForDebugging(`[bridge:repl] Injecting inbound user message: ${preview}${uuid ? ` uuid=${uuid}` : ''}`);
              enqueue({
                value: content,
                mode: 'prompt' as const,
                uuid,
                // skipSlashCommands stays true as defense-in-depth —
                // processUserInputBase overrides it internally when bridgeOrigin
                // is set AND the resolved command passes isBridgeSafeCommand.
                // This keeps exit-word suppression and immediate-command blocks
                // intact for any code path that checks skipSlashCommands directly.
                skipSlashCommands: true,
                bridgeOrigin: true,
                // Official: client_platform → QueuedCommand.clientPlatform for
                // concurrent onQuery re-queue + drain round-trip.
                ...(clientPlatform !== undefined ? { clientPlatform } : {}),
              });
            } catch (e) {
              logForDebugging(`[bridge:repl] handleInboundMessage failed: ${e}`, { level: 'error' });
            }
          }

          // densable 2.1.251 #22: policy_disabled latches a quiet notice for the
          // post-init null branch (not surfaceBridgeFailure / not failed toast).
          let policyDisabledNotice: string | undefined;
          // State change callback — maps bridge lifecycle events to AppState.
          function handleStateChange(state: BridgeState, detail?: string, kind?: string): void {
            if (cancelled) return;
            // densable: Ur==="policy_disabled" → np=si; return (no failed UI).
            if (state === 'policy_disabled') {
              policyDisabledNotice = detail ?? "disabled by your organization's policy";
              return;
            }
            // densable eDe: FC/replBridgeActive true on connected|ready (when
            // handle exists), false on failed — gates JT enqueue for RC mid-join.
            if (state === 'failed') {
              setReplBridgeActive(false);
            } else if ((state === 'connected' || state === 'ready') && handleRef.current) {
              setReplBridgeActive(true);
            }
            if (outboundOnly) {
              logForDebugging(`[bridge:repl] Mirror state=${state}${detail ? ` detail=${detail}` : ''}`);
              // Sync replBridgeConnected so the forwarding effect starts/stops
              // writing as the transport comes up or dies.
              if (state === 'failed') {
                setAppState(prev => {
                  if (!prev.replBridgeConnected) return prev;
                  return { ...prev, replBridgeConnected: false };
                });
              } else if (state === 'ready' || state === 'connected') {
                setAppState(prev => {
                  if (prev.replBridgeConnected) return prev;
                  return { ...prev, replBridgeConnected: true };
                });
              }
              return;
            }
            const handle = handleRef.current;
            switch (state) {
              case 'ready': {
                // sessionId must be outside setAppState — callback scope would
                // throw ReferenceError and leave bootstrap cse_* unwritten
                // after failed→ready reconnect (G7 teleport mark would miss).
                const sessionId = handle?.bridgeSessionId;
                setAppState(prev => {
                  const connectUrl =
                    handle && handle.environmentId !== ''
                      ? buildBridgeConnectUrl(handle.environmentId, handle.sessionIngressUrl)
                      : prev.replBridgeConnectUrl;
                  const sessionUrl = handle
                    ? getRemoteSessionUrl(handle.bridgeSessionId, handle.sessionIngressUrl)
                    : prev.replBridgeSessionUrl;
                  const envId = handle?.environmentId;
                  if (
                    prev.replBridgeConnected &&
                    !prev.replBridgeSessionActive &&
                    !prev.replBridgeReconnecting &&
                    prev.replBridgeConnectUrl === connectUrl &&
                    prev.replBridgeSessionUrl === sessionUrl &&
                    prev.replBridgeEnvironmentId === envId &&
                    prev.replBridgeSessionId === sessionId
                  ) {
                    return prev;
                  }
                  return {
                    ...prev,
                    replBridgeConnected: true,
                    replBridgeSessionActive: false,
                    replBridgeReconnecting: false,
                    replBridgeConnectUrl: connectUrl,
                    replBridgeSessionUrl: sessionUrl,
                    replBridgeEnvironmentId: envId,
                    replBridgeSessionId: sessionId,
                    replBridgeError: undefined,
                    replBridgeErrorKind: undefined,
                  };
                });
                if (sessionId) setReplBridgeSessionId(sessionId);
                break;
              }
              case 'connected': {
                const wasSessionActive = store.getState().replBridgeSessionActive;
                setAppState(prev => {
                  if (prev.replBridgeSessionActive) return prev;
                  return {
                    ...prev,
                    replBridgeConnected: true,
                    replBridgeSessionActive: true,
                    replBridgeReconnecting: false,
                    replBridgeError: undefined,
                    replBridgeErrorKind: undefined,
                  };
                });
                // Notify model about newly available bridge-dependent tools
                if (!wasSessionActive) {
                  setMessages(prev => [
                    ...prev,
                    createSystemMessage(
                      'Remote Control 已连接。现在可以使用 PushNotification、SendUserFile、Brief 工具，请使用 SearchExtraTools 搜索发现。',
                      'info',
                    ),
                  ]);
                }
                // Force-republish full task_state after reconnect / credential
                // refresh. Dedupe by snapshot key + handle would otherwise skip
                // when tasks are unchanged, leaving remote clients without status
                // after they lost the prior ephemeral stream. If the session was
                // inactive (reconnecting path), the task-state effect remounts
                // and publishes on its own; this covers the still-active path.
                forceTaskStatePublishRef.current?.();
                // densable #31 ready-push:
                // if (zt&&!w.current&&!A.current){cfg=nZp(); if(cfg&&oZp(cfg,we,He)){
                //   w.current=!0; if(prob) zt.writeSdkMessages([bzu(YQp,Et())]); iZp(cfg)}}
                // we = replBridgeExplicit; He = reattach (x.current) | densable also
                // folds outbound into oZp third arg — local outboundOnly already
                // returned above, so only reattach remains for He.
                if (handle && !readyPushSentRef.current && !userActivityWhileConnectedRef.current) {
                  const readyCfg = loadRemoteControlReadyNudgeConfig();
                  const explicit = store.getState().replBridgeExplicit;
                  const reattachOrOutbound = bridgeReattachRef.current;
                  if (readyCfg && shouldSendRemoteControlReadyPushLive(readyCfg, explicit, reattachOrOutbound)) {
                    // densable: w.current=!0 always once gate passes; write+iZp only if prob
                    readyPushSentRef.current = true;
                    if (shouldEmitReadyPushByProbability(readyCfg.probability, Math.random())) {
                      handle.writeSdkMessages([
                        createReadyPushSdkMessage(REMOTE_CONTROL_READY_PUSH_MESSAGE, getSessionId()),
                      ]);
                      // densable iZp only on the write path (comma after writeSdkMessages)
                      recordRemoteControlReadyPushSent(readyCfg);
                    }
                  }
                }
                // Send system/init so remote clients (web/iOS/Android) get
                // session metadata. REPL uses query() directly — never hits
                // QueryEngine's SDKMessage layer — so this is the only path
                // to put system/init on the REPL-bridge wire. Skills load is
                // async (memoized, cheap after REPL startup); fire-and-forget
                // so the connected-state transition isn't blocked.
                if (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bridge_system_init', false)) {
                  void (async () => {
                    try {
                      const skills = await getSlashCommandToolSkills(getCwd());
                      if (cancelled) return;
                      const state = store.getState();
                      handleRef.current?.writeSdkMessages([
                        buildSystemInitMessage({
                          // tools/mcpClients/plugins redacted for REPL-bridge:
                          // MCP-prefixed tool names and server names leak which
                          // integrations the user has wired up; plugin paths leak
                          // raw filesystem paths (username, project structure).
                          // CCR v2 persists SDK messages to Spanner — users who
                          // tap "Connect from phone" may not expect these on
                          // Anthropic's servers. QueryEngine (SDK) still emits
                          // full lists — SDK consumers expect full telemetry.
                          tools: [],
                          mcpClients: [],
                          model: mainLoopModelRef.current,
                          permissionMode: state.toolPermissionContext.mode as PermissionMode, // TODO: avoid the cast
                          // Remote clients can only invoke bridge-safe commands —
                          // advertising unsafe ones (local-jsx, unallowed local)
                          // would let mobile/web attempt them and hit errors.
                          commands: commandsRef.current.filter(isBridgeSafeCommand),
                          agents: state.agentDefinitions.activeAgents,
                          skills,
                          plugins: [],
                          fastMode: state.fastMode,
                        }),
                      ]);
                    } catch (err) {
                      logForDebugging(`[bridge:repl] Failed to send system/init: ${errorMessage(err)}`, {
                        level: 'error',
                      });
                    }
                  })();
                }
                break;
              }
              case 'reconnecting':
                setAppState(prev => {
                  if (prev.replBridgeReconnecting) return prev;
                  return {
                    ...prev,
                    replBridgeReconnecting: true,
                    replBridgeSessionActive: false,
                  };
                });
                break;
              case 'failed':
                // densable case"failed": rt + set error/kind + qe + nr (keep error after disable)
                clearTimeout(failureTimeoutRef.current);
                surfaceBridgeFailure(detail, {
                  kind: kind ?? 'terminal',
                  wasConnected: handleRef.current !== null,
                });
                break;
              case 'policy_disabled':
                // densable: handled above (np latch). Keep union exhaustive.
                return;
            }
          }

          // Map of pending bridge permission response handlers, keyed by request_id.
          // Each entry is an onResponse handler waiting for CCR to reply.
          const pendingPermissionHandlers = new Map<string, (response: BridgePermissionResponse) => void>();

          // Dispatch incoming control_response messages to registered handlers
          function handlePermissionResponse(msg: SDKControlResponse): void {
            const requestId = msg.response?.request_id;
            if (!requestId) return;
            const handler = pendingPermissionHandlers.get(requestId);
            if (!handler) {
              logForDebugging(`[bridge:repl] No handler for control_response request_id=${requestId}`);
              return;
            }
            const parsed = parseBridgePermissionResponse(msg);
            if (!parsed) {
              logForDebugging(`[bridge:repl] Ignoring unrecognized control_response request_id=${requestId}`);
              return;
            }
            pendingPermissionHandlers.delete(requestId);
            handler(parsed);
          }

          let declinedHolder: LocalBridgeSessionHolder | undefined;
          // densable Yn=ne.current; ne.current=!1; Dr=ve.current; ve.current=void 0
          const reviveInitiated = reviveLatchRef.current;
          reviveLatchRef.current = false;
          const expectedAccount = reviveExpectedAccountRef.current;
          reviveExpectedAccountRef.current = undefined;
          const { getOauthAccountInfoFromDisk } = require('../utils/auth.js') as typeof import('../utils/auth.js');
          const { logEvent } =
            require('../services/analytics/index.js') as typeof import('../services/analytics/index.js');
          // densable leftover hook `xe({archiveAbandoned})` — hook-scope leftoverXe.
          const historySid = getSessionId();
          if (teardownSidRef.current !== undefined && teardownSidRef.current !== historySid) {
            leftoverXe({ archiveAbandoned: true });
          }
          // densable leftover `Pn` + official `if(Pn) tC()`.
          const leftoverPn =
            (firstMessageUuidRef.current !== undefined && messages[0]?.uuid !== firstMessageUuidRef.current) ||
            (eligibleCursorRef.current !== undefined &&
              messages[eligibleCursorRef.current.index]?.uuid !== eligibleCursorRef.current.uuid);
          if (leftoverPn) {
            clearBridgeSessionCache();
          }
          if (!leftoverPn && lastBridgeSessionIdRef.current !== undefined) {
            for (const id of flushedAtTeardownRef.current ?? []) {
              flushedUUIDsRef.current.add(id);
            }
          }
          let leftoverEt = false;
          let leftoverGt = false;
          let leftoverEo: ReplBridgeOauthAccount | undefined;
          if (lastBridgeSessionIdRef.current !== undefined) {
            const stashed = stashOauthRef.current;
            const live = getOauthAccountInfoFromDisk();
            if (live?.accountUuid) {
              leftoverEo = {
                accountUuid: live.accountUuid,
                organizationUuid: live.organizationUuid,
              };
            }
            if (cancelled) return;
            leftoverGt = !stashed?.accountUuid;
            const identityUnreadable = Boolean(stashed?.accountUuid) && !live?.accountUuid;
            const ownerMismatch =
              stashed !== undefined &&
              Boolean(stashed.accountUuid) &&
              Boolean(live?.accountUuid) &&
              !replBridgeOauthAccountsMatch(live, stashed);
            if (ownerMismatch || identityUnreadable) {
              if (reviveInitiated) {
                logForDebugging(
                  '[bridge:repl] Auto-revive aborted: stash owner vs current account mismatch/unreadable at init',
                );
                setAppState(prev => ({
                  ...prev,
                  replBridgeEnabled: false,
                  replBridgeError: HOST_ACCOUNT_CHANGED_HINT,
                  replBridgeErrorKind: 'terminal',
                }));
                return;
              }
              logForDebugging(
                ownerMismatch
                  ? '[bridge:repl] Reattach stash owner differs from current credential account — dropping stash, minting fresh (history not uploaded)'
                  : '[bridge:repl] Current account identity unreadable with an owned stash — dropping stash, minting fresh (history not uploaded)',
              );
              leftoverEt = true;
              deferredArchiveRef.current?.unregister();
              deferredArchiveRef.current = undefined;
              // densable leftover `HR(zc(Ur)),jR(zc(Ur)),FK(zc(Ur))`.
              markPrecautionarySessionSuppression(historySid);
              markResilientPrecautionSid(historySid);
              clearScanUncertaintyHoldSid(historySid);
              const torn = isReplBridgeSessionTorn(historySid);
              if (ownerMismatch && !torn) {
                logEvent('rc_cross_account_suppression', {});
              } else {
                logEvent('rc_cross_account_suppression', {
                  reason: (torn
                    ? 'torn_entry_pair'
                    : 'identity_unreadable') as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              }
              if (ownerMismatch && !torn) {
                writeHistorySuppression(
                  historySid as import('crypto').UUID,
                  getProject().sessionFile ?? undefined,
                  'chokepoint_veto',
                  live?.accountUuid,
                );
              } else if (ownerMismatch) {
                logForDebugging(
                  '[bridge:repl] Chokepoint veto under a TORN entry pair: precautionary suppression only, no permanent taint write',
                  { level: 'warn' },
                );
              }
              // densable leftover `xe({archiveAbandoned:!1}),Vn.clear(),Xo()===Ur)tC()`.
              // ZUa as tC ← r9s as ZUa = b4t(Yn()) = clearBridgeSessionCache.
              // Xo=`getSessionId`.
              leftoverXe({ archiveAbandoned: false });
              flushedUUIDsRef.current.clear();
              if (getSessionId() === historySid) {
                clearBridgeSessionCache();
              }
            }
          }
          const leftoverDt = suppressLatchSidRef.current === historySid;
          persistSuppressedRef.current = leftoverEt || leftoverDt || (leftoverGt && leftoverPn);
          const leftoverMo = leftoverGt && leftoverPn;
          const rawHandle = await initReplBridge({
            host: getReplDiffHost(),
            workspaceDiffComputeBudget: REPL_WORKSPACE_DIFF_COMPUTE_BUDGET,
            getToolPermissionContext: () => store.getState().toolPermissionContext,
            outboundOnly,
            reattachSessionId: leftoverPn ? undefined : lastBridgeSessionIdRef.current,
            reattachOrFail: leftoverPn
              ? false
              : (reviveInitiated && lastBridgeSessionIdRef.current !== undefined) || leftoverGt,
            reviveInitiated,
            expectedAccount: reviveInitiated ? expectedAccount : leftoverEo,
            tags: outboundOnly ? ['ccr-mirror'] : undefined,
            localHolderGuard:
              reviveInitiated || (!outboundOnly && !replBridgeExplicit)
                ? {
                    mode: 'decline',
                    onDeclined: holder => {
                      declinedHolder = holder;
                    },
                  }
                : { mode: 'observe' },
            onInboundMessage: handleInboundMessage,
            onPermissionResponse: handlePermissionResponse,
            onInterrupt() {
              // densable Vwo — remote interrupt cancels pending dynamic /loop wakeups
              // (same cancel path as Esc, but reason=remote_cancel like SIGTERM).
              try {
                const { cancelLoopWakeupsOnUserAbort } =
                  require('../utils/loopDynamic.js') as typeof import('../utils/loopDynamic.js');
                cancelLoopWakeupsOnUserAbort('remote_cancel');
              } catch {
                // loopDynamic may be unavailable in partial test mocks
              }
              handleRemoteInterrupt(abortControllerRef.current);
            },
            async onStopTask(taskId) {
              // densable 2.1.238 #19 — RC panel stop_task → stopTask source:"user".
              // Invent-ban: do not pass storageV5 / Desktop tasks UI.
              const { stopTask } = await import('../tasks/stopTask.js');
              return stopTask(taskId, {
                getAppState: store.getState,
                setAppState,
                source: 'user',
              });
            },
            onSetModel(model) {
              // densable 2.1.238 REPL onSetModel (Zkd callback): default/null →
              // CE(); restricted family-alias steps down; unrecognized ids still
              // apply (RGf is print-only). Restricted with no step-down →
              // {ok:false} so Zkd emits error control_response.
              const { decideReplBridgeSetModel, modelNotAllowedMessage, sanitizeModelIdForError } =
                require('../utils/model/printSetModel.js') as typeof import('../utils/model/printSetModel.js');
              const { logEvent } =
                require('../services/analytics/index.js') as typeof import('../services/analytics/index.js');
              const prevSession = store.getState().mainLoopModelForSession;
              const decision = decideReplBridgeSetModel(
                model,
                typeof prevSession === 'string' ? prevSession : undefined,
              );
              if (!decision.ok) {
                const keyId = sanitizeModelIdForError(typeof model === 'string' && model.trim() ? model : 'default');
                addNotification({
                  key: `model-restricted-bridge-${keyId}`,
                  text: decision.error,
                  color: 'warning',
                  priority: 'immediate',
                });
                logEvent('tengu_feature_bad', {
                  feature_name:
                    'model_switch' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  error_code:
                    'not_allowed' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
                return { ok: false as const, error: decision.error };
              }
              if (decision.steppedDown) {
                addNotification({
                  key: `model-restricted-bridge-${sanitizeModelIdForError(decision.requestedArg)}`,
                  text: modelNotAllowedMessage(decision.requestedArg, decision.model),
                  color: 'warning',
                  priority: 'immediate',
                });
                logEvent('tengu_feature_sad', {
                  feature_name:
                    'model_switch' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                  error_code:
                    'family_alias_stepped_down' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              } else {
                logEvent('tengu_feature_ok', {
                  feature_name:
                    'model_switch' as import('../services/analytics/index.js').AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
                });
              }
              setMainLoopModelOverride(decision.model);
              const {
                applyFastModeOnModelSwitch,
                clearFastModeCooldown,
                formatBridgeFastModeToast,
                isFastModeEnabled,
              } = require('../utils/fastMode.js') as typeof import('../utils/fastMode.js');
              if (isFastModeEnabled()) {
                clearFastModeCooldown();
              }
              let prevFast: boolean | undefined;
              let nextFast: boolean | undefined;
              setAppState(prev => {
                const applied = applyFastModeOnModelSwitch(decision.model, prev.fastMode, {
                  remoteSession: true,
                });
                prevFast = !!prev.fastMode;
                nextFast = applied.nextFastMode;
                const modelSame = prev.mainLoopModelForSession === decision.model;
                if (modelSame && !applied.changed) return prev;
                return {
                  ...prev,
                  mainLoopModelForSession: decision.model,
                  ...(applied.changed ? { fastMode: applied.nextFastMode } : null),
                };
              });
              if (prevFast !== undefined && nextFast !== undefined) {
                const toast = formatBridgeFastModeToast(prevFast, nextFast, decision.model);
                if (toast !== null) {
                  addNotification({
                    key: 'model-switch-fast-mode',
                    text: toast,
                    priority: 'immediate',
                    timeoutMs: 3000,
                  });
                }
              }
            },
            onSetMaxThinkingTokens(maxTokens) {
              const enabled = maxTokens !== null;
              setAppState(prev => {
                if (prev.thinkingEnabled === enabled) return prev;
                return { ...prev, thinkingEnabled: enabled };
              });
            },
            onSetPermissionMode(mode) {
              // Policy guards MUST fire before transitionPermissionMode —
              // its internal auto-gate check is a defensive throw (with a
              // setAutoModeActive(true) side-effect BEFORE the throw) rather
              // than a graceful reject. Letting that throw escape would:
              // (1) leave STATE.autoModeActive=true while the mode is
              //     unchanged (3-way invariant violation per src/CLAUDE.md)
              // (2) fail to send a control_response → server kills WS
              // These mirror print.ts handleSetPermissionMode; the bridge
              // can't import the checks directly (bootstrap-isolation), so
              // it relies on this verdict to emit the error response.
              if (mode === 'bypassPermissions') {
                if (isBypassPermissionsModeDisabled()) {
                  return {
                    ok: false,
                    error:
                      'Cannot set permission mode to bypassPermissions because it is disabled by settings or configuration',
                  };
                }
                if (!store.getState().toolPermissionContext.isBypassPermissionsModeAvailable) {
                  return {
                    ok: false,
                    error:
                      'Cannot set permission mode to bypassPermissions because the session was not launched with --dangerously-skip-permissions',
                  };
                }
              }
              if (feature('TRANSCRIPT_CLASSIFIER') && mode === 'auto' && !isAutoModeGateEnabled()) {
                const reason = getAutoModeUnavailableReason();
                return {
                  ok: false,
                  error: reason
                    ? `Cannot set permission mode to auto: ${getAutoModeUnavailableNotification(reason)}`
                    : 'Cannot set permission mode to auto',
                };
              }
              // Guards passed — apply via the centralized transition so
              // prePlanMode stashing and auto-mode state sync all fire.
              setAppState(prev => {
                const current = prev.toolPermissionContext.mode;
                if (current === mode) return prev;
                const next = transitionPermissionMode(current, mode, prev.toolPermissionContext);
                return {
                  ...prev,
                  toolPermissionContext: { ...next, mode },
                };
              });
              // Recheck queued permission prompts now that mode changed.
              setImmediate(() => {
                getLeaderToolUseConfirmQueue()?.(currentQueue => {
                  currentQueue.forEach(item => {
                    void item.recheckPermission();
                  });
                  return currentQueue;
                });
              });
              return { ok: true };
            },
            onSetMcpPermissionModeOverride(serverName, mode) {
              // Official 2.1.x: tighten-only per-server pin (print.ts snt/WDu).
              const parsed = parseMcpPermissionModeOverride(mode);
              if (!parsed.ok) {
                logForDebugging(
                  `set_mcp_permission_mode_override: rejected mode='${parsed.rejected}' for ${serverName} (tighten-only)`,
                  { level: 'warn' },
                );
                return {
                  ok: false,
                  error: `Permission mode override over the control channel is tighten-only ('default', 'auto', or null); rejected '${parsed.rejected}'`,
                };
              }
              if (parsed.override === 'auto' && !isAutoModeGateEnabled()) {
                const reason = getAutoModeUnavailableReason();
                return {
                  ok: false,
                  error: reason
                    ? `Cannot pin MCP server '${serverName}' to auto: ${getAutoModeUnavailableNotification(reason)}`
                    : `Cannot pin MCP server '${serverName}' to auto`,
                };
              }
              const override = parsed.override;
              setAppState(prev => {
                const current = prev.toolPermissionContext.mcpPermissionModeOverrides ?? {};
                const nextOverrides =
                  override === undefined ? omit(current, serverName) : { ...current, [serverName]: override };
                return {
                  ...prev,
                  toolPermissionContext: {
                    ...prev.toolPermissionContext,
                    mcpPermissionModeOverrides: nextOverrides,
                  },
                };
              });
              const known =
                store.getState().mcp.clients.some(c => c.name === serverName) ||
                getMcpConfigByName(serverName) !== null;
              return known
                ? { ok: true }
                : {
                    ok: true,
                    warning:
                      override === undefined
                        ? `MCP server '${serverName}' is not known; no override was present to clear.`
                        : `MCP server '${serverName}' is not yet known; override stored but will not apply until a server with that exact name connects.`,
                  };
            },
            onStateChange: handleStateChange,
            initialMessages: messages.length > 0 ? messages : undefined,
            getMessages: () => messagesRef.current,
            previouslyFlushedUUIDs: flushedUUIDsRef.current,
            initialName: replBridgeInitialName,
            perpetual,
            // densable leftover `et||Dt||Mo` / `an`.
            suppressHistoryBackfill: leftoverEt || leftoverDt || leftoverMo,
            onHistoryBackfillSuppressed: info => {
              if (cancelled) return;
              if (info?.uncertaintyOnly) return;
              persistSuppressedRef.current = true;
              suppressLatchSidRef.current = historySid;
            },
          });
          const handle = rawHandle
            ? {
                ...rawHandle,
                markTranscriptReset() {
                  transcriptResetPendingRef.current = true;
                  pendingResultAfterFlushRef.current = false;
                  lastWrittenIndexRef.current = 0;
                },
              }
            : null;
          if (cancelled) {
            // Effect was cancelled while initReplBridge was in flight.
            // Tear down the handle to avoid leaking resources (poll loop,
            // WebSocket, registered environment, cleanup callback).
            logForDebugging(
              `[bridge:repl] Hook: init cancelled during flight, tearing down${handle ? ` env=${handle.environmentId}` : ''}`,
            );
            if (handle) {
              void handle.teardown();
            }
            return;
          }
          if (!handle && declinedHolder) {
            logForDebugging(
              `[bridge:repl] Init declined: session held by local pid ${declinedHolder.pid}; leaving Remote Control off`,
            );
            if (!outboundOnly) {
              const notice = formatRemoteControlOccupancyNotice(declinedHolder, {
                crossSessionMessaging: feature('UDS_INBOX') ? true : false,
              });
              setMessages(prev => {
                const last = prev.at(-1);
                if (
                  last?.type === 'system' &&
                  last.subtype === 'informational' &&
                  typeof last.content === 'string' &&
                  last.content.startsWith(REMOTE_CONTROL_NOT_STARTED_HERE)
                ) {
                  return prev;
                }
                return [...prev, createSystemMessage(notice, 'warning')];
              });
            }
            setAppState(prev => (prev.replBridgeEnabled ? { ...prev, replBridgeEnabled: false } : prev));
            return;
          }
          // densable 2.1.251 #22: !ks && np !== void 0 → quiet org-policy decline.
          // Log + optional informational notice; disable RC; no failed toast.
          if (!handle && policyDisabledNotice !== undefined) {
            const notice = policyDisabledNotice;
            logForDebugging('[bridge:repl] Init declined by org policy; leaving Remote Control off');
            if (!outboundOnly) {
              setMessages(prev => {
                const last = prev.at(-1);
                if (last?.type === 'system' && last.subtype === 'informational' && last.content === notice) {
                  return prev;
                }
                return [...prev, createSystemMessage(notice, 'info')];
              });
            }
            setAppState(prev =>
              prev.replBridgeEnabled
                ? {
                    ...prev,
                    replBridgeEnabled: false,
                    replBridgeSessionGroupingId: undefined,
                  }
                : prev,
            );
            return;
          }
          if (!handle) {
            // densable !ks generic: not_enabled / other silent skips do NOT invent
            // a failure UI. Only bump consecutive when not a quiet skip latch;
            // if error already set keep it; else just turn RC off.
            // (Managed disableRemoteControl → isBridgeEnabledBlocking false →
            // Xb("not_enabled") with no onStateChange failed — stays quiet.)
            consecutiveFailuresRef.current++;
            logForDebugging(
              `[bridge:repl] Init returned null (precondition or session creation failed); consecutive failures: ${consecutiveFailuresRef.current}`,
            );
            clearTimeout(failureTimeoutRef.current);
            setAppState(prev => {
              if (prev.replBridgeError) {
                return prev;
              }
              // Gold: else Er(disable enabled) — no invented error string.
              if (prev.replBridgeEnabled) {
                return {
                  ...prev,
                  replBridgeEnabled: false,
                  replBridgeSessionGroupingId: undefined,
                };
              }
              return prev;
            });
            scheduleBridgeAutoDisable();
            return;
          }
          handleRef.current = handle;
          lastBridgeSessionIdRef.current = handle.bridgeSessionId;
          setReplBridgeHandle(handle);
          // densable eDe(!0) after successful init — enable JT/task_progress queue
          // so Remote Control clients joining mid-run receive workflow agent grid.
          setReplBridgeActive(true);
          consecutiveFailuresRef.current = 0;
          // Skip initial messages in the forwarding effect — they were
          // already loaded as session events during creation.
          lastWrittenIndexRef.current = initialMessageCount;

          // densable CXr + Bkn on connect — process-local meta + transcript pointer
          // so --resume / mid-session resume can force RC on (2.1.224 #30).
          // densable qCt(()=>sE()?.noHistoryBackfill===!0) — live probe for
          // compact-pair withhold (2.1.225 #7).
          if (!outboundOnly) {
            const seq = handle.getLastSequenceNum?.() ?? handle.getSSESequenceNum?.() ?? 0;
            const noHistoryBackfill = handle.noHistoryBackfill === true;
            // densable CXr owner stamp for q5o OWNER_ACCT/ORG on handoff (#5).
            let ownerAccountUuid: string | undefined;
            let ownerOrganizationUuid: string | undefined;
            try {
              const { getOauthAccountInfo } = require('../utils/auth.js') as typeof import('../utils/auth.js');
              const acct = getOauthAccountInfo();
              ownerAccountUuid = acct?.accountUuid || undefined;
              ownerOrganizationUuid = acct?.organizationUuid || undefined;
              liveOauthRef.current = acct
                ? { accountUuid: acct.accountUuid, organizationUuid: acct.organizationUuid }
                : undefined;
            } catch {
              /* optional */
            }
            saveBridgeSessionMeta(handle.bridgeSessionId, seq, {
              groupingId: handle.sessionGroupingId,
              ...(noHistoryBackfill ? { noHistoryBackfill: true } : {}),
              ...(ownerAccountUuid ? { ownerAccountUuid } : {}),
              ...(ownerOrganizationUuid ? { ownerOrganizationUuid } : {}),
            });
            saveBridgeSession(
              getSessionId() as import('crypto').UUID,
              handle.bridgeSessionId,
              seq,
              undefined,
              undefined,
              handle.sessionGroupingId,
              noHistoryBackfill || undefined,
              {
                accountUuid: ownerAccountUuid,
                organizationUuid: ownerOrganizationUuid,
              },
            );
            registerLiveSuppressionProbe(
              () =>
                handleRef.current?.noHistoryBackfill === true ||
                getPersistedBridgeSession()?.noHistoryBackfill === true,
            );
          }

          if (outboundOnly) {
            setAppState(prev => {
              if (prev.replBridgeConnected && prev.replBridgeSessionId === handle.bridgeSessionId) return prev;
              return {
                ...prev,
                replBridgeConnected: true,
                replBridgeSessionId: handle.bridgeSessionId,
                replBridgeSessionUrl: undefined,
                replBridgeConnectUrl: undefined,
                replBridgeError: undefined,
                replBridgeErrorKind: undefined,
              };
            });
            if (handle.bridgeSessionId) {
              setReplBridgeSessionId(handle.bridgeSessionId);
            }
            logForDebugging(`[bridge:repl] Mirror initialized, session=${handle.bridgeSessionId}`);
          } else {
            // Build bridge permission callbacks so the interactive permission
            // handler can race bridge responses against local user interaction.
            const permissionCallbacks: BridgePermissionCallbacks = {
              sendRequest(requestId, toolName, input, toolUseId, description, permissionSuggestions, blockedPath) {
                handle.sendControlRequest({
                  type: 'control_request',
                  request_id: requestId,
                  request: {
                    subtype: 'can_use_tool',
                    tool_name: toolName,
                    input,
                    tool_use_id: toolUseId,
                    description,
                    ...(permissionSuggestions ? { permission_suggestions: permissionSuggestions } : {}),
                    ...(blockedPath ? { blocked_path: blockedPath } : {}),
                  },
                });
              },
              sendResponse(requestId, response) {
                const payload: Record<string, unknown> = { ...response };
                handle.sendControlResponse({
                  type: 'control_response',
                  response: {
                    subtype: 'success',
                    request_id: requestId,
                    response: payload,
                  },
                });
              },
              cancelRequest(requestId) {
                handle.sendControlCancelRequest(requestId);
              },
              onResponse(requestId, handler) {
                pendingPermissionHandlers.set(requestId, handler);
                return () => {
                  pendingPermissionHandlers.delete(requestId);
                };
              },
            };
            setAppState(prev => ({
              ...prev,
              replBridgePermissionCallbacks: permissionCallbacks,
            }));
            const url = getRemoteSessionUrl(handle.bridgeSessionId, handle.sessionIngressUrl);
            // environmentId === '' signals the v2 env-less path. buildBridgeConnectUrl
            // builds an env-specific connect URL, which doesn't exist without an env.
            const hasEnv = handle.environmentId !== '';
            const connectUrl = hasEnv
              ? buildBridgeConnectUrl(handle.environmentId, handle.sessionIngressUrl)
              : undefined;
            setAppState(prev => {
              if (prev.replBridgeConnected && prev.replBridgeSessionUrl === url) {
                return prev;
              }
              return {
                ...prev,
                replBridgeConnected: true,
                replBridgeSessionUrl: url,
                replBridgeConnectUrl: connectUrl ?? prev.replBridgeConnectUrl,
                replBridgeEnvironmentId: handle.environmentId,
                replBridgeSessionId: handle.bridgeSessionId,
                replBridgeError: undefined,
                replBridgeErrorKind: undefined,
              };
            });
            if (handle.bridgeSessionId) {
              setReplBridgeSessionId(handle.bridgeSessionId);
            }

            // Show bridge status with URL in the transcript. perpetual (KAIROS
            // assistant mode) falls back to v1 at initReplBridge.ts — skip the
            // v2-only upgrade nudge for them. Own try/catch so a cosmetic
            // GrowthBook hiccup doesn't hit the outer init-failure handler.
            const upgradeNudge = !perpetual ? await shouldShowAppUpgradeMessage().catch(() => false) : false;
            if (cancelled) return;
            setMessages(prev => [
              ...prev,
              createBridgeStatusMessage(
                url,
                upgradeNudge
                  ? 'Please upgrade to the latest version of the Claude mobile app to see your Remote Control sessions.'
                  : undefined,
              ),
            ]);

            logForDebugging(`[bridge:repl] Hook initialized, session=${handle.bridgeSessionId}`);
          }
        } catch (err) {
          // Never crash the REPL — surface the error in the UI.
          // Check cancelled first (symmetry with the !handle path at line ~386):
          // if initReplBridge threw during rapid toggle-off (in-flight network
          // error), don't count that toward the fuse or spam a stale error
          // into the UI. Also fixes pre-existing spurious setAppState/
          // setMessages on cancelled throws.
          if (cancelled) return;
          consecutiveFailuresRef.current++;
          const errMsg = errorMessage(err);
          logForDebugging(
            `[bridge:repl] Init failed: ${errMsg}; consecutive failures: ${consecutiveFailuresRef.current}`,
          );
          clearTimeout(failureTimeoutRef.current);
          // densable nt — persistent error + reconnect transcript (not toast-only)
          surfaceBridgeFailure(errMsg, { kind: 'terminal', wasConnected: false });
        }
      })();

      return () => {
        cancelled = true;
        clearTimeout(failureTimeoutRef.current);
        failureTimeoutRef.current = undefined;
        giTimerRef.current && clearTimeout(giTimerRef.current);
        giTimerRef.current = undefined;
        const Ge = store.getState().replBridgeSkipNextArchive;
        const en = leftoverEnRef.current;
        leftoverEnRef.current = false;
        const et = !outboundOnly && hasMatchingQueuedSdkEvent(gt => gt.type === 'conversation_reset');
        if (et) {
          logForDebugging('[bridge:repl] bridge_conversation_reset undelivered_at_teardown');
          leftoverXe({ archiveAbandoned: handleRef.current === null });
        }
        if (Ge) {
          setAppState(gt => (gt.replBridgeSkipNextArchive ? { ...gt, replBridgeSkipNextArchive: false } : gt));
        }
        if (handleRef.current) {
          const handle = handleRef.current;
          // densable leftover cleanup @230351800 — Ge/et/Dt/tC/SD then teardown.
          const stillEnabled = store.getState().replBridgeEnabled;
          const eo = !stillEnabled && !en;
          const Dt = (eo && !Ge) || et;
          const go = Boolean(Ge && !(en && et));
          // densable leftover cleanup: `if(!en) xe({archiveAbandoned:!1})` before persist.
          if (!en) {
            leftoverXe({ archiveAbandoned: false });
          }
          if (!outboundOnly) {
            if (Dt) {
              // densable leftover cleanup `Dt` — aL tombstone + ct.
              clearBridgeSessionMeta();
              clearBridgeSession(getSessionId() as import('crypto').UUID);
              registerLiveSuppressionProbe(undefined);
            } else if (Ge && !en) {
              clearBridgeSessionCache();
            } else {
              // densable CXr + Bkn: keep seq/grouping/owner for re-init + resume.
              const seq = handle.getLastSequenceNum?.() ?? handle.getSSESequenceNum?.() ?? 0;
              const noHistoryBackfill = handle.noHistoryBackfill === true;
              let ownerAccountUuid: string | undefined;
              let ownerOrganizationUuid: string | undefined;
              try {
                const { getOauthAccountInfo } = require('../utils/auth.js') as typeof import('../utils/auth.js');
                const acct = getOauthAccountInfo();
                ownerAccountUuid = acct?.accountUuid || undefined;
                ownerOrganizationUuid = acct?.organizationUuid || undefined;
                liveOauthRef.current = acct
                  ? { accountUuid: acct.accountUuid, organizationUuid: acct.organizationUuid }
                  : undefined;
              } catch {
                /* optional */
              }
              saveBridgeSessionMeta(handle.bridgeSessionId, seq, {
                groupingId: handle.sessionGroupingId,
                ...(noHistoryBackfill ? { noHistoryBackfill: true } : {}),
                ...(ownerAccountUuid ? { ownerAccountUuid } : {}),
                ...(ownerOrganizationUuid ? { ownerOrganizationUuid } : {}),
              });
              saveBridgeSession(
                getSessionId() as import('crypto').UUID,
                handle.bridgeSessionId,
                seq,
                undefined,
                undefined,
                handle.sessionGroupingId,
                noHistoryBackfill || undefined,
                {
                  accountUuid: ownerAccountUuid,
                  organizationUuid: ownerOrganizationUuid,
                },
              );
              // densable qCt(void 0) when handle is about to be null — probe
              // falls back to process meta / transcript noHistoryBackfill.
              registerLiveSuppressionProbe(undefined);
            }
          }
          // densable leftover: `Xn=Ge||en||Mo?void 0:eo?"remote_control_disabled":"host_exit"`.
          const Mo = outboundOnly !== store.getState().replBridgeOutboundOnly && store.getState().replBridgeEnabled;
          const reason = Ge || en || Mo ? undefined : eo ? 'remote_control_disabled' : 'host_exit';
          liveOauthRef.current = undefined;
          logForDebugging(
            `[bridge:repl] Hook cleanup: starting teardown for session=${handle.bridgeSessionId}${go ? ' (skipArchive)' : ''}${reason ? ` reason=${reason}` : ''}`,
          );
          teardownPromiseRef.current = handle.teardown({
            skipArchive: go,
            ...(reason ? { reason } : {}),
          });
          handleRef.current = null;
          setReplBridgeHandle(null);
          // densable eDe(!1) on teardown — stop interactive JT enqueue.
          setReplBridgeActive(false);
          // Clear cse_* only on teardown (not on failed) so reconnect ready
          // can re-write without racing a wipe from setReplBridgeActive(false).
          setReplBridgeSessionId(undefined);
        }
        setAppState(prev => {
          // densable leftover: `en||oe` keeps replBridgeError / kind.
          const keepError = en || outboundOnly;
          const nextError = keepError ? prev.replBridgeError : undefined;
          const nextKind = keepError ? prev.replBridgeErrorKind : undefined;
          if (
            !prev.replBridgeConnected &&
            !prev.replBridgeSessionActive &&
            prev.replBridgeError === nextError &&
            prev.replBridgeErrorKind === nextKind
          ) {
            return prev;
          }
          return {
            ...prev,
            replBridgeConnected: false,
            replBridgeSessionActive: false,
            replBridgeReconnecting: false,
            replBridgeConnectUrl: undefined,
            replBridgeSessionUrl: undefined,
            replBridgeEnvironmentId: undefined,
            replBridgeSessionId: undefined,
            replBridgeError: nextError,
            replBridgeErrorKind: nextKind,
            replBridgePermissionCallbacks: undefined,
          };
        });
        lastWrittenIndexRef.current = 0;
        flushedUUIDsRef.current = new Set();
        transcriptCursorRef.current = {};
        pendingResultAfterFlushRef.current = false;
        transcriptResetPendingRef.current = false;
      };
    }
  }, [replBridgeEnabled, replBridgeExplicit, replBridgeOutboundOnly, setAppState, setMessages, addNotification]);

  // densable auth-revive watcher: poll after auth fail; same-account fresh
  // credential re-enables RC and latches Yn/Dr for the next init.
  useEffect(() => {
    if (!feature('BRIDGE_MODE')) return;
    if (
      replBridgeEnabled ||
      replBridgeError === undefined ||
      replBridgeErrorKind !== 'auth' ||
      replBridgeOutboundOnly ||
      !isBridgeAuthReviveEnabled()
    ) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pollMs = 300_000;
    const AUTH_REVIVE_CAP = 10;
    const poll = async (): Promise<void> => {
      const { getClaudeAIOAuthTokens, getOauthAccountInfoFromDisk } =
        require('../utils/auth.js') as typeof import('../utils/auth.js');
      const { logEvent } = require('../services/analytics/index.js') as typeof import('../services/analytics/index.js');
      const generationMoved = store.getState().authChangeGeneration !== authFailGenerationRef.current;
      const killSwitchOff = !isBridgeAuthReviveEnabled();
      const brake = killSwitchOff || (!generationMoved && authReviveCountRef.current >= AUTH_REVIVE_CAP);
      if (brake) {
        logForDebugging(
          killSwitchOff
            ? '[bridge:repl] Auth-revive watcher: kill switch off — still polling, no unattended revive'
            : '[bridge:repl] Auth-revive watcher: non-interactive revive brake engaged — still polling; an in-process /login bypasses',
        );
      }
      // densable Ue=Pe===oL — still loading; skip this tick (not no_oauth).
      const stillLoading = authFailTokenRef.current === AUTH_FAIL_TOKEN_LOADING;
      if (brake || stillLoading) {
        timer = setTimeout(() => {
          void poll();
        }, pollMs);
        return;
      }
      const prevToken = authFailTokenRef.current;
      const prevAccount = authFailAccountRef.current;
      let live: { accountUuid?: string; organizationUuid?: string; accessToken?: string } | undefined;
      try {
        const tokens = getClaudeAIOAuthTokens();
        const acct = getOauthAccountInfoFromDisk();
        live =
          tokens?.accessToken && acct
            ? {
                accessToken: tokens.accessToken,
                accountUuid: acct.accountUuid,
                organizationUuid: acct.organizationUuid,
              }
            : undefined;
      } catch {
        live = undefined;
      }
      if (cancelled) return;
      // no_oauth failures snapshot prevToken as undefined; treat a newly
      // present token as a fresh credential so /login can revive RC.
      const tokenArrived = Boolean(live?.accessToken) && (prevToken ? live!.accessToken !== prevToken : true);
      if (!(tokenArrived && live?.accountUuid)) {
        timer = setTimeout(() => {
          void poll();
        }, pollMs);
        return;
      }
      if (prevAccount?.accountUuid) {
        const sameAccount =
          live.accountUuid === prevAccount.accountUuid &&
          (live.organizationUuid || undefined) === (prevAccount.organizationUuid || undefined);
        if (!sameAccount) {
          logForDebugging('[bridge:repl] Auth-revive watcher: credential belongs to a different account — disarming');
          return;
        }
      }
      logForDebugging(
        prevToken
          ? '[bridge:repl] Auth-revive watcher: fresh same-account credential — re-enabling Remote Control'
          : '[bridge:repl] Auth-revive watcher: credential appeared after no_oauth — re-enabling Remote Control',
      );
      let flipped = false;
      setAppState(prev => {
        if (prev.replBridgeEnabled || prev.replBridgeError === undefined) {
          return prev;
        }
        flipped = true;
        return {
          ...prev,
          replBridgeEnabled: true,
          replBridgeError: undefined,
          replBridgeErrorKind: undefined,
        };
      });
      if (flipped) {
        logEvent('tengu_bridge_repl_auth_revive', {});
        authReviveCountRef.current++;
        reviveLatchRef.current = true;
        reviveExpectedAccountRef.current = {
          accountUuid: live.accountUuid,
          organizationUuid: live.organizationUuid,
        };
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    replBridgeEnabled,
    replBridgeError,
    replBridgeErrorKind,
    replBridgeOutboundOnly,
    authChangeGeneration,
    setAppState,
  ]);

  // Write new messages as they appear.
  // Also re-runs when replBridgeConnected changes (bridge finishes init),
  // so any messages that arrived before the bridge was ready get written.
  useEffect(() => {
    // Positive feature() guard — see first useEffect comment
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeConnected) return;

      const handle = handleRef.current;
      if (!handle) return;
      // densable leftover `l_e(oe,zo)` — skip F upload while reset is queued.
      if (leftoverL_e(handle, replBridgeSessionActive)) return;

      // Clamp the index in case messages were compacted (array shortened).
      // After compaction the ref could exceed messages.length, and without
      // clamping no new messages would be forwarded.
      const ge = leftoverURef.current;
      leftoverURef.current = false;
      try {
        const ke = flushedUUIDsRef.current;
        const { head: We, tail: nt, eligible: ot } = transcriptCursorRef.current;
        const headOk = We === undefined || messages[0]?.uuid === We;
        const eligibleOk = ot === undefined || messages[ot.index]?.uuid === ot.uuid;
        let ce = 0;
        if (ge) {
          leftoverGRef.current = true;
          logForDebugging(
            `[bridge:repl] Transcript replaced under a detached binding — ${messages.length} message(s) accounted as seen, not uploaded`,
          );
        } else {
          if (headOk && eligibleOk) {
            if (nt !== undefined && messages[nt.index]?.uuid === nt.uuid) {
              ce = nt.index + 1;
            } else if (ot !== undefined) {
              ce = ot.index + 1;
            }
          }
          if (ce === 0 && (nt !== undefined || ot !== undefined)) {
            logForDebugging(
              `[bridge:repl] Transcript rewrite detected (messages.length=${messages.length}), rescanning`,
            );
          }
        }
        let Fe = ce > 0 ? ot : undefined;
        const pendingUpload: Message[] = [];
        for (let qt = ce; qt < messages.length; qt++) {
          const Lt = messages[qt];
          if (!Lt || !isEligibleBridgeMessage(Lt)) {
            if (Lt) {
              forwardAgentProgressSdkFrames(handle, Lt, ke, ge);
            }
            continue;
          }
          Fe = { index: qt, uuid: Lt.uuid };
          if (ke.has(Lt.uuid)) continue;
          if (ge) {
            // Detached binding: mark seen without uploading.
            ke.add(Lt.uuid);
            continue;
          }
          if (isCompactionOrSummaryMarker(Lt) && (leftoverGRef.current || shouldSkipBridgeHistoryBackfill())) continue;
          pendingUpload.push(Lt);
        }
        leftoverA_e(handle);
        if (pendingUpload.length > 0) {
          handle.writeMessages(pendingUpload);
          for (const Lt of pendingUpload) ke.add(Lt.uuid);
          transcriptResetPendingRef.current = false;
        }
        // Commit the cursor only after a successful write so a transport throw
        // does not permanently drop messages that never left the process.
        lastWrittenIndexRef.current = messages.length;
        const tail = messages.at(-1);
        transcriptCursorRef.current = {
          head: messages[0]?.uuid,
          tail: tail && { index: messages.length - 1, uuid: tail.uuid },
          eligible: Fe,
        };
      } catch (error) {
        logForDebugging(`[bridge:repl] Failed forwarding messages to remote control: ${errorMessage(error)}`, {
          level: 'error',
        });
        if (ge) leftoverURef.current = true;
      }

      if (
        pendingResultAfterFlushRef.current &&
        isTranscriptResetResultReady(transcriptResetPendingRef.current, messages.length)
      ) {
        transcriptResetPendingRef.current = false;
        pendingResultAfterFlushRef.current = false;
        handle.sendResult();
        return;
      }

      if (pendingResultAfterFlushRef.current && !transcriptResetPendingRef.current) {
        pendingResultAfterFlushRef.current = false;
        handle.sendResult();
      }
    }
  }, [messages, replBridgeConnected, replBridgeSessionActive]);

  // densable leftover hook enqueue: `KG(oe),oe()` @230355254.
  // `if(!ge||l_e(ge,sessionActive))return; a_e(ge)`.
  useEffect(() => {
    if (!feature('BRIDGE_MODE')) return;
    if (!replBridgeConnected) return;

    const drainTaskEventsToBridge = (): void => {
      const handle = handleRef.current;
      if (!handle || leftoverL_e(handle, store.getState().replBridgeSessionActive)) {
        return;
      }
      leftoverA_e(handle);
    };

    setSdkEventEnqueueListener(drainTaskEventsToBridge);
    // Catch anything queued before the listener was registered.
    drainTaskEventsToBridge();
    return () => {
      setSdkEventEnqueueListener(null);
    };
  }, [replBridgeConnected, replBridgeSessionActive, store]);

  useEffect(() => {
    if (feature('BRIDGE_MODE')) {
      if (!replBridgeSessionActive || replBridgeOutboundOnly) return;

      let cancelled = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      let pollTimer: ReturnType<typeof setInterval> | undefined;
      let watcher: FSWatcher | null = null;
      let watchedDir: string | null = null;
      let lastPublishedSnapshotKey: string | null = null;
      let lastPublishedHandle: ReplBridgeHandle | null = null;
      let forceNextPublish = false;

      const rewatch = (dir: string): void => {
        if (dir === watchedDir && watcher !== null) return;
        watcher?.close();
        watcher = null;
        watchedDir = dir;
        try {
          watcher = watch(dir, schedulePublish);
          watcher.unref();
        } catch {
          // Writers ensure the directory exists; if it does not yet, the
          // poll timer and in-process task signal still converge the snapshot.
        }
      };

      const publishTaskState = async (): Promise<void> => {
        const handle = handleRef.current;
        if (!handle) return;

        const taskListId = getTaskListId();
        rewatch(getTasksDir(taskListId));

        try {
          const tasks = await listTasks(taskListId);
          if (cancelled || handleRef.current !== handle) return;
          const snapshotKey = getTaskStateSnapshotKey(taskListId, tasks);
          const force = forceNextPublish;
          forceNextPublish = false;
          if (
            !shouldPublishTaskState({
              snapshotKey,
              handle,
              lastSnapshotKey: lastPublishedSnapshotKey,
              lastHandle: lastPublishedHandle,
              force,
            })
          ) {
            return;
          }
          handle.writeSdkMessages([buildTaskStateMessage(taskListId, tasks)]);
          lastPublishedSnapshotKey = snapshotKey;
          lastPublishedHandle = handle;
        } catch (err) {
          logForDebugging(`[bridge:repl] Failed to publish task_state: ${errorMessage(err)}`, { level: 'error' });
        }
      };

      const schedulePublish = (): void => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined;
          void publishTaskState();
        }, TASK_STATE_DEBOUNCE_MS);
        debounceTimer.unref?.();
      };

      forceTaskStatePublishRef.current = () => {
        // Invalidate dedupe so the next publish always goes out, even when
        // the task list and handle identity are unchanged after reconnect.
        forceNextPublish = true;
        lastPublishedSnapshotKey = null;
        void publishTaskState();
      };

      void publishTaskState();
      const unsubscribe = onTasksUpdated(schedulePublish);
      pollTimer = setInterval(() => {
        void publishTaskState();
      }, TASK_STATE_POLL_MS);
      pollTimer.unref?.();

      return () => {
        cancelled = true;
        forceTaskStatePublishRef.current = null;
        unsubscribe();
        if (debounceTimer) clearTimeout(debounceTimer);
        if (pollTimer) clearInterval(pollTimer);
        watcher?.close();
      };
    }
  }, [replBridgeSessionActive, replBridgeOutboundOnly]);

  const sendBridgeResult = useCallback(() => {
    if (feature('BRIDGE_MODE')) {
      const handle = handleRef.current;
      if (!handle) {
        pendingResultAfterFlushRef.current = true;
        return;
      }

      if (isTranscriptResetResultReady(transcriptResetPendingRef.current, messagesRef.current.length)) {
        transcriptResetPendingRef.current = false;
        pendingResultAfterFlushRef.current = false;
        handle.sendResult();
        return;
      }

      // Message mirroring happens in a separate effect. When the turn completes
      // before that effect flushes the latest transcript rows, hold the result
      // so remote state transitions after the final mirrored messages instead
      // of bouncing back to "running" on local slash commands like /clear.
      if (
        transcriptResetPendingRef.current ||
        shouldDeferBridgeResult({
          hasHandle: true,
          isConnected: replBridgeConnected,
          lastWrittenIndex: lastWrittenIndexRef.current,
          messageCount: messagesRef.current.length,
        })
      ) {
        pendingResultAfterFlushRef.current = true;
        return;
      }

      handle.sendResult();
    }
  }, [replBridgeConnected]);

  return { sendBridgeResult };
}
