/**
 * densable 2.1.224 child activity event parsing (sjv He callback).
 * Pure NDJSON line handler recovered from `/tmp/shr-extract-224/sjv.pretty.js`.
 *
 * densable 2.1.228 #7 — follow-up hold between last bg task finish and the
 * follow-up turn (`bgResultAwaitingFollowup` / `SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS`
 * / ZGi=30000). Gold from SEA pretty region around
 * `releasing the follow-up hold` / `session still counted as busy`.
 */

import { formatDelayMs } from './tokenRefresh.js'

/** densable `ZGi` — default bg-result → follow-up grace */
export const BG_RESULT_FOLLOWUP_GRACE_MS = 30_000

export type SessionActivityKind =
  | 'startup'
  | 'activity'
  | 'turn-end'
  | 'turn-end-deferred'
  | 'awaiting-action'
  | 'init-observed'

export type BgTaskSnapshot = {
  liveTasks: number
  liveTaskIds: string[]
  wakeupInMs?: number
  /** densable `_t` — holding busy across bg-result → follow-up gap */
  bgResultAwaitingFollowup?: boolean
}

export type SessionActivityHandler = (
  kind: SessionActivityKind,
  snapshot?: BgTaskSnapshot,
) => void

export type ActivityPipeState = {
  /** task_id → task_type (exclude monitor_* from ledger count) */
  tasks: Map<string, string>
  /** ScheduleWakeup hold-until epoch ms */
  wakeupUntil: number | null
  /** deferred turn-end timer */
  deferredTimer: ReturnType<typeof setTimeout> | undefined
  /** whether a user/assistant turn is in flight */
  turnInFlight: boolean
  /** result observed this turn */
  sawResult: boolean
  /** waiting_on_user sticky */
  waitingOnUser: boolean
  /** session_state_changed seen */
  sawSessionState: boolean
  /** system/init observed */
  sawInit: boolean
  /** densable fe = 120000 pad on ScheduleWakeup delay */
  wakeupPadMs: number
  /**
   * densable `_t` — follow-up hold after background task finished while
   * waiting for the follow-up turn (2.1.228 #7).
   */
  bgResultAwaitingFollowup: boolean
  /** densable `Ge` — follow-up hold grace timer */
  followUpHoldTimer: ReturnType<typeof setTimeout> | undefined
  /**
   * densable `tt` — a background result / terminal bg task was observed
   * (gates starting the follow-up hold).
   */
  sawBgResult: boolean
  /**
   * densable `Fe` — task ids known to be backgrounded
   * (`task_updated` is_backgrounded / `background_tasks_changed`).
   */
  backgroundedTaskIds: Set<string>
  /**
   * densable `We` — task ids owned by subagent (`owned_by_subagent`).
   * Terminal events for these use the lighter `yt` path.
   */
  subagentOwnedTaskIds: Set<string>
  /**
   * densable `ct` — task ids that contributed to the current follow-up hold
   * (matched against turn_starting task_id for follow-up classification).
   */
  followUpTaskIds: Set<string>
  /** densable `Ee` — grace ms (env or ZGi) */
  followUpGraceMs: number
}

/**
 * densable `A8("SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS")||ZGi`.
 * A8 returns 0 for unset/invalid → falls through to ZGi=30000.
 */
export function resolveBgResultFollowUpGraceMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SELF_HOSTED_RUNNER_BG_RESULT_GRACE_MS
  if (raw === undefined || raw === '') return BG_RESULT_FOLLOWUP_GRACE_MS
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return BG_RESULT_FOLLOWUP_GRACE_MS
  return Math.min(n, 2_147_483_647)
}

export function createActivityPipeState(
  env: NodeJS.ProcessEnv = process.env,
): ActivityPipeState {
  return {
    tasks: new Map(),
    wakeupUntil: null,
    deferredTimer: undefined,
    turnInFlight: false,
    sawResult: false,
    waitingOnUser: false,
    sawSessionState: false,
    sawInit: false,
    wakeupPadMs: 120_000,
    bgResultAwaitingFollowup: false,
    followUpHoldTimer: undefined,
    sawBgResult: false,
    backgroundedTaskIds: new Set(),
    subagentOwnedTaskIds: new Set(),
    followUpTaskIds: new Set(),
    followUpGraceMs: resolveBgResultFollowUpGraceMs(env),
  }
}

