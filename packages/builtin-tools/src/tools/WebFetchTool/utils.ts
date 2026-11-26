import axios, { type AxiosResponse } from 'axios'
import { LRUCache } from 'lru-cache'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { queryHaiku, queryWithModel } from 'src/services/api/claude.js'
import { type EffortValue, resolveAppliedEffort } from 'src/utils/effort.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { getSmallFastModel } from 'src/utils/model/model.js'
import {
  AbortError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from 'src/utils/errors.js'
import { getWebFetchUserAgent } from 'src/utils/http.js'
import { logError } from 'src/utils/log.js'
import { getContentText } from 'src/utils/messages.js'
import {
  isBinaryContentType,
  persistBinaryContent,
} from 'src/utils/mcpOutputStorage.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionHost.js'
import { asSystemPrompt } from 'src/utils/systemPromptType.js'
import { isPreapprovedHost } from './preapproved.js'
import { makeSecondaryModelPrompt } from './prompt.js'

const DEFAULT_TAVILY_EXTRACT_URL = 'https://tavily.claude-code-best.win/extract'

// Custom error class for egress proxy blocks
class EgressBlockedError extends Error {
  constructor(public readonly domain: string) {
    super(
      JSON.stringify({
        error_type: 'EGRESS_BLOCKED',
        domain,
        message: `Access to ${domain} is blocked by the network egress proxy.`,
      }),
    )
    this.name = 'EgressBlockedError'
  }
}

export class WebFetchRequestError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
  ) {
    super(message)
    this.name = 'WebFetchRequestError'
  }
}

// Cache for storing fetched URL content
type CacheEntry = {
  bytes: number
  code: number
  codeText: string
  content: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}

// densable 2.1.233: $J_=900000; C9s() = CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS ?? $J_
// Cache with configurable TTL (default 15 min) and 50MB size limit.
// LRUCache handles automatic expiration and eviction.
const DEFAULT_WEBFETCH_CACHE_TTL_MS = 15 * 60 * 1000 // densable $J_
const MAX_CACHE_SIZE_BYTES = 50 * 1024 * 1024 // 50MB

type WebFetchCacheHostState = {
  cachedTtlMs: number | undefined
  urlCache: LRUCache<string, CacheEntry> | null
}

const webFetchCacheStateByHost = new HostSlot<WebFetchCacheHostState>(() => ({
  cachedTtlMs: undefined,
  urlCache: null,
}))

function getWebFetchCacheHostState(): WebFetchCacheHostState {
  return webFetchCacheStateByHost.of(getBootstrapSessionHost())
}

/** densable C9s — resolve WebFetch URL cache TTL once per host (env or default). */
export function getWebFetchCacheTtlMs(): number {
  const state = getWebFetchCacheHostState()
  if (state.cachedTtlMs !== undefined) {
    return state.cachedTtlMs
  }
  const raw = process.env.CLAUDE_CODE_WEBFETCH_CACHE_TTL_MS
  if (raw !== undefined && raw !== '') {
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) {
      state.cachedTtlMs = n
      return n
    }
  }
  state.cachedTtlMs = DEFAULT_WEBFETCH_CACHE_TTL_MS
  return DEFAULT_WEBFETCH_CACHE_TTL_MS
}

/** Test helper — clear memoized TTL so env changes apply. */
export function resetWebFetchCacheTtlMsForTests(): void {
  const state = webFetchCacheStateByHost.peek(getBootstrapSessionHost())
  if (state) {
    state.cachedTtlMs = undefined
    state.urlCache = null
  }
}

function getUrlCache(): LRUCache<string, CacheEntry> {
  const state = getWebFetchCacheHostState()
  if (state.urlCache === null) {
    state.urlCache = new LRUCache<string, CacheEntry>({
      maxSize: MAX_CACHE_SIZE_BYTES,
      // densable: ttl:C9s() — evaluated at construction; C9s memoizes env
      ttl: getWebFetchCacheTtlMs(),
    })
  }
  return state.urlCache
}

export function clearWebFetchCache(): void {
  webFetchCacheStateByHost.peek(getBootstrapSessionHost())?.urlCache?.clear()
}

