/**
 * densable idm/Mrf live-racer registry — shared by ideDiffRacer + useDiffInIDE
 * without a circular import (racer imports showDiff from the hook).
 */

const closeByToolUseId = new Map<string, () => void>()
const racerListeners = new Set<() => void>()

function notify(): void {
  for (const listener of racerListeners) {
    listener()
  }
}

export function getIdeDiffRacerCloseTab(
  toolUseID: string,
): (() => void) | undefined {
  return closeByToolUseId.get(toolUseID)
}

export function hasIdeDiffRacer(toolUseID: string): boolean {
  return closeByToolUseId.has(toolUseID)
}

export function subscribeIdeDiffRacers(onStoreChange: () => void): () => void {
  racerListeners.add(onStoreChange)
  return () => {
    racerListeners.delete(onStoreChange)
  }
}

export function setIdeDiffRacerCloseTab(
  toolUseID: string,
  closeTab: () => void,
): void {
  closeByToolUseId.set(toolUseID, closeTab)
  notify()
}

export function clearIdeDiffRacerCloseTab(toolUseID: string): void {
  if (!closeByToolUseId.delete(toolUseID)) return
  notify()
}
