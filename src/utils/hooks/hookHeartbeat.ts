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

let registeredSink: HookHeartbeatSink | undefined
let currentTurnId = 0
let turnPastResult: number | undefined
const activeHeartbeatsBySession = new Map<string, Set<HookProgressHeartbeat>>()

export function registerHookHeartbeatSink(
  sink: HookHeartbeatSink | undefined,
): () => void {
  const prev = registeredSink
  registeredSink = sink
  return () => {
    if (registeredSink === sink) {
      registeredSink = prev
    }
  }
}

export function setHookHeartbeatTurn(turnId: number): void {
  currentTurnId = turnId
}

export function markHookHeartbeatTurnPastResult(turnId: number): void {
  turnPastResult = turnId
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
    sink: HookHeartbeatSink,
    intervalMs: number = getHookHeartbeatIntervalMs(),
  ) {
    this.hookEvent = hookEvent
    this.toolUseID = toolUseID
    this.turn = turn
    this.signal = signal
    this.sessionId = getSessionId()
    this.maxTicks = Math.max(
      1,
      Math.ceil(Math.min(maxWindowMs, MAX_HEARTBEAT_WINDOW_MS) / intervalMs),
    )
    this.timer = setInterval(() => this.tick(sink), intervalMs)
    if (typeof this.timer.unref === 'function') {
      this.timer.unref()
    }
    const set = activeHeartbeatsBySession.get(this.sessionId) ?? new Set()
    set.add(this)
    activeHeartbeatsBySession.set(this.sessionId, set)
  }

  get beatCount(): number {
    return this.beats
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    clearInterval(this.timer)
    const set = activeHeartbeatsBySession.get(this.sessionId)
    set?.delete(this)
    if (set?.size === 0) {
      activeHeartbeatsBySession.delete(this.sessionId)
    }
  }

  [Symbol.dispose](): void {
    this.stop()
  }

  private tick(sink: HookHeartbeatSink): void {
    try {
      if (this.signal?.aborted) {
        this.stop()
        return
      }
      if (currentTurnId !== this.turn) {
        this.stop()
        return
      }
      if (!(++this.ticks <= this.maxTicks)) {
        this.outcome = 'over_limit'
        this.stop()
        return
      }
      sink({
        type: 'tool_progress',
        tool_use_id: `hook-${this.hookEvent}-${this.toolUseID}-heartbeat-${this.beats++}`,
        tool_name: this.hookEvent,
        parent_tool_use_id: this.toolUseID,
        elapsed_time_seconds: Math.floor((Date.now() - this.startTime) / 1000),
        heartbeat: true,
      })
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
    const isHeadless =
      params.forceNonInteractiveForTest ?? getIsNonInteractiveSession()
    const sink = params.sink ?? registeredSink
    if (
      !isHeadless ||
      !sink ||
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE_SEND_KEEPALIVES) ||
      currentTurnId === turnPastResult ||
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
      currentTurnId,
      params.signal,
      params.maxTimeoutMs,
      sink,
    )
  } catch (err) {
    logError(err)
    return undefined
  }
}

export function stopAllHookHeartbeatsForSession(sessionId?: string): void {
  const id = sessionId ?? getSessionId()
  const set = activeHeartbeatsBySession.get(id)
  if (!set) return
  for (const hb of [...set]) {
    hb.stop()
  }
}
