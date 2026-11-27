import type { AddressFamily, LookupAddress as AxiosLookupAddress } from 'axios'
import { lookup as dnsLookup } from 'dns'
import { lookup as dnsLookupAsync } from 'dns/promises'
import { isIP } from 'net'

/**
 * Canonical SSRF guard shared by HTTP hooks, MCP OAuth/XAA flows, Agent inline
 * MCP servers, and plugin archive downloads.
 *
 * Blocks private, link-local, unspecified, ULA, NAT64, IPv4-compatible,
 * IPv4-mapped, multicast, and cloud metadata address ranges.
 *
 * Loopback (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`) is controlled
 * explicitly via `SsrfPolicy.allowLoopback` (defaults to `true` for HTTP hooks
 * where local dev policy servers are a primary use case).
 *
 * When a global proxy or the sandbox network proxy is in use, the guard is
 * effectively bypassed for the target host because the proxy performs DNS
 * resolution. The sandbox proxy enforces its own domain allowlist.
 */

export type SsrfPolicy = {
  /**
   * Whether loopback addresses (`127.0.0.0/8`, `::1`, `localhost`, `*.localhost`,
   * and mapped/compatible/NAT64 IPv6 embedding loopback) are allowed.
   * Defaults to `true` for backward compatibility with HTTP hooks.
   */
  allowLoopback?: boolean
}

export type SsrfDnsLookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family?: number }>>

const BLOCKED_METADATA_HOSTNAMES = new Set([
  'metadata.google.internal',
  'metadata.goog',
  'metadata',
  'instance-data',
  'metadata.azure.internal',
])

/**
 * Normalizes a candidate IP literal: trims whitespace, strips surrounding
 * brackets `[...]` and IPv6 `%zone` / `%25zone` identifiers, and lowercases.
 */
export function normalizeIpLiteral(raw: string): string {
  let s = raw.trim().toLowerCase()
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1)
  }
  const zoneIdx = s.indexOf('%')
  if (zoneIdx !== -1) {
    s = s.slice(0, zoneIdx)
  }
  return s
}

/**
 * Parse a dotted-decimal IPv4 literal into 4 octets, or null if not valid IPv4.
 */
export function parseIPv4Octets(
  address: string,
): [number, number, number, number] | null {
  if (isIP(address) !== 4) {
    return null
  }
  const parts = address.split('.')
  if (parts.length !== 4) {
    return null
  }
  const nums: number[] = []
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null
    }
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      return null
    }
    nums.push(n)
  }
  return [nums[0]!, nums[1]!, nums[2]!, nums[3]!]
}

/**
 * Expand an IPv6 literal (with optional `[...]`, `%zone`, `::`, and trailing
 * dotted-decimal IPv4 such as `::ffff:169.254.169.254`, `::169.254.169.254`,
 * or `64:ff9b::169.254.169.254`) into exactly 8 16-bit integer groups.
 * Returns null if not a well-formed IPv6 literal.
 */
