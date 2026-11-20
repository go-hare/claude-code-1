import { basename } from 'path'
import type { Message } from 'src/types/message.js'

export type ArtifactInfo = {
  toolUseId: string
  filePath: string
  basename: string
  hash?: string
  url?: string
  expiresAt?: string
  rawContent: string
  isError: boolean
}

const URL_REGEX = /https?:\/\/[^\s)"',]+\.html\b/
const ID_REGEX = /\bid:\s*([A-Za-z0-9_-]+)/
const EXPIRES_REGEX = /\bexpires:\s*([0-9T:.Z+-]+)/

export function extractArtifacts(messages: Message[]): ArtifactInfo[] {
  const results: ArtifactInfo[] = []

  for (const message of messages) {
    if (message.type !== 'assistant') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      if (!('type' in block)) continue
      const b = block as unknown as Record<string, unknown>
      if (b.type !== 'tool_use') continue
      if (b.name !== 'artifact' && b.name !== 'Artifact') continue

      const toolUseId = b.id as string
      const input = b.input as { file_path?: string } | undefined
      const filePath = input?.file_path ?? '<unknown>'

      const resultBlock = findToolResult(messages, toolUseId)
      if (!resultBlock) continue

      const rawContent =
        typeof resultBlock.content === 'string'
          ? resultBlock.content
          : Array.isArray(resultBlock.content)
            ? resultBlock.content
                .map(c =>
                  typeof c === 'string'
                    ? c
                    : 'text' in c
                      ? (c as { text: string }).text
                      : '',
                )
                .join('')
            : ''

      const isError = resultBlock.is_error === true
      const urlMatch = rawContent.match(URL_REGEX)
      const idMatch = rawContent.match(ID_REGEX)
      const expiresMatch = rawContent.match(EXPIRES_REGEX)

      results.push({
        toolUseId,
        filePath,
        basename: basename(filePath),
        hash: idMatch?.[1],
        url: urlMatch?.[0],
        expiresAt: expiresMatch?.[1],
        rawContent,
        isError,
      })
    }
  }

  // newest first
  return results.reverse()
}

export type ArtifactPageResponse<T> =
  | { served: true; rows: T[]; nextPageToken?: string }
  | {
      served: false
      reason?: string
      status?: number
      retryAfterMs?: number
    }

export type PaginatedArtifactsResult<T> = {
  items: T[]
  incomplete: boolean
  pagesFetched: number
  lastError?: string
}

const DEFAULT_RETRY_DELAYS_MS = [500, 1500]
const MAX_RETRY_DELAY_MS = 10_000

function isRetryableArtifactPageFailure(
  res: Extract<ArtifactPageResponse<unknown>, { served: false }>,
): boolean {
  if (res.reason === 'request_error') return true
  const s = res.status
  return s !== undefined && (s === 408 || s === 429 || (s >= 500 && s < 600))
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  if (signal?.aborted) return Promise.resolve()
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Official 2.1.327 (#422) `mr` / `dr`: fetch paginated cloud artifacts with
 * retry on transient failures (network/408/429/5xx). Never silently claims
 * "No artifacts yet" or hides truncation: sets `incomplete: true` whenever any
 * page fails after retries or `nextPageToken` remains unread.
 */
export async function fetchPaginatedArtifacts<
  T extends { id?: string; slug?: string },
>(opts: {
  fetchPage: (
    pageToken: string | undefined,
    signal?: AbortSignal,
  ) => Promise<ArtifactPageResponse<T>>
  signal?: AbortSignal
  maxPages?: number
  retryDelaysMs?: number[]
  onProgress?: (items: T[]) => void
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
}): Promise<PaginatedArtifactsResult<T>> {
  const maxPages = opts.maxPages ?? 20
  const retryDelays = opts.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS
  const sleep = opts.sleep ?? abortableDelay
  const seen = new Set<string>()
  const items: T[] = []

  const mergeRows = (rows: T[]) => {
    for (const row of rows) {
      const key = row.slug ?? row.id
      if (key !== undefined) {
        if (seen.has(key)) continue
        seen.add(key)
      }
      items.push(row)
    }
  }

  const fetchWithRetries = async (
    pageToken: string | undefined,
  ): Promise<ArtifactPageResponse<T>> => {
    let res = await opts.fetchPage(pageToken, opts.signal)
    for (const baseMs of retryDelays) {
      if (res.served || opts.signal?.aborted) break
      if (!isRetryableArtifactPageFailure(res)) break
      const waitMs = Math.min(
        Math.max(baseMs, res.retryAfterMs ?? 0),
        MAX_RETRY_DELAY_MS,
      )
      await sleep(waitMs, opts.signal)
      if (opts.signal?.aborted) break
      res = await opts.fetchPage(pageToken, opts.signal)
    }
    return res
  }

  let pagesFetched = 0
  let pageToken: string | undefined
  let lastRes: ArtifactPageResponse<T> | undefined

  while (pagesFetched < maxPages && !opts.signal?.aborted) {
    lastRes = await fetchWithRetries(pageToken)
    if (!lastRes.served) {
      return {
        items,
        incomplete: true,
        pagesFetched,
        lastError:
          lastRes.reason ??
          (lastRes.status !== undefined ? `HTTP ${lastRes.status}` : 'failed'),
      }
    }
    pagesFetched++
    mergeRows(lastRes.rows)
    opts.onProgress?.([...items])
    if (lastRes.nextPageToken === undefined) {
      return { items, incomplete: false, pagesFetched }
    }
    pageToken = lastRes.nextPageToken
  }

  const incomplete =
    !lastRes || !lastRes.served || lastRes.nextPageToken !== undefined
  return { items, incomplete, pagesFetched }
}

function findToolResult(
  messages: Message[],
  toolUseId: string,
): { content: unknown; is_error?: boolean } | null {
  for (const message of messages) {
    if (message.type !== 'user') continue
    const content = message.message?.content
    if (!Array.isArray(content)) continue

    for (const block of content) {
      if (typeof block !== 'object' || block === null) continue
      if (!('type' in block)) continue
      const b = block as unknown as Record<string, unknown>
      if (b.type !== 'tool_result') continue
      if (b.tool_use_id !== toolUseId) continue
      return { content: b.content, is_error: b.is_error as boolean | undefined }
    }
  }
  return null
}