/** non-monitor live task count (densable oe / ce) */
export function countNonMonitorTasks(tasks: Map<string, string>): number {
  let n = 0
  for (const t of tasks.values()) {
    if (t !== 'monitor_mcp' && t !== 'monitor_ws') n++
  }
  return n
}

export function snapshotBgTasks(state: ActivityPipeState): BgTaskSnapshot {
  return {
    // densable ce() — exclude monitor_* from live count / hold gates
    liveTasks: countNonMonitorTasks(state.tasks),
    liveTaskIds: Array.from(state.tasks, ([id, type]) => `${id}:${type}`),
    wakeupInMs:
      state.wakeupUntil !== null
        ? Math.max(0, state.wakeupUntil - Date.now())
        : undefined,
    bgResultAwaitingFollowup: state.bgResultAwaitingFollowup,
  }
}

function isWakeupHolding(state: ActivityPipeState): boolean {
  return state.wakeupUntil !== null && Date.now() < state.wakeupUntil
}

type ActivityHandlers = {
  onSessionActivity?: SessionActivityHandler
  onBgTaskLedger?: (liveNonMonitor: number) => void
  onTokenAck?: (requestId: string) => void
  onSessionStartHookError?: () => void
  onInitObserved?: () => void
  onDebug?: (msg: string) => void
  /**
   * densable `b` / status-ish logger for follow-up hold lines
   * (`[runner:session] ${sessionId} …`). Falls back to onDebug.
   */
  onStatus?: (msg: string) => void
  /** densable `o` — session id for follow-up hold log lines */
  sessionId?: string
  /**
   * densable `C` — mark session still busy / release busy across the
   * bg-result → follow-up gap (rootRunner deferredHold).
   */
  onBgResultFollowUpBusy?: (busy: boolean, childExited?: boolean) => void
  /** densable g_ ScheduleWakeup tool name — optional exact match */
  scheduleWakeupToolName?: string
}

function logSession(handlers: ActivityHandlers, msg: string): void {
  const line = handlers.sessionId
    ? `[runner:session] ${handlers.sessionId} ${msg}`
    : `[runner:session] ${msg}`
  ;(handlers.onStatus ?? handlers.onDebug)?.(line)
}

/** densable `Ke` — clear follow-up grace timer only */
function clearFollowUpHoldTimer(state: ActivityPipeState): void {
  if (state.followUpHoldTimer !== undefined) {
    clearTimeout(state.followUpHoldTimer)
    state.followUpHoldTimer = undefined
  }
}

/**
 * densable `at` — clear follow-up hold.
 * @param reason log reason when hold was active
 * @param keepTimer when true (densable Ur), do not clear timer/saw flags
 * @param childExited densable br — forwarded to C
 */
function clearFollowUpHold(
  state: ActivityPipeState,
  handlers: ActivityHandlers,
  reason: string,
  keepTimer = false,
  childExited = false,
): void {
  if (!keepTimer) {
    clearFollowUpHoldTimer(state)
    state.sawBgResult = false
    state.followUpTaskIds.clear()
  }
  if (state.bgResultAwaitingFollowup) {
    state.bgResultAwaitingFollowup = false
    handlers.onDebug?.(
      handlers.sessionId
        ? `[runner:session] ${handlers.sessionId} background-result follow-up cleared (${reason})`
        : `[runner:session] background-result follow-up cleared (${reason})`,
    )
    handlers.onBgResultFollowUpBusy?.(false, childExited)
  }
}

/** densable `ht` — arm grace → release hold → maybe turn-end */
function armFollowUpHoldGrace(
  state: ActivityPipeState,
  handlers: ActivityHandlers,
): void {
  clearFollowUpHoldTimer(state)
  const grace = state.followUpGraceMs
  state.followUpHoldTimer = setTimeout(() => {
    state.followUpHoldTimer = undefined
    logSession(
      handlers,
      `no follow-up turn within ${formatDelayMs(grace)} of the background task finishing — releasing the follow-up hold`,
    )
    clearFollowUpHold(state, handlers, 'grace elapsed')
    maybeEmitTurnEnd(state, handlers)
  }, grace)
}

/**
 * densable `Rt` — start follow-up hold (session still counted as busy).
 * Only arms grace timer when !turnInFlight (densable `if(!ne)ht()`).
 */
