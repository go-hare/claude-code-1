import { randomBytes } from 'crypto'
import axios from 'axios'
import type { HookEvent } from 'src/entrypoints/agentSdkTypes.js'
import { createCombinedAbortSignal } from '../combinedAbortSignal.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getProxyUrl, shouldBypassProxy } from '../proxy.js'
// Import as namespace so spyOn works in tests (direct imports bypass spies)
import * as settingsModule from '../settings/settings.js'
import type { HttpHook } from '../settings/types.js'
import { ssrfGuardedLookup } from './ssrfGuard.js'

const DEFAULT_HTTP_HOOK_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes (matches TOOL_HOOK_EXECUTION_TIMEOUT_MS)

/**
 * Get the sandbox proxy config for routing HTTP hook requests through the
 * sandbox network proxy when sandboxing is enabled.
 *
 * Uses dynamic import to avoid a static import cycle
 * (sandbox-adapter -> settings -> ... -> hooks -> execHttpHook).
 */
async function getSandboxProxyConfig(): Promise<
  { host: string; port: number; protocol: string } | undefined
> {
  const { SandboxManager } = await import('../sandbox/sandbox-adapter.js')

  if (!SandboxManager.isSandboxingEnabled()) {
    return undefined
  }

  // Wait for the sandbox network proxy to finish initializing. In REPL mode,
  // SandboxManager.initialize() is fire-and-forget so the proxy may not be
  // ready yet when the first hook fires.
  await SandboxManager.waitForNetworkInitialization()

  const proxyPort = SandboxManager.getProxyPort()
  if (!proxyPort) {
    return undefined
  }

  return { host: '127.0.0.1', port: proxyPort, protocol: 'http' }
}

/**
 * Read HTTP hook allowlist restrictions from merged settings (all sources).
 * Follows the allowedMcpServers precedent: arrays concatenate across sources.
 * When allowManagedHooksOnly is set in managed settings, only admin-defined
 * hooks run anyway, so no separate lock-down boolean is needed here.
 */
function getHttpHookPolicy(): {
  allowedUrls: string[] | undefined
  allowedEnvVars: string[] | undefined
} {
  const settings = settingsModule.getInitialSettings()
  return {
    allowedUrls: settings.allowedHttpHookUrls,
    allowedEnvVars: settings.httpHookAllowedEnvVars,
  }
}

const URL_WILDCARD_TOKEN = `zzwildcard${randomBytes(8).toString('hex')}zz`
const URL_PUNYCODE_TOKEN = `zzpunycode${randomBytes(8).toString('hex')}zz`
const SPECIAL_URL_PROTOCOLS = new Set([
  'http:',
  'https:',
  'ws:',
  'wss:',
  'ftp:',
  'file:',
])

function compileWildcardFinder(needle: string) {
  if (!needle.includes(needle.charAt(0), 1)) {
    return (haystack: string, start: number, end: number): number => {
      const idx = haystack.indexOf(needle, start)
      return idx === -1 || idx + needle.length > end ? -1 : idx
    }
  }
  const lps = new Int32Array(needle.length)
  for (let i = 1, len = 0; i < needle.length; i++) {
    while (len > 0 && needle.charCodeAt(i) !== needle.charCodeAt(len)) {
      len = lps[len - 1] ?? 0
    }
    if (needle.charCodeAt(i) === needle.charCodeAt(len)) len++
    lps[i] = len
  }
  return (haystack: string, start: number, end: number): number => {
    for (let i = start, j = 0; i < end; i++) {
      while (j > 0 && haystack.charCodeAt(i) !== needle.charCodeAt(j)) {
        j = lps[j - 1] ?? 0
      }
      if (haystack.charCodeAt(i) === needle.charCodeAt(j)) j++
      if (j === needle.length) return i - needle.length + 1
    }
    return -1
  }
}

