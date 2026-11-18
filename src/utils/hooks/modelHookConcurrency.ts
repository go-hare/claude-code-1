import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'

/**
 * Upstream v2.1.302 (`fJe = 12`): at most 12 prompt/agent hooks of one event
 * run at a time; the rest wait their turn.
 */
export const MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT = 12

type Waiter = {
  limit: number
  signal: AbortSignal
  grant: () => void
  cancel: () => void
}

type EventSlotState = {
  active: number
  waiters: Waiter[]
}

const eventSlots = new Map<string, EventSlotState>()

function getSlotState(key: string): EventSlotState {
  let state = eventSlots.get(key)
  if (!state) {
    state = { active: 0, waiters: [] }
    eventSlots.set(key, state)
  }
  return state
}

function drainWaiters(state: EventSlotState): void {
  while (state.waiters.length > 0 && state.active < state.waiters[0]!.limit) {
    const next = state.waiters.shift()!
    if (next.signal.aborted) {
      next.cancel()
      continue
    }
    state.active += 1
    next.grant()
  }
}

/**
 * Acquire a concurrency slot for a model (prompt/agent) hook of `hookEvent`.
 * Returns a release callback, or `undefined` if `signal` is aborted before a
 * slot is granted.
 */
export function acquireModelHookSlot(
  hookEvent: HookEvent | string,
  signal: AbortSignal,
  limit = MAX_CONCURRENT_MODEL_HOOKS_PER_EVENT,
): Promise<(() => void) | undefined> {
  if (signal.aborted) {
    return Promise.resolve(undefined)
  }
  const state = getSlotState(hookEvent)
  const release = () => {
    state.active = Math.max(0, state.active - 1)
    drainWaiters(state)
  }
  if (state.active < limit && state.waiters.length === 0) {
    state.active += 1
    return Promise.resolve(release)
  }
  return new Promise(resolve => {
    const onAbort = () => {
      const idx = state.waiters.indexOf(waiter)
      if (idx !== -1) {
        state.waiters.splice(idx, 1)
      }
      resolve(undefined)
      drainWaiters(state)
    }
    const waiter: Waiter = {
      limit,
      signal,
      grant: () => {
        signal.removeEventListener('abort', onAbort)
        resolve(release)
      },
      cancel: () => {
        signal.removeEventListener('abort', onAbort)
        resolve(undefined)
      },
    }
    state.waiters.push(waiter)
    signal.addEventListener('abort', onAbort, { once: true })
    drainWaiters(state)
  })
}

export function getActiveModelHookCount(hookEvent: HookEvent | string): number {
  return eventSlots.get(hookEvent)?.active ?? 0
}

export function resetModelHookConcurrencyForTests(): void {
  eventSlots.clear()
}
