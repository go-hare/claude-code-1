import axios from 'axios'
import memoize from 'lodash-es/memoize.js'
import { getOauthConfig } from 'src/constants/oauth.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { getClaudeAIOAuthTokens } from 'src/utils/auth.js'
import { getGlobalConfig, saveGlobalConfig } from 'src/utils/config.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isEnvDefinedFalsy } from 'src/utils/envUtils.js'
import { clearMcpAuthCache } from './client.js'
import { claudeAiMcpInitProjectionHeaders } from './claudeAiProxyStateless.js'
import { normalizeNameForMCP } from './normalization.js'
import type { ScopedMcpServerConfig } from './types.js'

type ClaudeAIMcpServerTool = {
  name: string
  /** Official org/admin ceiling: allow | ask | blocked */
  effective_max_permission?: string
}

type ClaudeAIMcpServer = {
  type: 'mcp_server'
  id: string
  display_name: string
  url: string
  created_at: string
  icon_url?: string
  tools?: ClaudeAIMcpServerTool[]
  stateless?: boolean
  cached_init_response?: Record<string, unknown> | null
  discover_support?: 'legacy' | 'supported'
  cached_discover_response?: Record<string, unknown> | null
  /** densable: whether the connector is connected/authorized in claude.ai */
  eligible?: boolean
  eligibility_reason?: string
}

/**
 * densable `Pgs` — session-local set of claude.ai connectors that connected
 * successfully this process (Gsr). Complements persisted ever-connected.
 */
const sessionClaudeAiMcpConnected = new Set<string>()

/**
 * Official Kdg: map claude.ai connector tools → toolPermissions.
 * Invalid values fall back to "blocked" (fail closed).
 */
