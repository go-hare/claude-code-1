/**
 * densable 2.1.251 #57 — VQt `call` permissionOverrides four-arm + helpers.
 *
 * Gold call arm (gold-251-f):
 *   c = kx(tool,ctx)==="bypassPermissions"
 *   T = c ? skip_all
 *     : m ? follow_a_plan + domains + onPermissionRequest
 *     : R.length>0 ? follow_a_plan + domains
 *     : ask
 *   then ie(..., T) → socketClient.callTool with PermissionOverrides
 */
import type {
  BridgePermissionRequest,
  PermissionMode,
  PermissionOverrides,
} from '@ant/claude-for-chrome-mcp'
import {
  getSessionBypassPermissionsMode,
  getSessionId,
} from '../../bootstrap/state.js'
import { logEvent } from '../../services/analytics/index.js'
import type { ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import {
  getChromeInstallSessionState,
  rememberLastExecutedTabUrl,
  type ResolvedChromeHost,
} from './sessionState.js'

export type ChromeDomainSets = {
  allowed: Set<string>
  denied: Set<string>
  allowedRaw: string[]
}

/**
 * densable `y` — normalize host for set membership (lowercase, strip trailing dots).
 */
export function normalizeChromeHost(host: string): string {
  return host
    .replace(/\.+(?=$|:)/, '')
    .toLowerCase()
    .replace(/\.+$/, '')
}

/**
 * SEA 325 `Zen` + `Gpe` helper — check both `host` and (for plain http:// or
 * unknown-scheme hosts without an explicit port) `host:80`.
 */
export function isChromeHostInSet(
  set: ReadonlySet<string>,
  host: string,
  url?: string,
): boolean {
  const normalized = normalizeChromeHost(host)
  if (set.has(normalized)) return true
  if (normalized.includes(':')) return false
  if (url !== undefined) {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' || parsed.port !== '') {
        return false
      }
    } catch {
      return false
    }
  }
  return set.has(`${normalized}:80`)
}

/**
 * densable `x` — collect chrome domain allow/deny from permission rules.
 */
