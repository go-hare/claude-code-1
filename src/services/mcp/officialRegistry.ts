import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import { logForDebugging } from '../../utils/debug.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { errorMessage } from '../../utils/errors.js'
import { HostSlot, getBootstrapSessionHost } from '../../utils/sessionRoot.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'

/**
 * #2205: Official connector directory response shape (`GET /api/directory/server-urls`).
 * Replaces the legacy `/mcp-registry/v0/servers?version=latest&visibility=commercial`
 * endpoint so OpenTelemetry MCP server name reporting follows the current
 * connector directory.
 */
type DirectoryServerUrlsResponse = {
  urls?: unknown
}

const DEFAULT_DIRECTORY_VISIBILITY = [
  'commercial',
  'private',
  'enterprise',
  'health',
]
const DIRECTORY_FETCH_TIMEOUT_MS = 5000
const DIRECTORY_MAX_CONTENT_LENGTH = 1_048_576

// URLs stripped of credentials, query string, and trailing slash — matches the
// normalization done by getLoggingSafeMcpBaseUrl so direct Set.has() lookup works.
type HostOfficialRegistryState = {
  officialUrls: Set<string> | undefined
  officialUrlsFetchInFlight: Promise<void> | undefined
  officialUrlsFetchAwaitsLookup: boolean
  listableUrlLookedUp: boolean
  urlsRegistryCannotList: Set<string>
}

const hostOfficialRegistrySlot = new HostSlot<HostOfficialRegistryState>(
  () => ({
    officialUrls: undefined,
    officialUrlsFetchInFlight: undefined,
    officialUrlsFetchAwaitsLookup: false,
    listableUrlLookedUp: false,
    urlsRegistryCannotList: new Set<string>(),
  }),
)

function getHostOfficialRegistryState(): HostOfficialRegistryState {
  return hostOfficialRegistrySlot.of(getBootstrapSessionHost())
}

export function normalizeOfficialMcpUrl(url: string): string | undefined {
  try {
    const u = new URL(url)
    u.username = ''
    u.password = ''
    u.search = ''
    return u.toString().replace(/\/$/, '')
  } catch {
    return undefined
  }
}

export function getMcpDirectoryVisibility(): string[] {
  const raw = getFeatureValue_CACHED_MAY_BE_STALE<unknown>(
    'tengu_mcp_directory_visibility',
    DEFAULT_DIRECTORY_VISIBILITY,
  )
  if (Array.isArray(raw) && raw.every(item => typeof item === 'string')) {
    return raw.filter(item => item.length > 0)
  }
  return DEFAULT_DIRECTORY_VISIBILITY
}

export function getOfficialMcpDirectoryUrlsEndpoint(): string {
  const origin = getOauthConfig().CLAUDE_AI_ORIGIN.replace(/\/$/, '')
  return `${origin}/api/directory/server-urls`
}

async function fetchOfficialDirectoryUrlsNow(
  state: HostOfficialRegistryState,
): Promise<void> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)) {
    return
  }

  const source =
    'bff' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  if (getMcpDirectoryVisibility().length === 0) {
    state.officialUrls = new Set<string>()
    logEvent('tengu_mcp_registry_fetch', {
      source,
      success: true,
      url_count: 0,
      duration_ms: 0,
      empty_visibility: true,
    })
    return
  }

  const startMs = Date.now()
  try {
    const endpoint = getOfficialMcpDirectoryUrlsEndpoint()
    const response = await axios.get<DirectoryServerUrlsResponse>(endpoint, {
      timeout: DIRECTORY_FETCH_TIMEOUT_MS,
      maxContentLength: DIRECTORY_MAX_CONTENT_LENGTH,
      maxRedirects: 0,
    })

    const rawUrls = response.data?.urls
    if (
      response.status !== 200 ||
      !Array.isArray(rawUrls) ||
      !rawUrls.every(u => typeof u === 'string')
    ) {
      throw new Error(
        `GET /api/directory/server-urls answered status ${response.status}, not 200 with a list of URLs`,
      )
    }

    const urls = new Set<string>()
    for (const rawUrl of rawUrls) {
      const normalized = normalizeOfficialMcpUrl(rawUrl)
      if (normalized) {
        urls.add(normalized)
      }
    }
    state.officialUrls = urls
    logForDebugging(`[mcp-registry] Loaded ${urls.size} official MCP URLs`)
    logEvent('tengu_mcp_registry_fetch', {
      source,
      success: true,
      url_count: urls.size,
      duration_ms: Date.now() - startMs,
    })
  } catch (error) {
    logForDebugging(`Failed to fetch MCP registry: ${errorMessage(error)}`, {
      level: 'error',
    })
    logEvent('tengu_mcp_registry_fetch', {
      source,
      success: false,
      url_count: 0,
      duration_ms: Date.now() - startMs,
    })
  }
}

/**
 * Fire-and-forget fetch of the current connector directory URLs.
 * Populates `officialUrls` for `isOfficialMcpUrl` OTel server-name lookups.
 */
export async function prefetchOfficialMcpUrls(): Promise<void> {
  if (isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC)) {
    return
  }
  const state = getHostOfficialRegistryState()
  state.officialUrlsFetchAwaitsLookup = false
  state.officialUrlsFetchInFlight ??= fetchOfficialDirectoryUrlsNow(
    state,
  ).finally(() => {
    state.officialUrlsFetchInFlight = undefined
  })
  return state.officialUrlsFetchInFlight
}

/**
 * Returns true iff the given (already-normalized via getLoggingSafeMcpBaseUrl)
 * URL is in the current connector directory. Undefined directory → false (fail-closed),
 * while triggering a deferred fetch if startup deferred until first lookup.
 */
export function isOfficialMcpUrl(normalizedUrl: string): boolean {
  const state = getHostOfficialRegistryState()
  if (state.officialUrls !== undefined) {
    return state.officialUrls.has(normalizedUrl)
  }
  if (
    state.listableUrlLookedUp ||
    state.urlsRegistryCannotList.has(normalizedUrl)
  ) {
    return false
  }
  if (normalizedUrl.startsWith('https://')) {
    state.listableUrlLookedUp = true
    if (state.officialUrlsFetchAwaitsLookup) {
      void prefetchOfficialMcpUrls()
    }
  } else {
    state.urlsRegistryCannotList.add(normalizedUrl)
  }
  return false
}

export function setOfficialMcpUrlsForTesting(
  urls: Iterable<string> | undefined,
): void {
  const state = getHostOfficialRegistryState()
  if (urls === undefined) {
    state.officialUrls = undefined
    return
  }
  const set = new Set<string>()
  for (const u of urls) {
    const normalized = normalizeOfficialMcpUrl(u)
    if (normalized) set.add(normalized)
  }
  state.officialUrls = set
}

export function resetOfficialMcpUrlsForTesting(): void {
  hostOfficialRegistrySlot.drop(getBootstrapSessionHost())
}
