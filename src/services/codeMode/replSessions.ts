/**
 * Async REPL session manager (`ReplSessions`) and async lane debounce.
 *
 * 1:1 alignment with official Claude Code 2.1.328:
 * - `chunk@313680426.js`: `qhe` (`ReplSessions`), `XJo = 8`, `JJo` (`NO_EVALS`),
 *   `jIl` (`mainThreadStoppableWork`), `Uke` (`getReplSessions`).
 * - `chunk@314161648.js`: `AIl` (`getAsyncLaneDebounceConfig`: 750ms / 3000ms),
 *   `RIl` (`waitAsyncLaneLinger`).
 */

import {
  REPL_DETACH_AFTER_MS,
  REPL_MAIN_THREAD_KEY,
  REPL_SETTLE_WINDOW_MS,
} from './constants.js'

export const ASYNC_REPL_MAX_EVALS = 8

export const ASYNC_LANE_DEBOUNCE_MS = 750
export const ASYNC_LANE_MAX_WAIT_MS = 3_000

const SNIPPET_MAX_CHARS = 100
const FINISHED_TICKS_CAP = 50
const START_TICKS_DISPLAY_CAP = 10
const TICK_BATCH_DELAY_MS = 200
const EVAL_ID_BY_TOOL_USE_CAP = 256

export type ReplEvalState = 'waiting' | 'running' | 'detached' | 'late'

export type ReplEvalAbortRequester =
  | 'script'
  | 'person'
  | 'taskStop'
  | 'session'
  | 'declined'

export type ReplEvalLedgerEntry = {
  id: number
  state: ReplEvalState
  runningMs: number
  snippet: string
  notYetStarted: string[]
}

export type ReplEvalAccess = {
  list: () => Array<ReplEvalLedgerEntry & { self: boolean }>
  abort: (evalId: number) => string
}

export type ReplEvalLateHandle = {
  abort: () => void
  discard: () => void
  idle: Promise<void>
}

export type ReplEvalTick = {
  toolUseId: string
  phase: string
  toolInput?: unknown
  scriptStartedAt?: number
  scriptHelper?: boolean
  [key: string]: unknown
}

export type ReplEvalTickEvent = {
  evalId: number
  startedAt: number
  tick: ReplEvalTick
}

export type ReplRunningScriptInfo = {
  evalId: number
  description?: string
  startedAt?: number
  late: boolean
}

export type ReplEvalDispatchOptions = {
  description?: string
  replyId?: string
  toolUseId?: string
  signal: AbortSignal
  detachAfterMs: number
  staysAttachedOnTurnAbort?: boolean
  deliver: (
    evalId: number,
    output: string,
    isError: boolean,
    retired: boolean,
    isHeld: () => boolean,
    abortCause?: 'person' | 'other',
  ) => void | Promise<void>
}

export type ReplEvalRunner = (
  controller: AbortController,
  hooks: { reportNotYetStarted: (fn: () => string[]) => void },
) => Promise<string> | string

export type ReplEvalDispatchHandle = {
  evalId: number
  finished: Promise<void>
  retired: () => boolean
  ended: Promise<void>
  stopped: AbortSignal
}

export type StoppableWorkHandle = {
  outstanding: () => number
  stoppable: () => number
  onOutstandingChange: (listener: () => void) => () => void
  interrupt: () => void
}

export const NO_EVALS: ReplEvalAccess = {
  list: () => [],
  abort: () => 'no such eval',
}

class SimpleEmitter<T = void> {
  private readonly listeners = new Set<(value: T) => void>()