function responseHeaderToString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value
  }
  if (Array.isArray(value)) {
    const parts = value
      .map(responseHeaderToString)
      .filter((part): part is string => part !== undefined)
    return parts.length > 0 ? parts.join(', ') : undefined
  }
  return undefined
}

function getResponseHeader(
  headers: AxiosResponse<unknown>['headers'],
  name: string,
): string | undefined {
  const headersWithGet = headers as { get?: (headerName: string) => unknown }
  if (typeof headersWithGet.get === 'function') {
    const value = responseHeaderToString(headersWithGet.get(name))
    if (value !== undefined) {
      return value
    }
  }

  return responseHeaderToString(headers[name.toLowerCase()])
}

// Lazy singleton — defers the turndown → @mixmark-io/domino import (~1.4MB
// retained heap) until the first HTML fetch, and reuses one instance across
// calls (construction builds 15 rule objects; .turndown() is stateless).
// @types/turndown ships only `export =` (no .d.mts), so TS types the import
// as the class itself while Bun wraps CJS in { default } — hence the cast.
type TurndownCtor = typeof import('turndown')
type TurndownNodeLike = {
  nodeName: string
  parentNode: TurndownNodeLike | null
  children: ArrayLike<TurndownNodeLike>
  getAttribute: (name: string) => string | null
  nesting?: { indented: number; underlined: number; code: number }
}

// 2.1.323 #2056: preserve empty table cells instead of dropping them and
// shifting later columns left (aligned with official `Cpt`/`vDn`/`IDn`/`lXr`/`dXr`).
const tableCellContent = new WeakMap<object, string>()
const simpleTableCache = new WeakMap<object, boolean>()
const nestedTableCells = new WeakSet<object>()

function isTableCellNode(node: TurndownNodeLike): boolean {
  return node.nodeName === 'TD' || node.nodeName === 'TH'
}

function findAncestorNode(
  node: TurndownNodeLike,
  predicate: (n: TurndownNodeLike) => boolean,
): TurndownNodeLike | null {
  let cur = node.parentNode
  while (cur && !predicate(cur)) {
    cur = cur.parentNode
  }
  return cur
}

function isSimpleHeaderedTableCell(node: TurndownNodeLike): boolean {
  const table = findAncestorNode(node, n => n.nodeName === 'TABLE')
  if (!table) return false
  let isSimple = simpleTableCache.get(table)
  if (isSimple === undefined) {
    const cells: TurndownNodeLike[] = []
    for (const section of Array.from(table.children)) {
      if (section.nodeName === 'TR') {
        for (const cell of Array.from(section.children)) {
          cells.push(cell)
        }
      } else {
        for (const row of Array.from(section.children)) {
          for (const cell of Array.from(row.children)) {
            cells.push(cell)
          }
        }
      }
    }
    isSimple =
      cells.some(c => c.nodeName === 'TH') &&
      cells.every(
        c =>
          (c.getAttribute('rowspan') ?? '1') === '1' &&
          (c.getAttribute('colspan') ?? '1') === '1',
      )
    simpleTableCache.set(table, isSimple)
    const outerCell = findAncestorNode(table, isTableCellNode)
    if (outerCell) nestedTableCells.add(outerCell)
  }
  return isSimple
}

function replaceTableCell(content: string, node: TurndownNodeLike): string {
  if (isSimpleHeaderedTableCell(node) && !nestedTableCells.has(node)) {
    tableCellContent.set(node, content)
  }
  return `\n\n${content}\n\n`
}

function replaceTableRow(content: string, node: TurndownNodeLike): string {
  const fallback = `\n\n${content}\n\n`
  const cells = Array.from(node.children).filter(isTableCellNode)
  const values = cells.map(cell => tableCellContent.get(cell))
  for (const cell of cells) {
    tableCellContent.delete(cell)
  }
  if (cells.length === 0 || !values.every(v => v !== undefined)) {
    return fallback
  }
  const formatted = values.map(v =>
    (v as string)
      .trim()
      .replace(/ {2}\n/g, '<br>')
      .replace(/\\[\s\S]|\|/g, match => (match === '|' ? '\\|' : match)),
  )
  if (formatted.some(v => /[\r\n]/.test(v))) {
    return fallback
  }
  return formatted.every(v => !v) ? '' : `\n| ${formatted.join(' | ')} |\n`
}

