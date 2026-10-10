/**
 * densable 2.1.289 `$n` / `ai` — MCP list pagination clamp.
 *
 * Gold `$n` walks `nextCursor` until missing or `wr=20` pages, then logs
 * "still returning nextCursor after 20 pages; stopping" and returns the
 * partial aggregate (does not throw). Gold `ai` (modern era) uses
 * `Client.listTools` cacheMode refresh; SDK `listMaxPages` default 64 throws
 * `SdkErrorCode.ListPaginationExceeded` — `An` does not retry that throw.
 *
 * `list_pagination_exceeded` is gold `ys[bs.ListPaginationExceeded]` classifier.
 * Gold `fo`/`On` emit `tengu_mcp_list_paginated` (KEEP 遥测) on the `$n`/`ai` hosts.
 */
import {
  IssuerMismatchError,
  ProtocolError,
  ProtocolErrorCode,
  SdkError,
  SdkErrorCode,
} from '@modelcontextprotocol/client'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { AbortError } from '../../utils/errors.js'
import { logMCPError } from '../../utils/log.js'
import { sleep } from '../../utils/sleep.js'
import { getMcpTimeoutMs } from './mcpConnectTimeout.js'

type McpListPaginatedOutcome = 'complete' | 'capped' | 'error'

/**
 * Gold `fo(e,r,n,s)` — `{method, pageCount, itemCount, outcome}`.
 * Never `export function fo`.
 */