  subscribe(listener: (value: T) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(value: T): void {
    for (const listener of this.listeners) {
      try {
        listener(value)
      } catch {
        // Isolate subscriber errors.
      }
    }
  }
}

type PendingEvalEntry = {
  startedAt: number | undefined
  detached: boolean
  description: string | undefined
  replyId: string | undefined
  snippet: string
  controller: AbortController | undefined
  abortRequested: ReplEvalAbortRequester | undefined
  epoch: number
  late: { abort: () => void; discard: () => void } | undefined
  ticks: Map<string, ReplEvalTick>
  finished: Set<string>
  callReturned: boolean
  readNotYetStarted: (() => string[]) | undefined
  left: () => void
  retired: () => boolean
  stopped: AbortController
}

type SettlingEvalEntry = {
  description: string | undefined
  startedAt: number
}

type ReplContextLike = {
  clearAllTimers?: () => void
}

class ReplContextState {
  context: ReplContextLike | undefined = undefined
  running = new Set<AbortController>()
  attached: Promise<void> | undefined = undefined
  deliveryChain: Promise<void> = Promise.resolve()
  depth = 0
  pending = new Map<number, PendingEvalEntry>()
  ranEvals = false
  epoch = 0
  conversation = 0
  holdReportsEpoch = 0
  declined: { reason: unknown; replyIds: Set<string> } | undefined = undefined
  rewoundToolUses = new Set<string>()
  kept: ((evalId: number) => boolean) | undefined = undefined
  evalIdByToolUseId = new Map<string, number>()
  ticks = new SimpleEmitter<ReplEvalTickEvent>()
  unwaited = new Set<number>()
  undelivered = new Set<number>()
  statusLineGiven = false
  settling = new Map<number, SettlingEvalEntry>()
  onRunningChange: () => void = () => {}
  runningCache: { at: number; value: Map<string, ReplRunningScriptInfo> } = {
    at: -1,
    value: new Map(),
  }
  runningChanges = 0
  tickBatches = 0
  tickBatchOpen = false
  scriptTicksCache:
    | {
        running: Map<string, ReplRunningScriptInfo>
        tickBatches: number
        value: Map<string, Array<{ data: ReplEvalTick }>>
      }
    | undefined = undefined
}

const EMPTY_RUNNING_SCRIPTS: ReadonlyMap<string, ReplRunningScriptInfo> =
  new Map()
const EMPTY_SCRIPT_TICKS: ReadonlyMap<
  string,
  Array<{ data: ReplEvalTick }>
> = new Map()
const EMPTY_UNDELIVERED: ReadonlySet<number> = new Set()

function isTerminalTick(tick: ReplEvalTick): boolean {
  return tick.phase === 'complete' || tick.phase === 'error'
}

function isTurnSteerAbortReason(reason: unknown): boolean {
  if (typeof reason !== 'object' || reason === null) return false
  const rec = reason as { kind?: unknown; name?: unknown }
  return rec.kind === 'turn-steer' || rec.name === 'TurnSteerAbort'
}

function notifyRunningChanged(state: ReplContextState): void {
  state.runningChanges++
  state.onRunningChange()
}

function removePendingEntry(
  state: ReplContextState,
  evalId: number,
  entry: PendingEvalEntry,
): void {
  state.pending.delete(evalId)
  entry.left()
  if (
    entry.startedAt !== undefined &&
    !entry.stopped.signal.aborted &&
    !entry.retired() &&
    state.undelivered.has(evalId)
  ) {
    state.settling.set(evalId, {
      description: entry.description,
      startedAt: entry.startedAt,
    })
  }
}

export class ReplSessions {
  private readonly sessions = new Map<string, ReplContextState>()
  private nextEvalId = 1
  private unsettledCount = 0
  private lateCount = 0
  private readonly outstandingEmitter = new SimpleEmitter<void>()
  private readonly runningScriptsEmitter = new SimpleEmitter<void>()
  private readonly scriptTicksEmitter = new SimpleEmitter<void>()
  private readonly stopAskerBySignal = new WeakMap<
    AbortSignal,
    ReplEvalAbortRequester
  >()
  private mainThreadWorkHandle: StoppableWorkHandle | undefined

  takeScriptNumber(): number {
    return this.nextEvalId++
  }

