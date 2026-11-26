export type SessionState = 'idle' | 'running' | 'requires_action'

import { isProactiveActive } from '../proactive/index.js'

/**
 * Context carried with requires_action transitions so downstream
 * surfaces (CCR sidebar, push notifications) can show what the
 * session is blocked on, not just that it's blocked.
 *
 * Two delivery paths:
 * - tool_name + action_description → RequiresActionDetails proto
 *   (webhook payload, typed, logged in Datadog)
 * - full object → external_metadata.pending_action (queryable JSON
 *   on the Session, lets the frontend iterate on shape without
 *   proto round-trips)
 */
export type RequiresActionDetails = {
  tool_name: string
  /**
   * Official display_tool_name for host UIs (e.g. dialog park uses
   * "Claude needs your input"). Optional for permission prompts.
   */
  display_tool_name?: string
  /** Human-readable summary, e.g. "Editing src/foo.ts", "Running npm test" */
  action_description: string
  tool_use_id: string
  request_id: string
  /** Raw tool input — the frontend reads from external_metadata.pending_action.input
   * to parse question options / plan content without scanning the event stream. */
  input?: Record<string, unknown>
}

export type AutomationStatePhase = 'standby' | 'sleeping'

export type AutomationStateMetadata = {
  enabled: boolean
  phase: AutomationStatePhase | null
  next_tick_at: number | null
  sleep_until: number | null
}

import { isEnvTruthy } from './envUtils.js'
import { NestedChainIdleTracker } from './nestedChainIdle.js'
import type { PermissionMode } from './permissions/PermissionMode.js'
import { enqueueSdkEvent } from './sdkEventQueue.js'
import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

// CCR external_metadata keys — push in onChangeAppState, restore in
// externalMetadataToAppState.
export type SessionExternalMetadata = {
  permission_mode?: string | null
  model?: string | null
  pending_action?: RequiresActionDetails | null
  automation_state?: AutomationStateMetadata | null
  // Opaque — typed at the emit site. Importing PostTurnSummaryOutput here
  // would leak the import path string into sdk.d.ts via agentSdkBridge's
  // re-export of SessionState.
  post_turn_summary?: unknown
  // Host mid-turn progress phrase (external_metadata.task_summary). densable
  // 2.1.211 ships stream mirror + idle null clear only; non-null writer is not
  // present in the official binary (BG midturn LLM writes job `detail`, not
  // this key). Callers may still set a string; Host sees it via stream mirror.
  task_summary?: string | null
  is_ultracode_active?: boolean | null
}

/**
 * Official CCR worker GET shape (densable 2.1.239 #13).
 * `internal` carries `worker_permission_mode` — not the external
 * `permission_mode` key.
 */
export type RestoredWorkerState = {
  external: SessionExternalMetadata | Record<string, unknown> | null
  internal: Record<string, unknown> | null
  readFailed?: boolean
} | null

type SessionStateChangedListener = (
  state: SessionState,
  details?: RequiresActionDetails,
) => void
type SessionMetadataChangedListener = (
  metadata: SessionExternalMetadata,
) => void
type PermissionModeChangedListener = (mode: PermissionMode) => void
type WaitingOnUserChangedListener = (waiting: boolean) => void
type SessionMetadataListenerOptions = {
  replayCurrent?: boolean
}
type SessionInternalMetadataChangedListener = (
  metadata: Record<string, unknown>,
) => void

type SessionStateHostState = {
  stateListener: SessionStateChangedListener | null
  metadataListener: SessionMetadataChangedListener | null
  permissionModeListener: PermissionModeChangedListener | null
  waitingOnUserListener: WaitingOnUserChangedListener | null
  internalMetadataListener: SessionInternalMetadataChangedListener | null
  workerPermissionModeRecordEnabled: boolean
  ultracodeActiveSent: boolean | undefined
  ultracodeActiveWritten: boolean
  /**
   * Official Imn nested-chain idle densable tracker (per-host).
   * waitingOnUser = requires_action && mainLoopRefcount - nestedBlocked <= 0.
   */
  nestedChainIdleTracker: NestedChainIdleTracker
  hasPendingAction: boolean
  currentState: SessionState
  currentAutomationState: AutomationStateMetadata | null
  currentMetadata: SessionExternalMetadata
}