function matchWildcard(pattern: string, target: string): boolean {
  const parts = pattern.split('*')
  const head = parts[0] ?? ''
  if (parts.length === 1) return head === target
  const tail = parts.at(-1) ?? ''
  const limit = target.length - tail.length
  if (
    limit < head.length ||
    !target.startsWith(head) ||
    !target.endsWith(tail)
  ) {
    return false
  }
  const middle = parts.slice(1, -1).filter(p => p !== '')
  const finders: Array<(h: string, s: number, e: number) => number> = []
  let cursor = head.length
  for (let idx = 0; idx < middle.length; idx++) {
    const part = middle[idx]!
    const finder = (finders[idx] ??= compileWildcardFinder(part))
    const found = finder(target, cursor, limit)
    if (found === -1) return false
    cursor = found + part.length
  }
  return true
}

function matchSegmentedWildcard(
  pattern: string,
  target: string,
  delimiters: string,
): boolean {
  const nextDelim = (str: string, from: number): number => {
    let i = from
    while (i < str.length && !delimiters.includes(str.charAt(i))) i++
    return i
  }
  let pIdx = 0
  let tIdx = 0
  for (;;) {
    const pEnd = nextDelim(pattern, pIdx)
    const tEnd = nextDelim(target, tIdx)
    if (
      pattern.charAt(pEnd) !== target.charAt(tEnd) ||
      !matchWildcard(pattern.slice(pIdx, pEnd), target.slice(tIdx, tEnd))
    ) {
      return false
    }
    if (pEnd === pattern.length) return true
    pIdx = pEnd + 1
    tIdx = tEnd + 1
  }
}

function protectPunycodeWildcards(input: string, extraToken?: string): string {
  return input.replace(/[a-z0-9-]+/gi, label =>
    /^xn--/i.test(label) &&
    (label.includes(URL_WILDCARD_TOKEN) ||
      (extraToken !== undefined && label.includes(extraToken)))
      ? URL_PUNYCODE_TOKEN + label
      : label,
  )
}

function unprotectPunycodeWildcards(input: string): string {
  return input.replaceAll(URL_PUNYCODE_TOKEN, '')
}

function hasProtectedPunycodeLabel(parsed: URL, extraToken?: string): boolean {
  return (
    SPECIAL_URL_PROTOCOLS.has(parsed.protocol) &&
    parsed.hostname
      .split('.')
      .some(
        label =>
          label.startsWith('xn--') &&
          (label.includes(URL_WILDCARD_TOKEN) ||
            (extraToken !== undefined && label.includes(extraToken))),
      )
  )
}

/**
 * Parse a URL pattern with `*` wildcards (and optional extra placeholder token)
 * without letting URL() reject wildcard ports or punycode-looking wildcard labels.
 */
export function parseUrlPattern(
  pattern: string,
  extraToken?: string,
): {
  protocol: string
  hostname: string
  username: string
  password: string
  port: string
  pathname: string
  search: string
  hash: string
} | null {
  const masked = protectPunycodeWildcards(
    pattern.replaceAll('*', URL_WILDCARD_TOKEN),
    extraToken,
  )
  let parsed: URL
  try {
    parsed = new URL(masked)
  } catch {
    const portFix = masked.replace(
      new RegExp(
        `:(?:${URL_WILDCARD_TOKEN}${extraToken ? `|${extraToken}` : ''})(?=[/?#]|$)`,
      ),
      ':0',
    )
    if (portFix === masked) return null
    try {
      parsed = new URL(portFix)
    } catch {
      return null
    }
  }
  if (hasProtectedPunycodeLabel(parsed, extraToken)) return null
  const unmask = (val: string) =>
    unprotectPunycodeWildcards(val).replaceAll(URL_WILDCARD_TOKEN, '*')
  return {
    protocol: unmask(parsed.protocol),
    hostname: unmask(parsed.hostname),
    username: unmask(parsed.username),
    password: unmask(parsed.password),
    port: unmask(parsed.port),
    pathname: unmask(parsed.pathname),
    search: unmask(parsed.search),
    hash: unmask(parsed.hash),
  }
}

/**
 * Match a URL against a pattern with * as a wildcard (any characters).
 * Same semantics as the MCP server allowlist patterns (official R8).
 */