  dispatch(
    key: string,
    runner: ReplEvalRunner,
    options: ReplEvalDispatchOptions,
    snippet = '',
  ): ReplEvalDispatchHandle {
    const state = this.getOrCreate(key)
    if (state.depth >= ASYNC_REPL_MAX_EVALS) {
      throw new Error(
        `async REPL dispatch rejected: ${state.depth} evals already waiting or running on this context — wait for their settles (Poll) before dispatching more`,
      )
    }

    const evalId = this.nextEvalId++
    const { epoch, conversation } = state
    const isRetired = (): boolean =>
      (state.conversation !== conversation && state.kept?.(evalId) !== true) ||
      (options.toolUseId !== undefined &&
        state.rewoundToolUses.has(options.toolUseId))
    const isHeld = (): boolean => state.holdReportsEpoch > epoch

    if (options.toolUseId !== undefined) {
      state.evalIdByToolUseId.set(options.toolUseId, evalId)
      if (state.evalIdByToolUseId.size > EVAL_ID_BY_TOOL_USE_CAP) {
        for (const [tid, id] of state.evalIdByToolUseId) {
          if (!state.pending.has(id) && !state.settling.has(id)) {
            state.evalIdByToolUseId.delete(tid)
            break
          }
        }
      }
    }

    state.ranEvals = true
    state.depth++

    let remainingGates = 2
    let resolveEnded: () => void = () => {}
    const ended = new Promise<void>(resolve => {
      resolveEnded = resolve
    })
    const releaseGate = (): void => {
      remainingGates--
      if (remainingGates === 0) {
        resolveEnded()
      }
    }
    const onDelivered = (): void => {
      state.unwaited.delete(evalId)
      state.undelivered.delete(evalId)
      state.settling.delete(evalId)
      notifyRunningChanged(state)
      releaseGate()
    }

    const stopped = new AbortController()
    const onParentSignalAbort = (): void => {
      if (!isTurnSteerAbortReason(options.signal.reason)) {
        stopped.abort()
      }
    }

    const entry: PendingEvalEntry = {
      startedAt: undefined,
      detached: false,
      description: options.description,
      replyId: options.replyId,
      snippet: snippet.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_MAX_CHARS),
      controller: undefined,
      abortRequested: undefined,
      epoch: state.epoch,
      late: undefined,
      ticks: new Map(),
      finished: new Set(),
      callReturned: false,
      readNotYetStarted: undefined,
      left: () => {
        options.signal.removeEventListener('abort', onParentSignalAbort)
        releaseGate()
      },
      retired: isRetired,
      stopped,
    }

    if (options.signal.aborted) {
      onParentSignalAbort()
    } else {
      options.signal.addEventListener('abort', onParentSignalAbort, {
        once: true,
      })
    }

    if (state.declined !== undefined) {
      if (
        options.replyId !== undefined &&
        state.declined.replyIds.has(options.replyId)
      ) {
        entry.stopped.abort(state.declined.reason)
        entry.abortRequested = 'declined'
      } else {
        state.declined = undefined
      }
    }

    state.pending.set(evalId, entry)
    state.unwaited.add(evalId)
    state.undelivered.add(evalId)
    state.statusLineGiven = false
    notifyRunningChanged(state)
    this.setUnsettledCount(this.unsettledCount + 1)

    const prevAttached = state.attached ?? Promise.resolve()
    let releaseAttached: () => void = () => {}
    const currentAttached = new Promise<void>(resolve => {
      releaseAttached = resolve
    })
    state.attached = currentAttached
    void currentAttached.then(() => {
      if (state.attached === currentAttached) {
        state.attached = undefined
      }
    })

    let handedToDelivery = false
    const runEval = async (): Promise<void> => {
      let output: string
      let isError = false
      let abortCause: 'person' | 'other' | undefined
      const isTurnAbortedByPerson = (): boolean =>
        options.signal.aborted && !isTurnSteerAbortReason(options.signal.reason)

      if (isTurnAbortedByPerson()) {
        isError = true
        abortCause = 'person'
        output =
          'cancelled before start — the dispatching turn was aborted while this eval waited for its turn; the script never ran'
      } else if (state.epoch !== epoch) {
        isError = true
        abortCause = 'person'
        output =
          'cancelled before start — the session was interrupted while this eval waited for its turn; the script never ran'
      } else if (entry.abortRequested !== undefined) {
        isError = true
        abortCause = entry.abortRequested === 'person' ? 'person' : 'other'
        output =
          entry.abortRequested === 'person'
            ? 'cancelled before start — the user stopped this eval while it waited for its turn; the script never ran'
            : entry.abortRequested === 'declined'
              ? "cancelled before start — the user declined the permission dialog for an earlier script's call (a No or an Esc), which also cancels the scripts behind that one; the script never ran"
              : entry.abortRequested === 'taskStop'
                ? 'cancelled before start — a TaskStop call stopped this eval while it waited for its turn; the script never ran'
                : entry.abortRequested === 'session'
                  ? 'cancelled before start — Claude Code stopped this eval while it waited for its turn; the script never ran'
                  : 'cancelled before start — a script aborted this eval (self.running().abort()) while it waited for its turn; it never ran'
      } else {
        const controller = new AbortController()
        let detachTimer: ReturnType<typeof setTimeout> | undefined
        let done = false
        const detach = (): void => {
          if (done) return
          if (detachTimer !== undefined) clearTimeout(detachTimer)
          entry.detached = true
          releaseAttached()
        }
        const onSignalDuringRun = (): void => {
          if (isTurnAbortedByPerson()) {
            controller.abort(options.signal.reason)
          } else if (options.staysAttachedOnTurnAbort !== true) {
            detach()
          }
        }
        if (options.signal.aborted) {
          onSignalDuringRun()
        } else {
          options.signal.addEventListener('abort', onSignalDuringRun, {
            once: true,
          })
        }
        state.running.add(controller)
        entry.startedAt = Date.now()
        notifyRunningChanged(state)
        entry.controller = controller
        if (!entry.detached) {
          detachTimer = setTimeout(detach, options.detachAfterMs)
          detachTimer.unref?.()
        }
        try {
          output = await runner(controller, {
            reportNotYetStarted: fn => {
              entry.readNotYetStarted = fn
            },
          })
        } catch (err) {
          isError = true
          output =
            err instanceof Error
              ? err.message
              : 'host-side failure before settling (non-Error rejection; detail withheld from coercion)'
        } finally {
          done = true
          if (detachTimer !== undefined) clearTimeout(detachTimer)
          options.signal.removeEventListener('abort', onSignalDuringRun)
          state.running.delete(controller)
        }
      }

      handedToDelivery = true
      this.enqueueDelivery(
        key,
        evalId,
        output,
        isError,
        options,
        releaseAttached,
        isRetired,
        onDelivered,
        isHeld,
        abortCause,
      )
    }

