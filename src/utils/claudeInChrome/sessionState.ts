/**
 * densable 2.1.239 `slf` / `gP` — chrome session singleton.
 * densable 2.1.251 #57 — Host bag fields used by VQt call:
 * `bridgeBinding` (Pvr), `resolvedHostByToolUseId` (O),
 * `resolvedUrlByToolUseId`, `lastExecutedTabUrlByScope` (E).
 */

export type ChromeTabGroupSocketClient = {
  isConnected(): boolean
  callTool(
    name: string,
    args: Record<string, unknown>,
    extras?: unknown,
  ): Promise<unknown>
  setPermissionMode?(mode: string, allowedDomains?: string[]): Promise<void>
}

export type ChromeBridgeBinding = {
  /** densable Pvr stores both context + socketClient. */
  context?: unknown
  socketClient: ChromeTabGroupSocketClient
}

export type ChromeTabGroupCloseInFlight = {
  onlyIfEmpty: boolean | undefined
  promise: Promise<unknown>
}

export type ResolvedChromeHost = {
  host: string
  url?: string
}

/** densable D — max resolved-host map size before clear. */
const RESOLVED_HOST_MAP_CAP = 64

type ChromeInstallSessionState = {
  wiredThisSession: boolean
  installUpsellResolution: Promise<string> | undefined
  installUpsellBypassSuppressionCounted: boolean
  bridgeBinding: ChromeBridgeBinding | undefined
  tabGroupCleanupRegistered: boolean
  unsubscribeSessionSwitch: (() => void) | undefined
  unregisterExitCleanup: (() => void) | undefined
  closesInFlight: Map<string, ChromeTabGroupCloseInFlight>
  /** densable uf().resolvedHostByToolUseId */
  resolvedHostByToolUseId: Map<string, ResolvedChromeHost>
  /** densable uf().resolvedUrlByToolUseId */
  resolvedUrlByToolUseId: Map<string, string>
  /** densable uf().lastExecutedTabUrlByScope */
  lastExecutedTabUrlByScope: Map<string, string>
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
  resolvedHostByToolUseId: new Map(),
  resolvedUrlByToolUseId: new Map(),
  lastExecutedTabUrlByScope: new Map(),
}

/** densable `gP()` / `uf()` — session chrome host singleton. */
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

/**
 * densable `O` — remember host for toolUseId (checkPermissions → call).
 * Caps map size like gold `n.size>=D` then clear.
 */
export function rememberResolvedChromeHost(
  toolUseId: string,
  host: ResolvedChromeHost,
): void {
  if (state.resolvedHostByToolUseId.size >= RESOLVED_HOST_MAP_CAP) {
    state.resolvedHostByToolUseId.clear()
  }
  state.resolvedHostByToolUseId.set(toolUseId, host)
}

/** densable `E` — last executed tab URL by session scope. */
export function rememberLastExecutedTabUrl(
  sessionId: string,
  url: string,
): void {
  state.lastExecutedTabUrlByScope.set(sessionId, url)
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
  state.resolvedHostByToolUseId = new Map()
  state.resolvedUrlByToolUseId = new Map()
  state.lastExecutedTabUrlByScope = new Map()
}