export function chromeDomainSetsFromContext(
  ctx: ToolPermissionContext,
): ChromeDomainSets {
  const allowed = new Set<string>()
  const denied = new Set<string>()
  const allowedRaw: string[] = []

  const collect = (
    rulesBySource: ToolPermissionContext['alwaysAllowRules'] | undefined,
    into: Set<string>,
    raw?: string[],
  ): void => {
    if (!rulesBySource) return
    for (const list of Object.values(rulesBySource)) {
      if (!Array.isArray(list)) continue
      for (const rule of list) {
        const s = typeof rule === 'string' ? rule : String(rule ?? '')
        const hostMatch = s.match(
          /(?:claude-in-chrome|Chrome)[^\s]*[:\s@]+([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)/i,
        )
        const bare = s.match(/^([a-z0-9.-]+\.[a-z]{2,}(?::\d+)?)$/i)
        const host = hostMatch?.[1] ?? bare?.[1]
        if (!host) continue
        const n = normalizeChromeHost(host)
        into.add(n)
        if (raw && !raw.includes(host)) raw.push(host)
      }
    }
  }

  collect(ctx.alwaysDenyRules, denied)
  collect(ctx.alwaysAllowRules, allowed, allowedRaw)
  return { allowed, denied, allowedRaw }
}

/**
 * densable `se` — onPermissionRequest: allow only if host still in allowed set.
 */
export function createChromeOnPermissionRequest(
  allowed: Set<string>,
): (request: BridgePermissionRequest) => Promise<boolean> {
  return async request => {
    let host: string | undefined
    let url = ''
    try {
      url =
        request && typeof request === 'object' && 'url' in request
          ? String((request as { url?: string }).url ?? '')
          : ''
      if (url) host = new URL(url).host
    } catch {
      host = undefined
    }
    const ok = !!host && isChromeHostInSet(allowed, host, url || undefined)
    if (!ok) {
      logEvent('chrome_permission_prompt', {})
    }
    return ok
  }
}

/** densable `F` — sessionScope bag. */
export function chromeSessionScope(): { sessionId: string } {
  return { sessionId: getSessionId() }
}

/**
 * Official 2.1.326 #254 (`ipa` / `spa` / `Sgn`) — resolve the Chrome site name
 * (host or host:port) to include as `chrome_site` on Remote Control permission
 * requests, including when the site is already allowed in permission rules.
 */
const CHROME_SITE_HOST_RE = /^[a-z0-9._-]+$/
const CHROME_SITE_IPV6_RE = /^\[[0-9a-f:.]+\]$/
const CHROME_SITE_MAX_LEN = 253

export function isValidChromeSiteName(site: string): boolean {
  if (!site || site.length > CHROME_SITE_MAX_LEN) return false
  const colonIdx = site.lastIndexOf(':')
  const host =
    colonIdx > 0 && !site.endsWith(']') ? site.slice(0, colonIdx) : site
  const port =
    colonIdx > 0 && !site.endsWith(']') ? site.slice(colonIdx + 1) : undefined
  if (
    port !== undefined &&
    (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65535)
  ) {
    return false
  }
  return CHROME_SITE_HOST_RE.test(host) || CHROME_SITE_IPV6_RE.test(host)
}

export function resolveChromeSiteForPermissionPrompt(
  toolUseId: string | undefined,
  input?: Record<string, unknown>,
): string | undefined {
  const state = getChromeInstallSessionState()
  const resolvedHost = toolUseId
    ? state.resolvedHostByToolUseId.get(toolUseId)?.host
    : undefined
  if (resolvedHost) {
    const normalized = normalizeChromeHost(resolvedHost)
    if (isValidChromeSiteName(normalized)) return normalized
  }
  const urlCandidate =
    (toolUseId ? state.resolvedUrlByToolUseId.get(toolUseId) : undefined) ??
    (typeof input?.url === 'string' ? input.url : undefined) ??
    state.lastExecutedTabUrlByScope.get(getSessionId())
  if (urlCandidate) {
    try {
      const parsed = new URL(urlCandidate)
      const host = normalizeChromeHost(parsed.host)
      if (isValidChromeSiteName(host)) return host
    } catch {
      // fall through
    }
  }
  return undefined
}

/**
 * densable VQt call arm — build PermissionOverrides for this tool use.
 */
export function resolveChromeCallPermissionOverrides(
  context: ToolUseContext,
  toolUseId: string | undefined,
): PermissionOverrides {
  const state = getChromeInstallSessionState()
  const resolved: ResolvedChromeHost | undefined = toolUseId
    ? state.resolvedHostByToolUseId.get(toolUseId)
    : undefined
  const resolvedUrl = toolUseId
    ? state.resolvedUrlByToolUseId.get(toolUseId)
    : undefined
  if (toolUseId) {
    state.resolvedHostByToolUseId.delete(toolUseId)
    state.resolvedUrlByToolUseId.delete(toolUseId)
  }

  const ctx = context.getAppState().toolPermissionContext
  // densable VQt: `c=kx(a,d)==="bypassPermissions"`. Nq is session bypass
  // (TD/Dme). Do NOT treat plan + isBypassPermissionsModeAvailable as skip_all
  // — that flag only means Shift+Tab can reach bypass (planBypass.ts).
  const bypass =
    getSessionBypassPermissionsMode() || ctx.mode === 'bypassPermissions'

  const sets = chromeDomainSetsFromContext(ctx)
  const host = resolved?.host
  if (
    host &&
    !isChromeHostInSet(sets.denied, host, resolvedUrl) &&
    !sets.allowed.has(normalizeChromeHost(host))
  ) {
    sets.allowed.add(normalizeChromeHost(host))
    if (!sets.allowedRaw.includes(host)) sets.allowedRaw.push(host)
  }

  const sessionScope = chromeSessionScope()
  let overrides: PermissionOverrides
  if (bypass) {
    overrides = { permissionMode: 'skip_all_permission_checks' }
  } else if (host) {
    overrides = {
      permissionMode: 'follow_a_plan',
      allowedDomains: [...sets.allowedRaw],
      onPermissionRequest: createChromeOnPermissionRequest(sets.allowed),
    }
  } else if (sets.allowedRaw.length > 0) {
    overrides = {
      permissionMode: 'follow_a_plan',
      allowedDomains: [...sets.allowedRaw],
    }
  } else {
    overrides = { permissionMode: 'ask' }
  }

  if (resolvedUrl) {
    rememberLastExecutedTabUrl(sessionScope.sessionId, resolvedUrl)
  }
  if (host) {
    logEvent('chrome_permission_prompt', {})
  }

  return overrides
}

/** densable TD. */
export function chromePermissionModeFromSession(): PermissionMode {
  return getSessionBypassPermissionsMode()
    ? 'skip_all_permission_checks'
    : 'ask'
}

/** densable Nq mirror. */
export function isChromeSessionBypass(): boolean {
  return getSessionBypassPermissionsMode()
}

// ── 2.1.293 #325: tab lookup with slow-browser retry (SEA `x`, `K`, `q`) ──

export const TAB_LOOKUP_CAP_MS = 5000
export const TAB_LOOKUP_RETRY_DELAY_MS = 2500

const TAB_LOOKUP_TIMEOUT_FAILURES = new Set([
  'connect_timeout',
  'no_browser_selected_timeout',
  'browser_selected_late_timeout',
  'answer_timeout',
])

export type ChromeTabEntry = {
  tabId: number
  url?: unknown
}

export type ChromeTabsQueryResult =
  | { ok: true; tabs: ChromeTabEntry[]; connectMs: number; callMs: number }
  | { ok: false; failure: string; connectMs: number; callMs: number }

export type ChromeTabUrlResult =
  | { ok: true; url: string; connectMs: number; callMs: number }
  | {
      ok: false
      failure: string
      connectMs: number
      callMs: number
      retryCallMs?: number
    }

function hasValidTabUrl(res: ChromeTabUrlResult): boolean {
  if (!res.ok) return false
  try {
    new URL(res.url)
    return true
  } catch {
    return false
  }
}

/** SEA `K(e, o)` — match `tabId` in the returned `availableTabs` list. */
export function matchTabUrl(
  result: ChromeTabsQueryResult,
  tabId: number,
): ChromeTabUrlResult {
  if (!result.ok) return result
  const { tabs, connectMs, callMs } = result
  const idx = tabs.findIndex(t => t == null || t.tabId === tabId)
  const entry = tabs[idx]
  if (idx === -1) {
    return {
      ok: false,
      failure: tabs.length === 0 ? 'empty_tab_list' : 'tab_not_listed',
      connectMs,
      callMs,
    }
  }
  if (entry == null || typeof entry.url !== 'string') {
    return { ok: false, failure: 'malformed_tab_list', connectMs, callMs }
  }
  if (entry.url === '') {
    return { ok: false, failure: 'tab_url_empty', connectMs, callMs }
  }
  return { ok: true, url: entry.url, connectMs, callMs }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    timer.unref?.()
    promise.then(
      v => {
        clearTimeout(timer)
        resolve(v)
      },
      err => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/**
 * SEA `x(e)` — query `tabs_context_mcp` with a bounded timeout (`capMs`, default 5000ms).
 */
export async function queryTabUrl(opts?: {
  capMs?: number
  onSentToSelectedBrowser?: () => void
}): Promise<ChromeTabsQueryResult> {
  const started = performance.now()
  const track: { browserSelected?: boolean; startedAt?: number } = {}
  let outcome: ChromeTabEntry[] | string
  try {
    const binding = getChromeInstallSessionState().bridgeBinding
    if (!binding) {
      return { ok: false, failure: 'binding_missing', connectMs: 0, callMs: 0 }
    }
    const { socketClient } = binding
    outcome = await withTimeout(
      (async (): Promise<ChromeTabEntry[] | string> => {
        if (socketClient.ensureConnected) {
          if (!(await socketClient.ensureConnected())) return 'not_connected'
        } else if (!socketClient.isConnected()) {
          return 'not_connected'
        }
        track.browserSelected = socketClient.hasActiveSelection?.()
        track.startedAt = performance.now()
        if (track.browserSelected === true) {
          opts?.onSentToSelectedBrowser?.()
        }
        const raw = (await socketClient.callTool(
          'tabs_context_mcp',
          { createIfEmpty: false, includePermissionState: false },
          { permissionMode: 'ask', sessionScope: chromeSessionScope() },
        )) as
          | {
              error?: unknown
              result?: { content?: Array<{ text?: unknown }> }
            }
          | undefined
        if (!raw) return 'empty_result'
        if (raw.error) return 'tool_error'
        const content = raw.result?.content
        const text =
          Array.isArray(content) &&
          content[0] &&
          typeof content[0] === 'object' &&
          typeof content[0].text === 'string'
            ? content[0].text
            : undefined
        if (!text) return 'no_text'
        let parsed: { availableTabs?: unknown } | undefined
        try {
          parsed = JSON.parse(text) as { availableTabs?: unknown }
        } catch {
          return text.includes('createIfEmpty') ? 'no_tab_group' : 'not_json'
        }
        return Array.isArray(parsed?.availableTabs)
          ? (parsed.availableTabs as ChromeTabEntry[])
          : 'no_tab_list'
      })().catch((err: unknown): string => {
        if (track.startedAt === undefined) return 'connect_threw'
        if (
          err instanceof Error &&
          (err.name === 'SocketConnectionError' ||
            err.name === 'ToolCallLostError')
        ) {
          return 'connection_lost'
        }
        if (err instanceof Error && err.name === 'NoExtensionConnectedError') {
          return 'no_extension'
        }
        return 'call_threw'
      }),
      opts?.capMs ?? TAB_LOOKUP_CAP_MS,
      'queryTabUrl bridge call',
    ).catch(() => {
      if (track.startedAt === undefined) return 'connect_timeout'
      if (socketClient.hasActiveSelection?.() === false) {
        return 'no_browser_selected_timeout'
      }
      return track.browserSelected === false
        ? 'browser_selected_late_timeout'
        : 'answer_timeout'
    })
  } catch {
    outcome = 'other_threw'
  }
  const now = performance.now()
  const connectMs = Math.round((track.startedAt ?? now) - started)
  const callMs =
    track.startedAt === undefined ? 0 : Math.round(now - track.startedAt)
  return typeof outcome === 'string'
    ? { ok: false, failure: outcome, connectMs, callMs }
    : { ok: true, tabs: outcome, connectMs, callMs }
}

/**
 * SEA `q(e)` (2.1.293 #325) — resolve a tab's URL, firing a parallel retry after
 * `retryDelayMs` (default 2500ms) if the selected browser is slow to report tabs.
 */
export async function resolveTabUrlWithRetry(
  tabId: number,
  opts?: {
    capMs?: number
    retryDelayMs?: number
    query?: typeof queryTabUrl
  },
): Promise<ChromeTabUrlResult> {
  const capMs = opts?.capMs ?? TAB_LOOKUP_CAP_MS
  const retryDelayMs = opts?.retryDelayMs ?? TAB_LOOKUP_RETRY_DELAY_MS
  const query = opts?.query ?? queryTabUrl
  const started = performance.now()

  let resolveSent!: () => void
  const sentPromise = new Promise<void>(r => {
    resolveSent = r
  })
  const retryAbort = new AbortController()
  const retryState: { sent: boolean; callMs?: number } = { sent: false }

  const primary = query({
    capMs,
    onSentToSelectedBrowser: resolveSent,
  }).then(res => {
    retryAbort.abort()
    return matchTabUrl(res, tabId)
  })

  const retry = sentPromise
    .then(async (): Promise<ChromeTabUrlResult | undefined> => {
      await new Promise<void>(resolve => {
        if (retryAbort.signal.aborted) {
          resolve()
          return
        }
        const t = setTimeout(resolve, retryDelayMs)
        t.unref?.()
        retryAbort.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(t)
            resolve()
          },
          { once: true },
        )
      })
      const remaining = capMs - (performance.now() - started)
      const client = getChromeInstallSessionState().bridgeBinding?.socketClient
      if (
        retryAbort.signal.aborted ||
        remaining <= 0 ||
        client?.isConnected() !== true ||
        client.hasActiveSelection?.() !== true
      ) {
        return undefined
      }
      retryState.sent = true
      const res = matchTabUrl(await query({ capMs: remaining }), tabId)
      if (hasValidTabUrl(res)) return res
      if (res.ok || !TAB_LOOKUP_TIMEOUT_FAILURES.has(res.failure)) {
        retryState.callMs = res.callMs
      }
      return undefined
    })
    .catch(() => undefined)

  const rescued = await Promise.race([primary.then(() => undefined), retry])
  if (rescued === undefined) {
    const first = await primary
    if (retryState.sent && !first.ok && first.failure === 'answer_timeout') {
      return {
        ...first,
        failure: 'answer_timeout_after_retry',
        retryCallMs: retryState.callMs,
      }
    }
    return first
  }
  return rescued
}

// ── 2.1.323 #2198: Browser tool call escaped / JSON-text input refusal ──────

const BROWSER_ESCAPE_HINT =
  'Permission checks may read that spelling differently from what would run.'

const PRINTABLE_OR_LINE_SEP_UNICODE_ESCAPE =
  /\\u(?:00[2-6][0-9a-fA-F]|007[0-9a-eA-E]|202[89])/
const ANY_UNICODE_ESCAPE = /\\u[0-9a-fA-F]{4}/

export type BrowserInputValidationError = {
  errorCode: 'BROWSER_INPUT_JSON_TEXT' | 'BROWSER_INPUT_ESCAPE'
  message: string
}

/**
 * Matches Claude in Chrome and desktop browser pane MCP tools (official `rLo(name)` / `Claude_Browser`).
 */
export function isBrowserMcpToolName(name: string): boolean {
  return (
    name.startsWith('mcp__claude-in-chrome__') ||
    name.startsWith('mcp__Claude_in_Chrome__') ||
    name.startsWith('mcp__Claude_Browser__')
  )
}

function canonicalizeJsonText(raw: string): string | undefined {
  let out = ''
  for (let i = 0; i < raw.length; ) {
    const ch = raw[i]!
    if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
      i++
      continue
    }
    if (ch !== '"') {
      out += ch
      i++
      continue
    }
    let j = i + 1
    while (j < raw.length && raw[j] !== '"') {
      j += raw[j] === '\\' ? 2 : 1
    }
    if (j >= raw.length) return undefined
    let parsed: unknown
    try {
      parsed = JSON.parse(raw.slice(i, j + 1))
    } catch {
      return undefined
    }
    if (typeof parsed !== 'string') return undefined
    out += JSON.stringify(parsed)
    i = j + 1
  }
  return out
}

