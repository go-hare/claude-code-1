/**
 * OAuth redirect port helpers — extracted from auth.ts to break the
 * auth.ts ↔ xaaIdpLogin.ts circular dependency.
 *
 * densable 2.1.231 SEA gold (`JFr` / `rLv` / `gIt` / `wMa` / `ILv`):
 *   function JFr(e=AMa){return`http://localhost:${e}/callback`}
 *   AMa=3118; windows ports 39152–49151 else 49152–65535
 *   gIt(preferred): MCP_OAUTH_CALLBACK_PORT → preferred if free → random → 3118
 *   ILv: loopback host is 127.0.0.1 or localhost
 *
 * densable 2.1.231 #1 pre-registered client (Slack): reuse stored callback port
 * so redirect_uri matches the prior DCR registration (see performMCPOAuthFlow).
 */
import { createServer } from 'http'
import { getPlatform } from '../../utils/platform.js'

// densable tLv — Windows dynamic range 49152–65535 is reserved
const REDIRECT_PORT_RANGE =
  getPlatform() === 'windows'
    ? { min: 39152, max: 49151 }
    : { min: 49152, max: 65535 }

/** densable AMa */
export const REDIRECT_PORT_FALLBACK = 3118

/**
 * densable JFr — loopback redirect URI with fixed `/callback` path.
 *
 * SEA 2.1.231 uses `http://localhost:${port}/callback` (not 127.0.0.1).
 * Pre-registered OAuth clients (Slack) typically register `localhost`;
 * hostname must match the registered redirect_uri.
 *
 * Callback servers still bind `127.0.0.1` (listen address ≠ redirect host).
 * RFC 8252 §7.3: loopback redirect URIs match any port if path matches —
 * but pre-registered clients pin both host and port.
 */
export function buildRedirectUri(
  port: number = REDIRECT_PORT_FALLBACK,
): string {
  return `http://localhost:${port}/callback`
}

/**
 * densable ILv — true when URI is loopback http redirect base host
 * (`http://127.0.0.1` or `http://localhost`).
 */
export function isLoopbackOAuthRedirectUri(uri: string): boolean {
  try {
    const u = new URL(uri)
    if (u.protocol !== 'http:') return false
    const host = u.hostname.toLowerCase()
    return host === '127.0.0.1' || host === 'localhost'
  } catch {
    return false
  }
}

/**
 * densable: parse port from a stored loopback redirect URI for reuse.
 * Returns undefined if not a loopback URI or port is missing/invalid.
 */
export function getPortFromLoopbackRedirectUri(
  uri: string | undefined | null,
): number | undefined {
  if (!uri || !isLoopbackOAuthRedirectUri(uri)) return undefined
  try {
    const port = Number(new URL(uri).port)
    return Number.isInteger(port) && port > 0 && port <= 65535
      ? port
      : undefined
  } catch {
    return undefined
  }
}

function getMcpOAuthCallbackPort(): number | undefined {
  // densable rLv: env port must be ≤ 65535 (parseInt NaN fails)
  const port = parseInt(process.env.MCP_OAUTH_CALLBACK_PORT || '', 10)
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return undefined
  return port
}

/** densable wMa — is port free on 127.0.0.1 */
export async function isOAuthRedirectPortAvailable(
  port: number,
): Promise<boolean> {
  try {
    await new Promise<void>((resolve, reject) => {
      const testServer = createServer()
      testServer.once('error', reject)
      testServer.listen(port, '127.0.0.1', () => {
        testServer.close(() => resolve())
      })
    })
    return true
  } catch {
    return false
  }
}

/**
 * densable gIt(preferred?) — pick callback port:
 * 1. MCP_OAUTH_CALLBACK_PORT env (if set)
 * 2. preferred port if free (stored redirect from prior registration)
 * 3. random free port in platform range (≤100 attempts)
 * 4. fallback 3118 if free
 * 5. throw
 */
export async function findAvailablePort(
  preferredPort?: number,
): Promise<number> {
  const configuredPort = getMcpOAuthCallbackPort()
  if (configuredPort !== undefined) {
    return configuredPort
  }

  if (
    preferredPort !== undefined &&
    Number.isInteger(preferredPort) &&
    preferredPort > 0 &&
    preferredPort <= 65535 &&
    (await isOAuthRedirectPortAvailable(preferredPort))
  ) {
    return preferredPort
  }

  const { min, max } = REDIRECT_PORT_RANGE
  const range = max - min + 1
  const maxAttempts = Math.min(range, 100)

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const port = min + Math.floor(Math.random() * range)
    if (await isOAuthRedirectPortAvailable(port)) {
      return port
    }
  }

  if (await isOAuthRedirectPortAvailable(REDIRECT_PORT_FALLBACK)) {
    return REDIRECT_PORT_FALLBACK
  }

  throw new Error(`No available ports for OAuth redirect`)
}
