import type * as React from 'react'
import { createHostEngineFeed } from '../../engine/hostEngineTurn.js'
import type { QueryParams } from '../../query.js'
import type { SpinnerMode } from '../../components/Spinner.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type {
  StreamingThinking,
  StreamingToolUse,
} from '../../utils/messages.js'
import { QueryGuard } from '../../utils/QueryGuard.js'
import { waitWithAbort } from '../../utils/abortController.js'
import { createSignal } from '../../utils/signal.js'
import {
  dispatchReplStreamEvent,
  runReplTurn,
  type DispatchReplStreamEventDeps,
  type RunReplTurnArgs,
  type RunReplTurnDeps,
} from './runReplTurn.js'

const THINKING_AUTO_HIDE_MS = 30_000

export type TurnSnapshot = {
  abortController: AbortController | null
  isQueryActive: boolean
  isExternalLoading: boolean
  isLoading: boolean
  streamMode: SpinnerMode
  streamingThinking: StreamingThinking | null
  streamingToolUses: StreamingToolUse[]
  streamingText: string | null
  responseLength: number
  isMainRequestAwaitingResponse: boolean
  isMainResponseStreaming: boolean
}

/**
 * Official 2.1.328 `iie`: owns the guard and publishes loading synchronously
 * from guard/external state. Streaming state retains its local facade here.
 */
