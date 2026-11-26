// Auto mode state functions — lives in its own module so callers can
// conditionally require() it on feature('TRANSCRIPT_CLASSIFIER').
import { getBootstrapSessionHost, HostSlot } from '../sessionHost.js'

export type AutoModeState = {
  active: boolean
  flagCli: boolean
  circuitBroken: boolean
  fromFallback: boolean
  /** Official 2.1.326 #297 (`HLn`/`xOi`): startup defaulted to auto while awaiting server-managed settings. */
  autoDefaultAwaitsServedSettings: boolean
}

export function createAutoModeState(): AutoModeState {
  return {
    active: false,
    flagCli: false,
    circuitBroken: false,
    fromFallback: false,
    autoDefaultAwaitsServedSettings: false,
  }
}

// Official 2.1.331 [W-068]: per-host AutoModeState slot.
const autoModeStateByHost = new HostSlot<{ state: AutoModeState }>(() => ({
  state: createAutoModeState(),
}))

function getAutoModeState(): AutoModeState {
  return autoModeStateByHost.of(getBootstrapSessionHost()).state
}

export function setAutoModeActive(active: boolean): void {
  getAutoModeState().active = active
}

export function isAutoModeActive(): boolean {
  return getAutoModeState().active
}

export function setAutoModeFlagCli(passed: boolean): void {
  getAutoModeState().flagCli = passed
}

export function getAutoModeFlagCli(): boolean {
  return getAutoModeState().flagCli
}

export function setAutoModeCircuitBroken(broken: boolean): void {
  getAutoModeState().circuitBroken = broken
}

export function isAutoModeCircuitBroken(): boolean {
  return getAutoModeState().circuitBroken
}

/**
 * Official 2.1.196+: true when auto was selected as a silent fallback
 * (no explicit CLI/settings mode) rather than user intent. Resume and
 * setAutoModeFlagCli treat this differently from explicit auto.
 */
export function setAutoModeFromFallback(fromFallback: boolean): void {
  getAutoModeState().fromFallback = fromFallback
}

export function isAutoModeFromFallback(): boolean {
  return getAutoModeState().fromFallback
}

/** Official 2.1.326 #297 (`HLn`): record whether startup auto default awaits served policy settings. */
export function setAutoDefaultAwaitsServedSettings(awaits: boolean): void {
  getAutoModeState().autoDefaultAwaitsServedSettings = awaits
}

/** Official 2.1.326 #297 (`xOi`): true while startup auto default awaits served policy settings. */
export function isAutoDefaultAwaitsServedSettings(): boolean {
  return getAutoModeState().autoDefaultAwaitsServedSettings
}

export function _setGlobalAutoModeStateForTesting(state: AutoModeState): void {
  autoModeStateByHost.of(getBootstrapSessionHost()).state = state
}

export function _resetForTesting(): void {
  autoModeStateByHost.of(getBootstrapSessionHost()).state =
    createAutoModeState()
}
