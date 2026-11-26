/**
 * pipeMuteState — Master-side logical disconnect state.
 *
 * Tracks which slave pipes are currently "muted" (logically disconnected)
 * and which have a temporary `/send` override active.
 *
 * This is local master state only — not part of the socket protocol.
 */

import { getBootstrapSessionHost, HostSlot } from './sessionHost.js'

class PipeMuteHostState {
  mutedPipes = new Set<string>()
  sendOverrides = new Set<string>()
  sendOverrideVersion = 0
  sendOverrideListeners = new Set<() => void>()
}

const fallbackPipeMuteHost: object = {}
const pipeMuteStateByHost = new HostSlot<PipeMuteHostState>(
  () => new PipeMuteHostState(),
)

function getPipeMuteHostState(): PipeMuteHostState {
  try {
    const host = getBootstrapSessionHost()
    if (host) return pipeMuteStateByHost.of(host)
  } catch {
    // Fall back when sessionHost is mocked
  }
  return pipeMuteStateByHost.of(fallbackPipeMuteHost)
}

// ---------------------------------------------------------------------------
// Muted set: slaves whose business messages should be dropped by master
// ---------------------------------------------------------------------------

export function setMasterMutedPipes(names: Iterable<string>): void {
  const muted = getPipeMuteHostState().mutedPipes
  muted.clear()
  for (const n of names) muted.add(n)
}

export function isMasterPipeMuted(name: string): boolean {
  return getPipeMuteHostState().mutedPipes.has(name)
}

export function removeMasterPipeMute(name: string): void {
  getPipeMuteHostState().mutedPipes.delete(name)
}

export function clearMasterMutedPipes(): void {
  getPipeMuteHostState().mutedPipes.clear()
}

// ---------------------------------------------------------------------------
// Send override set: slaves temporarily unmuted by explicit `/send` command.
// Override lasts until the slave emits `done` or `error`.
// ---------------------------------------------------------------------------

function emitSendOverrideChanged(
  state: PipeMuteHostState = getPipeMuteHostState(),
): void {
  state.sendOverrideVersion += 1
  for (const listener of state.sendOverrideListeners) {
    listener()
  }
}

export function addSendOverride(name: string): void {
  const state = getPipeMuteHostState()
  state.sendOverrides.add(name)
  emitSendOverrideChanged(state)
}

export function removeSendOverride(name: string): void {
  const state = getPipeMuteHostState()
  if (state.sendOverrides.delete(name)) {
    emitSendOverrideChanged(state)
  }
}

export function hasSendOverride(name: string): boolean {
  return getPipeMuteHostState().sendOverrides.has(name)
}

export function clearSendOverrides(): void {
  const state = getPipeMuteHostState()
  if (state.sendOverrides.size > 0) {
    state.sendOverrides.clear()
    emitSendOverrideChanged(state)
  }
}

export function subscribeSendOverride(listener: () => void): () => void {
  const listeners = getPipeMuteHostState().sendOverrideListeners
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getSendOverrideVersion(): number {
  return getPipeMuteHostState().sendOverrideVersion
}
