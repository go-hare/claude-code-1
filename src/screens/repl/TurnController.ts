import type * as React from 'react'
import type { SpinnerMode } from '../../components/Spinner.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type {
  StreamingThinking,
  StreamingToolUse,
} from '../../utils/messages.js'
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
  isLoading: boolean
  streamMode: SpinnerMode
  streamingThinking: StreamingThinking | null
  streamingToolUses: StreamingToolUse[]
  streamingText: string | null
  responseLength: number
}

/**
 * Official `RJ` @209652093 — REPL TurnController owning turn-scoped loading,
 * task-store projection, streaming thinking/tool-uses state, and auto-hide timers.
 */
export class TurnController {
  readonly #store: AppStateStore
  readonly #changed = createSignal()
  #snapshot: TurnSnapshot = {
    isLoading: false,
    streamMode: 'responding',
    streamingThinking: null,
    streamingToolUses: [],
    streamingText: null,
    responseLength: 0,
  }
  #cancelThinkingHide: (() => void) | null = null
  #disposed = false

  readonly loading = {
    getSnapshot: (): boolean => this.#snapshot.isLoading,
    subscribe: (listener: () => void): (() => void) => this.subscribe(listener),
  }

  readonly tasks = {
    getSnapshot: () => this.#store.getState().tasks,
    subscribe: (listener: () => void): (() => void) =>
      this.#store.subscribe(listener),
  }

  constructor(options: { store: AppStateStore; initialLoading?: boolean }) {
    this.#store = options.store
    if (options.initialLoading) {
      this.#snapshot = { ...this.#snapshot, isLoading: true }
    }
  }

  get isLoading(): boolean {
    return this.#snapshot.isLoading
  }

  getSnapshot = (): TurnSnapshot => this.#snapshot

  subscribe = (listener: () => void): (() => void) =>
    this.#changed.subscribe(listener)

  setLoading(isLoading: boolean): void {
    if (this.#disposed || this.#snapshot.isLoading === isLoading) return
    this.#snapshot = { ...this.#snapshot, isLoading }
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

  publishStreamPatch(patch: Partial<TurnSnapshot>): void {
    if (this.#disposed) return
    this.#snapshot = { ...this.#snapshot, ...patch }
    this.#changed.emit()
  }

  dispatchStreamEvent(deps: DispatchReplStreamEventDeps): void {
    if (this.#disposed) return
    dispatchReplStreamEvent(deps)
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
    this.#cancelThinkingHide?.()
    this.#cancelThinkingHide = null
  }
}
