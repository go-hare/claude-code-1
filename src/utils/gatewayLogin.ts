/**
 * densable 2.1.212 #43 — Cloud gateway interactive OIDC device-flow helpers.
 *
 * densable symbols (from claude.exe):
 * - $zd ≈ resolveSameOriginOAuthEndpoint
 * - a6n ≈ isPrivateNetworkAddress
 * - mOc ≈ assertGatewayLoginNetworkPolicy
 * - dl_ ≈ formatGatewayTlsCertHint
 * - wki ≈ extractOAuthDeviceError
 * - pl_/fl_/Tki ≈ metadata / device / token zod shapes
 * - cl_ = urn:ietf:params:oauth:grant-type:device_code
 * - GGh = fedstart host allowlist (skip private-network check)
 * - gOc/Smc/o2r/i2r live in gatewayEnv.ts (TLS pin + enterpriseGateway)
 */

import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { z } from 'zod'
import { logForDebugging } from './debug.js'
import {
  GATEWAY_HTTP_LOOPBACK_FINGERPRINT,
  isGatewayHttpLoopbackHost,
  normalizeGatewayBaseUrl,
  normalizeGatewayTlsFingerprint,
  probeGatewayTlsFingerprint,
} from './gatewayEnv.js'
import { getProxyUrl, shouldBypassProxy } from './proxy.js'

/** densable cl_ */
export const GATEWAY_DEVICE_CODE_GRANT =
  'urn:ietf:params:oauth:grant-type:device_code'

/**
 * densable GGh — FedRAMP hosts allowed on public addresses without
 * private-network assertion.
 */
export const GATEWAY_LOGIN_PUBLIC_HOST_ALLOWLIST = new Set([
  'claude.fedstart.com',
  'claude.palantirfedstart.com',
])

/** densable pl_ */
export const gatewayOAuthMetadataSchema = z.object({
  device_authorization_endpoint: z.string().optional(),
  token_endpoint: z.string().optional(),
})

/** densable fl_ */
export const gatewayDeviceAuthorizationResponseSchema = z.object({
  device_code: z.string(),
  user_code: z.string(),
  verification_uri: z.string(),
  verification_uri_complete: z.string().optional(),
  expires_in: z.number(),
  interval: z.number().optional(),
})

/** densable Tki */
export const gatewayTokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().nullish(),
})

export type GatewayOAuthEndpoints = {
  deviceAuthorizationEndpoint: string
  tokenEndpoint: string
}

/**
 * densable $zd — only accept advertised OAuth endpoints when same-origin
 * with the gateway base URL; otherwise fall back to path on gateway origin.
 */
export function resolveSameOriginOAuthEndpoint(
  gatewayBaseUrl: string,
  advertised: string | undefined,
  fallbackPath: string,
): string {
  if (advertised) {
    try {
      if (new URL(advertised).origin === new URL(gatewayBaseUrl).origin) {
        return advertised
      }
    } catch {
      // fall through
    }
    logForDebugging(
      `[gateway-login] ignoring advertised endpoint ${advertised} (not same-origin with ${gatewayBaseUrl}); using ${fallbackPath}`,
    )
  }
  return `${gatewayBaseUrl}${fallbackPath}`
}

/**
 * densable a6n — RFC1918 / loopback / link-local / CGNAT / ULA / unique-local.
 */
export function isPrivateNetworkAddress(address: string): boolean {
  const t = address.replace(/%.*$/, '').toLowerCase()
  if (isIP(t) === 4) {
    const [o = 0, i = 0] = t.split('.').map(Number)
    return (
      o === 10 ||
      (o === 172 && i >= 16 && i <= 31) ||
      (o === 192 && i === 168) ||
      o === 127 ||
      (o === 169 && i === 254) ||
      (o === 100 && i >= 64 && i <= 127)
    )
  }
  if (isIP(t) !== 6) return false
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(t)
  if (mapped?.[1]) return isPrivateNetworkAddress(mapped[1])
  if (t === '::1') return true
  const n = parseInt(/^([0-9a-f]{1,4}):/.exec(t)?.[1] ?? '0', 16)
  // fe80::/10 unique-local link, fc00::/7 ULA
  return (n >= 65152 && n <= 65215) || (n >= 64512 && n <= 65023)
}

/**
 * densable mOc — gateway login may only target private-network hosts
 * (unless FedRAMP allowlist). Proxy path must also be private when used.
 */