const sessionStateHostSlot = new HostSlot<SessionStateHostState>(() => {
  const hostState: SessionStateHostState = {
    stateListener: null,
    metadataListener: null,
    permissionModeListener: null,
    waitingOnUserListener: null,
    internalMetadataListener: null,
    workerPermissionModeRecordEnabled: false,
    ultracodeActiveSent: false,
    ultracodeActiveWritten: false,
    nestedChainIdleTracker: new NestedChainIdleTracker({
      onWaitingOnUserChanged: waiting => {
        hostState.waitingOnUserListener?.(waiting)
      },
    }),
    hasPendingAction: false,
    currentState: 'idle',
    currentAutomationState: null,
    currentMetadata: {},
  }
  return hostState
})

function getSessionStateHost(): SessionStateHostState {
  return sessionStateHostSlot.of(getBootstrapSessionHost())
}

export function setSessionStateChangedListener(
  cb: SessionStateChangedListener | null,
): void {
  getSessionStateHost().stateListener = cb
}

/** Official onWaitingOnUserChanged densable consumer registration. */
export function setWaitingOnUserChangedListener(
  cb: WaitingOnUserChangedListener | null,
): void {
  getSessionStateHost().waitingOnUserListener = cb
}

/** Official waitingOnUser densable — requires_action with no open main-loop refs beyond nested blocks. */
export function isWaitingOnUser(): boolean {
  return getSessionStateHost().nestedChainIdleTracker.waitingOnUser
}

/** Official setMainLoopRefcount densable. */
export function setMainLoopRefcount(n: number): void {
  getSessionStateHost().nestedChainIdleTracker.setMainLoopRefcount(n)
}

/** Official notifyNestedPromptBlocking densable. */
export function notifyNestedPromptBlocking(agentId: string): void {
  getSessionStateHost().nestedChainIdleTracker.notifyNestedPromptBlocking(
    agentId,
  )
}

/** Official notifyNestedPromptUnblocking densable. */
export function notifyNestedPromptUnblocking(agentId: string): void {
  getSessionStateHost().nestedChainIdleTracker.notifyNestedPromptUnblocking(
    agentId,
  )
}

/** Official dropNestedBlockedChain densable. */
export function dropNestedBlockedChain(agentId: string): void {
  getSessionStateHost().nestedChainIdleTracker.dropNestedBlockedChain(agentId)
}

/**
 * Official Imn.reteeWaitingOnUser — force re-emit current waitingOnUser
 * (e.g. after one of several concurrent parks resolves).
 */
export function reteeWaitingOnUser(): void {
  getSessionStateHost().nestedChainIdleTracker.reteeWaitingOnUser()
}

/**
 * Official Imn.republishPendingAction — re-publish surviving pending_action
 * metadata without a full state transition (multi-prompt race).
 */
export function republishPendingAction(details: RequiresActionDetails): void {
  getSessionStateHost().hasPendingAction = true
  notifySessionMetadataChanged({ pending_action: details })
}

export function setSessionMetadataChangedListener(
  cb: SessionMetadataChangedListener | null,
  options?: SessionMetadataListenerOptions,
): void {
  getSessionStateHost().metadataListener = cb
  if (!cb || !options?.replayCurrent) {
    return
  }

  const snapshot = getSessionMetadataSnapshot()
  if (Object.keys(snapshot).length === 0) {
    return
  }

  cb(snapshot)
}

