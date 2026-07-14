// Auto mode state functions — lives in its own module so callers can
// conditionally require() it on feature('TRANSCRIPT_CLASSIFIER').

export type AutoModeState = {
  active: boolean
  flagCli: boolean
  circuitBroken: boolean
  fromFallback: boolean
}

export function createAutoModeState(): AutoModeState {
  return {
    active: false,
    flagCli: false,
    circuitBroken: false,
    fromFallback: false,
  }
}

let autoModeState = createAutoModeState()

export function setAutoModeActive(active: boolean): void {
  autoModeState.active = active
}

export function isAutoModeActive(): boolean {
  return autoModeState.active
}

export function setAutoModeFlagCli(passed: boolean): void {
  autoModeState.flagCli = passed
}

export function getAutoModeFlagCli(): boolean {
  return autoModeState.flagCli
}

export function setAutoModeCircuitBroken(broken: boolean): void {
  autoModeState.circuitBroken = broken
}

export function isAutoModeCircuitBroken(): boolean {
  return autoModeState.circuitBroken
}

/**
 * Official 2.1.196+: true when auto was selected as a silent fallback
 * (no explicit CLI/settings mode) rather than user intent. Resume and
 * setAutoModeFlagCli treat this differently from explicit auto.
 */
export function setAutoModeFromFallback(fromFallback: boolean): void {
  autoModeState.fromFallback = fromFallback
}

export function isAutoModeFromFallback(): boolean {
  return autoModeState.fromFallback
}

export function _setGlobalAutoModeStateForTesting(state: AutoModeState): void {
  autoModeState = state
}

export function _resetForTesting(): void {
  autoModeState = createAutoModeState()
}