    const runPromise = prevAttached.then(async () => {
      try {
        await runEval()
      } finally {
        if (!handedToDelivery) {
          this.setUnsettledCount(this.unsettledCount - 1)
          releaseAttached()
          onDelivered()
        }
      }
    })
    void runPromise.catch(() => {})

    const finished = runPromise
      .then(
        () => {},
        () => {},
      )
      .then(() => {
        state.depth--
        if (entry.late === undefined) {
          removePendingEntry(state, evalId, entry)
        }
        notifyRunningChanged(state)
      })

    return {
      evalId,
      finished,
      retired: isRetired,
      ended,
      stopped: entry.stopped.signal,
    }
  }

  pending(key: string): ReplEvalLedgerEntry[] {
    return this.ledger(key).filter(item => item.state !== 'late')
  }

  ledger(key: string): ReplEvalLedgerEntry[] {
    const state = this.sessions.get(key)
    if (state === undefined) return []
    const now = Date.now()
    return [...state.pending].map(([id, entry]) => ({
      id,
      state:
        entry.late !== undefined
          ? 'late'
          : entry.startedAt === undefined
            ? 'waiting'
            : entry.detached
              ? 'detached'
              : 'running',
      runningMs: entry.startedAt === undefined ? 0 : now - entry.startedAt,
      snippet: entry.snippet,
      notYetStarted: entry.readNotYetStarted?.() ?? [],
    }))
  }

  holdLate(key: string, evalId: number, handle: ReplEvalLateHandle): void {
    const state = this.sessions.get(key)
    const entry = state?.pending.get(evalId)
    if (
      state === undefined ||
      entry === undefined ||
      entry.late !== undefined
    ) {
      handle.abort()
      return
    }
    entry.late = { abort: handle.abort, discard: handle.discard }
    entry.ticks.clear()
    entry.finished.clear()
    notifyRunningChanged(state)
    this.setLateCount(this.lateCount + 1)
    const onIdle = (): void => this.releaseLate(state, evalId, entry)
    void handle.idle.then(onIdle, onIdle)
  }

  private releaseLate(
    state: ReplContextState,
    evalId: number,
    entry: PendingEvalEntry,
  ): void {
    if (state.pending.get(evalId) !== entry) return
    removePendingEntry(state, evalId, entry)
    notifyRunningChanged(state)
    this.setLateCount(this.lateCount - 1)
  }

  stopAskerOf(signal: AbortSignal): ReplEvalAbortRequester | undefined {
    return this.stopAskerBySignal.get(signal)
  }

  recordTick(key: string, evalId: number, tick: ReplEvalTick): void {
    const state = this.sessions.get(key)
    const entry = state?.pending.get(evalId)
    if (state === undefined || entry === undefined) return
    const normalized: ReplEvalTick = {
      ...tick,
      toolInput: entry.ticks.get(tick.toolUseId)?.toolInput ?? tick.toolInput,
      scriptStartedAt: entry.startedAt,
    }
    entry.ticks.set(normalized.toolUseId, normalized)
    if (isTerminalTick(normalized)) {
      entry.finished.add(normalized.toolUseId)
      if (entry.finished.size > FINISHED_TICKS_CAP) {
        const oldest = entry.finished.values().next().value
        if (oldest !== undefined) {
          entry.finished.delete(oldest)
          entry.ticks.delete(oldest)
        }
      }
    } else {
      entry.finished.delete(normalized.toolUseId)
    }

    if (!state.tickBatchOpen) {
      state.tickBatchOpen = true
      const timer = setTimeout(() => {
        state.tickBatchOpen = false
        state.tickBatches++
        this.scriptTicksEmitter.emit()
      }, TICK_BATCH_DELAY_MS)
      timer.unref?.()
    }

    if (entry.callReturned && entry.startedAt !== undefined) {
      state.ticks.emit({
        evalId,
        startedAt: entry.startedAt,
        tick: normalized,
      })
    }
  }

