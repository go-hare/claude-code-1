/**
 * 2.1.323 #1970: 30-second progress heartbeat while hooks run long in
 * `claude -p` and SDK sessions so a host (e.g. Claude Desktop) won't end
 * the turn as hung.
 *
 * Aligned with official 2.1.323/2.1.325 SEA (`eln` / `gJe` / `fmr` / `uJe`).
 */
import {
  getIsNonInteractiveSession,
  getSessionId,
} from '../../bootstrap/state.js'
import { isEnvTruthy } from '../envUtils.js'
import { logError } from '../log.js'
import {
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  HostSlot,
  runWithSession,
} from '../sessionHost.js'
import type { Session } from '../sessionRoot.js'

export const DEFAULT_HOOK_HEARTBEAT_INTERVAL_MS = 30_000
const MAX_HEARTBEAT_WINDOW_MS = 2_147_483_647

export const HOOK_HEARTBEAT_EVENTS: ReadonlySet<string> = new Set([
  'UserPromptSubmit',
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Stop',
  'PreCompact',
  'PostCompact',
])

export type HookHeartbeatEvent = {
  type: 'tool_progress'
  tool_use_id: string
  tool_name: string
  parent_tool_use_id: string
  elapsed_time_seconds: number
  heartbeat: true
}

export type HookHeartbeatSink = (event: HookHeartbeatEvent) => void

class HostHookHeartbeatState {
  registeredSink: HookHeartbeatSink | undefined
  currentTurnId = 0
  turnPastResult: number | undefined
  activeHeartbeatsBySession = new Map<string, Set<HookProgressHeartbeat>>()
}

const hostHookHeartbeatSlot = new HostSlot<HostHookHeartbeatState>(
  () => new HostHookHeartbeatState(),
)

function getHostHookHeartbeatState(): HostHookHeartbeatState {
  return hostHookHeartbeatSlot.of(getBootstrapSessionHost())
}

export function registerHookHeartbeatSink(
  sink: HookHeartbeatSink | undefined,
): () => void {
  const state = getHostHookHeartbeatState()
  const prev = state.registeredSink
  state.registeredSink = sink
  return () => {
    if (state.registeredSink === sink) {
      state.registeredSink = prev
    }
  }
}

export function setHookHeartbeatTurn(turnId: number): void {
  getHostHookHeartbeatState().currentTurnId = turnId
}

export function markHookHeartbeatTurnPastResult(turnId: number): void {
  getHostHookHeartbeatState().turnPastResult = turnId
}

export function getHookHeartbeatIntervalMs(): number {
  const raw = process.env.CLAUDE_CODE_HOOK_HEARTBEAT_INTERVAL_MS
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = Number(raw)
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed
    }
  }
  return DEFAULT_HOOK_HEARTBEAT_INTERVAL_MS
}

export class HookProgressHeartbeat {
  readonly hookEvent: string
  readonly toolUseID: string
  readonly turn: number
  readonly signal: AbortSignal | undefined
  readonly sessionId: string
  readonly startTime: number = Date.now()
  readonly maxTicks: number
  private readonly hostState: HostHookHeartbeatState
  private readonly capturedSession: Session | undefined
  private readonly explicitSink: HookHeartbeatSink | undefined
  private timer: ReturnType<typeof setInterval>
  private ticks = 0
  private beats = 0
  private stopped = false
  outcome: 'ok' | 'over_limit' | 'threw' = 'ok'

  constructor(
    hookEvent: string,
    toolUseID: string,
    turn: number,
    signal: AbortSignal | undefined,
    maxWindowMs: number,
    sink?: HookHeartbeatSink,
    intervalMs: number = getHookHeartbeatIntervalMs(),
  ) {
    this.hookEvent = hookEvent
    this.toolUseID = toolUseID
    this.turn = turn
    this.signal = signal
    this.hostState = getHostHookHeartbeatState()
    this.capturedSession = getActiveSessionFromAls()
    this.explicitSink = sink
    this.sessionId = getSessionId()
    this.maxTicks = Math.max(
      1,
      Math.ceil(Math.min(maxWindowMs, MAX_HEARTBEAT_WINDOW_MS) / intervalMs),
    )
    this.timer = setInterval(() => this.tick(), intervalMs)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
    const set =
      this.hostState.activeHeartbeatsBySession.get(this.sessionId) ?? new Set()
    set.add(this)
    this.hostState.activeHeartbeatsBySession.set(this.sessionId, set)
  }

  get beatCount(): number {
    return this.beats
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    const set = this.hostState.activeHeartbeatsBySession.get(this.sessionId)
    set?.delete(this)
    if (set?.size === 0) {
      this.hostState.activeHeartbeatsBySession.delete(this.sessionId)
    }
  }

  [Symbol.dispose](): void {
    this.stop()
  }

  private tick(): void {
    try {
      if (this.signal?.aborted) {
        this.stop()
        return
      }
      if (this.hostState.currentTurnId !== this.turn) {
        this.stop()
        return
      }
      if (!(++this.ticks <= this.maxTicks)) {
        this.outcome = 'over_limit'
        this.stop()
        return
      }
      const targetSink = this.explicitSink ?? this.hostState.registeredSink
      if (!targetSink) {
        this.stop()
        return
      }
      const event: HookHeartbeatEvent = {
        type: 'tool_progress',
        tool_use_id: `hook-${this.hookEvent}-${this.toolUseID}-heartbeat-${this.beats++}`,
        tool_name: this.hookEvent,
        parent_tool_use_id: this.toolUseID,
        elapsed_time_seconds: Math.floor((Date.now() - this.startTime) / 1000),
        heartbeat: true,
      }
      if (this.capturedSession) {
        runWithSession(this.capturedSession, () => targetSink(event))
      } else {
        targetSink(event)
      }
    } catch (err) {
      this.outcome = 'threw'
      this.stop()
      logError(err)
    }
  }
}

export function startHookHeartbeat(params: {
  hookEvent: string
  toolUseID: string
  agentId?: string
  besideTheTurn?: boolean
  matchedHookCount: number
  maxTimeoutMs: number
  signal?: AbortSignal
  sink?: HookHeartbeatSink
  forceNonInteractiveForTest?: boolean
}): HookProgressHeartbeat | undefined {
  try {
    const state = getHostHookHeartbeatState()
    const isHeadless =
      params.forceNonInteractiveForTest ?? getIsNonInteractiveSession()
    const sink = params.sink ?? state.registeredSink
    if (
      !isHeadless ||
      !sink ||
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES) ||
      state.currentTurnId === state.turnPastResult ||
      params.agentId !== undefined ||
      params.besideTheTurn === true ||
      params.matchedHookCount === 0 ||
      !HOOK_HEARTBEAT_EVENTS.has(params.hookEvent)
    ) {
      return undefined
    }
    return new HookProgressHeartbeat(
      params.hookEvent,
      params.toolUseID,
      state.currentTurnId,
      params.signal,
      params.maxTimeoutMs,
      params.sink,
    )
  } catch (err) {
    logError(err)
    return undefined
  }
}

export function stopAllHookHeartbeatsForSession(sessionId?: string): void {
  const state = getHostHookHeartbeatState()
  const id = sessionId ?? getSessionId()
  const set = state.activeHeartbeatsBySession.get(id)
  if (!set) return
  for (const hb of [...set]) {
    hb.stop()
  }
}