/**
 * Register a listener for permission-mode changes from onChangeAppState.
 * Wired by print.ts to emit an SDK system:status message so CCR/IDE clients
 * see mode transitions in real time — regardless of which code path mutated
 * toolPermissionContext.mode (Shift+Tab, ExitPlanMode dialog, slash command,
 * bridge set_permission_mode, etc.).
 */
export function setPermissionModeChangedListener(
  cb: PermissionModeChangedListener | null,
): void {
  getSessionStateHost().permissionModeListener = cb
}

function normalizeAutomationState(
  state: AutomationStateMetadata | null | undefined,
): AutomationStateMetadata | null {
  if (!state || state.enabled !== true) {
    return null
  }

  return {
    enabled: true,
    phase:
      state.phase === 'standby' || state.phase === 'sleeping'
        ? state.phase
        : null,
    next_tick_at:
      typeof state.next_tick_at === 'number' ? state.next_tick_at : null,
    sleep_until:
      typeof state.sleep_until === 'number' ? state.sleep_until : null,
  }
}

function automationStateKey(state: AutomationStateMetadata | null): string {
  return JSON.stringify(state)
}

function applyMetadataUpdate(metadata: SessionExternalMetadata): void {
  const hostState = getSessionStateHost()
  const nextMetadata = { ...hostState.currentMetadata }
  for (const key of Object.keys(metadata) as Array<
    keyof SessionExternalMetadata
  >) {
    const value = metadata[key]
    if (value === undefined) {
      delete nextMetadata[key]
      continue
    }
    ;(nextMetadata as Record<string, unknown>)[key] = value
  }
  hostState.currentMetadata = nextMetadata
}

export function getSessionMetadataSnapshot(): SessionExternalMetadata {
  const hostState = getSessionStateHost()
  const snapshot: SessionExternalMetadata = { ...hostState.currentMetadata }
  if (hostState.currentAutomationState) {
    snapshot.automation_state = { ...hostState.currentAutomationState }
  } else if ('automation_state' in hostState.currentMetadata) {
    snapshot.automation_state =
      hostState.currentMetadata.automation_state ?? null
  }
  return snapshot
}

export function getSessionState(): SessionState {
  return getSessionStateHost().currentState
}

