/**
 * densable 2.1.218 #11 — in-process host engine closed-gate (S8o family).
 *
 * densable symbols (SEA 2.1.218):
 *   S8o({run, queryParams, onCommandLifecycle, ...})
 *   Ye()  — close: ae=true; H.done()
 *   Ke()  — intent dispatch; turn after close → drop + warn
 *   Me()  — drain turn queue H
 *   Ne()  — yield* Me(); finally cancel in-flight + discard remaining L
 *   Ae/Ie — command_lifecycle emit
 *   Y6o(e,t) / WEo / qdt / fRs — turn-end completed vs cancelled
 *
 * This module ports the **closed-gate + intent queue + lifecycle** control
 * plane 1:1. Turn *body* is injected via `runTurn` (densable `run` +
 * `queryParams` composition) so Host/print can wire QueryEngine later without
 * inventing a QueryEngine-only sham of Ye/Ke.
 */

import { logForDebugging } from '../utils/debug.js'
import {
  notifyCommandLifecycle,
  type CommandLifecycleState,
} from '../utils/commandLifecycle.js'
import { Stream } from '../utils/stream.js'
import {
  applyHostStickyToPrepared,
  type HostStickyControlState,
} from './hostPermissionLayers.js'

/** densable turn intent payload (type stripped at streamInput). */
export type HostTurnIntent = {
  uuid?: string
  message?: unknown
  parent_tool_use_id?: string | null
  priority?: string
  shouldQuery?: boolean
  timestamp?: string
  origin?: unknown
  [key: string]: unknown
}

export type HostEngineIntent =
  | ({ type: 'turn' } & HostTurnIntent)
  | { type: 'interrupt'; reason?: string }
  | { type: 'set_model'; model?: string | null }
  | { type: 'set_permission_mode'; mode: string }
  | {
      type: 'set_max_thinking_tokens'
      max_thinking_tokens: number | null | undefined
    }
  | { type: 'apply_flag_settings'; settings: Record<string, unknown> }
  | { type: 'seed_read_state'; path: string; seed: unknown }

export type HostEngineLifecycleFrame = {
  type: 'command_lifecycle'
  /** densable Ae field name (Host yield shape). */
  command_uuid: string
  state: CommandLifecycleState
  session_id?: string
}

/**
 * densable run generator return value carries terminal `reason` (qr).
 * See Me: `qr=Wr.value?Wr.value.reason:void 0`.
 */
export type HostTurnReturn = {
  reason?: string
  [key: string]: unknown
}

export type HostEngineLog = (
  message: string,
  meta?: { level?: 'warn' | 'error' | 'info' | 'verbose' },
) => void

export type CreateHostEngineOptions<TPrepared = HostTurnIntent> = {
  sessionId?: string
  /**
   * densable D / hostOwnsPermissionMode — when true, sticky permission_mode
   * is latched but not applied as a permissionLayers entry (host owns mode).
   */
  hostOwnsPermissionMode?: boolean
  /**
   * densable onCommandLifecycle / x — also always mirrors to
   * notifyCommandLifecycle for stream-json Host/CCR.
   */
  onCommandLifecycle?: (uuid: string, state: CommandLifecycleState) => void
  /**
   * densable queryParams builder t(Ze). On throw → lifecycle cancelled,
   * turn not run (densable turn_setup_failed path simplified to cancel).
   */
  prepareTurn?: (intent: HostTurnIntent) => Promise<TPrepared> | TPrepared
  /**
   * densable run e(...). Yielded values are re-yielded from the engine
   * generator. Must respect abortController.signal.
   * Generator return value may include `{ reason }` (densable qr).
   */
  runTurn: (
    prepared: TPrepared,
    abortController: AbortController,
    intent: HostTurnIntent,
  ) => AsyncGenerator<unknown, HostTurnReturn | undefined | unknown, unknown>
  log?: HostEngineLog
}

