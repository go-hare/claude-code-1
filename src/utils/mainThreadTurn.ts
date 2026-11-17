/**
 * densable 2.1.289 `dRt` / `ZO` / `Sss` / `yHr` / `g_e`.
 *
 * Main-thread query() bind/release slot. Never export densable ids.
 */
import { getSessionOnceLatches } from './sessionRoot.js'

export type MainThreadTurnSlot = {
  turnId: string
  started: Promise<void>
  isPersonStarted: boolean
  cancelled: () => boolean
  cancel: () => void
}

export function subscribeMainThreadTurnBegin(listener: () => void): () => void {
  return getSessionOnceLatches().mainThreadTurn.turnBegan.subscribe(listener)
}

export function subscribeMainThreadTurnEnd(listener: () => void): () => void {
  return getSessionOnceLatches().mainThreadTurn.turnEnded.subscribe(listener)
}

/** densable `Sss`. */
export function bindMainThreadTurn(input: {
  turnId: string
  abort: () => void
  started?: Promise<void>
  startedBy?: string
}): void {
  let cancelled = false
  const state = getSessionOnceLatches().mainThreadTurn
  state.slot = {
    turnId: input.turnId,
    started: input.started ?? Promise.resolve(),
    isPersonStarted: input.startedBy === 'person',
    cancelled: () => cancelled,
    cancel: () => {
      if (cancelled) return
      cancelled = true
      input.abort()
    },
  } satisfies MainThreadTurnSlot
  state.turnBegan.emit()
}

/** densable `yHr`. */
export function releaseMainThreadTurn(turnId: string): void {
  const state = getSessionOnceLatches().mainThreadTurn
  const current = state.slot as MainThreadTurnSlot | undefined
  const wasCurrent = current?.turnId === turnId
  if (wasCurrent) state.slot = undefined
  if (wasCurrent) state.turnEnded.emit()
}

/** densable `g_e`. */
export function getMainThreadTurn(): MainThreadTurnSlot | undefined {
  return getSessionOnceLatches().mainThreadTurn.slot as
    | MainThreadTurnSlot
    | undefined
}

/** Test cleanup. */
export function resetMainThreadTurn(): void {
  const state = getSessionOnceLatches().mainThreadTurn
  state.slot = undefined
  state.turnBegan.clear()
  state.turnEnded.clear()
}