export class TurnController {
  readonly guard = new QueryGuard()
  readonly engineFeed = createHostEngineFeed<QueryParams>()
  readonly #store: AppStateStore
  readonly #ownsEngine: boolean
  readonly #changed = createSignal()
  readonly #unsubscribeGuard: () => void
  #snapshot: TurnSnapshot = {
    abortController: null,
    isQueryActive: false,
    isExternalLoading: false,
    isLoading: false,
    streamMode: 'responding',
    streamingThinking: null,
    streamingToolUses: [],
    streamingText: null,
    responseLength: 0,
    isMainRequestAwaitingResponse: false,
    isMainResponseStreaming: false,
  }
  #cancelThinkingHide: (() => void) | null = null
  #disposed = false
  #awaitPendingHooks: (() => Promise<void> | undefined) | undefined

  readonly loading = {
    getSnapshot: (): boolean => this.#snapshot.isLoading,
    subscribe: (listener: () => void): (() => void) => this.subscribe(listener),
  }

  readonly tasks = {
    getSnapshot: () => this.#store.getState().tasks,
    subscribe: (listener: () => void): (() => void) =>
      this.#store.subscribe(listener),
  }

  constructor(options: {
    store: AppStateStore
    initialLoading?: boolean
    ownsEngine?: boolean
  }) {
    this.#store = options.store
    this.#ownsEngine = options.ownsEngine ?? true
    if (options.initialLoading) {
      this.#snapshot = {
        ...this.#snapshot,
        isExternalLoading: true,
        isLoading: true,
      }
    }
    this.#unsubscribeGuard = this.guard.subscribe(() => {
      this.#publish({ isQueryActive: this.guard.isActive })
    })
  }

  bindSessionStartHooks(read: () => Promise<void> | undefined): void {
    this.#awaitPendingHooks = read
  }

  awaitSessionStartHooks = (signal: AbortSignal): Promise<void> | undefined => {
    const pending = this.#awaitPendingHooks?.()
    if (!pending) return
    return waitWithAbort(pending, signal).catch(error => {
      if (!signal.aborted) throw error
    })
  }

  get abortController(): AbortController | null {
    return this.#snapshot.abortController
  }

  setAbortController = (abortController: AbortController | null): void => {
    this.#publish({ abortController })
  }

  get isLoading(): boolean {
    return this.#snapshot.isLoading
  }

  readPendingQueryParams = (): QueryParams => {
    const next = this.engineFeed.pendingQueryParams.shift()
    if (next === undefined) {
      throw new Error(
        'engine: queryParams called before send — turn wiring bug',
      )
    }
    return next
  }

  getSnapshot = (): TurnSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) =>
    this.#changed.subscribe(listener)

  setExternalLoading = (isExternalLoading: boolean): void => {
    this.#publish({ isExternalLoading })
  }

  #publish(patch: Partial<Omit<TurnSnapshot, 'isLoading'>>): void {
    if (this.#disposed) return
    const prev = this.#snapshot
    const next = { ...prev, ...patch }
    if (
      (Object.keys(patch) as (keyof typeof patch)[]).every(key =>
        Object.is(prev[key], next[key]),
      )
    ) {
      return
    }
    this.#snapshot = {
      ...next,
      isLoading: next.isQueryActive || next.isExternalLoading,
    }
    this.#changed.emit()
  }

  setStreamMode = (streamMode: SpinnerMode): void => {
    if (this.#disposed || this.#snapshot.streamMode === streamMode) return
    this.#snapshot = { ...this.#snapshot, streamMode }
    this.#changed.emit()
  }

  setStreamingThinking = (
    updater: React.SetStateAction<StreamingThinking | null>,
  ): void => {
    if (this.#disposed) return
    const next =
      typeof updater === 'function'
        ? updater(this.#snapshot.streamingThinking)
        : updater
    if (Object.is(next, this.#snapshot.streamingThinking)) return

    this.#cancelThinkingHide?.()
    this.#cancelThinkingHide = null

    if (next && !next.isStreaming && next.streamingEndedAt) {
      const remaining =
        THINKING_AUTO_HIDE_MS - (Date.now() - next.streamingEndedAt)
      if (remaining <= 0) {
        this.#snapshot = { ...this.#snapshot, streamingThinking: null }
        this.#changed.emit()
        return
      }
      const timer = setTimeout(() => {
        this.#cancelThinkingHide = null
        this.setStreamingThinking(null)
      }, remaining)
      timer.unref?.()
      this.#cancelThinkingHide = () => clearTimeout(timer)
    }

    this.#snapshot = { ...this.#snapshot, streamingThinking: next }
    this.#changed.emit()
  }

  setStreamingToolUses = (
    updater: React.SetStateAction<StreamingToolUse[]>,
  ): void => {
    if (this.#disposed) return
    const next =
      typeof updater === 'function'
        ? updater(this.#snapshot.streamingToolUses)
        : updater
    if (Object.is(next, this.#snapshot.streamingToolUses)) return
    this.#snapshot = { ...this.#snapshot, streamingToolUses: next }
    this.#changed.emit()
  }

  publishStreamPatch(
    patch: Partial<Omit<TurnSnapshot, 'isLoading' | 'isQueryActive'>>,
  ): void {
    this.#publish(patch)
  }

  beginEngineRead = (): void => {
    this.#publish({
      isMainRequestAwaitingResponse: false,
      isMainResponseStreaming: false,
    })
  }

  noteMainRequestAnnounced = (): void => {
    this.#publish({ isMainRequestAwaitingResponse: true })
  }

  resetRequestState = (): void => {
    this.beginEngineRead()
  }

  get isMainRequestAwaitingResponse(): boolean {
    return this.#snapshot.isMainRequestAwaitingResponse
  }

  get isMainResponseStreaming(): boolean {
    return this.#snapshot.isMainResponseStreaming
  }

  dispatchStreamEvent(deps: DispatchReplStreamEventDeps): void {
    if (this.#disposed) return
    const event = deps.event as {
      type?: string
      event?: { type?: string }
      message?: unknown
    }
    if (event.type === 'stream_request_start') this.noteMainRequestAnnounced()
    if (event.type === 'stream_event') {
      if (event.event?.type === 'message_start') {
        this.#publish({ isMainRequestAwaitingResponse: false })
      } else if (event.event?.type === 'message_stop') {
        this.#publish({ isMainResponseStreaming: false })
      }
    } else if (event.type === 'assistant') {
      this.#publish({
        isMainRequestAwaitingResponse: false,
        isMainResponseStreaming: false,
      })
    }
    dispatchReplStreamEvent({
      ...deps,
      onApiMetrics: metrics => {
        if ('type' in metrics && metrics.type === 'start') {
          this.#publish({ isMainResponseStreaming: true })
        } else if ('type' in metrics && metrics.type === 'end') {
          this.#publish({ isMainResponseStreaming: false })
        }
        deps.onApiMetrics?.(metrics)
      },
    })
  }

  async runTurn(
    args: RunReplTurnArgs,
    deps: RunReplTurnDeps,
  ): Promise<boolean> {
    if (this.#disposed) return false
    return runReplTurn(args, deps)
  }

  dispose(): void {
    this.#disposed = true
    this.#unsubscribeGuard()
    this.#cancelThinkingHide?.()
    this.#cancelThinkingHide = null
    if (this.#ownsEngine) this.engineFeed.input?.done()
    this.engineFeed.input = null
  }
}
