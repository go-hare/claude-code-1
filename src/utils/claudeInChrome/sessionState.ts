/**
 * densable 2.1.239 `slf` / `gP` — chrome session singleton.
 * Tab-group close uses `bridgeBinding` / `closesInFlight` / cleanup latches
 * (`jrl` / `ANS`). Do not invent the rest of `slf` (resolvedHostByToolUseId, …).
 */

export type ChromeTabGroupSocketClient = {
  isConnected(): boolean
  callTool(
    name: string,
    args: Record<string, unknown>,
    extras?: unknown,
  ): Promise<unknown>
}

export type ChromeBridgeBinding = {
  socketClient: ChromeTabGroupSocketClient
}

export type ChromeTabGroupCloseInFlight = {
  onlyIfEmpty: boolean | undefined
  promise: Promise<unknown>
}

type ChromeInstallSessionState = {
  wiredThisSession: boolean
  installUpsellResolution: Promise<string> | undefined
  installUpsellBypassSuppressionCounted: boolean
  bridgeBinding: ChromeBridgeBinding | undefined
  tabGroupCleanupRegistered: boolean
  unsubscribeSessionSwitch: (() => void) | undefined
  unregisterExitCleanup: (() => void) | undefined
  closesInFlight: Map<string, ChromeTabGroupCloseInFlight>
}

const state: ChromeInstallSessionState = {
  wiredThisSession: false,
  installUpsellResolution: undefined,
  installUpsellBypassSuppressionCounted: false,
  bridgeBinding: undefined,
  tabGroupCleanupRegistered: false,
  unsubscribeSessionSwitch: undefined,
  unregisterExitCleanup: undefined,
  closesInFlight: new Map(),
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
  state.bridgeBinding = undefined
  state.tabGroupCleanupRegistered = false
  state.unsubscribeSessionSwitch?.()
  state.unsubscribeSessionSwitch = undefined
  state.unregisterExitCleanup?.()
  state.unregisterExitCleanup = undefined
  state.closesInFlight = new Map()
}