export function urlMatchesPattern(url: string, pattern: string): boolean {
  if (pattern === '*') return true
  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    return false
  }
  const masked = protectPunycodeWildcards(
    pattern.replaceAll('*', URL_WILDCARD_TOKEN),
  )
  let wildcardPort = false
  let parsedPattern: URL | undefined
  try {
    parsedPattern = new URL(masked)
  } catch {
    const portFix = masked.replace(
      new RegExp(`:${URL_WILDCARD_TOKEN}(?=[/?#]|$)`),
      ':0',
    )
    if (portFix !== masked) {
      try {
        parsedPattern = new URL(portFix)
        wildcardPort = true
      } catch {
        // fall through to segmented fallback
      }
    }
  }
  if (!parsedPattern || hasProtectedPunycodeLabel(parsedPattern)) {
    const normalized = `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}`
    return matchSegmentedWildcard(pattern, normalized, '/')
  }
  if (
    parsedPattern.protocol !== `${URL_WILDCARD_TOKEN}:` &&
    parsedPattern.protocol !== parsedUrl.protocol
  ) {
    return false
  }
  const targetHost = parsedUrl.hostname.replace(/\.$/, '').toLowerCase()
  const patternHost = unprotectPunycodeWildcards(parsedPattern.hostname)
    .replace(/\.$/, '')
    .toLowerCase()
    .replaceAll(URL_WILDCARD_TOKEN, '*')
  if (!matchWildcard(patternHost, targetHost)) return false
  if (
    parsedPattern.port === '' &&
    parsedPattern.hostname.includes(URL_WILDCARD_TOKEN)
  ) {
    wildcardPort = true
  }
  if (!wildcardPort && parsedPattern.port !== parsedUrl.port) return false
  if (
    (parsedPattern.pathname === '/' || parsedPattern.pathname === '') &&
    parsedPattern.search === '' &&
    !masked.endsWith('/')
  ) {
    return true
  }
  const patternRest = unprotectPunycodeWildcards(
    parsedPattern.pathname + parsedPattern.search,
  ).replaceAll(URL_WILDCARD_TOKEN, '*')
  return matchWildcard(patternRest, parsedUrl.pathname + parsedUrl.search)
}

/**
 * Strip CR, LF, and NUL bytes from a header value to prevent HTTP header
 * injection (CRLF injection) via env var values or hook-configured header
 * templates. A malicious env var like "token\r\nX-Evil: 1" would otherwise
 * inject a second header into the request.
 */
function sanitizeHeaderValue(value: string): string {
  // eslint-disable-next-line no-control-regex
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional control character sanitization
  return value.replace(/[\r\n\x00]/g, '')
}

/**
 * Interpolate $VAR_NAME and ${VAR_NAME} patterns in a string using process.env,
 * but only for variable names present in the allowlist. References to variables
 * not in the allowlist are replaced with empty strings to prevent exfiltration
 * of secrets via project-configured HTTP hooks.
 *
 * The result is sanitized to strip CR/LF/NUL bytes to prevent header injection.
 */
function interpolateEnvVars(
  value: string,
  allowedEnvVars: ReadonlySet<string>,
): string {
  const interpolated = value.replace(
    /\$\{([A-Z_][A-Z0-9_]*)\}|\$([A-Z_][A-Z0-9_]*)/g,
    (_, braced, unbraced) => {
      const varName = braced ?? unbraced
      if (!allowedEnvVars.has(varName)) {
        logForDebugging(
          `Hooks: env var $${varName} not in allowedEnvVars, skipping interpolation`,
          { level: 'warn' },
        )
        return ''
      }
      return process.env[varName] ?? ''
    },
  )
  return sanitizeHeaderValue(interpolated)
}

/**
 * Execute an HTTP hook by POSTing the hook input JSON to the configured URL.
 * Returns the raw response for the caller to interpret.
 *
 * When sandboxing is enabled, requests are routed through the sandbox network
 * proxy which enforces the domain allowlist. The proxy returns HTTP 403 for
 * blocked domains.
 *
 * Header values support $VAR_NAME and ${VAR_NAME} env var interpolation so that
 * secrets (e.g. "Authorization: Bearer $MY_TOKEN") are not stored in settings.json.
 * Only env vars explicitly listed in the hook's `allowedEnvVars` array are resolved;
 * all other references are replaced with empty strings.
 */
