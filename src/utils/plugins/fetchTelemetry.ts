/**
 * Telemetry for plugin/marketplace fetches that hit the network.
 *
 * Added for inc-5046 (GitHub complained about claude-plugins-official load).
 * Before this, fetch operations only had logForDebugging — no way to measure
 * actual network volume. This surfaces what's hitting GitHub vs GCS vs
 * user-hosted so we can see the GCS migration take effect and catch future
 * hot-path regressions before GitHub emails us again.
 *
 * Volume: these fire at startup (install-counts 24h-TTL)
 * and on explicit user action (install/update). NOT per-interaction. Similar
 * envelope to tengu_binary_download_*.
 */

import { HttpsProxyAgent } from 'https-proxy-agent'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS as SafeString,
} from '../../services/analytics/index.js'
import { OFFICIAL_MARKETPLACE_NAME } from './officialMarketplace.js'

export type PluginFetchSource =
  | 'install_counts'
  | 'marketplace_clone'
  | 'marketplace_pull'
  | 'marketplace_url'
  | 'plugin_clone'
  | 'plugin_archive'
  | 'mcpb'

export type PluginFetchOutcome = 'success' | 'failure' | 'cache_hit'

// Allowlist of public hosts we report by name. Anything else (enterprise
// git, self-hosted, internal) is bucketed as 'other' — we don't want
// internal hostnames (git.mycorp.internal) landing in telemetry. Bounded
// cardinality also keeps the dashboard host-breakdown tractable.
const KNOWN_PUBLIC_HOSTS = new Set([
  'github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  'gist.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',
  'codeberg.org',
  'dev.azure.com',
  'ssh.dev.azure.com',
  'storage.googleapis.com', // GCS — where Dickson's migration points
])

/**
 * Extract hostname from a URL or git spec and bucket to the allowlist.
 * Handles `https://host/...`, `git@host:path`, `ssh://host/...`.
 * Returns a known public host, 'other' (parseable but not allowlisted —
 * don't leak private hostnames), or 'unknown' (unparseable / local path).
 */
function extractHost(urlOrSpec: string): string {
  let host: string
  const scpMatch = /^[^@/]+@([^:/]+):/.exec(urlOrSpec)
  if (scpMatch) {
    host = scpMatch[1]!
  } else {
    try {
      host = new URL(urlOrSpec).hostname
    } catch {
      return 'unknown'
    }
  }
  const normalized = host.toLowerCase()
  return KNOWN_PUBLIC_HOSTS.has(normalized) ? normalized : 'other'
}

/**
 * True if the URL/spec points at anthropics/claude-plugins-official — the
 * repo GitHub complained about. Lets the dashboard separate "our problem"
 * traffic from user-configured marketplaces.
 */
function isOfficialRepo(urlOrSpec: string): boolean {
  return urlOrSpec.includes(`anthropics/${OFFICIAL_MARKETPLACE_NAME}`)
}

export function logPluginFetch(
  source: PluginFetchSource,
  urlOrSpec: string | undefined,
  outcome: PluginFetchOutcome,
  durationMs: number,
  errorKind?: string,
): void {
  // String values are bounded enums / hostname-only — no code, no paths,
  // no raw error messages. Same privacy envelope as tengu_web_fetch_host.
  logEvent('tengu_plugin_remote_fetch', {
    source: source as SafeString,
    host: (urlOrSpec ? extractHost(urlOrSpec) : 'unknown') as SafeString,
    is_official: urlOrSpec ? isOfficialRepo(urlOrSpec) : false,
    outcome: outcome as SafeString,
    duration_ms: Math.round(durationMs),
    ...(errorKind && { error_kind: errorKind as SafeString }),
  })
}

/**
 * Classify an error into a stable bucket for the error_kind field. Keeps
 * cardinality bounded — raw error messages would explode dashboard grouping.
 *
 * Handles both axios Error objects (Node.js error codes like ENOTFOUND) and
 * git stderr strings (human phrases like "Could not resolve host"). DNS
 * checked BEFORE timeout because gitClone's error enhancement at
 * marketplaceManager.ts:~950 rewrites DNS failures to include the word
 * "timeout" — ordering the other way would misclassify git DNS as timeout.
 */
