/**
 * Official agent-proxy NO_PROXY tables (densable 2.1.239 Ohu / G1s / gUy / yUy)
 * and c0T host match.
 *
 * #56: only API anthropic hosts bypass the session proxy. www / docs /
 * anthropic.com apex are NOT in Ohu, so Bash and other tools tunnel them.
 */

/** densable Ohu — NO_PROXY_COMMON. */
export const NO_PROXY_COMMON = [
  'localhost',
  '127.0.0.1',
  '::1',
  '127.0.0.0/8',
  '0.0.0.0/8',
  '::',
  '169.254.0.0/16',
  'api.anthropic.com',
  'api-staging.anthropic.com',
  'api-pr-preview.anthropic.com',
  'mcp-proxy.anthropic.com',
  'mcp-proxy-staging.anthropic.com',
  'registry.npmjs.org',
  'jsr.io',
  'npm.jsr.io',
  'pypi.org',
  'files.pythonhosted.org',
  'index.crates.io',
  'proxy.golang.org',
  'host.docker.internal',
] as const

/** densable G1s — embedded CCR (Ohu + RFC1918 + cluster). */
export const NO_PROXY_EMBEDDED = [
  ...NO_PROXY_COMMON,
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '.svc.cluster.local',
  '*.svc.cluster.local',
].join(',')

/** densable gUy — standalone = Ohu only. */
export const NO_PROXY_STANDALONE = NO_PROXY_COMMON.join(',')

/**
 * densable yUy — selective include-host mode. Loopback / RFC1918 / cluster
 * only; no anthropic hosts (listed includeHosts take the tunnel).
 */
export const NO_PROXY_SELECTIVE = [
  '127.0.0.1',
  'localhost',
  '::1',
  '127.0.0.0/8',
  '0.0.0.0/8',
  '169.254.0.0/16',
  'host.docker.internal',
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10',
  '.svc.cluster.local',
  '*.svc.cluster.local',
].join(',')

/**
 * densable c0T — isAnthropicHost.
 * Trailing-dot stripped; apex or any .anthropic.com suffix.
 */
export function isAnthropicHost(host: string): boolean {
  const t = host.replace(/\.$/, '').toLowerCase()
  return t === 'anthropic.com' || t.endsWith('.anthropic.com')
}

const OHU_HOSTS = new Set(
  NO_PROXY_COMMON.map(h => h.toLowerCase()).filter(
    h => !h.includes('/') && !h.startsWith('.') && !h.startsWith('*'),
  ),
)

/**
 * Official Ohu membership for a hostname. CIDR / wildcard entries are
 * not hostname-equal; those stay in the env list for runtime parsers.
 */
export function isNoProxyCommonHost(host: string): boolean {
  return OHU_HOSTS.has(host.replace(/\.$/, '').toLowerCase())
}

/**
 * #56: non-API anthropic.com hosts (www, docs, apex) must NOT bypass
 * the session proxy. API + mcp-proxy hosts stay on Ohu.
 */
export function shouldTunnelNonApiAnthropicHost(host: string): boolean {
  return isAnthropicHost(host) && !isNoProxyCommonHost(host)
}