function startFollowUpHold(
  state: ActivityPipeState,
  handlers: ActivityHandlers,
): void {
  if (!state.bgResultAwaitingFollowup) {
    state.bgResultAwaitingFollowup = true
    logSession(
      handlers,
      `background task finished; follow-up turn pending — session still counted as busy (grace ${formatDelayMs(state.followUpGraceMs)})`,
    )
    handlers.onBgResultFollowUpBusy?.(true)
  }
  if (!state.turnInFlight) {
    armFollowUpHoldGrace(state, handlers)
  }
}

/**
 * densable `yt` — terminal event for subagent-owned / stopped tasks.
 * Starts hold only when sawBgResult && no live tasks && !waiting && !turnInFlight.
 */
function onSubagentOrStoppedTerminal(
  state: ActivityPipeState,
  handlers: ActivityHandlers,
  taskId: string,
): void {
  state.backgroundedTaskIds.delete(taskId)
  state.subagentOwnedTaskIds.delete(taskId)
  if (
    state.sawBgResult &&
    countNonMonitorTasks(state.tasks) === 0 &&
    !state.waitingOnUser &&
    !state.turnInFlight
  ) {
    startFollowUpHold(state, handlers)
  }
}

/**
 * densable `Xe` — terminal event for a (non-subagent-owned) task.
 * Marks sawBgResult when task was backgrounded; starts hold when safe.
 */
function onBackgroundTaskTerminal(
  state: ActivityPipeState,
  handlers: ActivityHandlers,
  taskId: string,
): void {
  if (state.subagentOwnedTaskIds.has(taskId)) {
    onSubagentOrStoppedTerminal(state, handlers, taskId)
    return
  }
  if (state.backgroundedTaskIds.delete(taskId)) {
    state.sawBgResult = true
    state.followUpTaskIds.add(taskId)
  }
  // densable ce() — monitor_* must not block follow-up hold
  if (countNonMonitorTasks(state.tasks) > 0) return
  if (state.waitingOnUser) return
  // densable: if(!(tt||!ne))return — skip only when !tt && turnInFlight
  if (!state.sawBgResult && state.turnInFlight) return
  state.sawBgResult = true
  state.followUpTaskIds.add(taskId)
  startFollowUpHold(state, handlers)
}

/**
 * densable He — parse one NDJSON line from stdout / FD3 activity pipe.
 */