// 2.1.323 #2157: cap pathological nesting depth (aligned with official `uXr`/`cXr`/`pXr`/`mXr`)
// so deeply nested HTML pages convert quickly with bounded memory.
const NESTING_LIMITS = { indented: 12, underlined: 1, code: 1 } as const
const NESTING_CATEGORY = new Map<string, keyof typeof NESTING_LIMITS>([
  ['LI', 'indented'],
  ['BLOCKQUOTE', 'indented'],
  ['H1', 'underlined'],
  ['H2', 'underlined'],
  ['CODE', 'code'],
])
const ZERO_NESTING = { indented: 0, underlined: 0, code: 0 }

function isPastNestingLimit(node: TurndownNodeLike): boolean {
  const parentNesting = node.parentNode?.nesting ?? ZERO_NESTING
  const category = NESTING_CATEGORY.get(node.nodeName)
  if (!category) {
    node.nesting = parentNesting
    return false
  }
  node.nesting = {
    ...parentNesting,
    [category]: parentNesting[category] + 1,
  }
  return parentNesting[category] >= NESTING_LIMITS[category]
}

function replacePastNestingLimit(
  content: string,
  node: TurndownNodeLike,
): string {
  return node.nodeName === 'CODE' ? content : `\n\n${content}\n\n`
}

const MAX_TURNDOWN_INPUT_CHARS = 1_048_576

let turndownServicePromise: Promise<InstanceType<TurndownCtor>> | undefined
function getTurndownService(): Promise<InstanceType<TurndownCtor>> {
  return (turndownServicePromise ??= import('turndown').then(m => {
    const Turndown = (m as unknown as { default: TurndownCtor }).default
    const service = new Turndown()
    service.remove(['style', 'script', 'noscript', 'iframe'])
    service.addRule('tableCell', {
      filter: node => isTableCellNode(node as unknown as TurndownNodeLike),
      replacement: (content, node) =>
        replaceTableCell(content, node as unknown as TurndownNodeLike),
    })
    service.addRule('tableRow', {
      filter: node => node.nodeName === 'TR',
      replacement: (content, node) =>
        replaceTableRow(content, node as unknown as TurndownNodeLike),
    })
    service.addRule('pastNestingLimit', {
      filter: node => isPastNestingLimit(node as unknown as TurndownNodeLike),
      replacement: (content, node) =>
        replacePastNestingLimit(content, node as unknown as TurndownNodeLike),
    })
    return service
  }))
}

/**
 * Converts HTML to Markdown using the configured Turndown instance
 * (2.1.323 #2056 table cell preservation + #2157 nesting cap + 1MiB input cap).
 */
export async function convertHtmlToMarkdown(html: string): Promise<string> {
  try {
    let md = (await getTurndownService()).turndown(
      html.slice(0, MAX_TURNDOWN_INPUT_CHARS),
    )
    if (html.length > MAX_TURNDOWN_INPUT_CHARS) {
      md += '\n\n[Content truncated due to length...]'
    }
    return md
  } catch {
    return html
  }
}

// PSR requested limiting the length of URLs to 250 to lower the potential
// for a data exfiltration. However, this is too restrictive for some customers'
// legitimate use cases, such as JWT-signed URLs (e.g., cloud service signed URLs)
// that can be much longer. We already require user approval for each domain,
// which provides a primary security boundary. In addition, Claude Code has
// other data exfil channels, and this one does not seem relatively high risk,
// so I'm removing that length restriction. -ab
const MAX_URL_LENGTH = 2000

// Per PSR:
// "Implement resource consumption controls because setting limits on CPU,
// memory, and network usage for the Web Fetch tool can prevent a single
// request or user from overwhelming the system."
const MAX_HTTP_CONTENT_LENGTH = 10 * 1024 * 1024

// Timeout for the main HTTP fetch request (60 seconds).
// Prevents hanging indefinitely on slow/unresponsive servers.
// Overridable via settings.webFetchHttpTimeoutMs (set in /web-tools panel).
const DEFAULT_FETCH_TIMEOUT_MS = 60_000
const DEFAULT_WEBFETCH_DEADLINE_MS = 300_000
const MAX_SAFE_TIMEOUT_MS = 2_147_483_647