  callReturned(key: string, evalId: number): void {
    const state = this.sessions.get(key)
    const entry = state?.pending.get(evalId)
    if (state === undefined || entry === undefined || entry.callReturned) {
      return
    }
    entry.callReturned = true
    if (entry.startedAt === undefined) return
    for (const tick of entry.ticks.values()) {
      state.ticks.emit({ evalId, startedAt: entry.startedAt, tick })
    }
  }

  ticks(key: string): ReplEvalTickEvent[] {
    const state = this.sessions.get(key)
    if (state === undefined) return []
    const result: ReplEvalTickEvent[] = []
    for (const [evalId, entry] of state.pending) {
      if (!entry.callReturned || entry.startedAt === undefined) continue
      for (const tick of entry.ticks.values()) {
        result.push({ evalId, startedAt: entry.startedAt, tick })
      }
    }
    return result
  }

  takeUnwaited(key: string, filterIds?: ReadonlySet<number>): number[] {
    const state = this.sessions.get(key)
    if (state === undefined) return []
    const taken = [...state.unwaited].filter(id => filterIds?.has(id) ?? true)
    for (const id of taken) {
      state.unwaited.delete(id)
    }
    return taken
  }

  noteStatusLine(key: string): void {
    this.getOrCreate(key).statusLineGiven = true
  }

  takeStatusLineGiven(key: string): boolean {
    const state = this.sessions.get(key)
    if (state === undefined) return false
    const given = state.statusLineGiven
    state.statusLineGiven = false
    return given
  }

  undelivered(key: string): ReadonlySet<number> {
    return this.sessions.get(key)?.undelivered ?? EMPTY_UNDELIVERED
  }

  runningScripts(key: string): ReadonlyMap<string, ReplRunningScriptInfo> {
    const state = this.sessions.get(key)
    if (state === undefined) return EMPTY_RUNNING_SCRIPTS
    if (state.runningCache.at === state.runningChanges) {
      return state.runningCache.value
    }
    const map = new Map<string, ReplRunningScriptInfo>()
    for (const [toolUseId, evalId] of state.evalIdByToolUseId) {
      const pendingEntry = state.pending.get(evalId)
      const active = pendingEntry ?? state.settling.get(evalId)
      if (
        active === undefined ||
        (pendingEntry !== undefined &&
          (pendingEntry.epoch !== state.epoch || pendingEntry.retired()))
      ) {
        continue
      }
      map.set(toolUseId, {
        evalId,
        description: active.description,
        startedAt: active.startedAt,
        late:
          pendingEntry?.late !== undefined && !state.undelivered.has(evalId),
      })
    }
    state.runningCache = { at: state.runningChanges, value: map }
    return map
  }

  onRunningScriptsChange(listener: () => void): () => void {
    return this.runningScriptsEmitter.subscribe(listener)
  }

  scriptTicks(key: string): ReadonlyMap<string, Array<{ data: ReplEvalTick }>> {
    const state = this.sessions.get(key)
    if (state === undefined) return EMPTY_SCRIPT_TICKS
    const running = this.runningScripts(key) as Map<
      string,
      ReplRunningScriptInfo
    >
    const cached = state.scriptTicksCache
    if (
      cached?.running === running &&
      cached.tickBatches === state.tickBatches
    ) {
      return cached.value
    }
    const map = new Map<string, Array<{ data: ReplEvalTick }>>()
    for (const [toolUseId, { evalId }] of running) {
      const items: Array<{ data: ReplEvalTick }> = []
      let startCount = 0
      for (const tick of state.pending.get(evalId)?.ticks.values() ?? []) {
        if (
          tick.scriptHelper !== true &&
          (tick.phase !== 'start' || ++startCount <= START_TICKS_DISPLAY_CAP)
        ) {
          items.push({ data: tick })
        }
      }
      if (items.length > 0) {
        map.set(toolUseId, items)
      }
    }
    state.scriptTicksCache = {
      running,
      tickBatches: state.tickBatches,
      value: map,
    }
    return map
  }