export type HostEngineControls = {
  /** densable streamInput — each item becomes a turn; finally closes. */
  streamInput: (source: AsyncIterable<Record<string, unknown>>) => Promise<void>
  /** densable close / Ye */
  close: () => void
  /** densable interrupt — abort in-flight; return still_queued uuids */
  interrupt: (reason?: string) => Promise<{ still_queued: string[] }>
  setModel: (model: string | null | undefined) => Promise<void>
  setPermissionMode: (mode: string) => Promise<void>
  setMaxThinkingTokens: (max: number | null | undefined) => Promise<void>
  applyFlagSettings: (settings: Record<string, unknown>) => Promise<void>
  seedReadState: (path: string, seed: unknown) => Promise<void>
  /** densable turnCount */
  turnCount: () => number
  /** Test/host: is closed-gate latched */
  isClosed: () => boolean
  /** Test: pending mirror queue length */
  pendingTurnCount: () => number
  /** densable Ke — advanced / control-plane inject */
  dispatch: (intent: HostEngineIntent) => void
}

export type HostEngine = AsyncGenerator<unknown, void, unknown> &
  HostEngineControls

const DROPPED_TURN_LOG = '[engine] dropped turn intent received after close()'

// ── densable terminal-reason taxonomy (qdt / fRs / WEo / Y6o) ──────────────

/**
 * densable qdt — user-abort terminal reasons.
 * `function qdt(e){return e==="aborted_streaming"||e==="aborted_tools"}`
 */
export function isUserAbortTerminalReason(reason: string | undefined): boolean {
  return reason === 'aborted_streaming' || reason === 'aborted_tools'
}

/**
 * densable fRs — error-class terminal reasons (true → cancelled via WEo).
 * Non-error terminals (max_turns, completed, stop_hook_prevented, …) return false.
 */
export function isErrorClassTerminalReason(
  reason: string | undefined,
): boolean {
  if (reason === undefined) return false
  switch (reason) {
    case 'blocking_limit':
    case 'rapid_refill_breaker':
    case 'prompt_too_long':
    case 'image_error':
    case 'model_error':
    case 'api_error':
    case 'malformed_tool_use_exhausted':
    case 'budget_exhausted':
    case 'structured_output_retry_exhausted':
    case 'tool_deferred_unavailable':
    case 'turn_setup_failed':
      return true
    case 'aborted_streaming':
    case 'aborted_tools':
    case 'stop_hook_prevented':
    case 'hook_stopped':
    case 'tool_deferred':
    case 'max_turns':
    case 'background_requested':
    case 'completed':
      return false
    default:
      return false
  }
}

/**
 * densable WEo — `function WEo(e){return qdt(e)||fRs(e)}`
 */
export function isCancelledTerminalReason(reason: string | undefined): boolean {
  return isUserAbortTerminalReason(reason) || isErrorClassTerminalReason(reason)
}

/**
 * densable Y6o — turn-end lifecycle state.
 * `function Y6o(e,t){return t||WEo(e)?"cancelled":"completed"}`
 * @param terminalReason densable qr (run generator return .reason)
 * @param aborted densable Ur (yt.signal.aborted)
 */
export function resolveTurnLifecycleState(
  terminalReason: string | undefined,
  aborted: boolean,
): 'completed' | 'cancelled' {
  return aborted || isCancelledTerminalReason(terminalReason)
    ? 'cancelled'
    : 'completed'
}

function extractTerminalReason(value: unknown): string | undefined {
  if (value !== null && typeof value === 'object' && 'reason' in value) {
    const r = (value as { reason?: unknown }).reason
    return typeof r === 'string' ? r : undefined
  }
  return undefined
}

function defaultLog(
  message: string,
  meta?: { level?: 'warn' | 'error' | 'info' | 'verbose' },
): void {
  logForDebugging(message, {
    level: meta?.level === 'verbose' ? 'debug' : (meta?.level ?? 'info'),
  })
}

/**
 * densable S8o factory — closed-gate host engine.
 */