export function getWebFetchDeadlineMs(): number {
  const envRaw = process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS
  if (envRaw !== undefined) {
    const parsed = Number(envRaw)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.min(parsed, MAX_SAFE_TIMEOUT_MS)
    }
  }
  return DEFAULT_WEBFETCH_DEADLINE_MS
}

function getFetchTimeoutMs(): number {
  const settings = getSettings_DEPRECATED() as Record<string, unknown> & {
    webFetchHttpTimeoutMs?: number
  }
  return settings.webFetchHttpTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS
}

// Cap same-host redirect hops. Without this a malicious server can return
// a redirect loop (/a → /b → /a …) and the per-request timeout
// (controlled by settings.webFetchHttpTimeoutMs)
// resets on every hop, hanging the tool until user interrupt. 10 matches
// common client defaults (axios=5, follow-redirects=21, Chrome=20).
const MAX_REDIRECTS = 10

// Truncate to not spend too many tokens
export const MAX_MARKDOWN_LENGTH = 100_000

export function isPreapprovedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url)
    return isPreapprovedHost(parsedUrl.hostname, parsedUrl.pathname)
  } catch {
    return false
  }
}

export function validateURL(url: string): boolean {
  if (url.length > MAX_URL_LENGTH) {
    return false
  }

  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return false
  }

  // We don't need to check protocol here, as we'll upgrade http to https when making the request

  // As long as we aren't supporting aiming to cookies or internal domains,
  // we should block URLs with usernames/passwords too, even though these
  // seem exceedingly unlikely.
  if (parsed.username || parsed.password) {
    return false
  }

  // Initial filter that this isn't a privileged, company-internal URL
  // by checking that the hostname is publicly resolvable
  const hostname = parsed.hostname
  const parts = hostname.split('.')
  if (parts.length < 2) {
    return false
  }

  return true
}

/**
 * Check if a redirect is safe to follow
 * Allows redirects that:
 * - Add or remove "www." in the hostname
 * - Keep the origin the same but change path/query params
 * - Or both of the above
 */
export function isPermittedRedirect(
  originalUrl: string,
  redirectUrl: string,
): boolean {
  try {
    const parsedOriginal = new URL(originalUrl)
    const parsedRedirect = new URL(redirectUrl)

    if (parsedRedirect.protocol !== parsedOriginal.protocol) {
      return false
    }

    if (parsedRedirect.port !== parsedOriginal.port) {
      return false
    }

    if (parsedRedirect.username || parsedRedirect.password) {
      return false
    }

    // Now check hostname conditions
    // 1. Adding www. is allowed: example.com -> www.example.com
    // 2. Removing www. is allowed: www.example.com -> example.com
    // 3. Same host (with or without www.) is allowed: paths can change
    const stripWww = (hostname: string) => hostname.replace(/^www\./, '')
    const originalHostWithoutWww = stripWww(parsedOriginal.hostname)
    const redirectHostWithoutWww = stripWww(parsedRedirect.hostname)
    return originalHostWithoutWww === redirectHostWithoutWww
  } catch (_error) {
    return false
  }
}

/**
 * Helper function to handle fetching URLs with custom redirect handling
 * Recursively follows redirects if they pass the redirectChecker function
 *
 * Per PSR:
 * "Do not automatically follow redirects because following redirects could
 * allow for an attacker to exploit an open redirect vulnerability in a
 * trusted domain to force a user to make a request to a malicious domain
 * unknowingly"
 */
type RedirectInfo = {
  type: 'redirect'
  originalUrl: string
  redirectUrl: string
  statusCode: number
}