export async function assertGatewayLoginNetworkPolicy(
  gatewayUrl: string,
): Promise<void> {
  const t = new URL(gatewayUrl)
  const r = t.hostname.replace(/^\[|\]$/g, '')
  const n = isIP(r) === 4 || isIP(r) === 6
  if (t.protocol === 'https:' && GATEWAY_LOGIN_PUBLIC_HOST_ALLOWLIST.has(r)) {
    return
  }

  const proxy = getProxyUrl()
  if (proxy && !shouldBypassProxy(gatewayUrl)) {
    let a: string
    let l: string[]
    try {
      a = new URL(proxy).hostname.replace(/^\[|\]$/g, '')
      if (!a) throw new Error('no hostname')
      l =
        isIP(a) === 4 || isIP(a) === 6
          ? [a]
          : (await dnsLookup(a, { all: true })).map(d => d.address)
    } catch {
      throw new Error(
        "Could not resolve the configured HTTP proxy. Connect to your organization's network (or VPN) and try again.",
      )
    }
    if (l.length === 0 || l.some(u => !isPrivateNetworkAddress(u))) {
      const u =
        isIP(r) === 6
          ? `[${r}]:${t.port || (t.protocol === 'http:' ? '80' : '443')}`
          : r
      throw new Error(
        `Gateway login would go through proxy ${a}, which is not on a private network. Add ${u} to NO_PROXY for a direct connection, or use a proxy on your organization's private network.`,
      )
    }
  }

  let i: string[]
  if (n) {
    i = [r]
  } else {
    try {
      i = (await dnsLookup(r, { all: true })).map(a => a.address)
    } catch {
      throw new Error(
        `Could not resolve gateway host ${r}. Connect to your organization's network (or VPN) and try again.`,
      )
    }
  }
  if (i.length === 0) {
    throw new Error(`Could not resolve gateway host ${r}.`)
  }
  const s = i.find(a => !isPrivateNetworkAddress(a))
  if (s !== undefined) {
    const a = i.some(l => isPrivateNetworkAddress(l))
    throw new Error(
      `Gateway hosts must be on your organization's private network; ${r} resolves to the public (or unrecognized) address ${s}. ` +
        (a
          ? 'Every address for a gateway host must be private — if this is a dual-stack DNS name, publish only private records for it (for example, remove the public AAAA record).'
          : n
            ? "Use your gateway's private (internal) address or DNS name instead."
            : "Connect to your organization's network (or VPN) and try again."),
    )
  }
}

/** densable ul_ TLS codes + message regex → user-facing CA hint (dl_). */
const GATEWAY_TLS_CERT_CODES = new Set([
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_UNTRUSTED',
])

export function formatGatewayTlsCertHint(err: unknown): string | null {
  const code =
    extractErrorCode(err) ??
    extractErrorCode((err as { cause?: unknown })?.cause)
  const msg = err instanceof Error ? err.message : String(err)
  if (
    !(
      (code !== undefined && GATEWAY_TLS_CERT_CODES.has(code)) ||
      /self[- ]?signed certificate|unable to (verify the first|get (local )?issuer) certificate|certificate not trusted/i.test(
        msg,
      )
    )
  ) {
    return null
  }
  return (
    "Could not verify the gateway's TLS certificate. If your gateway uses a private CA or self-signed certificate: Claude Code reads your OS trust " +
    'store by default on the native binary and Node ≥22.15, so if the CA is ' +
    'already installed there, upgrade to a current runtime. Otherwise set ' +
    'NODE_EXTRA_CA_CERTS to the CA certificate PEM file before starting — ' +
    'e.g. `export NODE_EXTRA_CA_CERTS=/path/to/ca.pem` — or add it under ' +
    '`env.NODE_EXTRA_CA_CERTS` in your user settings (~/.claude/settings.json).'
  )
}

function extractErrorCode(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const c = (err as { code?: unknown }).code
  return typeof c === 'string' ? c : undefined
}

/**
 * densable wki — axios error body `{error: string}` for device-code poll.
 */
export function extractOAuthDeviceError(err: unknown): string | undefined {
  if (!err || typeof err !== 'object') return undefined
  const e = err as {
    isAxiosError?: boolean
    response?: { data?: unknown }
  }
  if (!e.isAxiosError) return undefined
  const data = e.response?.data
  if (typeof data === 'object' && data !== null && 'error' in data) {
    const r = (data as { error: unknown }).error
    return typeof r === 'string' ? r : undefined
  }
  return undefined
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * densable o2r wrapper via local probeGatewayTlsFingerprint.
 * Non-https loopback → http-loopback sentinel (matches densable).
 */
export async function probeGatewayLoginTls(
  gatewayUrl: string,
  timeoutMs = 10_000,
): Promise<{ hostname: string; fingerprint: string }> {
  const parsed = new URL(gatewayUrl)
  const hostname = parsed.hostname.replace(/^\[|\]$/g, '')
  if (parsed.protocol !== 'https:') {
    if (!isGatewayHttpLoopbackHost(hostname)) {
      throw new Error(
        'Gateway URL must use https:// (got http://). Plain HTTP is only allowed for localhost during development.',
      )
    }
    return {
      hostname,
      fingerprint: GATEWAY_HTTP_LOOPBACK_FINGERPRINT,
    }
  }
  const result = await probeGatewayTlsFingerprint(gatewayUrl, {
    timeoutMs,
  })
  if (!result?.fingerprint) {
    throw new Error('could not read TLS certificate fingerprint')
  }
  return {
    hostname: result.hostname ?? hostname,
    fingerprint: normalizeGatewayTlsFingerprint(result.fingerprint),
  }
}

/** Re-export normalize for login UI (u6n ≡ normalizeGatewayBaseUrl). */
export { normalizeGatewayBaseUrl as normalizeGatewayLoginUrl }
