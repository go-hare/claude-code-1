import type { Message } from '../types/message.js'

/**
 * Official 2.1.328 subscribable transcript snapshot interface satisfied by both
 * `TranscriptStore` and REPL's `TranscriptProjection` (single source of truth).
 */
export interface SubscribableTranscript {
  subscribe: (listener: () => void) => () => void
  getSnapshot: () => readonly Message[]
}

/**
 * Official 2.1.328 subscribable live transcript store consumed directly by
 * `ScrollPin` (`Zse`) and `Messages` (`Tje` when `source.kind === 'live'`).
 */
export class TranscriptStore implements SubscribableTranscript {
  private messages: readonly Message[] = []
  private readonly listeners = new Set<() => void>()

  constructor(initial: readonly Message[] = []) {
    this.messages = initial
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): readonly Message[] => this.messages

  setMessages(next: readonly Message[]): void {
    if (next === this.messages) return
    this.messages = next
    for (const listener of this.listeners) {
      listener()
    }
  }
}