function findDisallowedEscape(
  value: unknown,
  namesHosts = false,
): { escape: string; namesHosts: boolean } | undefined {
  if (typeof value === 'string') {
    const match = (
      namesHosts ? ANY_UNICODE_ESCAPE : PRINTABLE_OR_LINE_SEP_UNICODE_ESCAPE
    ).exec(value)?.[0]
    return match === undefined ? undefined : { escape: match, namesHosts }
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findDisallowedEscape(item, namesHosts)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const found = findDisallowedEscape(
        v,
        namesHosts || k === 'url' || k === 'domains',
      )
      if (found !== undefined) return found
    }
  }
  return undefined
}

function expectsObjectOrArray(
  schema:
    | { properties?: Record<string, { type?: string | string[] }> }
    | undefined,
  key: string,
): 'array' | 'object' | undefined {
  const prop = schema?.properties?.[key]
  if (!prop) return undefined
  const types = Array.isArray(prop.type)
    ? prop.type
    : prop.type
      ? [prop.type]
      : []
  if (types.includes('array')) return 'array'
  if (types.includes('object')) return 'object'
  return undefined
}

/**
 * 2.1.323 #2198 (official `Wro` / `A5e` / `v5e`): refuses escaped `\uXXXX`
 * sequences and JSON-encoded string values for structured browser tool inputs
 * (Claude in Chrome and desktop browser pane) and tells Claude how to respell them.
 */