export async function getWithPermittedRedirects(
  url: string,
  signal: AbortSignal,
  redirectChecker: (originalUrl: string, redirectUrl: string) => boolean,
  depth = 0,
  deadlineSignal?: AbortSignal,
): Promise<AxiosResponse<ArrayBuffer> | RedirectInfo> {
  if (deadlineSignal === undefined) {
    const deadlineMs = getWebFetchDeadlineMs()
    if (deadlineMs === 0) {
      return getWithPermittedRedirects(
        url,
        signal,
        redirectChecker,
        depth,
        new AbortController().signal,
      )
    }
    const deadlineController = new AbortController()
    const timer = setTimeout(() => deadlineController.abort(), deadlineMs)
    try {
      return await getWithPermittedRedirects(
        url,
        signal,
        redirectChecker,
        depth,
        deadlineController.signal,
      )
    } finally {
      clearTimeout(timer)
    }
  }
  if (depth > MAX_REDIRECTS) {
    throw new Error(`Too many redirects (exceeded ${MAX_REDIRECTS})`)
  }
  // Official CCR webfetch proxy densable — only on the first hop so redirects
  // re-enter with the absolute redirect URL (which may re-plan).
  let fetchUrl = url
  const headers: Record<string, string> = {
    Accept: 'text/markdown, text/html, */*',
    'User-Agent': getWebFetchUserAgent(),
  }
  if (depth === 0) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { planWebFetchCcrProxy } =
        require('src/utils/ccrProxyGates.js') as typeof import('src/utils/ccrProxyGates.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSessionIngressAuthToken } =
        require('src/utils/sessionIngressAuth.js') as typeof import('src/utils/sessionIngressAuth.js')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getSessionId } =
        require('src/bootstrap/state.js') as typeof import('src/bootstrap/state.js')
      const plan = planWebFetchCcrProxy({
        targetUrl: url,
        sessionId: getSessionId(),
        authToken: getSessionIngressAuthToken(),
      })
      if (plan.useProxy) {
        fetchUrl = plan.fetchUrl
        Object.assign(headers, plan.headers)
      }
    } catch {
      // densable optional
    }
  }
  try {
    return await axios.get(fetchUrl, {
      signal: AbortSignal.any([signal, deadlineSignal]),
      timeout: getFetchTimeoutMs(),
      maxRedirects: 0,
      responseType: 'arraybuffer',
      maxContentLength: MAX_HTTP_CONTENT_LENGTH,
      headers,
    })
  } catch (error) {
    if (
      axios.isAxiosError(error) &&
      error.response &&
      [301, 302, 307, 308].includes(error.response.status)
    ) {
      const redirectLocation = getResponseHeader(
        error.response.headers,
        'location',
      )
      if (!redirectLocation) {
        throw new Error('Redirect missing Location header')
      }

      // Resolve relative URLs against the original URL
      const redirectUrl = new URL(redirectLocation, url).toString()

      if (redirectChecker(url, redirectUrl)) {
        // Recursively follow the permitted redirect
        return getWithPermittedRedirects(
          redirectUrl,
          signal,
          redirectChecker,
          depth + 1,
          deadlineSignal,
        )
      } else {
        // Return redirect information to the caller
        return {
          type: 'redirect',
          originalUrl: url,
          redirectUrl,
          statusCode: error.response.status,
        }
      }
    }

    // Detect egress proxy blocks: the proxy returns 403 with
    // X-Proxy-Error: blocked-by-allowlist when egress is restricted
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 403 &&
      getResponseHeader(error.response.headers, 'x-proxy-error') ===
        'blocked-by-allowlist'
    ) {
      const hostname = new URL(url).hostname
      throw new EgressBlockedError(hostname)
    }

    if (axios.isCancel(error) && deadlineSignal.aborted && !signal.aborted) {
      throw new WebFetchRequestError(
        `Fetch did not complete within the ${getWebFetchDeadlineMs() / 1000}s deadline`,
        'EDEADLINE',
      )
    }

    if (axios.isAxiosError(error) && !axios.isCancel(error)) {
      const isCloudSession = isEnvTruthy(process.env.CLAUDE_CODE_REMOTE)
      const message =
        error.code === 'ENOTFOUND' && isCloudSession
          ? `${error.message}. In this cloud session a host fails to resolve like this when it is outside the session's allowed network domains, or does not exist. If another host has failed the same way, stop trying more sites: carry on without them, and say in your answer that ${new URL(url).hostname} has to be allowed in the session's network settings. Fetch it again only once the user says it is allowed.`
          : error.message
      throw new WebFetchRequestError(message, error.code)
    }

    throw error
  }
}

function isRedirectInfo(
  response: AxiosResponse<ArrayBuffer> | RedirectInfo,
): response is RedirectInfo {
  return 'type' in response && response.type === 'redirect'
}

export type FetchedContent = {
  content: string
  bytes: number
  code: number
  codeText: string
  contentType: string
  persistedPath?: string
  persistedSize?: number
}

