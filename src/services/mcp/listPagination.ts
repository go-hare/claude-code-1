/**
 * Official 2.1.144: paginate MCP list endpoints that return nextCursor.
 * Without this, tools/list (and resources/prompts) only return page 1.
 */

export type CursorListPage<T> = {
  items: T[]
  nextCursor?: string
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
  const maxPages = opts?.maxPages ?? 100
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
