/**
 * Official 2.1.206 MCP tool-call auth reconnect coordinator (OHs Map).
 *
 * Concurrent tool calls that hit 401 / ConnectionClosed while a reconnect is
 * already in flight rejoin that promise (`collateral_rejoin`) instead of
 * starting a second reconnect. The leader logs `reauth_retry`.
 */

export type AuthReconnectKind = 'mcp_headers_helper' | 'mcp_oauth_refresh'

export type AuthReconnectJoin =
  | { role: 'leader'; kind: AuthReconnectKind }
  | { role: 'collateral'; kind: AuthReconnectKind }

/**
 * Decide whether this call should start reconnect (leader) or await an
 * in-flight one (collateral). Pure — Map is passed in so tests stay isolated.
 */
export function planAuthReconnectJoin(
  inflightKeys: ReadonlySet<string>,
  cacheKey: string,
  kind: AuthReconnectKind,
): AuthReconnectJoin {
  if (inflightKeys.has(cacheKey)) {
    return { role: 'collateral', kind }
  }
  return { role: 'leader', kind }
}

/**
 * Official gate: can this config attempt headersHelper / OAuth reauth?
 * (Does not check isAuthRetry / disabled / needs-auth — those stay at call site.)
 */
export function classifyAuthReconnectKind(opts: {
  type?: string
  headersHelper?: string
  url?: string
  hasRefreshToken: boolean
}): AuthReconnectKind | null {
  const transport =
    opts.type === 'http' || opts.type === 'sse' || opts.type === 'ws'
  if (transport && opts.headersHelper) {
    return 'mcp_headers_helper'
  }
  if (
    (opts.type === 'http' || opts.type === 'sse') &&
    !opts.headersHelper &&
    !!opts.url &&
    opts.hasRefreshToken
  ) {
    return 'mcp_oauth_refresh'
  }
  return null
}

/**
 * Official W: ConnectionClosed while a reconnect is already running for this
 * server → collateral rejoin even without a fresh 401 classification.
 */
export function isConnectionClosedWhileReconnecting(
  error: unknown,
  hasInflight: boolean,
): boolean {
  if (!hasInflight || !(error instanceof Error)) return false
  const code = (error as Error & { code?: number }).code
  return code === -32000 && error.message.includes('Connection closed')
}

/** In-flight reconnect promises keyed by getServerCacheKey (official OHs). */
const authReconnectInFlight = new Map<
  string,
  Promise<{ type: string; [k: string]: unknown }>
>()

export function getAuthReconnectInFlightKeysForTests(): string[] {
  return [...authReconnectInFlight.keys()]
}

export function clearAuthReconnectInFlightForTests(): void {
  authReconnectInFlight.clear()
}

export function hasAuthReconnectInFlight(cacheKey: string): boolean {
  return authReconnectInFlight.has(cacheKey)
}

/**
 * Join or start a reconnect. `runReconnect` is only invoked for the leader
 * (clears cache + connectToServer). All waiters share the same promise.
 */
export async function joinOrStartAuthReconnect<T extends { type: string }>(
  cacheKey: string,
  kind: AuthReconnectKind,
  runReconnect: () => Promise<T>,
  log: (join: AuthReconnectJoin) => void,
): Promise<T> {
  const existing = authReconnectInFlight.get(cacheKey) as Promise<T> | undefined
  if (existing) {
    log({ role: 'collateral', kind })
    return existing
  }

  log({ role: 'leader', kind })
  const promise = (async () => runReconnect())()
  authReconnectInFlight.set(
    cacheKey,
    promise as Promise<{ type: string; [k: string]: unknown }>,
  )
  try {
    return await promise
  } finally {
    authReconnectInFlight.delete(cacheKey)
  }
}