export function expandIPv6Groups(
  rawAddr: string,
): [number, number, number, number, number, number, number, number] | null {
  let addr = normalizeIpLiteral(rawAddr)
  if (!addr.includes(':')) {
    return null
  }

  // Convert trailing dotted-decimal IPv4 into its two 16-bit hex groups before
  // splitting on `::` so forms like `::169.254.169.254` and `64:ff9b::10.0.0.1`
  // preserve the `::` boundary accurately.
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':')
    if (lastColon === -1) {
      return null
    }
    const v4 = addr.slice(lastColon + 1)
    const octets = parseIPv4Octets(v4)
    if (!octets) {
      return null
    }
    const hi = ((octets[0] << 8) | octets[1]).toString(16)
    const lo = ((octets[2] << 8) | octets[3]).toString(16)
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`
  }

  const dbl = addr.indexOf('::')
  if (dbl !== -1 && addr.indexOf('::', dbl + 2) !== -1) {
    return null
  }

  let head: string[]
  let tail: string[]
  if (dbl === -1) {
    head = addr.split(':')
    tail = []
  } else {
    const headStr = addr.slice(0, dbl)
    const tailStr = addr.slice(dbl + 2)
    head = headStr === '' ? [] : headStr.split(':')
    tail = tailStr === '' ? [] : tailStr.split(':')
  }

  const fill = 8 - head.length - tail.length
  if (dbl === -1 ? fill !== 0 : fill < 1) {
    return null
  }

  const parseHexGroup = (token: string): number | null => {
    if (!/^[0-9a-f]{1,4}$/.test(token)) {
      return null
    }
    const val = Number.parseInt(token, 16)
    return val >= 0 && val <= 0xffff ? val : null
  }

  const out: number[] = []
  for (const h of head) {
    const v = parseHexGroup(h)
    if (v === null) return null
    out.push(v)
  }
  for (let i = 0; i < fill; i++) {
    out.push(0)
  }
  for (const t of tail) {
    const v = parseHexGroup(t)
    if (v === null) return null
    out.push(v)
  }
  if (out.length !== 8) {
    return null
  }
  return [
    out[0]!,
    out[1]!,
    out[2]!,
    out[3]!,
    out[4]!,
    out[5]!,
    out[6]!,
    out[7]!,
  ]
}

function isBlockedV4Octets(
  a: number,
  b: number,
  _c: number,
  _d: number,
  allowLoopback: boolean,
): boolean {
  // 127.0.0.0/8 — loopback
  if (a === 127) return !allowLoopback
  // 0.0.0.0/8 — "this" network
  if (a === 0) return true
  // 10.0.0.0/8 — RFC 1918 private
  if (a === 10) return true
  // 100.64.0.0/10 — RFC 6598 shared address space / CGNAT (includes Alibaba IMDS 100.100.100.200)
  if (a === 100 && b >= 64 && b <= 127) return true
  // 169.254.0.0/16 — link-local, cloud metadata (AWS/GCP/Azure IMDS)
  if (a === 169 && b === 254) return true
  // 172.16.0.0/12 — RFC 1918 private
  if (a === 172 && b >= 16 && b <= 31) return true
  // 192.168.0.0/16 — RFC 1918 private
  if (a === 192 && b === 168) return true
  // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, 255.255.255.255 broadcast
  if (a >= 224) return true
  return false
}

function isBlockedV6Groups(
  g: [number, number, number, number, number, number, number, number],
  allowLoopback: boolean,
): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g
  const allZeroPrefix6 =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0

  // :: (0:0:0:0:0:0:0:0) unspecified — always blocked
  if (allZeroPrefix6 && g6 === 0 && g7 === 0) {
    return true
  }

  // ::1 (0:0:0:0:0:0:0:1) loopback
  if (allZeroPrefix6 && g6 === 0 && g7 === 1) {
    return !allowLoopback
  }

  // IPv4-mapped (::ffff:0:0/96)
  const isIpv4Mapped =
    g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff
  // IPv4-compatible (::/96, deprecated RFC 4291)
  const isIpv4Compatible = allZeroPrefix6
  // NAT64 well-known prefix (64:ff9b::/96, RFC 6052)
  const isNat64WellKnown =
    g0 === 0x0064 &&
    g1 === 0xff9b &&
    g2 === 0 &&
    g3 === 0 &&
    g4 === 0 &&
    g5 === 0
  // NAT64 local-use prefix (64:ff9b:1::/48, RFC 8215)
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0x0001) {
    return true
  }

  if (isIpv4Mapped || isIpv4Compatible || isNat64WellKnown) {
    return isBlockedV4Octets(
      (g6 >> 8) & 0xff,
      g6 & 0xff,
      (g7 >> 8) & 0xff,
      g7 & 0xff,
      allowLoopback,
    )
  }

  // 6to4 (2002::/16) — embeds IPv4 in g1:g2
  if (
    g0 === 0x2002 &&
    isBlockedV4Octets(
      (g1 >> 8) & 0xff,
      g1 & 0xff,
      (g2 >> 8) & 0xff,
      g2 & 0xff,
      allowLoopback,
    )
  ) {
    return true
  }

  // fc00::/7 — unique local addresses (includes AWS IMDSv2 IPv6 fd00:ec2::254 in any form)
  if ((g0 & 0xfe00) === 0xfc00) {
    return true
  }

  // fe80::/10 — link-local (fe80:: through febf::)
  if ((g0 & 0xffc0) === 0xfe80) {
    return true
  }

  // fec0::/10 — deprecated site-local
  if ((g0 & 0xffc0) === 0xfec0) {
    return true
  }

  // ff00::/8 — multicast
  if ((g0 & 0xff00) === 0xff00) {
    return true
  }

  return false
}

/**
 * Returns true if the IP address is in a blocked range under `policy`.
 *
 * Strips optional `[...]` brackets and `%zone` identifiers before parsing.
 * Defaults to `{ allowLoopback: true }` for backward compatibility with HTTP hooks.
 */
export function isBlockedAddress(
  address: string,
  policy: SsrfPolicy = {},
): boolean {
  const allowLoopback = policy.allowLoopback ?? true
  const normalized = normalizeIpLiteral(address)
  const v = isIP(normalized)
  if (v === 4) {
    const octets = parseIPv4Octets(normalized)
    return octets
      ? isBlockedV4Octets(
          octets[0],
          octets[1],
          octets[2],
          octets[3],
          allowLoopback,
        )
      : false
  }
  if (v === 6) {
    const groups = expandIPv6Groups(normalized)
    // Fail closed if net.isIP classified it as IPv6 but canonical expansion failed
    return groups ? isBlockedV6Groups(groups, allowLoopback) : true
  }
  // Handle IPv6 forms with embedded dotted IPv4 / non-canonical spacing if not
  // caught by isIP (e.g. if a runtime's isIP rejects a valid canonical form).
  if (normalized.includes(':')) {
    const groups = expandIPv6Groups(normalized)
    if (groups) {
      return isBlockedV6Groups(groups, allowLoopback)
    }
  }
  return false
}

/**
 * Returns true if `hostname` represents a loopback host (`localhost`,
 * `*.localhost`, `127.0.0.0/8`, `::1`, or expanded `0:0:0:0:0:0:0:1`).
 */
export function isLoopbackAddressOrHostname(hostname: string): boolean {
  let normalized = normalizeIpLiteral(hostname)
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }
  if (normalized === 'localhost' || normalized.endsWith('.localhost')) {
    return true
  }
  const v4 = parseIPv4Octets(normalized)
  if (v4) {
    return v4[0] === 127
  }
  const v6 = expandIPv6Groups(normalized)
  if (v6) {
    const [g0, g1, g2, g3, g4, g5, g6, g7] = v6
    return (
      g0 === 0 &&
      g1 === 0 &&
      g2 === 0 &&
      g3 === 0 &&
      g4 === 0 &&
      g5 === 0 &&
      g6 === 0 &&
      g7 === 1
    )
  }
  return false
}

/**
 * Synchronous check for hostnames and IP literals (before DNS resolution).
 * Blocks empty hosts, known cloud metadata hostnames, loopback hostnames (when
 * `allowLoopback` is false), and all blocked IPv4/IPv6 literals.
 */
export function isBlockedHostnameOrIp(
  hostname: string,
  policy: SsrfPolicy = {},
): boolean {
  const allowLoopback = policy.allowLoopback ?? true
  let normalized = normalizeIpLiteral(hostname)
  if (normalized.endsWith('.')) {
    normalized = normalized.slice(0, -1)
  }
  if (normalized === '') {
    return true
  }
  if (BLOCKED_METADATA_HOSTNAMES.has(normalized)) {
    return true
  }
  if (
    !allowLoopback &&
    (normalized === 'localhost' || normalized.endsWith('.localhost'))
  ) {
    return true
  }
  return isBlockedAddress(normalized, policy)
}

function ssrfError(
  hostname: string,
  address: string,
  allowLoopback: boolean,
): NodeJS.ErrnoException {
  const suffix = allowLoopback
    ? ' Loopback (127.0.0.1, ::1) is allowed for local dev.'
    : ''
  const err = new Error(
    `Request blocked by SSRF guard: ${hostname} resolves to ${address} (private/link-local/non-routable address).${suffix}`,
  )
  return Object.assign(err, {
    code: 'ERR_HTTP_HOOK_BLOCKED_ADDRESS',
    hostname,
    address,
  })
}

/**
 * Creates a dns.lookup-compatible function enforcing `policy` on IP literals
 * and every resolved DNS address. Used as the `lookup` option in axios / Node
 * HTTP requests so the validated IP is the one the socket connects to.
 */
export function createSsrfGuardedLookup(
  policy: SsrfPolicy = {},
): (
  hostname: string,
  options: object,
  callback: (
    err: Error | null,
    address: AxiosLookupAddress | AxiosLookupAddress[],
    family?: AddressFamily,
  ) => void,
) => void {
  const allowLoopback = policy.allowLoopback ?? true

  return function guardedLookup(hostname, options, callback): void {
    const wantsAll = 'all' in options && options.all === true
    const normalized = normalizeIpLiteral(hostname)

    if (isBlockedHostnameOrIp(hostname, policy)) {
      callback(ssrfError(hostname, normalized || hostname, allowLoopback), '')
      return
    }

    const ipVersion = isIP(normalized)
    if (ipVersion !== 0) {
      const family = ipVersion === 6 ? 6 : 4
      if (wantsAll) {
        callback(null, [{ address: normalized, family }])
      } else {
        callback(null, normalized, family)
      }
      return
    }

    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) {
        callback(err, '')
        return
      }

      for (const { address } of addresses) {
        if (isBlockedAddress(address, policy)) {
          callback(ssrfError(hostname, address, allowLoopback), '')
          return
        }
      }

      const first = addresses[0]
      if (!first) {
        callback(
          Object.assign(new Error(`ENOTFOUND ${hostname}`), {
            code: 'ENOTFOUND',
            hostname,
          }),
          '',
        )
        return
      }

      const family = first.family === 6 ? 6 : 4
      if (wantsAll) {
        callback(
          null,
          addresses.map(a => ({
            address: a.address,
            family: a.family === 6 ? 6 : 4,
          })),
        )
      } else {
        callback(null, first.address, family)
      }
    })
  }
}

/**
 * Default dns.lookup-compatible SSRF guard for HTTP hooks and OAuth endpoints
 * (loopback allowed; private, link-local, ULA, NAT64, unspecified, multicast
 * and cloud metadata ranges blocked).
 */
export const ssrfGuardedLookup = createSsrfGuardedLookup({
  allowLoopback: true,
})

/**
 * Async DNS-aware SSRF check for callers using `fetch` or pre-connection gates
 * (MCP OAuth/XAA, Agent inline MCP servers).
 * Validates hostname/IP literals synchronously, then resolves DNS and rejects
 * if ANY returned address is blocked under `policy`.
 */
export async function assertHostNotSsrfBlocked(
  hostname: string,
  policy: SsrfPolicy = {},
  lookupFn?: SsrfDnsLookupFn,
): Promise<void> {
  const allowLoopback = policy.allowLoopback ?? true
  const normalized = normalizeIpLiteral(hostname)

  if (isBlockedHostnameOrIp(hostname, policy)) {
    throw ssrfError(hostname, normalized || hostname, allowLoopback)
  }

  // Already a validated public (or allowed loopback) IP literal — no DNS needed
  if (isIP(normalized) !== 0) {
    return
  }

  // If loopback is allowed and hostname is explicitly localhost, allow directly
  if (allowLoopback && isLoopbackAddressOrHostname(hostname)) {
    return
  }

  const addresses = lookupFn
    ? await lookupFn(hostname)
    : await dnsLookupAsync(hostname, { all: true })

  if (!addresses || addresses.length === 0) {
    throw Object.assign(new Error(`ENOTFOUND ${hostname}`), {
      code: 'ENOTFOUND',
      hostname,
    })
  }

  for (const { address } of addresses) {
    if (isBlockedAddress(address, policy)) {
      throw ssrfError(hostname, address, allowLoopback)
    }
  }
}