export function createHostEngine<TPrepared = HostTurnIntent>(
  options: CreateHostEngineOptions<TPrepared>,
): HostEngine {
  const log = options.log ?? defaultLog
  const sessionId = options.sessionId

  // densable: H = new YZ (async queue), L = [], N = null, q = null, ae = false, P = 0
  const H = new Stream<HostTurnIntent>()
  const L: HostTurnIntent[] = []
  let N: string | null = null
  let q: AbortController | null = null
  let ae = false
  let P = 0

  // densable sticky control fields (U/W/$/G + se) — applied in Me as
  // permissionLayers + readFileState seed merge (hostPermissionLayers.ts).
  let pendingModel: string | null = null
  let pendingPermissionMode: string | null = null
  let pendingMaxThinking: number | null | undefined
  let pendingFlagSettings: Record<string, unknown> | null = null
  const seedReadStateMap = new Map<string, unknown>()
  const hostOwnsPermissionMode = options.hostOwnsPermissionMode === true

  function stickySnapshot(): HostStickyControlState {
    return {
      model: pendingModel,
      permissionMode: pendingPermissionMode,
      maxThinkingTokens: pendingMaxThinking,
      flagSettings: pendingFlagSettings,
    }
  }

  // densable he — lifecycle frames to yield between turns
  const lifecycleOutbox: HostEngineLifecycleFrame[] = []

  function emitLifecycle(uuid: string, state: CommandLifecycleState): void {
    try {
      options.onCommandLifecycle?.(uuid, state)
    } catch {
      /* densable Ie swallows callback errors via ke */
    }
    // stream-json / CCR path uses `uuid` field (notifyCommandLifecycle)
    notifyCommandLifecycle(uuid, state)
    // densable Ae yield shape uses command_uuid
    lifecycleOutbox.push({
      type: 'command_lifecycle',
      command_uuid: uuid,
      state,
      ...(sessionId ? { session_id: sessionId } : {}),
    })
  }

  function* drainLifecycleOutbox(): Generator<HostEngineLifecycleFrame> {
    while (lifecycleOutbox.length > 0) {
      const frame = lifecycleOutbox.shift()!
      log(`[engine] yield command_lifecycle/${frame.state}`, {
        level: 'verbose',
      })
      yield frame
    }
  }

  /** densable Ye */
  function Ye(): void {
    ae = true
    H.done()
  }

  /** densable Ke */
  function Ke(intent: HostEngineIntent): void {
    switch (intent.type) {
      case 'turn': {
        if (ae) {
          log(DROPPED_TURN_LOG, { level: 'warn' })
          break
        }
        const { type: _t, ...rest } = intent
        const turn = rest as HostTurnIntent
        L.push(turn)
        if (turn.uuid !== undefined) {
          emitLifecycle(turn.uuid, 'queued')
        }
        H.enqueue(turn)
        break
      }
      case 'interrupt': {
        if (q) {
          if (intent.reason !== undefined) {
            q.abort(
              typeof DOMException !== 'undefined'
                ? new DOMException(intent.reason, 'AbortError')
                : new Error(intent.reason),
            )
          } else {
            q.abort()
          }
        }
        break
      }
      case 'set_model': {
        pendingModel = intent.model ?? null
        log(`[engine] send set_model model=${intent.model}`)
        break
      }
      case 'set_permission_mode': {
        pendingPermissionMode = intent.mode
        break
      }
      case 'set_max_thinking_tokens': {
        pendingMaxThinking = intent.max_thinking_tokens
        log(
          `[engine] send set_max_thinking_tokens max=${intent.max_thinking_tokens}`,
        )
        break
      }
      case 'apply_flag_settings': {
        pendingFlagSettings = {
          ...(pendingFlagSettings ?? {}),
          ...intent.settings,
        }
        log(
          `[engine] send apply_flag_settings keys=${Object.keys(intent.settings).join(',')}`,
        )
        break
      }
      case 'seed_read_state': {
        seedReadStateMap.set(intent.path, intent.seed)
        log(`[engine] send seed_read_state path=${intent.path}`)
        break
      }
      default:
        break
    }
  }

  async function* Me(): AsyncGenerator<unknown, void, unknown> {
    // densable for await (Ze of H)
    for await (const Ze of H) {
      yield* drainLifecycleOutbox()

      let prepared: TPrepared
      try {
        if (options.prepareTurn) {
          prepared = await options.prepareTurn(Ze)
        } else {
          prepared = Ze as unknown as TPrepared
        }
      } catch (err) {
        // densable: L.shift(); Ae(uuid,"cancelled"); continue
        L.shift()
        yield* drainLifecycleOutbox()
        if (Ze.uuid !== undefined) {
          emitLifecycle(Ze.uuid, 'cancelled')
        }
        log(
          `[engine] turn setup failed: ${err instanceof Error ? err.message : String(err)}`,
          { level: 'error' },
        )
        yield* drainLifecycleOutbox()
        continue
      }

      P++
      const yt = new AbortController()
      q = yt
      L.shift()
      if (Ze.uuid !== undefined) {
        emitLifecycle(Ze.uuid, 'started')
        N = Ze.uuid
      } else {
        N = null
      }
      yield* drainLifecycleOutbox()
      log(`[engine] turn ${P} start`)

      // densable Me: merge se seeds + sticky U/W/$/G → permissionLayers
      const preparedWithSticky = applyHostStickyToPrepared(
        prepared,
        stickySnapshot(),
        seedReadStateMap,
        hostOwnsPermissionMode,
      )
      // densable clears se after apply (one-shot seed per path batch)
      seedReadStateMap.clear()

      // densable: Er=null, Ur, qr from run generator
      let Er: string | null = null
      let qr: string | undefined
      let Ur = false
      const wr = options.runTurn(preparedWithSticky, yt, Ze)
      try {
        try {
          let step = await wr.next()
          while (!step.done) {
            yield* drainLifecycleOutbox()
            yield step.value
            step = await wr.next()
          }
          // densable: qr=Wr.value?Wr.value.reason:void 0
          qr = extractTerminalReason(step.value)
        } catch (err) {
          // densable: catch(Wr){Er=le(Wr)}
          Er = err instanceof Error ? err.message : String(err)
        } finally {
          // densable: Ur=yt.signal.aborted; await wr.return(void 0).catch(()=>{})
          Ur = yt.signal.aborted
          await wr.return(undefined).catch(() => {})
        }

        // densable: ln=Ae(Ze.uuid, Er!==null?"cancelled":Y6o(qr,Ur)); N=null
        if (N !== null) {
          const state: CommandLifecycleState =
            Er !== null ? 'cancelled' : resolveTurnLifecycleState(qr, Ur)
          emitLifecycle(N, state)
          N = null
        }
        if (Er !== null) {
          log(`[engine] turn ${P} error: ${Er}`, { level: 'error' })
        }
      } finally {
        q = null
        log(`[engine] turn ${P} end`)
        yield* drainLifecycleOutbox()
      }
    }
    yield* drainLifecycleOutbox()
  }

  /** densable Ne */
  async function* Ne(): AsyncGenerator<unknown, void, unknown> {
    try {
      yield* Me()
    } finally {
      // densable: cancel in-flight; discard remaining L
      if (N !== null) {
        emitLifecycle(N, 'cancelled')
        N = null
      }
      for (const Ve of L) {
        if (Ve.uuid !== undefined) {
          emitLifecycle(Ve.uuid, 'discarded')
        }
      }
      L.length = 0
      yield* drainLifecycleOutbox()
    }
  }

  const pt = Ne()
  const st = pt.return.bind(pt)
  const De = pt.throw.bind(pt)

  const controls: HostEngineControls = {
    streamInput: async source => {
      try {
        for await (const Ze of source) {
          const { type: _Tt, ...Et } = Ze
          Ke({ type: 'turn', ...Et })
        }
      } finally {
        Ye()
      }
    },
    close: Ye,
    interrupt: async reason => {
      Ke({ type: 'interrupt', reason })
      return {
        still_queued: L.flatMap(Ze => (Ze.uuid !== undefined ? [Ze.uuid] : [])),
      }
    },
    setModel: async model => {
      Ke({ type: 'set_model', model })
    },
    setPermissionMode: async mode => {
      Ke({ type: 'set_permission_mode', mode })
    },
    setMaxThinkingTokens: async max => {
      Ke({ type: 'set_max_thinking_tokens', max_thinking_tokens: max })
    },
    applyFlagSettings: async settings => {
      Ke({ type: 'apply_flag_settings', settings })
    },
    seedReadState: async (path, seed) => {
      Ke({ type: 'seed_read_state', path, seed })
    },
    turnCount: () => P,
    isClosed: () => ae,
    pendingTurnCount: () => L.length,
    dispatch: Ke,
  }

  // densable: pt.return/throw first Ye then original
  const engine = Object.assign(pt, controls, {
    return: async (value?: undefined) => {
      Ye()
      return st(value)
    },
    throw: async (err?: unknown) => {
      Ye()
      return De(err)
    },
  }) as HostEngine

  return engine
}

/** densable drop log string — exported for tests. */
export const HOST_ENGINE_DROPPED_TURN_LOG = DROPPED_TURN_LOG