export function handleActivityLine(
  line: string,
  state: ActivityPipeState,
  handlers: ActivityHandlers,
): void {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return
  }
  if (!parsed || typeof parsed !== 'object') return
  const msg = parsed as Record<string, unknown>
  const emit = handlers.onSessionActivity
  const debug = handlers.onDebug

  if (msg.type === 'control_response') {
    const resp = msg.response as { request_id?: unknown } | undefined
    const rid = resp?.request_id
    if (typeof rid === 'string' && rid.startsWith('shr-token-')) {
      handlers.onTokenAck?.(rid)
    }
  }

  if (msg.type === 'assistant') {
    debug?.('[runner:session] Activity: assistant message')
  } else if (msg.type === 'result') {
    debug?.(
      `[runner:session] Result: subtype=${String((msg as { subtype?: unknown }).subtype)}`,
    )
  }

  if (msg.type === 'system' && msg.subtype === 'task_started') {
    if (
      typeof msg.task_id === 'string' &&
      msg.task_type !== 'in_process_teammate'
    ) {
      state.tasks.set(
        msg.task_id,
        typeof msg.task_type === 'string' ? msg.task_type : 'unknown',
      )
      if (msg.owned_by_subagent === true) {
        state.subagentOwnedTaskIds.add(msg.task_id)
      } else {
        state.subagentOwnedTaskIds.delete(msg.task_id)
      }
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'task_updated') {
    const patch = msg.patch as
      | { status?: unknown; is_backgrounded?: unknown }
      | undefined
    const status = patch?.status
    if (
      typeof msg.task_id === 'string' &&
      patch?.is_backgrounded === true &&
      state.tasks.has(msg.task_id)
    ) {
      state.backgroundedTaskIds.add(msg.task_id)
    }
    if (
      typeof msg.task_id === 'string' &&
      (status === 'completed' || status === 'failed' || status === 'killed') &&
      state.tasks.delete(msg.task_id)
    ) {
      onBackgroundTaskTerminal(state, handlers, msg.task_id)
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
      maybeEmitTurnEnd(state, handlers)
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'task_notification') {
    if (typeof msg.task_id === 'string' && state.tasks.delete(msg.task_id)) {
      if (msg.status === 'stopped') {
        onSubagentOrStoppedTerminal(state, handlers, msg.task_id)
      } else {
        onBackgroundTaskTerminal(state, handlers, msg.task_id)
      }
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
      maybeEmitTurnEnd(state, handlers)
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'background_tasks_changed') {
    const tasks = msg.tasks
    if (Array.isArray(tasks)) {
      for (const t of tasks) {
        const id = (t as { task_id?: unknown } | null)?.task_id
        if (typeof id === 'string') state.backgroundedTaskIds.add(id)
      }
    }
    return
  }
  if (
    msg.type === 'system' &&
    msg.subtype === 'hook_response' &&
    msg.hook_event === 'SessionStart' &&
    msg.outcome === 'error'
  ) {
    handlers.onSessionStartHookError?.()
    return
  }
  if (msg.type === 'system' && msg.subtype === 'init') {
    if (!state.sawInit) {
      state.sawInit = true
      handlers.onInitObserved?.()
    }
    emit?.('activity')
    return
  }
  if (msg.type === 'system' && msg.subtype === 'turn_starting') {
    if (!state.sawInit) return
    emit?.('activity')
    // densable: follow-up turn starting clears hold; non-follow-up keeps timer
    const mode = msg.mode
    const taskId = msg.task_id
    const isFollowUp =
      mode === undefined ||
      (mode === 'task-notification' && !('task_id' in msg)) ||
      (mode === 'task-notification' &&
        typeof taskId === 'string' &&
        state.followUpTaskIds.has(taskId))
    if (isFollowUp) {
      clearFollowUpHold(state, handlers, 'follow-up turn starting')
    } else {
      clearFollowUpHold(state, handlers, 'non-follow-up turn starting', true)
      clearFollowUpHoldTimer(state)
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'session_state_changed') {
    if (typeof msg.waiting_on_user === 'boolean') {
      state.sawSessionState = true
      state.waitingOnUser = msg.waiting_on_user
    }
    if (msg.state === 'idle') {
      if (!state.sawResult) emit?.('turn-end')
      return
    }
    if (!state.sawInit) return
    if (typeof msg.waiting_on_user === 'boolean') {
      emit?.(msg.waiting_on_user ? 'awaiting-action' : 'activity')
      clearFollowUpHold(
        state,
        handlers,
        msg.waiting_on_user ? 'child parked at a prompt' : 'child running',
        true,
      )
    } else if (msg.state === 'requires_action') {
      emit?.('awaiting-action')
      clearFollowUpHold(state, handlers, 'child parked at a prompt', true)
    } else if (msg.state === 'running') {
      emit?.('activity')
      clearFollowUpHold(state, handlers, 'child running', true)
    }
    return
  }

  if (msg.type === 'assistant') {
    const content = (msg.message as { content?: unknown } | undefined)?.content
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          (block as { type?: unknown }).type === 'tool_use' &&
          (handlers.scheduleWakeupToolName === undefined ||
            (block as { name?: unknown }).name ===
              handlers.scheduleWakeupToolName)
        ) {
          const input = (block as { input?: { delaySeconds?: unknown } }).input
          const delay = Number(input?.delaySeconds)
          if (Number.isFinite(delay)) {
            const sec = Math.min(3600, Math.max(60, delay))
            state.wakeupUntil = Date.now() + sec * 1000 + state.wakeupPadMs
          }
        }
      }
    }
  }

  if (msg.type === 'result') {
    state.turnInFlight = false
    state.sawResult = true
    // densable: if(tt&&ce()===0&&!be)Rt() — bg result already seen, no non-monitor tasks
    if (
      state.sawBgResult &&
      countNonMonitorTasks(state.tasks) === 0 &&
      !state.waitingOnUser
    ) {
      startFollowUpHold(state, handlers)
    }
    if (
      countNonMonitorTasks(state.tasks) === 0 &&
      !isWakeupHolding(state) &&
      !state.bgResultAwaitingFollowup
    ) {
      emit?.('turn-end')
    } else if (
      state.waitingOnUser &&
      !process.env.CLAUDE_RUNNER_DISABLE_AWAITING_ACTION_OVERRIDE
    ) {
      emit?.('awaiting-action', snapshotBgTasks(state))
      clearFollowUpHold(state, handlers, 'child parked at a prompt', true)
    } else {
      // densable: mark remaining live tasks as backgrounded
      for (const id of state.tasks.keys()) {
        state.backgroundedTaskIds.add(id)
      }
      emit?.('turn-end-deferred', snapshotBgTasks(state))
      // densable: if(_t)ht() — re-arm grace while deferred
      if (state.bgResultAwaitingFollowup) {
        armFollowUpHoldGrace(state, handlers)
      }
      if (state.deferredTimer !== undefined) clearTimeout(state.deferredTimer)
      if (state.wakeupUntil !== null) {
        state.deferredTimer = setTimeout(
          () => {
            state.deferredTimer = undefined
            state.wakeupUntil = null
            maybeEmitTurnEnd(state, handlers)
          },
          Math.max(0, state.wakeupUntil - Date.now()),
        )
      }
    }
    return
  }

  if (msg.type === 'user' || msg.type === 'assistant') {
    // densable: ignore from_subagent user/assistant for turn tracking
    if ((msg as { from_subagent?: unknown }).from_subagent === true) return
    if (!state.turnInFlight && msg.type === 'user') state.wakeupUntil = null
    const wasIdle = !state.turnInFlight
    state.turnInFlight = true
    if (state.deferredTimer !== undefined) {
      clearTimeout(state.deferredTimer)
      state.deferredTimer = undefined
    }
    if (!state.sawSessionState) emit?.('activity')
    // densable: if(Ht){at("follow-up turn opened",fe); if(fe)Ke()}
    // When opening a new turn from idle, clear follow-up hold.
    if (wasIdle) {
      clearFollowUpHold(state, handlers, 'follow-up turn opened')
      clearFollowUpHoldTimer(state)
    }
  }
}

