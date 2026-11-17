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

/**
 * Official `GJ` + `l9` @209943150 — REPL main transcript state &
 * `AppState.transcripts[getMainThreadAgentId()]` projection.
 */
export class TranscriptProjection {
  readonly #store: AppStateStore
  readonly #changed = createSignal()
  #messages: Message[]

  constructor(options: TranscriptProjectionOptions) {
    this.#store = options.store
    this.#messages = options.initialMessages ?? []
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

  setMessages = (action: React.SetStateAction<Message[]>): void => {
    const prev = this.#messages
    const next = typeof action === 'function' ? action(prev) : action
    pruneDetachedToolCalls(prev, next)
    if (Object.is(next, prev)) return
    this.#messages = next
    this.#changed.emit()
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
