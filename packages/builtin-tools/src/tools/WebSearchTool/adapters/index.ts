/**
 * Search adapter factory — selects the appropriate backend.
 *
 * Priority (highest first):
 *   1. WEB_SEARCH_ADAPTER environment variable (explicit override)
 *   2. settings.webSearchAdapter (user-configurable via /web-tools)
 *   3. Default: tavily
 */

import { getBootstrapSessionHost, HostSlot } from 'src/utils/sessionHost.js'
import { getSettings_DEPRECATED } from 'src/utils/settings/settings.js'
import { ApiSearchAdapter } from './apiAdapter.js'
import { BingSearchAdapter } from './bingAdapter.js'
import { BraveSearchAdapter } from './braveAdapter.js'
import { ExaSearchAdapter } from './exaAdapter.js'
import { TavilySearchAdapter } from './tavilyAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type {
  SearchResult,
  SearchOptions,
  SearchProgress,
  WebSearchAdapter,
} from './types.js'

export type SearchAdapterKey = 'api' | 'bing' | 'brave' | 'exa' | 'tavily'

type WebSearchAdapterHostCache = {
  cachedAdapter: WebSearchAdapter | null
  cachedAdapterKey: SearchAdapterKey | null
}

const adapterHostCacheSlot = new HostSlot<WebSearchAdapterHostCache>(() => ({
  cachedAdapter: null,
  cachedAdapterKey: null,
}))

export function createAdapter(): WebSearchAdapter {
  const hostCache = adapterHostCacheSlot.of(getBootstrapSessionHost())
  // 1. Explicit env override
  const envAdapter = process.env.WEB_SEARCH_ADAPTER
  // 2. Settings preference (set via /web-tools panel)
  const settingsAdapter = getSettings_DEPRECATED().webSearchAdapter

  const adapterKey: SearchAdapterKey =
    envAdapter === 'api' ||
    envAdapter === 'bing' ||
    envAdapter === 'brave' ||
    envAdapter === 'exa' ||
    envAdapter === 'tavily'
      ? envAdapter
      : settingsAdapter === 'api' ||
          settingsAdapter === 'bing' ||
          settingsAdapter === 'brave' ||
          settingsAdapter === 'exa' ||
          settingsAdapter === 'tavily'
        ? settingsAdapter
        : 'tavily' // 3. Default

  if (hostCache.cachedAdapter && hostCache.cachedAdapterKey === adapterKey) {
    return hostCache.cachedAdapter
  }

  switch (adapterKey) {
    case 'api':
      hostCache.cachedAdapter = new ApiSearchAdapter()
      break
    case 'bing':
      hostCache.cachedAdapter = new BingSearchAdapter()
      break
    case 'brave':
      hostCache.cachedAdapter = new BraveSearchAdapter()
      break
    case 'exa':
      hostCache.cachedAdapter = new ExaSearchAdapter()
      break
    case 'tavily':
    default:
      hostCache.cachedAdapter = new TavilySearchAdapter()
      break
  }

  hostCache.cachedAdapterKey = adapterKey
  return hostCache.cachedAdapter
}