  onScriptTicksChange(listener: () => void): () => void {
    const unsubTicks = this.scriptTicksEmitter.subscribe(listener)
    const unsubRunning = this.runningScriptsEmitter.subscribe(listener)
    return () => {
      unsubTicks()
      unsubRunning()
    }
  }

  onTick(
    key: string,
    listener: (event: ReplEvalTickEvent) => void,
  ): () => void {
    return this.getOrCreate(key).ticks.subscribe(listener)
  }

  abort(
    key: string,
    evalId: number,
    requester: ReplEvalAbortRequester = 'script',
  ): string {
    const state = this.sessions.get(key)
    const entry = state?.pending.get(evalId)
    if (state === undefined || entry === undefined) {
      return 'no such eval (it may have settled already)'
    }
    entry.stopped.abort()
    if (entry.late !== undefined) {
      entry.late.abort()
      this.releaseLate(state, evalId, entry)
    } else if (entry.controller !== undefined) {
      if (requester !== 'person' && !entry.controller.signal.aborted) {
        this.stopAskerBySignal.set(entry.controller.signal, requester)
      }
      entry.controller.abort(new Error('user-cancel'))
    } else {
      entry.abortRequested = requester
    }
    return ''
  }

  cancelWaiting(key: string, reason: unknown, replyId: string): void {
    const state = this.sessions.get(key)
    if (state === undefined) return
    const replyIds = state.declined?.replyIds ?? new Set<string>()
    replyIds.add(replyId)
    state.declined = { reason, replyIds }
    for (const entry of state.pending.values()) {
      if (
        entry.controller === undefined &&
        entry.abortRequested === undefined
      ) {
        entry.stopped.abort(reason)
        entry.abortRequested = 'declined'
        if (entry.replyId !== undefined) {
          replyIds.add(entry.replyId)
        }
      }
    }
  }

  access(key: string, getSelfEvalId: () => number | undefined): ReplEvalAccess {
    return {
      list: () => {
        const selfId = getSelfEvalId()
        return this.ledger(key).map(entry => ({
          ...entry,
          self: entry.id === selfId,
        }))
      },
      abort: (evalId: number) => this.abort(key, evalId, 'script'),
    }
  }

  outstanding(key?: string): number {
    if (key === undefined) return this.unsettledCount + this.lateCount
    const state = this.sessions.get(key)
    if (state === undefined) return 0
    let late = 0
    for (const entry of state.pending.values()) {
      if (entry.late !== undefined) late++
    }
    return state.undelivered.size + late
  }

  unsettled(key?: string): number {
    if (key === undefined) return this.unsettledCount
    return this.sessions.get(key)?.undelivered.size ?? 0
  }

  mainThreadStoppableWork(): StoppableWorkHandle {
    this.mainThreadWorkHandle ??= {
      outstanding: () => this.outstanding(REPL_MAIN_THREAD_KEY),
      stoppable: () => this.stoppable([REPL_MAIN_THREAD_KEY]),
      onOutstandingChange: listener => this.onOutstandingChange(listener),
      interrupt: () => {
        this.interrupt([REPL_MAIN_THREAD_KEY])
      },
    }
    return this.mainThreadWorkHandle
  }

  stoppable(keys?: Iterable<string>): number {
    const keySet = keys === undefined ? undefined : new Set(keys)
    let count = 0
    for (const [key, state] of this.sessions) {
      if (keySet !== undefined && !keySet.has(key)) continue
      for (const entry of state.pending.values()) {
        if (
          entry.epoch === state.epoch &&
          !entry.abortRequested &&
          entry.controller?.signal.aborted !== true
        ) {
          count++
        }
      }
    }
    return count
  }

  onOutstandingChange(listener: () => void): () => void {
    return this.outstandingEmitter.subscribe(listener)
  }

  private setUnsettledCount(next: number): void {
    this.unsettledCount = Math.max(0, next)
    this.outstandingEmitter.emit()
  }

  private setLateCount(next: number): void {
    this.lateCount = Math.max(0, next)
    this.outstandingEmitter.emit()
  }

  depth(key: string): number {
    return this.sessions.get(key)?.depth ?? 0
  }

  attached(key: string): Promise<void> | undefined {
    return this.sessions.get(key)?.attached
  }

