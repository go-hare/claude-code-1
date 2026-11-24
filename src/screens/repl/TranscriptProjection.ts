import type * as React from 'react'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import { pruneDetachedToolCalls } from '../../utils/detachedToolCallStore.js'
import {
  applyMessageStoreAction,
  type MessageStoreAction,
} from '../../utils/messageStore.js'
import { createSignal } from '../../utils/signal.js'

export type TranscriptMessageOp = MessageStoreAction
export type TranscriptOpHoldMode = false | true | 'held'

export type TranscriptProjectionOptions = {
  store: AppStateStore
  initialMessages?: Message[]
}

function isReplIgnoredProgress(m: Message): boolean {
  if (m.type !== 'progress') return false
  const data = m.data as Record<string, unknown> | undefined
  // Keep stop-hook progress observable for REPL's stopHookSpinnerSuffix while
  // suppressing high-frequency 1s tool/agent/MCP progress churn.
  return !(
    data?.type === 'hook_progress' &&
    (data.hookEvent === 'Stop' || data.hookEvent === 'SubagentStop')
  )
}

function hasNonProgressChange(
  prev: readonly Message[],
  next: readonly Message[],
): boolean {
  let i = 0
  let j = 0
  while (i < prev.length || j < next.length) {
    while (i < prev.length && isReplIgnoredProgress(prev[i]!)) i++
    while (j < next.length && isReplIgnoredProgress(next[j]!)) j++
    if (i >= prev.length || j >= next.length) {
      return i < prev.length || j < next.length
    }
    if (!Object.is(prev[i], next[j])) return true
    i++
    j++
  }
  return false
}

/**
 * Official `GJ` + `l9` @209943150 — REPL main transcript state &
 * `AppState.transcripts[getMainThreadAgentId()]` projection.
 */
export class TranscriptProjection {
  readonly #store: AppStateStore
  readonly #changed = createSignal()
  readonly #nonProgressChanged = createSignal()
  #messages: Message[]
  #nonProgressSnapshot: Message[]
  #publishedSnapshot: Message[] | undefined = undefined
  #dirty = false

  constructor(options: TranscriptProjectionOptions) {
    this.#store = options.store
    this.#messages = options.initialMessages ?? []
    this.#nonProgressSnapshot = this.#messages
    const mainAgentId = getMainThreadAgentId()
    this.#store.setState(prev => {
      const existing = prev.transcripts[mainAgentId]
      if (existing !== undefined) return prev
      return {
        ...prev,
        transcripts: {
          ...prev.transcripts,
          [mainAgentId]: {
            messages: this.#messages,
            inProgressToolUseIDs: new Set(),
          },
        },
      }
    })
  }

  getSnapshot = (): Message[] => this.#messages

  getCurrent = (): Message[] => this.#messages

  /** Official 2.1.328 `gie.getPublished` (`chunk@319736883.js:1835100`). */
  getPublished = (): Message[] => this.#publishedSnapshot ?? this.#messages

  subscribe = (listener: () => void): (() => void) =>
    this.#changed.subscribe(listener)

  getNonProgressSnapshot = (): Message[] => this.#nonProgressSnapshot

  subscribeNonProgress = (listener: () => void): (() => void) =>
    this.#nonProgressChanged.subscribe(listener)

  /**
   * Official 2.1.328 `gie.apply` / `son` (`chunk@319736883.js:1642851, 1834821`):
   * applies a structured `MessageStoreAction` (including `insert-after-uuid`,
   * `replace-by-uuid`, `append`, `update`, etc.) with optional `'held'` or
   * deferred (`true`) publication mode.
   */
  applyMessageOp = (
    op: TranscriptMessageOp,
    holdMode: TranscriptOpHoldMode = false,
  ): void => {
    this.replace(prev => applyMessageStoreAction(prev, op), holdMode)
  }

  /**
   * Official 2.1.328 `gie.replace(action, holdMode)` (`chunk@319736883.js:1834760`).
   * When `holdMode` is `'held'` or `true`, updates the live transcript buffer
   * immediately without notifying subscribers until a subsequent unheld update
   * or `flush()` commits it.
   */
  replace = (
    action: React.SetStateAction<Message[]>,
    holdMode: TranscriptOpHoldMode = false,
  ): void => {
    const prev = this.#messages
    const next = typeof action === 'function' ? action(prev) : action
    pruneDetachedToolCalls(prev, next)
    if (Object.is(next, prev)) {
      if (!holdMode && this.#publishedSnapshot !== undefined) {
        this.#publish(this.#publishedSnapshot)
      }
      return
    }
    this.#messages = next
    if (holdMode) {
      this.#publishedSnapshot ??= prev
      if (holdMode !== 'held') {
        this.#dirty = true
      }
      return
    }
    this.#publish(this.#publishedSnapshot ?? prev)
  }

  /**
   * Official 2.1.328 `gie.flush` (`chunk@319736883.js:1835120`):
   * publishes deferred updates when dirty (or unconditionally when `force` is true).
   */
  flush = (force = false): void => {
    if (this.#publishedSnapshot !== undefined && (force || this.#dirty)) {
      this.#publish(this.#publishedSnapshot)
    }
  }

  setMessages = (action: React.SetStateAction<Message[]>): void => {
    this.replace(action, false)
  }

  #publish(previousPublished: Message[]): void {
    this.#publishedSnapshot = undefined
    this.#dirty = false
    const next = this.#messages
    if (Object.is(next, previousPublished)) return
    const nonProgressDidChange = hasNonProgressChange(
      this.#nonProgressSnapshot,
      next,
    )
    if (nonProgressDidChange) {
      this.#nonProgressSnapshot = next
    }
    this.#changed.emit()
    if (nonProgressDidChange) {
      this.#nonProgressChanged.emit()
    }
    const mainAgentId = getMainThreadAgentId()
    this.#store.setState(state => {
      const existing = state.transcripts[mainAgentId]
      if (existing !== undefined && existing.messages === next) {
        return state
      }
      return {
        ...state,
        transcripts: {
          ...state.transcripts,
          [mainAgentId]: {
            messages: next,
            inProgressToolUseIDs: existing?.inProgressToolUseIDs ?? new Set(),
          },
        },
      }
    })
  }
}