export function toolPermissionsFromClaudeAiTools(
  tools: ClaudeAIMcpServerTool[] | undefined,
): Record<string, 'allow' | 'ask' | 'blocked'> | undefined {
  if (!tools?.length) return undefined
  // Null-proto: tool names may be Object.prototype keys (`constructor`).
  const out = Object.create(null) as Record<string, 'allow' | 'ask' | 'blocked'>
  for (const t of tools) {
    if (t.effective_max_permission === undefined) continue
    if (
      t.effective_max_permission === 'allow' ||
      t.effective_max_permission === 'ask' ||
      t.effective_max_permission === 'blocked'
    ) {
      out[t.name] = t.effective_max_permission
    } else {
      out[t.name] = 'blocked'
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

type ClaudeAIMcpServersResponse = {
  data: ClaudeAIMcpServer[]
  has_more: boolean
  next_page: string | null
}

const FETCH_TIMEOUT_MS = 5000
const MCP_SERVERS_BETA_HEADER = 'mcp-servers-2025-12-04'

/**
 * Fetches MCP server configurations from Claude.ai org configs.
 * These servers are managed by the organization via Claude.ai.
 *
 * Results are memoized for the session lifetime (fetch once per CLI session).
 */
export const fetchClaudeAIMcpConfigsIfEligible = memoize(
  async (): Promise<Record<string, ScopedMcpServerConfig>> => {
    try {
      if (isEnvDefinedFalsy(process.env.ENABLE_CLAUDEAI_MCP_SERVERS)) {
        logForDebugging('[claudeai-mcp] Disabled via env var')
        logEvent('tengu_claudeai_mcp_eligibility', {
          state:
            'disabled_env_var' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      // Official Ryt densable — any settings source disableClaudeAiConnectors.
      try {
        const { getSettingsForSource } = await import(
          '../../utils/settings/settings.js'
        )
        const { SETTING_SOURCES } = await import(
          '../../utils/settings/constants.js'
        )
        const { isClaudeAiConnectorsDisabledBySources } = await import(
          '../../utils/residualFinalEnvGates.js'
        )
        const disabled = isClaudeAiConnectorsDisabledBySources(
          SETTING_SOURCES.map(
            source => getSettingsForSource(source)?.disableClaudeAiConnectors,
          ),
        )
        if (disabled) {
          logForDebugging(
            '[claudeai-mcp] Disabled via disableClaudeAiConnectors setting',
          )
          logEvent('tengu_claudeai_mcp_eligibility', {
            state:
              'disabled_setting' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          })
          return {}
        }
      } catch {
        // Settings optional — fall through to fetch.
      }

      const tokens = getClaudeAIOAuthTokens()
      if (!tokens?.accessToken) {
        logForDebugging('[claudeai-mcp] No access token')
        logEvent('tengu_claudeai_mcp_eligibility', {
          state:
            'no_oauth_token' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      // Check for user:mcp_servers scope directly instead of isClaudeAISubscriber().
      // In non-interactive mode, isClaudeAISubscriber() returns false when ANTHROPIC_API_KEY
      // is set (even with valid OAuth tokens) because preferThirdPartyAuthentication() causes
      // isAnthropicAuthEnabled() to return false. Checking the scope directly allows users
      // with both API keys and OAuth tokens to access claude.ai MCPs in print mode.
      if (!tokens.scopes?.includes('user:mcp_servers')) {
        logForDebugging(
          `[claudeai-mcp] Missing user:mcp_servers scope (scopes=${tokens.scopes?.join(',') || 'none'})`,
        )
        logEvent('tengu_claudeai_mcp_eligibility', {
          state:
            'missing_scope' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        return {}
      }

      const baseUrl = getOauthConfig().BASE_API_URL
      const url = `${baseUrl}/v1/mcp_servers?limit=1000`

      logForDebugging(`[claudeai-mcp] Fetching from ${url}`)

      const response = await axios.get<ClaudeAIMcpServersResponse>(url, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          'Content-Type': 'application/json',
          'anthropic-beta': MCP_SERVERS_BETA_HEADER,
          'anthropic-version': '2023-06-01',
          ...claudeAiMcpInitProjectionHeaders(),
        },
        timeout: FETCH_TIMEOUT_MS,
      })

      const configs: Record<string, ScopedMcpServerConfig> = {}
      // Track used normalized names to detect collisions and assign (2), (3), etc. suffixes.
      // We check the final normalized name (including suffix) to handle edge cases where
      // a suffixed name collides with another server's base name (e.g., "Example Server 2"
      // colliding with "Example Server! (2)" which both normalize to claude_ai_Example_Server_2).
      const usedNormalizedNames = new Set<string>()

      for (const server of response.data.data) {
        const baseName = `claude.ai ${server.display_name}`

        // Try without suffix first, then increment until we find an unused normalized name
        let finalName = baseName
        let finalNormalized = normalizeNameForMCP(finalName)
        let count = 1
        while (usedNormalizedNames.has(finalNormalized)) {
          count++
          finalName = `${baseName} (${count})`
          finalNormalized = normalizeNameForMCP(finalName)
        }
        usedNormalizedNames.add(finalNormalized)

        const toolPermissions = toolPermissionsFromClaudeAiTools(server.tools)
        configs[finalName] = {
          type: 'claudeai-proxy',
          url: server.url,
          id: server.id,
          displayName: server.display_name,
          iconUrl: server.icon_url,
          scope: 'claudeai',
          ...(toolPermissions ? { toolPermissions } : {}),
          ...(server.stateless !== undefined
            ? { stateless: server.stateless }
            : {}),
          ...(server.cached_init_response !== undefined
            ? { cachedInitResponse: server.cached_init_response }
            : {}),
          ...(server.discover_support !== undefined
            ? { discoverSupport: server.discover_support }
            : {}),
          ...(server.cached_discover_response !== undefined
            ? { cachedDiscoverResponse: server.cached_discover_response }
            : {}),
          // densable: plumb eligible / eligibility_reason for DYo filter
          ...(server.eligible !== undefined
            ? { eligible: server.eligible }
            : {}),
          ...(server.eligibility_reason !== undefined
            ? { ineligibleReason: server.eligibility_reason }
            : {}),
        }
      }

      logForDebugging(
        `[claudeai-mcp] Fetched ${Object.keys(configs).length} servers`,
      )
      logEvent('tengu_claudeai_mcp_eligibility', {
        state:
          'eligible' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      return configs
    } catch {
      logForDebugging(`[claudeai-mcp] Fetch failed`)
      return {}
    }
  },
)

/**
 * Clears the memoized cache for fetchClaudeAIMcpConfigsIfEligible.
 * Call this after login so the next fetch will use the new auth tokens.
 */
export function clearClaudeAIMcpConfigsCache(): void {
  fetchClaudeAIMcpConfigsIfEligible.cache.clear?.()
  // Also clear the auth cache so freshly-authorized servers get re-connected
  clearMcpAuthCache()
}

/**
 * densable `Wsr` — record that a claude.ai connector successfully connected.
 * Idempotent. Updates densable `Pgs` (session) + persisted ever-connected.
 *
 * Gates the "N connectors unavailable/need auth" startup notifications: a
 * connector that was working yesterday and is now failed is a state change
 * worth surfacing; an org-configured connector that's been needs-auth since
 * it showed up is one the user has demonstrably ignored.
 */
export function markClaudeAiMcpConnected(name: string): void {
  sessionClaudeAiMcpConnected.add(name)
  saveGlobalConfig(current => {
    const seen = current.claudeAiMcpEverConnected ?? []
    if (seen.includes(name)) return current
    return { ...current, claudeAiMcpEverConnected: [...seen, name] }
  })
}

/** densable `Vsr` — persisted ever-connected list. */
export function hasClaudeAiMcpEverConnected(name: string): boolean {
  return (getGlobalConfig().claudeAiMcpEverConnected ?? []).includes(name)
}

/** densable `Gsr` — connected successfully this process. */
export function hasClaudeAiMcpSessionConnected(name: string): boolean {
  return sessionClaudeAiMcpConnected.has(name)
}

/** densable `$9u` — clear session set (tests / logout). */
export function clearClaudeAiMcpSessionConnected(): void {
  sessionClaudeAiMcpConnected.clear()
}
