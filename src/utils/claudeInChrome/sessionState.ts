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
  /** densable zps — live pick vs host hint. */
  getSelectedDeviceId?(): string | undefined
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
  /** densable zps `r.browserHints` — session memory only. */
  browserHints?: ChromeBrowserHints
  /** densable zps `r.lastSentPreferredDeviceId`. */
  lastSentPreferredDeviceId?: string
}

/** densable `$An` / `zps` host bag. */
export type ChromeBrowserHints = {
  preferredDeviceId?: string
  localDeviceIds: string[]
  hostPlatform?: 'darwin' | 'win32' | 'linux'
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
  browserHints: undefined,
  lastSentPreferredDeviceId: undefined,
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
  state.browserHints = undefined
  state.lastSentPreferredDeviceId = undefined
}

/**
 * densable `zps` — session-only chrome browser hints. Re-send of the same
 * preferred id while the in-session pick stands drops preferredDeviceId.
 */
export function setChromeBrowserHints(hints: ChromeBrowserHints): void {
  const lastSent = state.lastSentPreferredDeviceId
  const standing =
    state.browserHints !== undefined &&
    state.browserHints.preferredDeviceId === undefined &&
    lastSent !== undefined &&
    hints.preferredDeviceId === lastSent
  state.lastSentPreferredDeviceId = hints.preferredDeviceId
  state.browserHints =
    hints.preferredDeviceId === undefined && hints.localDeviceIds.length === 0
      ? undefined
      : standing
        ? { ...hints, preferredDeviceId: undefined }
        : hints
}

/** densable `sRr`. */
export function hintedPreferredDeviceId(
  fallback: () => string | undefined,
): string | undefined {
  return state.browserHints?.preferredDeviceId ?? fallback()
}

/** densable `iRr`. */
export function hintedLocalDeviceIds(): Map<string, 'live'> | undefined {
  const hints = state.browserHints
  if (!hints) return undefined
  return new Map(hints.localDeviceIds.map(id => [id, 'live'] as const))
}

/** densable `aRr`. */
export function hintedHostPlatform(): 'darwin' | 'win32' | 'linux' | undefined {
  return state.browserHints?.hostPlatform
}
