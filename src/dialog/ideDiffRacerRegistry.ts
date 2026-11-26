/**
 * densable idm/Mrf live-racer registry — shared by ideDiffRacer + useDiffInIDE
 * without a circular import (racer imports showDiff from the hook).
 */

import {
  getActiveSessionFromAls,
  getBootstrapSession,
  RootSessionSlot,
  runWithSession,
  type Session,
} from '../utils/sessionRoot.js'

type IdeDiffRacerSessionState = {
  closeByToolUseId: Map<string, () => void>
  racerListeners: Map<() => void, Session | undefined>
}

const ideDiffRacerBySession = new RootSessionSlot<IdeDiffRacerSessionState>(
  () => ({
    closeByToolUseId: new Map(),
    racerListeners: new Map(),
  }),
)

function getIdeDiffRacerState(): IdeDiffRacerSessionState {
  return ideDiffRacerBySession.of(getBootstrapSession())
}

function notify(state: IdeDiffRacerSessionState): void {
  for (const [listener, captured] of state.racerListeners) {
    if (captured !== undefined && getActiveSessionFromAls() !== captured) {
      runWithSession(captured, listener)
    } else {
      listener()
    }
  }
}

export function getIdeDiffRacerCloseTab(
  toolUseID: string,
): (() => void) | undefined {
  return getIdeDiffRacerState().closeByToolUseId.get(toolUseID)
}

export function hasIdeDiffRacer(toolUseID: string): boolean {
  return getIdeDiffRacerState().closeByToolUseId.has(toolUseID)
}

export function subscribeIdeDiffRacers(onStoreChange: () => void): () => void {
  const state = getIdeDiffRacerState()
  const captured = getActiveSessionFromAls()
  state.racerListeners.set(onStoreChange, captured)
  return () => {
    state.racerListeners.delete(onStoreChange)
  }
}

export function setIdeDiffRacerCloseTab(
  toolUseID: string,
  closeTab: () => void,
): void {
  const state = getIdeDiffRacerState()
  state.closeByToolUseId.set(toolUseID, closeTab)
  notify(state)
}

export function clearIdeDiffRacerCloseTab(toolUseID: string): void {
  const state = getIdeDiffRacerState()
  if (!state.closeByToolUseId.delete(toolUseID)) return
  notify(state)
}