  private enqueueDelivery(
    key: string,
    evalId: number,
    output: string,
    isError: boolean,
    options: ReplEvalDispatchOptions,
    releaseAttached: () => void,
    isRetired: () => boolean,
    onDelivered: () => void,
    isHeld: () => boolean,
    abortCause: 'person' | 'other' | undefined,
  ): void {
    const state = this.getOrCreate(key)
    state.deliveryChain = state.deliveryChain
      .then(() =>
        options.deliver(
          evalId,
          output,
          isError,
          isRetired(),
          isHeld,
          abortCause,
        ),
      )
      .catch(() => {})
      .finally(() => {
        releaseAttached()
        this.setUnsettledCount(this.unsettledCount - 1)
        onDelivered()
      })
  }

  clear(keys?: Iterable<string>, kept?: (evalId: number) => boolean): void {
    const keyList = keys === undefined ? undefined : Array.from(keys)
    for (const state of this.statesFor(keyList)) {
      state.conversation++
      state.kept = kept
      for (const entry of state.pending.values()) {
        entry.late?.discard()
      }
    }
    this.interrupt(keyList, { keepsNamed: kept })
  }

  dropRewound(key: string, toolUseIds: Iterable<string>): void {
    const state = this.sessions.get(key)
    if (state === undefined) return
    for (const toolUseId of toolUseIds) {
      state.rewoundToolUses.add(toolUseId)
      const evalId = state.evalIdByToolUseId.get(toolUseId)
      if (evalId !== undefined) {
        state.settling.delete(evalId)
      }
    }
    notifyRunningChanged(state)
  }

  bringBackRewound(key: string, toolUseIds: Iterable<string>): void {
    const state = this.sessions.get(key)
    if (state === undefined) return
    for (const toolUseId of toolUseIds) {
      state.rewoundToolUses.delete(toolUseId)
    }
    notifyRunningChanged(state)
  }

  tracks(key: string, evalId: number): boolean {
    const state = this.sessions.get(key)
    return (
      state !== undefined &&
      (state.pending.has(evalId) ||
        state.undelivered.has(evalId) ||
        state.settling.has(evalId))
    )
  }

  evalIdsOf(key: string, toolUseIds: Iterable<string>): Set<number> {
    const map = this.sessions.get(key)?.evalIdByToolUseId
    const ids = new Set<number>()
    if (map === undefined) return ids
    for (const toolUseId of toolUseIds) {
      const id = map.get(toolUseId)
      if (id !== undefined) ids.add(id)
    }
    return ids
  }

  interrupt(
    keys?: Iterable<string>,
    opts: {
      holdReports?: boolean
      keepsNamed?: (evalId: number) => boolean
    } = {},
  ): void {
    const keyList = keys === undefined ? undefined : Array.from(keys)
    for (const state of this.statesFor(keyList)) {
      state.epoch++
      state.statusLineGiven = false
      if (opts.holdReports === true) {
        state.holdReportsEpoch = state.epoch
      }
      for (const controller of state.running) {
        controller.abort(new Error('user-cancel'))
      }
      for (const evalId of state.settling.keys()) {
        if (opts.keepsNamed?.(evalId) !== true) {
          state.settling.delete(evalId)
        }
      }
      notifyRunningChanged(state)
      for (const [evalId, entry] of state.pending) {
        entry.stopped.abort()
        if (entry.late !== undefined) {
          entry.late.abort()
          this.releaseLate(state, evalId, entry)
        }
      }
      state.context?.clearAllTimers?.()
      state.declined = undefined
    }
    this.outstandingEmitter.emit()
  }

  get(key: string): ReplContextLike | undefined {
    return this.sessions.get(key)?.context
  }

  has(key: string): boolean {
    return this.sessions.get(key)?.context !== undefined
  }

  set(key: string, context: ReplContextLike): void {
    this.getOrCreate(key).context = context
  }

  release(key: string): boolean {
    const state = this.sessions.get(key)
    if (state?.context === undefined) return false
    state.context.clearAllTimers?.()
    state.context = undefined
    if (!state.ranEvals) {
      this.sessions.delete(key)
    }
    return true
  }

  forget(key: string): void {
    const state = this.sessions.get(key)
    if (state === undefined) return
    const isIdle = (): boolean =>
      state.depth === 0 &&
      state.pending.size === 0 &&
      state.undelivered.size === 0 &&
      state.settling.size === 0
    const isReleased = (): boolean =>
      this.sessions.get(key) === state && state.context === undefined
    const prevOnRunningChange = state.onRunningChange
    const check = (): void => {
      if (!isReleased() || isIdle()) {
        state.onRunningChange = prevOnRunningChange
      }
      if (isReleased() && isIdle()) {
        void state.deliveryChain.finally(() => {
          if (isReleased() && isIdle()) {
            this.sessions.delete(key)
          }
        })
      }
    }
    state.onRunningChange = () => {
      prevOnRunningChange()
      check()
    }
    check()
  }