export function validateBrowserToolInput(
  tool: {
    name: string
    inputJSONSchema?: Record<string, unknown>
  },
  input: unknown,
): BrowserInputValidationError | null {
  if (
    !isBrowserMcpToolName(tool.name) ||
    input === null ||
    typeof input !== 'object' ||
    Array.isArray(input)
  ) {
    return null
  }
  const obj = input as Record<string, unknown>

  // 1. Detect JSON-text string sent where an object or array is expected
  for (const [key, val] of Object.entries(obj)) {
    if (typeof val !== 'string') continue
    const trimmed = val.trim()
    const looksLikeJsonArray = trimmed.startsWith('[') && trimmed.endsWith(']')
    const looksLikeJsonObject = trimmed.startsWith('{') && trimmed.endsWith('}')
    if (!looksLikeJsonArray && !looksLikeJsonObject) continue

    const expected = expectsObjectOrArray(
      tool.inputJSONSchema as
        | { properties?: Record<string, { type?: string | string[] }> }
        | undefined,
      key,
    )
    const isKnownStructuredKey =
      expected !== undefined ||
      key === 'actions' ||
      key === 'domains' ||
      key === 'coordinate'
    if (!isKnownStructuredKey) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (parsed !== null && typeof parsed === 'object') {
      const isList = Array.isArray(parsed)
      const [kindLabel, exampleShape] = isList
        ? ['a list', '[ ... ]']
        : ['an object', '{ ... }']
      if (
        val.includes('\\') ||
        canonicalizeJsonText(val) !== JSON.stringify(parsed) ||
        isKnownStructuredKey
      ) {
        return {
          errorCode: 'BROWSER_INPUT_JSON_TEXT',
          message: `InputValidationError: ${tool.name} did not run: its "${key}" came in quotes, as a string of JSON text, and not as ${kindLabel}. ${BROWSER_ESCAPE_HINT} Send the same ${tool.name} call again with "${key}": ${exampleShape} in place of "${key}": "${exampleShape}".`,
        }
      }
    }
  }

  // 2. Detect disallowed \uXXXX escapes in actions or top-level input
  const actions = Array.isArray(obj.actions) ? obj.actions : []
  let badActionIndex = -1
  let badEscape: { escape: string; namesHosts: boolean } | undefined
  for (let i = 0; i < actions.length; i++) {
    const found = findDisallowedEscape(actions[i])
    if (found !== undefined) {
      badActionIndex = i
      badEscape = found
      break
    }
  }
  if (badEscape === undefined) {
    badEscape = findDisallowedEscape(obj)
  }
  if (badEscape === undefined) return null

  const { escape: esc, namesHosts } = badEscape
  const actionLabel =
    badActionIndex === -1 ? 'its input' : `action ${badActionIndex + 1}`
  const respellGuidance = namesHosts
    ? 'Write the URL or the domain with no escape in it.'
    : `${
        esc.startsWith('\\u00')
          ? `In a JavaScript string or regular expression write \\x${esc.slice(4)}`
          : `In a JavaScript string write \\u{${esc.slice(2)}}, which a regular expression takes only with the u flag`
      }; elsewhere write the character itself. To keep the escape as text, write its backslash as \\x5c in JavaScript or, where typing adds to what a field holds, type the backslash and the rest in two actions.`

  return {
    errorCode: 'BROWSER_INPUT_ESCAPE',
    message: `InputValidationError: ${tool.name} did not run: ${actionLabel} holds the escape ${esc}. ${BROWSER_ESCAPE_HINT} ${respellGuidance} Check the rest of the input too: no \\uXXXX escape may stand in a URL or a domain, nor elsewhere one from \\u0020 to \\u007e, \\u2028 or \\u2029. Then make the call again.`,
  }
}
