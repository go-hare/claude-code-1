/**
 * densable 2.1.216 #19 — `t7r` / `xs()` signal for MCP OAuth re-auth.
 *
 * Emitted when token refresh permanently invalidates credentials
 * (`invalid_grant` / DCR `invalid_client`|`unauthorized_client`). UI
 * subscribers surface a per-server high-priority toast pointing at
 * `/mcp` → Re-authenticate.
 *
 * Pure process-local bus (no AppState). Same shape as densable `xs()`:
 * subscribe returns unsubscribe; emit fans out to listeners.
 */

type Listener = (serverName: string) => void

const listeners = new Set<Listener>()

/**
 * densable `prg` / `DYt(e)` — object-identity WeakSet of MCP server configs
 * that use headersHelper silent recovery. densable SEA has `prg.has` but no
 * recovered `prg.add` call site (effectively dead mark path); we still keep
 * the same identity check so mark helpers can wire 1:1 if/when densable does.
 *
 * **Not** "truthy `headersHelper` string" — densable `oKn` does not treat
 * `headersHelper` as skip; only `n5e` / `DYt` / design-URL / XAA.
 */
const headersHelperConfigIdentity = new WeakSet<object>()

export function markMcpHeadersHelperConfig(config: object): void {
  headersHelperConfigIdentity.add(config)
}

/** densable `DYt(e)` */
export function isMcpHeadersHelperConfig(config: unknown): config is object {
  return (
    typeof config === 'object' &&
    config !== null &&
    headersHelperConfigIdentity.has(config)
  )
}

export function subscribeMcpNeedsReauth(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function emitMcpNeedsReauth(serverName: string): void {
  const errors: unknown[] = []
  for (const listener of listeners) {
    try {
      listener(serverName)
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length === 1) {
    throw errors[0]
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, 'Signal listener(s) threw')
  }
}

/** densable-facing notification copy (exact). */
export function formatMcpNeedsReauthNotification(serverName: string): string {
  return `MCP server "${serverName}" lost authentication · open /mcp and select Re-authenticate`
}

export function mcpNeedsReauthNotificationKey(serverName: string): string {
  return `mcp-needs-reauth-${serverName}`
}

/**
 * densable gate before toast (SRa / t7r.subscribe):
 *   if ((config.type==="sse"||config.type==="http") &&
 *       (oKn(config, hasClaudeAuth) || (Zge() && config.oauth?.xaa)))
 *     return; // silent recovery path — do not nag
 *
 * oKn(e,t) = n5e(e) || DYt(e) || (Fce(e.url) && firstParty && t)
 * - n5e: static Authorization header
 * - DYt: `prg.has(config)` object identity (not headersHelper string)
 * - Fce: Anthropic first-party design MCP URL — only with firstParty + claude auth
 * XAA silent when XAA env enabled and server has oauth.xaa
 *
 * densable `nKn` (headersHelper || any headers || Fce) is used for needs-auth
 * cache skip — **not** the toast oKn gate.
 */
export function shouldSkipMcpNeedsReauthNotification(opts: {
  configType?: string
  /** densable n5e input — static headers map */
  headers?: Record<string, string>
  /**
   * densable DYt input — the live config object identity, if marked via
   * `markMcpHeadersHelperConfig`. Do **not** pass a headersHelper string here.
   */
  configObject?: unknown
  url?: string
  oauthXaa?: boolean
  xaaEnabled: boolean
  isFirstPartyProvider: boolean
  hasClaudeAiAccessToken: boolean
}): boolean {
  if (opts.configType !== 'sse' && opts.configType !== 'http') {
    // densable only special-cases sse/http for the silent gate; other types
    // still get the toast if emit fired (emit only from OAuth refresh).
    return false
  }
  // densable: oKn(...) || (Zge() && oauth.xaa) — XAA branch is OR'd outside oKn
  if (opts.xaaEnabled && opts.oauthXaa) {
    return true
  }
  // oKn = n5e || DYt || (Fce && firstParty && hasClaude)
  if (
    Object.keys(opts.headers ?? {}).some(
      key => key.toLowerCase() === 'authorization',
    )
  ) {
    return true
  }
  if (isMcpHeadersHelperConfig(opts.configObject)) {
    return true
  }
  if (
    opts.url &&
    isAnthropicDesignMcpUrl(opts.url) &&
    opts.isFirstPartyProvider &&
    opts.hasClaudeAiAccessToken
  ) {
    return true
  }
  return false
}

/** densable Fce / Grg — first-party Anthropic design MCP URL prefix. */
export function isAnthropicDesignMcpUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return false
    const host = parsed.host.toLowerCase()
    // densable Fce: https + jPe(href) host allow + pathname starts with Grg
    if (
      host !== 'api.anthropic.com' &&
      !host.endsWith('.anthropic.com') &&
      host !== 'claude.ai' &&
      !host.endsWith('.claude.ai')
    ) {
      return false
    }
    return ['/v1/design/'].some(prefix => parsed.pathname.startsWith(prefix))
  } catch {
    return false
  }
}

/** Test helper — clear subscribers between cases. */
export function clearMcpNeedsReauthListenersForTests(): void {
  listeners.clear()
}
