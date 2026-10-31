/**
 * densable 2.1.289 `dRt` / `ZO` / `Sss` / `yHr` / `g_e`.
 *
 * Main-thread query() bind/release slot. Never export densable ids.
 */
import { createSignal } from './signal.js'

export type MainThreadTurnSlot = {
  turnId: string
  started: Promise<void>
  isPersonStarted: boolean
  cancelled: () => boolean
  cancel: () => void
}

let slot: MainThreadTurnSlot | undefined
const turnBegan = createSignal()
const turnEnded = createSignal()

export const subscribeMainThreadTurnBegin = turnBegan.subscribe
export const subscribeMainThreadTurnEnd = turnEnded.subscribe

/** densable `Sss`. */
export function bindMainThreadTurn(input: {
  turnId: string
  abort: () => void
  started?: Promise<void>
  startedBy?: string
}): void {
  let cancelled = false
  slot = {
    turnId: input.turnId,
    started: input.started ?? Promise.resolve(),
    isPersonStarted: input.startedBy === 'person',
    cancelled: () => cancelled,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      input.abort()
    },
  }
  turnBegan.emit()
}

/** densable `yHr`. */
export function releaseMainThreadTurn(turnId: string): void {
  const wasCurrent = slot?.turnId === turnId
  if (wasCurrent) slot = undefined
  if (wasCurrent) turnEnded.emit()
}

/** densable `g_e`. */
export function getMainThreadTurn(): MainThreadTurnSlot | undefined {
  return slot
}

/** Test cleanup. */
export function resetMainThreadTurn(): void {
  slot = undefined
  turnBegan.clear()
  turnEnded.clear()
}