export async function getURLMarkdownContent(
  url: string,
  abortController: AbortController,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  // Check cache (LRUCache handles TTL automatically)
  const urlCache = getUrlCache()
  const cachedEntry = urlCache.get(url)
  if (cachedEntry) {
    return {
      bytes: cachedEntry.bytes,
      code: cachedEntry.code,
      codeText: cachedEntry.codeText,
      content: cachedEntry.content,
      contentType: cachedEntry.contentType,
      persistedPath: cachedEntry.persistedPath,
      persistedSize: cachedEntry.persistedSize,
    }
  }

  // Official s_d/a_d (2.1.207): firstParty + WEBFETCH_USE_CCR_PROXY +
  // CLAUDE_CODE_SESSION_ID → session worker web-fetch (before direct HTTP).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      shouldWebFetchUseCcrSessionWorker,
      fetchViaCcrSessionWorker,
      formatCcrProxyToolError,
    } =
      require('src/utils/ccrProxyGates.js') as typeof import('src/utils/ccrProxyGates.js')
    if (shouldWebFetchUseCcrSessionWorker()) {
      const upgraded = url.replace(/^http:\/\//i, 'https://')
      const ccr = await fetchViaCcrSessionWorker({
        url: upgraded,
        signal: abortController.signal,
      })
      if (!ccr.ok) {
        throw new Error(`${formatCcrProxyToolError(ccr)} [web-fetch-ccr-proxy]`)
      }
      if (
        ccr.destinationUrl &&
        !isPermittedRedirect(upgraded, ccr.destinationUrl)
      ) {
        return {
          type: 'redirect',
          originalUrl: upgraded,
          redirectUrl: ccr.destinationUrl,
          statusCode: 302,
        }
      }
      const bytes = Buffer.byteLength(ccr.content, 'utf8')
      const entry: FetchedContent = {
        content: ccr.content,
        bytes,
        code: 200,
        codeText: 'OK',
        contentType: ccr.contentType,
      }
      urlCache.set(url, entry, { size: Math.max(1, bytes) })
      return entry
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('web-fetch-ccr-proxy') ||
        err.message.includes('"error_type"') ||
        err.name === 'AbortError')
    ) {
      throw err
    }
    // densable optional
  }

  let parsedUrl: URL
  let upgradedUrl = url

  try {
    parsedUrl = new URL(url)

    // Upgrade http to https if needed
    if (parsedUrl.protocol === 'http:') {
      parsedUrl.protocol = 'https:'
      upgradedUrl = parsedUrl.toString()
    }

    const hostname = parsedUrl.hostname

    if (process.env.USER_TYPE === 'ant') {
      logEvent('tengu_web_fetch_host', {
        hostname:
          hostname as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  } catch (e) {
    logError(e)
  }

  const response = await getWithPermittedRedirects(
    upgradedUrl,
    abortController.signal,
    isPermittedRedirect,
  )

  // Check if we got a redirect response
  if (isRedirectInfo(response)) {
    return response
  }

  const rawBuffer = Buffer.from(response.data)
  // Release the axios-held ArrayBuffer copy; rawBuffer owns the bytes now.
  // This lets GC reclaim up to MAX_HTTP_CONTENT_LENGTH (10MB) before Turndown
  // builds its DOM tree (which can be 3-5x the HTML size).
  ;(response as { data: unknown }).data = null
  const contentType = getResponseHeader(response.headers, 'content-type') ?? ''

  // Binary content: save raw bytes to disk with a proper extension so Claude
  // can inspect the file later. We still fall through to the utf-8 decode +
  // Haiku path below — for PDFs in particular the decoded string has enough
  // ASCII structure (/Title, text streams) that Haiku can summarize it, and
  // the saved file is a supplement rather than a replacement.
  let persistedPath: string | undefined
  let persistedSize: number | undefined
  if (isBinaryContentType(contentType)) {
    const persistId = `webfetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const result = await persistBinaryContent(rawBuffer, contentType, persistId)
    if (!('error' in result)) {
      persistedPath = result.filepath
      persistedSize = result.size
    }
  }

  const bytes = rawBuffer.length
  const htmlContent = rawBuffer.toString('utf-8')

  let markdownContent: string
  let contentBytes: number
  if (contentType.includes('text/html')) {
    markdownContent = await convertHtmlToMarkdown(htmlContent)
    contentBytes = Buffer.byteLength(markdownContent)
  } else {
    // It's not HTML - just use it raw. The decoded string's UTF-8 byte
    // length equals rawBuffer.length (modulo U+FFFD replacement on invalid
    // bytes — negligible for cache eviction accounting), so skip the O(n)
    // Buffer.byteLength scan.
    markdownContent = htmlContent
    contentBytes = bytes
  }

  // Store the fetched content in cache. Note that it's stored under
  // the original URL, not the upgraded or redirected URL.
  const entry: CacheEntry = {
    bytes,
    code: response.status,
    codeText: response.statusText,
    content: markdownContent,
    contentType,
    persistedPath,
    persistedSize,
  }
  // lru-cache requires positive integers; clamp to 1 for empty responses.
  urlCache.set(url, entry, { size: Math.max(1, contentBytes) })
  return entry
}

/**
 * Fetch URL content via Tavily Extract API, which directly returns Markdown.
 * This skips the HTML→Markdown conversion (turndown) and the secondary
 * model call (queryHaiku) — Tavily already delivers clean Markdown.
 */
export async function fetchContentWithTavily(
  url: string,
  abortController: AbortController,
): Promise<FetchedContent | RedirectInfo> {
  if (!validateURL(url)) {
    throw new Error('Invalid URL')
  }

  // Check cache (LRUCache handles TTL automatically)
  const urlCache = getUrlCache()
  const cachedEntry = urlCache.get(url)
  if (cachedEntry) {
    return {
      bytes: cachedEntry.bytes,
      code: cachedEntry.code,
      codeText: cachedEntry.codeText,
      content: cachedEntry.content,
      contentType: cachedEntry.contentType,
      persistedPath: cachedEntry.persistedPath,
      persistedSize: cachedEntry.persistedSize,
    }
  }

  let parsedUrl: URL
  try {
    parsedUrl = new URL(url)
  } catch {
    throw new Error('Invalid URL')
  }

  // Upgrade http to https if needed
  if (parsedUrl.protocol === 'http:') {
    parsedUrl.protocol = 'https:'
    url = parsedUrl.toString()
  }

  const abortSignal = abortController.signal

  const settings = getSettings_DEPRECATED() as Record<string, unknown> & {
    tavilyEndpointUrl?: string
  }
  const baseUrl = settings.tavilyEndpointUrl || DEFAULT_TAVILY_EXTRACT_URL
  // Derive extract URL from the base Tavily endpoint
  const extractUrl = baseUrl.endsWith('/search')
    ? baseUrl.replace(/\/search$/, '/extract')
    : baseUrl.endsWith('/extract')
      ? baseUrl
      : `${baseUrl.replace(/\/$/, '')}/extract`

  const response = await axios.post<{ url: string; raw_content: string }>(
    extractUrl,
    {
      urls: [url],
    },
    {
      signal: abortSignal,
      timeout: getFetchTimeoutMs(),
      headers: { 'Content-Type': 'application/json' },
    },
  )

  if (abortSignal.aborted) {
    throw new AbortError()
  }

  const rawContent = response.data?.raw_content ?? ''
  // If raw_content is a JSON string (extract may return {url:..., raw_content:...}
  // per URL), unwrap it.
  let markdownContent = rawContent
  if (!markdownContent.trim()) {
    // Try to extract from results array
    const resp = response.data as unknown as {
      results?: Array<{ raw_content?: string }>
    }
    const results = resp.results ?? []
    if (results.length > 0 && results[0].raw_content) {
      markdownContent = results[0].raw_content
    }
  }

  if (!markdownContent.trim()) {
    throw new Error(
      `Tavily Extract returned empty content for ${url}. The page may require authentication or JavaScript rendering.`,
    )
  }

  const contentBytes = Buffer.byteLength(markdownContent)

  const entry: CacheEntry = {
    bytes: contentBytes,
    code: 200,
    codeText: 'OK',
    content: markdownContent,
    contentType: 'text/markdown',
  }
  urlCache.set(url, entry, { size: Math.max(1, contentBytes) })
  return entry
}

/** Surrogate-pair safe slice from character offset (`pa(text, text.length - offset)`). */
export function sliceFromOffset(text: string, offset: number): string {
  if (offset <= 0) return text
  const remaining = text.length - offset
  if (remaining <= 0) return ''
  const sliced = text.slice(-remaining)
  const code = sliced.charCodeAt(0)
  return code >= 0xdc00 && code <= 0xdfff ? sliced.slice(1) : sliced
}

/** Surrogate-pair safe prefix slice (`Z(text, max)`). */
export function sliceToMax(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  const sliced = text.slice(0, max)
  const code = sliced.charCodeAt(max - 1)
  return code >= 0xd800 && code <= 0xdbff ? sliced.slice(0, -1) : sliced
}

/**
 * #720: Pick effort for WebFetch page reads as web searches do:
 * the caller's level on the caller's own model, otherwise the level
 * settings give the small model.
 */
export function resolveWebFetchModelAndEffort(
  callerModel?: string,
  callerEffort?: EffortValue,
): {
  model: string
  useCallerModel: boolean
  effortValue: EffortValue | undefined
} {
  if (callerModel !== undefined) {
    return {
      model: callerModel,
      useCallerModel: true,
      effortValue: callerEffort ?? resolveAppliedEffort(callerModel, undefined),
    }
  }
  const smallModel = getSmallFastModel()
  return {
    model: smallModel,
    useCallerModel: false,
    effortValue: resolveAppliedEffort(smallModel, undefined),
  }
}

export async function applyPromptToMarkdown(
  prompt: string,
  markdownContent: string,
  signal: AbortSignal,
  isNonInteractiveSession: boolean,
  isPreapprovedDomain: boolean,
  contentLead = '',
  callerOptions?: { callerModel?: string; callerEffort?: EffortValue },
): Promise<string> {
  // Truncate content to avoid "Prompt is too long" errors from the secondary model
  const truncatedContent =
    markdownContent.length > MAX_MARKDOWN_LENGTH
      ? sliceToMax(markdownContent, MAX_MARKDOWN_LENGTH) +
        '\n\n[Content truncated due to length...]'
      : markdownContent

  const modelPrompt = makeSecondaryModelPrompt(
    truncatedContent,
    prompt,
    isPreapprovedDomain,
  )
  const { model, useCallerModel, effortValue } = resolveWebFetchModelAndEffort(
    callerOptions?.callerModel,
    callerOptions?.callerEffort,
  )
  const sharedOptions = {
    // densable querySource:"web_fetch_apply" — in swh/FOREGROUND_529 so 529/429
    // get bounded backoff via withRetry (#35).
    querySource: 'web_fetch_apply' as const,
    agents: [],
    isNonInteractiveSession,
    hasAppendSystemPrompt: false,
    mcpTools: [],
    effortValue,
  }
  const assistantMessage = useCallerModel
    ? await queryWithModel({
        systemPrompt: asSystemPrompt([]),
        userPrompt: `${contentLead}${modelPrompt}`,
        signal,
        options: {
          ...sharedOptions,
          model,
        },
      })
    : await queryHaiku({
        systemPrompt: asSystemPrompt([]),
        userPrompt: `${contentLead}${modelPrompt}`,
        signal,
        options: sharedOptions,
      })

  // We need to bubble this up, so that the tool call throws, causing us to return
  // an is_error tool_use block to the server, and render a red dot in the UI.
  if (signal.aborted) {
    throw new AbortError()
  }

  // densable: if (c.isApiErrorMessage) throw new tn($c(c.message.content), "web-fetch-apply-api-error")
  // Avoid returning "API Error: …" overload text as the tool result body (#34).
  if (assistantMessage.isApiErrorMessage) {
    const text =
      getContentText(assistantMessage.message?.content as never) ?? 'API Error'
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      text,
      'web-fetch-apply-api-error',
    )
  }

  // Official 325 #1874: extract all text blocks; never return a synthetic
  // "No response from model" string as page content — fail clearly instead.
  const responseText =
    getContentText(assistantMessage.message?.content as never) ?? ''
  if (responseText.trim() === '') {
    throw new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'The small, fast model that reads the content gave no answer. Trying again may work.',
      'web-fetch-apply-no-answer',
    )
  }
  return responseText
}
