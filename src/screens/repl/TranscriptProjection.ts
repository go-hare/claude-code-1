import type * as React from 'react'
import { getMainThreadAgentId } from '../../bootstrap/state.js'
import type { AppStateStore } from '../../state/AppStateStore.js'
import type { Message } from '../../types/message.js'
import { pruneDetachedToolCalls } from '../../utils/detachedToolCallStore.js'
import { createSignal } from '../../utils/signal.js'

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

  subscribe = (listener: () => void): (() => void) =>
    this.#changed.subscribe(listener)

  getNonProgressSnapshot = (): Message[] => this.#nonProgressSnapshot

  subscribeNonProgress = (listener: () => void): (() => void) =>
    this.#nonProgressChanged.subscribe(listener)

  setMessages = (action: React.SetStateAction<Message[]>): void => {
    const prev = this.#messages
    const next = typeof action === 'function' ? action(prev) : action
    pruneDetachedToolCalls(prev, next)
    if (Object.is(next, prev)) return
    const nonProgressDidChange = hasNonProgressChange(
      this.#nonProgressSnapshot,
      next,
    )
    this.#messages = next
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