function emitMcpListPaginated(
  method: string,
  pageCount: number | undefined,
  itemCount: number,
  outcome: McpListPaginatedOutcome,
): void {
  logEvent('tengu_mcp_list_paginated', {
    method:
      method as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    pageCount,
    itemCount,
    outcome:
      outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Gold `On(e,n,r,s,h="pages")` — `{method, pageCount, itemCount, outcome, source}`.
 * Never `export function On`.
 */
function emitMcpListPaginatedOn(
  method: string,
  pageCount: number | undefined,
  itemCount: number,
  outcome: McpListPaginatedOutcome,
  source: 'pages' | 'aggregate' = 'pages',
): void {
  logEvent('tengu_mcp_list_paginated', {
    method:
      method as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    pageCount,
    itemCount,
    outcome:
      outcome as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    source:
      source as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/** Gold `$n` `wr` / `Dt` `mo`. */
export const MCP_LIST_MAX_PAGES = 20

/** Gold `$n` `Qr` / `Dt` `Tr`. */
export const MCP_LIST_RETRY_DELAYS_MS = [250, 500, 1000] as const

export type CursorListPage<T> = {
  items: T[]
  nextCursor?: string
}

export type McpListRequestClient = {
  request: (
    req: { method: string; params?: { cursor: string } } | { method: string },
    schemaOrOptions?: unknown,
    maybeOptions?: { timeout?: number },
  ) => Promise<{ nextCursor?: string } & Record<string, unknown>>
  listTools?: (
    params: undefined,
    options?: { timeout?: number; cacheMode?: 'refresh' },
  ) => Promise<{ tools: unknown[] }>
  transport?: unknown
}

/**
 * Fetch all pages of a cursor-paginated list.
 * Stops when nextCursor is missing/empty, or after maxPages (safety).
 * Official: logs when a server still returns nextCursor after the page cap.
 */
export async function listAllWithCursorPagination<T>(
  fetchPage: (cursor: string | undefined) => Promise<CursorListPage<T>>,
  opts?: {
    maxPages?: number
    onCapped?: (pages: number) => void
  },
): Promise<T[]> {
  const maxPages = opts?.maxPages ?? MCP_LIST_MAX_PAGES
  const all: T[] = []
  let cursor: string | undefined
  for (let page = 0; page < maxPages; page++) {
    const result = await fetchPage(cursor)
    if (result.items.length > 0) {
      all.push(...result.items)
    }
    const next = result.nextCursor
    if (typeof next !== 'string' || next.length === 0) {
      break
    }
    // Guard against servers that re-emit the same cursor.
    if (next === cursor) {
      break
    }
    // Last allowed page still has a cursor → capped.
    if (page === maxPages - 1) {
      opts?.onCapped?.(maxPages)
      break
    }
    cursor = next
  }
  return all
}

export function isMcpListPaginationExceeded(error: unknown): boolean {
  return (
    error instanceof SdkError &&
    error.code === SdkErrorCode.ListPaginationExceeded
  )
}

/**
 * Gold `An` / `In` — do not retry pagination-exceeded, timeouts, 4xx, abort,
 * ProtocolError JSON-RPC denylist, or a client whose transport is already gone.
 *
 * Gold `An` ProtocolError: retry unless code is -32001 / MethodNotFound /
 * InvalidRequest / InvalidParams / UnsupportedProtocolVersion /
 * MissingRequiredClientCapability.
 */
export function isMcpListRetryable(error: unknown): boolean {
  if (error instanceof AbortError) return false
  // Gold `Ake` — CLAUDEAI_BEARER_REJECTED is not retried (string code, not 4xx).
  if (
    error instanceof Error &&
    'code' in error &&
    (error as { code?: unknown }).code === 'CLAUDEAI_BEARER_REJECTED'
  ) {
    return false
  }
  // Gold `mj` — OAuth issuer mismatch is fatal for the list walk.
  if (error instanceof IssuerMismatchError) return false
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return false
  }
  if (error instanceof SdkError) {
    if (error.code === SdkErrorCode.ListPaginationExceeded) return false
    if (error.code === SdkErrorCode.RequestTimeout) return false
  }
  if (
    error instanceof Error &&
    'status' in error &&
    typeof (error as { status?: unknown }).status === 'number'
  ) {
    const status = (error as { status: number }).status
    if (status >= 400 && status < 500) return false
  }
  if (
    error instanceof Error &&
    !(error instanceof SdkError) &&
    !(error instanceof ProtocolError) &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'number'
  ) {
    const code = (error as { code: number }).code
    if (code >= 400 && code < 500) return false
  }
  if (error instanceof ProtocolError) {
    return (
      error.code !== -32001 &&
      error.code !== ProtocolErrorCode.MethodNotFound &&
      error.code !== ProtocolErrorCode.InvalidRequest &&
      error.code !== ProtocolErrorCode.InvalidParams &&
      error.code !== ProtocolErrorCode.UnsupportedProtocolVersion &&
      error.code !== ProtocolErrorCode.MissingRequiredClientCapability
    )
  }
  return true
}

function isMcpListClientDisconnected(client: { transport?: unknown }): boolean {
  return 'transport' in client && client.transport === undefined
}

/**
 * Gold `$n` — cursor walk + 20-page clamp + 250/500/1000 retry.
 * Capped lists return the partial aggregate (do not throw).
 */
export async function listMcpCursorPages<T>(
  client: McpListRequestClient,
  serverName: string,
  method: string,
  pick: (
    page: { nextCursor?: string } & Record<string, unknown>,
  ) => T[] | undefined,
): Promise<T[]> {
  let loggedError = false
  for (let attempt = 0; ; attempt++) {
    const items: T[] = []
    let cursor: string | undefined
    let pages = 0
    let capped = false
    try {
      do {
        const page = await client.request(
          cursor === undefined ? { method } : { method, params: { cursor } },
          { timeout: getMcpTimeoutMs() },
        )
        pages++
        const chunk = pick(page)
        if (chunk) items.push(...chunk)
        cursor =
          typeof page.nextCursor === 'string' && page.nextCursor.length > 0
            ? page.nextCursor
            : undefined
        if (cursor && pages >= MCP_LIST_MAX_PAGES) {
          capped = true
          break
        }
      } while (cursor)
      if (capped) {
        logMCPError(
          serverName,
          `${method} still returning nextCursor after ${MCP_LIST_MAX_PAGES} pages; stopping`,
        )
      }
      // Gold `fo`: emit when more than one page was walked.
      if (pages > 1) {
        emitMcpListPaginated(
          method,
          pages,
          items.length,
          capped ? 'capped' : 'complete',
        )
      }
      return items
    } catch (error) {
      if (pages > 0 && !loggedError) {
        loggedError = true
        emitMcpListPaginated(method, pages, items.length, 'error')
      }
      const delay = MCP_LIST_RETRY_DELAYS_MS[attempt]
      if (
        delay === undefined ||
        !isMcpListRetryable(error) ||
        isMcpListClientDisconnected(client)
      ) {
        throw error
      }
      logMCPError(
        serverName,
        `${method} failed (${error instanceof Error ? error.message : String(error)}); retrying in ${delay}ms`,
      )
      await sleep(delay)
      if (isMcpListClientDisconnected(client)) throw error
    }
  }
}

/**
 * Gold `ai` — modern-era `listTools` aggregate with the same retry budget.
 * `ListPaginationExceeded` is not retried; caller maps it to toolsListError.
 */
export async function listMcpToolsAggregated(
  client: McpListRequestClient,
  serverName: string,
): Promise<unknown[]> {
  if (typeof client.listTools !== 'function') {
    throw new TypeError('MCP client is missing listTools')
  }
  for (let attempt = 0; ; attempt++) {
    try {
      const result = await client.listTools(undefined, {
        timeout: getMcpTimeoutMs(),
        cacheMode: 'refresh',
      })
      // Gold `On("tools/list", void 0, …, "complete", "aggregate")`.
      emitMcpListPaginatedOn(
        'tools/list',
        undefined,
        result.tools.length,
        'complete',
        'aggregate',
      )
      return result.tools
    } catch (error) {
      if (isMcpListPaginationExceeded(error)) {
        emitMcpListPaginatedOn(
          'tools/list',
          undefined,
          0,
          'capped',
          'aggregate',
        )
      }
      const delay = MCP_LIST_RETRY_DELAYS_MS[attempt]
      if (
        delay === undefined ||
        !isMcpListRetryable(error) ||
        isMcpListClientDisconnected(client)
      ) {
        throw error
      }
      logMCPError(
        serverName,
        `tools/list failed (${error instanceof Error ? error.message : String(error)}); retrying in ${delay}ms`,
      )
      await sleep(delay)
      if (isMcpListClientDisconnected(client)) throw error
    }
  }
}
