export type SearchRetryStatus = {
  kind: 'retrying' | 'stalled' | 'error' | 'auto_mode_unavailable'
  deadline?: number
  attempt?: number
  maxRetries?: number
  retryInMs?: number
  error?: unknown
}

export interface SearchResult {
  title: string
  url: string
  snippet?: string
}

export interface SearchOptions {
  allowedDomains?: string[]
  blockedDomains?: string[]
  signal?: AbortSignal
  onProgress?: (progress: SearchProgress) => void
  /** Number of search results to return (default: 8) */
  numResults?: number
  /** Live crawl mode (default: 'fallback') */
  livecrawl?: 'fallback' | 'preferred'
  /** Search type (default: 'auto') */
  searchType?: 'auto' | 'fast' | 'deep'
  /** Maximum characters for context string (default: 10000) */
  contextMaxCharacters?: number
}

export interface SearchProgress {
  type: 'query_update' | 'search_results_received' | 'search_retry'
  query?: string
  resultCount?: number
  /** Official 2.1.326 (#175): retry status emitted while WebSearch retries */
  status?: SearchRetryStatus | null
}

export interface WebSearchAdapter {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}
