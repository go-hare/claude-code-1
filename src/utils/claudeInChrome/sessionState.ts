/**
 * densable 2.1.239 `slf` / `gP` — chrome install-upsell session subset.
 * Do not invent the rest of `slf` (bridgeBinding, trackedTabIds, …).
 */

type ChromeInstallSessionState = {
  wiredThisSession: boolean
  installUpsellResolution: Promise<string> | undefined
  installUpsellBypassSuppressionCounted: boolean
}

const state: ChromeInstallSessionState = {
  wiredThisSession: false,
  installUpsellResolution: undefined,
  installUpsellBypassSuppressionCounted: false,
}

/** densable `gP()` — session chrome host singleton. */
export function getChromeInstallSessionState(): ChromeInstallSessionState {
  return state
}

/** densable `Bmn`. */
export function isClaudeInChromeWiredThisSession(): boolean {
  return state.wiredThisSession
}

/** densable `xTr` sets `gP().wiredThisSession = true`. */
export function setClaudeInChromeWiredThisSession(wired: boolean): void {
  state.wiredThisSession = wired
}

/** densable `jmn`. */
export function clearClaudeInChromeWiredThisSession(): void {
  state.wiredThisSession = false
}

/** densable `Nby`. */
export function hasClaudeInChromeInstallUpsellLatch(): boolean {
  return state.installUpsellResolution !== undefined
}

export function resetChromeInstallSessionState(): void {
  state.wiredThisSession = false
  state.installUpsellResolution = undefined
  state.installUpsellBypassSuppressionCounted = false
}