export async function execHttpHook(
  hook: HttpHook,
  _hookEvent: HookEvent,
  jsonInput: string,
  signal?: AbortSignal,
  defaultTimeoutMs = DEFAULT_HTTP_HOOK_TIMEOUT_MS,
): Promise<{
  ok: boolean
  statusCode?: number
  body: string
  error?: string
  aborted?: boolean
}> {
  // Enforce URL allowlist before any I/O. Follows allowedMcpServers semantics:
  // undefined → no restriction; [] → block all; non-empty → must match a pattern.
  const policy = getHttpHookPolicy()
  if (policy.allowedUrls !== undefined) {
    const matched = policy.allowedUrls.some(p => urlMatchesPattern(hook.url, p))
    if (!matched) {
      const msg = `HTTP hook blocked: ${hook.url} does not match any pattern in allowedHttpHookUrls`
      logForDebugging(msg, { level: 'warn' })
      return { ok: false, body: '', error: msg }
    }
  }

  const timeoutMs = hook.timeout ? hook.timeout * 1000 : defaultTimeoutMs

  const { signal: combinedSignal, cleanup } = createCombinedAbortSignal(
    signal,
    { timeoutMs },
  )

  try {
    // Build headers with env var interpolation in values
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (hook.headers) {
      // Intersect hook's allowedEnvVars with policy allowlist when policy is set
      const hookVars = hook.allowedEnvVars ?? []
      const effectiveVars =
        policy.allowedEnvVars !== undefined
          ? hookVars.filter(v => policy.allowedEnvVars!.includes(v))
          : hookVars
      const allowedEnvVars = new Set(effectiveVars)
      for (const [name, value] of Object.entries(hook.headers)) {
        headers[name] = interpolateEnvVars(value, allowedEnvVars)
      }
    }

    // Route through sandbox network proxy when available. The proxy enforces
    // the domain allowlist and returns 403 for blocked domains.
    const sandboxProxy = await getSandboxProxyConfig()

    // Detect env var proxy (HTTP_PROXY / HTTPS_PROXY, respecting NO_PROXY).
    // When set, configureGlobalAgents() has already installed a request
    // interceptor that sets httpsAgent to an HttpsProxyAgent — the proxy
    // handles DNS for the target. Skip the SSRF guard in that case, same
    // as we do for the sandbox proxy, so that we don't accidentally block
    // a corporate proxy sitting on a private IP (e.g. 10.0.0.1:3128).
    const envProxyActive =
      !sandboxProxy &&
      getProxyUrl() !== undefined &&
      !shouldBypassProxy(hook.url)

    if (sandboxProxy) {
      logForDebugging(
        `Hooks: HTTP hook POST to ${hook.url} (via sandbox proxy :${sandboxProxy.port})`,
      )
    } else if (envProxyActive) {
      logForDebugging(
        `Hooks: HTTP hook POST to ${hook.url} (via env-var proxy)`,
      )
    } else {
      logForDebugging(`Hooks: HTTP hook POST to ${hook.url}`)
    }

    const response = await axios.post<string>(hook.url, jsonInput, {
      headers,
      signal: combinedSignal,
      responseType: 'text',
      validateStatus: () => true,
      maxRedirects: 0,
      // Explicit false prevents axios's own env-var proxy detection; when an
      // env-var proxy is configured, the global axios interceptor installed
      // by configureGlobalAgents() handles it via httpsAgent instead.
      proxy: sandboxProxy ?? false,
      // SSRF guard: validate resolved IPs, block private/link-local ranges
      // (but allow loopback for local dev). Skipped when any proxy is in
      // use — the proxy performs DNS for the target, and applying the
      // guard would instead validate the proxy's own IP, breaking
      // connections to corporate proxies on private networks.
      lookup: sandboxProxy || envProxyActive ? undefined : ssrfGuardedLookup,
    })

    cleanup()

    const body = response.data ?? ''
    logForDebugging(
      `Hooks: HTTP hook response status ${response.status}, body length ${body.length}`,
    )

    return {
      ok: response.status >= 200 && response.status < 300,
      statusCode: response.status,
      body,
    }
  } catch (error) {
    cleanup()

    if (combinedSignal.aborted) {
      return { ok: false, body: '', aborted: true }
    }

    const errorMsg = errorMessage(error)
    logForDebugging(`Hooks: HTTP hook error: ${errorMsg}`, { level: 'error' })
    return { ok: false, body: '', error: errorMsg }
  }
}