export function classifyFetchError(error: unknown): string {
  const msg = String((error as { message?: unknown })?.message ?? error)
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|Could not resolve host|Connection refused/i.test(
      msg,
    )
  ) {
    return 'dns_or_refused'
  }
  if (/ETIMEDOUT|timed out|timeout/i.test(msg)) return 'timeout'
  if (
    /ECONNRESET|socket hang up|Connection reset by peer|remote end hung up/i.test(
      msg,
    )
  ) {
    return 'conn_reset'
  }
  if (/403|401|authentication|permission denied/i.test(msg)) return 'auth'
  if (/404|not found|repository not found/i.test(msg)) return 'not_found'
  if (/certificate|SSL|TLS|unable to get local issuer/i.test(msg)) return 'tls'
  // Schema validation throws "Invalid response format" (install_counts) —
  // distinguish from true unknowns so the dashboard can
  // see "server sent garbage" separately.
  if (/Invalid response format|Invalid marketplace schema/i.test(msg)) {
    return 'invalid_schema'
  }
  return 'other'
}

function shouldBypassNoProxy(
  targetUrl: string,
  env: Record<string, string | undefined>,
): boolean {
  const noProxyRaw = (env.no_proxy || env.NO_PROXY || '').trim().toLowerCase()
  if (!noProxyRaw) return false
  if (noProxyRaw === '*') return true
  let parsed: URL
  try {
    parsed = new URL(targetUrl)
  } catch {
    return false
  }
  const host = parsed.hostname.toLowerCase()
  const port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  for (const token of noProxyRaw.split(/[,\s]+/)) {
    if (!token) continue
    const m = /^(.+):(\d+)$/.exec(token)
    const pattern = m ? m[1]! : token
    const patternPort = m ? Number(m[2]) : 0
    if (patternPort && patternPort !== port) continue
    if (pattern.startsWith('*')) {
      if (host.endsWith(pattern.slice(1))) return true
    } else if (pattern.startsWith('.')) {
      if (host === pattern.slice(1) || host.endsWith(pattern)) return true
    } else if (host === pattern || host.endsWith(`.${pattern}`)) {
      return true
    }
  }
  return false
}

/**
 * Official 2.1.325 #2379: resolve axios proxy options for plugin marketplace
 * and plugin downloads. When `ALL_PROXY` / `all_proxy` is the ONLY proxy
 * environment variable set (no `HTTP_PROXY`/`HTTPS_PROXY`), route through an
 * HTTP CONNECT tunnel via `HttpsProxyAgent` (`proxy: false` disables axios's
 * direct non-CONNECT proxy path so a proxy refusing CONNECT fails the request).
 */
export function getPluginDownloadProxyOptions(
  targetUrl: string,
  env: Record<string, string | undefined> = process.env,
): {
  httpsAgent?: HttpsProxyAgent<string>
  httpAgent?: HttpsProxyAgent<string>
  proxy?: false
  allProxyUrl?: string
} {
  const hasSpecificProxy = Boolean(
    env.https_proxy || env.HTTPS_PROXY || env.http_proxy || env.HTTP_PROXY,
  )
  if (hasSpecificProxy) {
    return {}
  }
  const allProxy = (env.all_proxy || env.ALL_PROXY || '').trim()
  if (!allProxy) {
    return {}
  }
  if (shouldBypassNoProxy(targetUrl, env)) {
    return {}
  }
  const normalizedProxy = allProxy.includes('://')
    ? allProxy
    : `http://${allProxy}`
  try {
    const parsed = new URL(normalizedProxy)
    if (!parsed.host) return {}
  } catch {
    return {}
  }
  const agent = new HttpsProxyAgent(normalizedProxy)
  return {
    httpsAgent: agent,
    httpAgent: agent,
    proxy: false,
    allProxyUrl: normalizedProxy,
  }
}
