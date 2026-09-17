import type { Notification } from '../context/notifications.js'
import type { Message } from '../types/message.js'
import { logEvent } from '../services/analytics/index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../services/analytics/index.js'
import { formatTokens } from './format.js'
import { idleReturnContextTokens } from './idleReturnHint.js'
import {
  resolveIdleThresholdMs,
  resolveIdleTokenThreshold,
} from './residualMsEnvGates.js'

export const IDLE_RETURN_HINT_KEY = 'idle-return-hint'

export type IdleReturnTurnSnapshot = {
  isLoading: boolean
  lastQueryCompletionTime: number
  submitCount: number
}

export type IdleReturnTurn = {
  getSnapshot: () => IdleReturnTurnSnapshot
  subscribe: (fn: () => void) => () => void
}

export type IdleReturnClock = {
  setTimeout: (fn: () => void, ms: number) => () => void
}

export type IdleReturnHost = {
  turn: IdleReturnTurn
  getMessages: () => readonly Message[]
  clock: IdleReturnClock
  now: () => number
  getLastInteractionTime: () => number
  isDialogOnScreen: () => boolean
  hasPendingLoopWakeup: () => boolean
  hasArmedQuotaAutoResume: () => boolean
  getIdleNotifThresholdMs: () => number
  sendIdleNotification: () => void
  addNotification: (n: Notification) => void
  removeNotification: (key: string) => void
  hasSeededRemotePrompt: boolean
}

/** densable 2.1.246 F$ — idle OS notif + idle-return hint. */
export class IdleReturnController {
  readonly #host: IdleReturnHost
  #snapshot: IdleReturnTurnSnapshot
  #overlayShowing = false
  #idleNotifCancel: (() => void) | null = null
  #hintCancel: (() => void) | null = null
  #hintShown = false
  readonly #unsubscribe: () => void
  #disposed = false

  constructor(host: IdleReturnHost) {
    this.#host = host
    this.#snapshot = host.turn.getSnapshot()
    this.#unsubscribe = host.turn.subscribe(this.#onTurn)
    this.#scheduleIdleNotif()
    this.#scheduleHint()
  }

  setLocalOverlayShowing(showing: boolean): void {
    if (this.#disposed || showing === this.#overlayShowing) return
    this.#overlayShowing = showing
    this.#scheduleIdleNotif()
  }

  onClearSubmitted(): void {
    if (!this.#hintShown) return
    const messages = this.#host.getMessages()
    logEvent('tengu_idle_return_action', {
      action:
        'hint_converted' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      idleMinutes: Math.round(
        (this.#host.now() - this.#snapshot.lastQueryCompletionTime) / 60_000,
      ),
      messageCount: messages.length,
      contextTokens: this.#contextTokens(messages),
    })
    this.#hintShown = false
  }

  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#unsubscribe()
    this.#clearIdleNotif()
    this.#clearHint()
  }

  #onTurn = (): void => {
    const next = this.#host.turn.getSnapshot()
    const prev = this.#snapshot
    this.#snapshot = next
    const loadingOrCompleteChanged =
      next.isLoading !== prev.isLoading ||
      next.lastQueryCompletionTime !== prev.lastQueryCompletionTime
    if (loadingOrCompleteChanged || next.submitCount !== prev.submitCount) {
      this.#scheduleIdleNotif()
    }
    if (loadingOrCompleteChanged) {
      this.#scheduleHint()
    }
  }

  #clearIdleNotif(): void {
    this.#idleNotifCancel?.()
    this.#idleNotifCancel = null
  }

  #scheduleIdleNotif(): void {
    this.#clearIdleNotif()
    const { isLoading, submitCount, lastQueryCompletionTime } = this.#snapshot
    if (isLoading) return
    if (submitCount === 0 && !this.#host.hasSeededRemotePrompt) return
    if (lastQueryCompletionTime === 0) return
    this.#idleNotifCancel = this.#host.clock.setTimeout(
      () => {
        this.#idleNotifCancel = null
        if (this.#host.getLastInteractionTime() > lastQueryCompletionTime)
          return
        const elapsed = this.#host.now() - lastQueryCompletionTime
        if (
          !this.#snapshot.isLoading &&
          !this.#overlayShowing &&
          !this.#host.isDialogOnScreen() &&
          !this.#host.hasPendingLoopWakeup() &&
          !this.#host.hasArmedQuotaAutoResume() &&
          elapsed >= this.#host.getIdleNotifThresholdMs()
        ) {
          this.#host.sendIdleNotification()
        }
      },
      Math.min(2147483647, this.#host.getIdleNotifThresholdMs()),
    )
  }

  #clearHint(): void {
    const hadTimer = this.#hintCancel !== null
    this.#hintCancel?.()
    this.#hintCancel = null
    if (hadTimer) {
      this.#host.removeNotification(IDLE_RETURN_HINT_KEY)
      this.#hintShown = false
    }
  }

  #scheduleHint(): void {
    this.#clearHint()
    const { isLoading, lastQueryCompletionTime } = this.#snapshot
    if (lastQueryCompletionTime === 0 || isLoading) return
    const tokenThreshold = resolveIdleTokenThreshold()
    if (this.#contextTokens(this.#host.getMessages()) < tokenThreshold) return
    const remaining =
      resolveIdleThresholdMs() - (this.#host.now() - lastQueryCompletionTime)
    this.#hintCancel = this.#host.clock.setTimeout(
      () => {
        const messages = this.#host.getMessages()
        const messageCount = messages.length
        if (messageCount === 0) return
        const contextTokens = this.#contextTokens(messages)
        const idleMinutes =
          (this.#host.now() - lastQueryCompletionTime) / 60_000
        this.#host.addNotification({
          key: IDLE_RETURN_HINT_KEY,
          kind: 'contextual',
          segments: [
            { text: 'new task? ', dim: true },
            { text: '/clear', color: 'suggestion' },
            { text: ' to save ', dim: true },
            {
              text: `${formatTokens(contextTokens)} tokens`,
              color: 'suggestion',
            },
          ],
          priority: 'medium',
          timeoutMs: 2147483647,
        })
        this.#hintShown = true
        logEvent('tengu_idle_return_action', {
          action:
            'hint_shown' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          idleMinutes: Math.round(idleMinutes),
          messageCount,
          contextTokens,
        })
      },
      Math.min(2147483647, Math.max(0, remaining)),
    )
  }

  #contextTokens(messages: readonly Message[]): number {
    return idleReturnContextTokens(messages as Message[])
  }
}

export function createIdleReturnTurnSource(initial: IdleReturnTurnSnapshot): {
  turn: IdleReturnTurn
  publish: (next: IdleReturnTurnSnapshot) => void
} {
  let snapshot = initial
  const listeners = new Set<() => void>()
  return {
    turn: {
      getSnapshot: () => snapshot,
      subscribe: fn => {
        listeners.add(fn)
        return () => {
          listeners.delete(fn)
        }
      },
    },
    publish(next) {
      if (
        next.isLoading === snapshot.isLoading &&
        next.lastQueryCompletionTime === snapshot.lastQueryCompletionTime &&
        next.submitCount === snapshot.submitCount
      ) {
        return
      }
      snapshot = next
      for (const fn of listeners) fn()
    },
  }
}

export function createIdleReturnClock(): IdleReturnClock {
  return {
    setTimeout(fn, ms) {
      const id = setTimeout(fn, ms)
      return () => clearTimeout(id)
    },
  }
}