/** densable `St` — emit turn-end only when not in turn / no tasks / no wakeup / no hold */
function maybeEmitTurnEnd(
  state: ActivityPipeState,
  handlers: ActivityHandlers | SessionActivityHandler | undefined,
): void {
  // Support legacy call shape maybeEmitTurnEnd(state, emit)
  const h: ActivityHandlers =
    typeof handlers === 'function'
      ? { onSessionActivity: handlers }
      : (handlers ?? {})
  if (
    state.turnInFlight ||
    countNonMonitorTasks(state.tasks) > 0 ||
    isWakeupHolding(state) ||
    state.bgResultAwaitingFollowup
  ) {
    return
  }
  if (state.deferredTimer !== undefined) {
    clearTimeout(state.deferredTimer)
    state.deferredTimer = undefined
  }
  h.onSessionActivity?.('turn-end')
}

/** densable stderr SDKStartup latch */
export function handleStderrInitMarker(
  line: string,
  state: ActivityPipeState,
  handlers: {
    onInitObserved?: () => void
    onSessionActivity?: SessionActivityHandler
  },
): void {
  if (
    !state.sawInit &&
    line.startsWith('SDKStartup: phase=system_init_emitted')
  ) {
    state.sawInit = true
    handlers.onInitObserved?.()
    handlers.onSessionActivity?.('init-observed')
  }
}

/**
 * densable dispose — clear deferred turn-end timer + follow-up hold.
 * When `handlers` is provided, release via `clearFollowUpHold` so
 * `onBgResultFollowUpBusy(false, childExited)` runs (avoids sticky
 * rootRunner.deferredHold if callers only dispose).
 */
export function disposeActivityPipeState(
  state: ActivityPipeState,
  handlers?: ActivityHandlers,
  reason = 'dispose',
  childExited = false,
): void {
  if (state.deferredTimer !== undefined) {
    clearTimeout(state.deferredTimer)
    state.deferredTimer = undefined
  }
  if (handlers) {
    // densable at(reason, !1, childExited) — notify busy callback when held
    clearFollowUpHold(state, handlers, reason, false, childExited)
  } else {
    // Legacy no-handler path: drop local flag/timer only (cannot notify)
    clearFollowUpHoldTimer(state)
    state.bgResultAwaitingFollowup = false
  }
}