export function notifySessionStateChanged(
  state: SessionState,
  details?: RequiresActionDetails,
): void {
  const hostState = getSessionStateHost()
  hostState.currentState = state
  // Official Imn.notifyStateChanged — keep nested-chain waitingOnUser in sync.
  hostState.nestedChainIdleTracker.setState(state)
  hostState.stateListener?.(state, details)

  // Mirror details into external_metadata so GetSession carries the
  // pending-action context without proto changes. Cleared via RFC 7396
  // null on the next non-blocked transition.
  if (state === 'requires_action' && details) {
    hostState.hasPendingAction = true
    // Official GMg — blocked post_turn_summary for host UIs (CCR sidebar).
    // Lazy require avoids bootstrap cycles (classifierSummary → sessionState types).
    let postTurn: SessionExternalMetadata['post_turn_summary']
    try {
      const {
        shouldEmitBlockedClassifierSummary,
        buildBlockedPostTurnSummary,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./permissions/classifierSummary.js') as typeof import('./permissions/classifierSummary.js')
      if (shouldEmitBlockedClassifierSummary()) {
        postTurn = buildBlockedPostTurnSummary(details)
      }
    } catch {
      postTurn = undefined
    }
    notifySessionMetadataChanged({
      pending_action: details,
      ...(postTurn !== undefined ? { post_turn_summary: postTurn } : {}),
    })
  } else if (hostState.hasPendingAction) {
    hostState.hasPendingAction = false
    notifySessionMetadataChanged({
      pending_action: null,
      post_turn_summary: null,
    })
  }

  // densable 2.1.211: clear task_summary at idle (hasTaskSummary path) so the
  // next turn doesn't briefly show prior progress. Non-null mid-turn writer is
  // not in official 211 either — only mirror + this clear. Completed-turn
  // densable: heuristic post_turn_summary immediately; optional LLM upgrade.
  if (state === 'idle') {
    let completedSummary: SessionExternalMetadata['post_turn_summary']
    // Capture any prior task_summary before clear (LLM completed context).
    const priorTaskSummary =
      typeof hostState.currentMetadata.task_summary === 'string'
        ? hostState.currentMetadata.task_summary
        : null
    try {
      const {
        shouldEmitCompletedClassifierSummary,
        buildCompletedPostTurnSummary,
        buildCompletedPostTurnSummaryWithHost,
        ensureCompletedClassifierLlmHost,
        getCompletedClassifierLlmHost,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./permissions/classifierSummary.js') as typeof import('./permissions/classifierSummary.js')
      if (shouldEmitCompletedClassifierSummary()) {
        // Immediate heuristic so hosts see status without waiting on LLM.
        completedSummary = buildCompletedPostTurnSummary({
          assistantText: priorTaskSummary,
        })
        // Official default Haiku host densable when mode is llm.
        ensureCompletedClassifierLlmHost()
        // Optional LLM densable upgrade when host is installed.
        if (getCompletedClassifierLlmHost()) {
          void buildCompletedPostTurnSummaryWithHost({
            assistantText: priorTaskSummary,
            context: priorTaskSummary,
          })
            .then(llmSummary => {
              if (
                llmSummary &&
                typeof llmSummary.status_detail === 'string' &&
                llmSummary.status_detail.length > 0
              ) {
                notifySessionMetadataChanged({
                  post_turn_summary: llmSummary,
                })
              }
            })
            .catch(() => {
              // heuristic already emitted
            })
        }
      }
    } catch {
      completedSummary = undefined
    }
    notifySessionMetadataChanged({
      task_summary: null,
      ...(completedSummary !== undefined
        ? { post_turn_summary: completedSummary }
        : {}),
    })
  }

  if (state !== 'idle') {
    notifyAutomationStateChanged(
      isProactiveActive()
        ? {
            enabled: true,
            phase: null,
            next_tick_at: null,
            sleep_until: null,
          }
        : null,
    )
  }

  // Mirror to the SDK event stream so non-CCR consumers (scmuxd, VS Code)
  // see the same authoritative idle/running signal the CCR bridge does.
  // 'idle' fires after heldBackResult flushes — lets scmuxd flip IDLE and
  // show the bg-task dot instead of a stuck generating spinner.
  //
  // Opt-in until CCR web + mobile clients learn to ignore this subtype in
  // their isWorking() last-message heuristics — the trailing idle event
  // currently pins them at "Running...".
  // https://anthropic.slack.com/archives/C093BJBD1CP/p1774152406752229
  let emitSessionState = isEnvTruthy(
    process.env.CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS,
  )
  try {
    const { isEmitSessionStateEventsEnabled } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('./residualFinalEnvGates.js') as typeof import('./residualFinalEnvGates.js')
    emitSessionState = isEmitSessionStateEventsEnabled()
  } catch {
    // residual helpers optional
  }
  if (emitSessionState) {
    enqueueSdkEvent({
      type: 'system',
      subtype: 'session_state_changed',
      state,
    })
  }
}

export function notifySessionMetadataChanged(
  metadata: SessionExternalMetadata,
): void {
  const hostState = getSessionStateHost()
  applyMetadataUpdate(metadata)
  hostState.metadataListener?.(metadata)
  if ('is_ultracode_active' in metadata && hostState.metadataListener) {
    hostState.ultracodeActiveSent = metadata.is_ultracode_active === true
    hostState.ultracodeActiveWritten = true
  }
  // densable 2.1.211 notifyMetadataChanged: stream system/task_summary so
  // non-CCR Hosts mirror external_metadata.task_summary (detail null = clear).
  if (Object.hasOwn(metadata, 'task_summary')) {
    try {
      const { emitTaskSummarySdk } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./sdkEventQueue.js') as typeof import('./sdkEventQueue.js')
      const detail =
        typeof metadata.task_summary === 'string'
          ? metadata.task_summary
          : metadata.task_summary === null
            ? null
            : null
      emitTaskSummarySdk(detail)
    } catch {
      // optional
    }
  }
}

export function notifyAutomationStateChanged(
  state: AutomationStateMetadata | null | undefined,
): void {
  const hostState = getSessionStateHost()
  const nextState = normalizeAutomationState(state)
  if (
    automationStateKey(nextState) ===
    automationStateKey(hostState.currentAutomationState)
  ) {
    return
  }

  hostState.currentAutomationState = nextState
  applyMetadataUpdate({ automation_state: nextState })
  hostState.metadataListener?.({ automation_state: nextState })
}

/**
 * Fired by onChangeAppState when toolPermissionContext.mode changes.
 * Downstream listeners (CCR external_metadata PUT, SDK status stream) are
 * both wired through this single choke point so no mode-mutation path can
 * silently bypass them.
 */
export function notifyPermissionModeChanged(mode: PermissionMode): void {
  getSessionStateHost().permissionModeListener?.(mode)
}

/** Official `Aio.enableWorkerPermissionModeRecord`. */
export function enableWorkerPermissionModeRecord(): void {
  getSessionStateHost().workerPermissionModeRecordEnabled = true
}

/** Official 2.1.325 `ultracodeActivePatch` (#1373). */
export function ultracodeActivePatch(active: boolean): {
  is_ultracode_active?: boolean | null
} {
  return active === getSessionStateHost().ultracodeActiveSent
    ? {}
    : { is_ultracode_active: active || null }
}

/** Official 2.1.325 `notifyUltracodeActive` (#1373). */
export function notifyUltracodeActive(active: boolean): void {
  const patch = ultracodeActivePatch(active)
  if ('is_ultracode_active' in patch) {
    notifySessionMetadataChanged(patch)
  }
}

/** Official 2.1.325 `settleUltracodeActive` (#1373). */
export function settleUltracodeActive(
  active: boolean,
  restored?: RestoredWorkerState,
): void {
  const hostState = getSessionStateHost()
  if (!hostState.ultracodeActiveWritten) {
    const ext = restored?.external as Record<string, unknown> | null | undefined
    hostState.ultracodeActiveSent =
      restored?.readFailed === true
        ? undefined
        : ext?.is_ultracode_active === true
  }
  notifyUltracodeActive(active)
}

export function resetUltracodeActiveForTesting(): void {
  const hostState = getSessionStateHost()
  hostState.ultracodeActiveSent = false
  hostState.ultracodeActiveWritten = false
}

/** Official `Aio.isWorkerPermissionModeRecordEnabled`. */
export function isWorkerPermissionModeRecordEnabled(): boolean {
  return getSessionStateHost().workerPermissionModeRecordEnabled
}

export function setInternalMetadataChangedListener(
  cb: SessionInternalMetadataChangedListener | null,
): void {
  getSessionStateHost().internalMetadataListener = cb
}

/** Official `Aio.notifyInternalMetadataChanged`. */
export function notifyInternalMetadataChanged(
  metadata: Record<string, unknown>,
): void {
  getSessionStateHost().internalMetadataListener?.(metadata)
}

export function resetSessionStateForTests(): void {
  const hostState = getSessionStateHost()
  hostState.stateListener = null
  hostState.metadataListener = null
  hostState.permissionModeListener = null
  hostState.waitingOnUserListener = null
  hostState.internalMetadataListener = null
  hostState.workerPermissionModeRecordEnabled = false
  hostState.hasPendingAction = false
  hostState.currentState = 'idle'
  hostState.currentAutomationState = null
  hostState.currentMetadata = {}
  hostState.nestedChainIdleTracker.reset()
}
