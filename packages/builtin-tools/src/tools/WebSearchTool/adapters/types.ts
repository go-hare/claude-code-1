import type { ToolUseContext } from 'src/Tool.js'

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
  /**
   * densable WebSearchTool.call(e,t,...) ToolUseContext — used by API adapter
   * for P_ effortValue + Tn getToolPermissionContext (bare mainLoopModel, not X$).
   */
  toolUseContext?: ToolUseContext
}

export interface SearchProgress {
  type: 'query_update' | 'search_results_received'
  query?: string
  resultCount?: number
}

export interface WebSearchAdapter {
  search(query: string, options: SearchOptions): Promise<SearchResult[]>
}