  private statesFor(keys: string[] | undefined): ReplContextState[] {
    if (keys === undefined) return [...this.sessions.values()]
    const result: ReplContextState[] = []
    for (const key of keys) {
      const state = this.sessions.get(key)
      if (state !== undefined) result.push(state)
    }
    return result
  }

  private getOrCreate(key: string): ReplContextState {
    let state = this.sessions.get(key)
    if (state === undefined) {
      state = new ReplContextState()
      state.onRunningChange = () => this.runningScriptsEmitter.emit()
      this.sessions.set(key, state)
    }
    return state
  }
}

let replSessionsSingleton: ReplSessions | undefined

export function getReplSessions(): ReplSessions {
  replSessionsSingleton ??= new ReplSessions()
  return replSessionsSingleton
}

export function resetReplSessionsForTests(): void {
  replSessionsSingleton?.clear()
  replSessionsSingleton = new ReplSessions()
}

export function mainThreadStoppableWork(
  sessions: ReplSessions = getReplSessions(),
): StoppableWorkHandle {
  return sessions.mainThreadStoppableWork()
}

/**
 * Official `AIl` (`chunk@314161648.js`): returns the async lane debounce
 * timing configuration (`debounceMs: 750`, `maxWaitMs: 3000`).
 */
export function getAsyncLaneDebounceConfig(): {
  debounceMs: number
  maxWaitMs: number
} {
  return {
    debounceMs: ASYNC_LANE_DEBOUNCE_MS,
    maxWaitMs: ASYNC_LANE_MAX_WAIT_MS,
  }
}

/**
 * Official `RIl` (`chunk@314161648.js`): waits for async lane news to debounce
 * (`debounceMs`) up to `maxWaitMs`, or resolves immediately if `signal` aborts
 * or `settled` has aborted while `nothingToLingerFor()` is true.
 */
export function waitAsyncLaneLinger(opts: {
  hasNews: () => boolean
  subscribe: (fn: () => void) => () => void
  signal: AbortSignal
  settled?: AbortSignal
  nothingToLingerFor?: () => boolean
  debounceMs?: number
  maxWaitMs?: number
}): Promise<void> {
  const {
    hasNews,
    subscribe,
    signal,
    settled,
    nothingToLingerFor,
    debounceMs = ASYNC_LANE_DEBOUNCE_MS,
    maxWaitMs = ASYNC_LANE_MAX_WAIT_MS,
  } = opts

  return new Promise<void>(resolve => {
    let done = false
    let debounceTimer: ReturnType<typeof setTimeout> | undefined
    let maxWaitTimer: ReturnType<typeof setTimeout> | undefined
    let unsubscribe: () => void = () => {}

    const finish = (): void => {
      if (done) return
      done = true
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
      if (maxWaitTimer !== undefined) clearTimeout(maxWaitTimer)
      unsubscribe()
      signal.removeEventListener('abort', finish)
      settled?.removeEventListener('abort', onSettled)
      resolve()
    }

    const onUpdate = (): void => {
      if (done) return
      if (!hasNews() && settled?.aborted !== true) return
      if (settled?.aborted === true && nothingToLingerFor?.() === true) {
        finish()
        return
      }
      if (debounceTimer !== undefined) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(finish, debounceMs)
      debounceTimer.unref?.()
      if (maxWaitTimer === undefined) {
        maxWaitTimer = setTimeout(finish, maxWaitMs)
        maxWaitTimer.unref?.()
      }
    }

    const onSettled = (): void => {
      onUpdate()
    }

    if (signal.aborted) {
      finish()
      return
    }
    unsubscribe = subscribe(onUpdate)
    signal.addEventListener('abort', finish, { once: true })
    settled?.addEventListener('abort', onSettled, { once: true })
    onUpdate()
  })
}

/**
 * Formats an async REPL evaluation's output in the official `<repl-output>` XML
 * envelope (`<repl-output eval="N" ms="..."><result>...</result></repl-output>`
 * or `<error>...</error>`).
 */
export function formatReplOutputEnvelope(opts: {
  evalId: number
  ms: number
  result: string
  isError?: boolean
}): string {
  const { evalId, ms, result, isError = false } = opts
  const tag = isError ? 'error' : 'result'
  const roundedMs = Math.max(0, Math.round(ms))
  return `<repl-output eval="${evalId}" ms="${roundedMs}">\n<${tag}>${result}</${tag}>\n</repl-output>`
}
