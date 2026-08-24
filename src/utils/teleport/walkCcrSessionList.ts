/**
 * densable 2.1.234 #34 — walkCcrSessionList (I5v).
 *
 * SEA:
 *   GET /v1/code/sessions?limit=100&cursor=…
 *   page budget tza=10; soft cap __i=50 when !exhaustive
 *   status.truncated = (pages>=tza && next_cursor!==null)
 *   filter archived / bridge husks / non-interactive titles ($ff / Fff)
 *   CCR_SESSION_ID_RE = /^(?:session|cse)_[A-Za-z0-9_-]+$/
 */

import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { getAPIProvider } from '../model/providers.js'
import { axiosGetWithRetry, getOAuthHeaders, prepareApiRequest } from './api.js'

/** densable tza */
export const CCR_SESSION_LIST_PAGE_BUDGET = 10
/** densable __i / CCR_LIST_TARGET_VISIBLE soft cap when !exhaustive */
export const CCR_LIST_TARGET_VISIBLE = 50
/** densable Nsr */
export const CCR_SESSION_ID_RE = /^(?:session|cse)_[A-Za-z0-9_-]+$/

export type CcrSessionListRow = {
  id: string
  title?: string | null
  status?: string
  worker_status?: string | null
  environment_kind?: string | null
  created_at?: string
  last_event_at?: string | null
}

export type WalkCcrSessionListOptions = {
  status?: { truncated: boolean }
  throwOnError?: boolean
  /** densable exhaustive:!0 — keep paging until budget / no cursor */
  exhaustive?: boolean
  /** when true, keep bridge environment_kind rows (non-husk) */
  includeBridgeKind?: boolean
  /** stop when last row's last_event_at/created_at is older than this ms epoch */
  stopWhenOlderThan?: number
  accept?: (row: CcrSessionListRow) => boolean
}

/** densable Fff — pooled / warming / ditto husk titles */
export function isRemoteSessionHuskTitle(title: string): boolean {
  return (
    title.includes('__CBU_POOLED__') ||
    title === '__warming__' ||
    title.startsWith('ditto:')
  )
}

/** densable $ff / isInteractiveRemoteSession */
export function isInteractiveRemoteSession(row: {
  title?: string | null
}): boolean {
  const t = (row.title ?? '').trim()
  return t !== '' && !isRemoteSessionHuskTitle(t)
}

type CodeSessionsPage = {
  data: CcrSessionListRow[]
  next_cursor?: string | null
}

/**
 * densable I5v — paginated CCR session list with truncated status.
 * Returns [] on gate/provider miss or soft failure (unless throwOnError).
 */
export async function walkCcrSessionList(
  opts: WalkCcrSessionListOptions = {},
): Promise<CcrSessionListRow[]> {
  if (getAPIProvider() !== 'firstParty') {
    if (opts.status) opts.status.truncated = false
    return []
  }
  try {
    const { accessToken } = await prepareApiRequest()
    const base = `${getOauthConfig().BASE_API_URL}/v1/code/sessions`
    const headers = getOAuthHeaders(accessToken)
    const seen = new Set<string>()
    const out: CcrSessionListRow[] = []
    let fetched = 0
    let cursor: string | null = null
    let pages = 0

    for (; pages < CCR_SESSION_LIST_PAGE_BUDGET; pages++) {
      const url = cursor
        ? `${base}?limit=100&cursor=${encodeURIComponent(cursor)}`
        : `${base}?limit=100`
      let response: { data: CodeSessionsPage }
      try {
        response = await axiosGetWithRetry<CodeSessionsPage>(url, {
          headers,
          timeout: 15_000,
        })
      } catch (err) {
        if (opts.throwOnError) throw err
        logForDebugging(
          `[ccr:list] page ${pages} failed (${out.length} rows so far): ${errorMessage(err)}`,
        )
        break
      }

      const rows = response.data?.data ?? []
      fetched += rows.length
      for (const row of rows) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        if (row.status === 'archived') continue
        if (!opts.includeBridgeKind && row.environment_kind === 'bridge') {
          continue
        }
        if (!CCR_SESSION_ID_RE.test(row.id)) continue
        const titleOk =
          opts.includeBridgeKind && row.environment_kind === 'bridge'
            ? !isRemoteSessionHuskTitle((row.title ?? '').trim())
            : isInteractiveRemoteSession(row)
        if (!titleOk) continue
        if (opts.accept && !opts.accept(row)) continue
        out.push(row)
      }

      cursor = response.data?.next_cursor ?? null
      const last = rows.at(-1)
      const lastTs = last
        ? Date.parse(last.last_event_at ?? last.created_at ?? '')
        : Number.NaN
      if (
        !cursor ||
        (!opts.exhaustive && out.length >= CCR_LIST_TARGET_VISIBLE) ||
        (opts.stopWhenOlderThan !== undefined &&
          !Number.isNaN(lastTs) &&
          lastTs < opts.stopWhenOlderThan)
      ) {
        break
      }
    }

    const truncated = pages >= CCR_SESSION_LIST_PAGE_BUDGET && cursor !== null
    if (opts.status) opts.status.truncated = truncated
    logForDebugging(
      `[ccr:list]: ${fetched} fetched, ${out.length} after archive/bridge/husk${opts.accept ? '/accept' : ''} filter${truncated ? ` (TRUNCATED: ${CCR_SESSION_LIST_PAGE_BUDGET}-page budget exhausted with more remaining)` : ''}`,
    )
    return out
  } catch (err) {
    if (opts.throwOnError) throw err
    logForDebugging(`[ccr:list] failed: ${errorMessage(err)}`)
    if (opts.status) opts.status.truncated = false
    return []
  }
}
