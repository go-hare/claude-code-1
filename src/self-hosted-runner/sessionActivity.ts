/**
 * densable 2.1.224 child activity event parsing (sjv He callback).
 * Pure NDJSON line handler recovered from `/tmp/shr-extract-224/sjv.pretty.js`.
 */

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
}

export function createActivityPipeState(): ActivityPipeState {
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
  }
}

/** non-monitor live task count (densable oe) */
export function countNonMonitorTasks(tasks: Map<string, string>): number {
  let n = 0
  for (const t of tasks.values()) {
    if (t !== 'monitor_mcp' && t !== 'monitor_ws') n++
  }
  return n
}

export function snapshotBgTasks(state: ActivityPipeState): BgTaskSnapshot {
  return {
    liveTasks: state.tasks.size,
    liveTaskIds: Array.from(state.tasks, ([id, type]) => `${id}:${type}`),
    wakeupInMs:
      state.wakeupUntil !== null
        ? Math.max(0, state.wakeupUntil - Date.now())
        : undefined,
  }
}

function isWakeupHolding(state: ActivityPipeState): boolean {
  return state.wakeupUntil !== null && Date.now() < state.wakeupUntil
}

/**
 * densable He — parse one NDJSON line from stdout / FD3 activity pipe.
 */
export function handleActivityLine(
  line: string,
  state: ActivityPipeState,
  handlers: {
    onSessionActivity?: SessionActivityHandler
    onBgTaskLedger?: (liveNonMonitor: number) => void
    onTokenAck?: (requestId: string) => void
    onSessionStartHookError?: () => void
    onInitObserved?: () => void
    onDebug?: (msg: string) => void
    /** densable g_ ScheduleWakeup tool name — optional exact match */
    scheduleWakeupToolName?: string
  },
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
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'task_updated') {
    const status = (msg.patch as { status?: unknown } | undefined)?.status
    if (
      typeof msg.task_id === 'string' &&
      (status === 'completed' || status === 'failed' || status === 'killed') &&
      state.tasks.delete(msg.task_id)
    ) {
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
      maybeEmitTurnEnd(state, emit)
    }
    return
  }
  if (msg.type === 'system' && msg.subtype === 'task_notification') {
    if (typeof msg.task_id === 'string' && state.tasks.delete(msg.task_id)) {
      handlers.onBgTaskLedger?.(countNonMonitorTasks(state.tasks))
      maybeEmitTurnEnd(state, emit)
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
    } else if (msg.state === 'requires_action') {
      emit?.('awaiting-action')
    } else if (msg.state === 'running') {
      emit?.('activity')
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
    if (state.tasks.size === 0 && !isWakeupHolding(state)) {
      emit?.('turn-end')
    } else if (
      state.waitingOnUser &&
      !process.env.CLAUDE_RUNNER_DISABLE_AWAITING_ACTION_OVERRIDE
    ) {
      emit?.('awaiting-action', snapshotBgTasks(state))
    } else {
      emit?.('turn-end-deferred', snapshotBgTasks(state))
      if (state.deferredTimer !== undefined) clearTimeout(state.deferredTimer)
      if (state.wakeupUntil !== null) {
        state.deferredTimer = setTimeout(
          () => {
            state.deferredTimer = undefined
            state.wakeupUntil = null
            maybeEmitTurnEnd(state, emit)
          },
          Math.max(0, state.wakeupUntil - Date.now()),
        )
      }
    }
    return
  }

  if (msg.type === 'user' || msg.type === 'assistant') {
    if (!state.turnInFlight && msg.type === 'user') state.wakeupUntil = null
    state.turnInFlight = true
    if (state.deferredTimer !== undefined) {
      clearTimeout(state.deferredTimer)
      state.deferredTimer = undefined
    }
    if (!state.sawSessionState) emit?.('activity')
  }
}

function maybeEmitTurnEnd(
  state: ActivityPipeState,
  emit: SessionActivityHandler | undefined,
): void {
  if (state.turnInFlight || state.tasks.size > 0 || isWakeupHolding(state)) {
    return
  }
  if (state.deferredTimer !== undefined) {
    clearTimeout(state.deferredTimer)
    state.deferredTimer = undefined
  }
  emit?.('turn-end')
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

export function disposeActivityPipeState(state: ActivityPipeState): void {
  if (state.deferredTimer !== undefined) {
    clearTimeout(state.deferredTimer)
    state.deferredTimer = undefined
  }
}
