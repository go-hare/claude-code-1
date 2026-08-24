import { homedir } from 'os'
import type { PermissionRule } from 'src/utils/permissions/PermissionRule.js'
import type { SettingsJson } from 'src/utils/settings/types.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { getAllowedSettingSources } from '../../bootstrap/state.js'
import {
  filterMcpServersByPolicy,
  getMcpConfigsByScope,
  shouldAllowManagedMcpServersOnly,
} from '../../services/mcp/config.js'
import { getProjectMcpServerStatusStrict } from '../../services/mcp/utils.js'
import { getCwd } from '../../utils/cwd.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import { SAFE_ENV_VARS } from '../../utils/managedEnvConstants.js'
import { getPermissionRulesForSource } from '../../utils/permissions/permissionsLoader.js'
import { isSourceAllowedByPolicy } from '../../utils/plugins/marketplaceHelpers.js'
import { lookupTrustedMarketplaceAuth } from '../../utils/plugins/marketplaceHeadersHelper.js'
import {
  areHeadersHelperCommandsDisabledByPolicy,
  isPluginBlockedByPolicy,
} from '../../utils/plugins/pluginPolicy.js'
import {
  getSettingsForSource,
  projectSettingsAliasesUserSettings,
} from '../../utils/settings/settings.js'

function hasHooks(settings: SettingsJson | null): boolean {
  if (settings === null || settings.disableAllHooks) {
    return false
  }
  if (settings.statusLine) {
    return true
  }
  if (settings.fileSuggestion) {
    return true
  }
  if (!settings.hooks) {
    return false
  }
  for (const hookConfig of Object.values(settings.hooks)) {
    if (hookConfig.length > 0) {
      return true
    }
  }
  return false
}

export function getHooksSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasHooks(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasHooks(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

function hasBashPermission(rules: PermissionRule[]): boolean {
  return rules.some(
    rule =>
      rule.ruleBehavior === 'allow' &&
      (rule.ruleValue.toolName === BASH_TOOL_NAME ||
        rule.ruleValue.toolName.startsWith(BASH_TOOL_NAME + '(')),
  )
}

/**
 * Get which setting sources have bash allow rules.
 * Returns an array of file paths that have bash permissions.
 */
export function getBashPermissionSources(): string[] {
  const sources: string[] = []

  const projectRules = getPermissionRulesForSource('projectSettings')
  if (hasBashPermission(projectRules)) {
    sources.push('.claude/settings.json')
  }

  const localRules = getPermissionRulesForSource('localSettings')
  if (hasBashPermission(localRules)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have otelHeadersHelper configured
 */
function hasOtelHeadersHelper(settings: SettingsJson | null): boolean {
  return !!settings?.otelHeadersHelper
}

/**
 * Get which setting sources have otelHeadersHelper configured.
 * Returns an array of file paths that have otelHeadersHelper.
 */
export function getOtelHeadersHelperSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasOtelHeadersHelper(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasOtelHeadersHelper(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have apiKeyHelper configured
 */
function hasApiKeyHelper(settings: SettingsJson | null): boolean {
  return !!settings?.apiKeyHelper
}

/**
 * Get which setting sources have apiKeyHelper configured.
 * Returns an array of file paths that have apiKeyHelper.
 */
export function getApiKeyHelperSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasApiKeyHelper(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasApiKeyHelper(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have AWS commands configured
 */
function hasAwsCommands(settings: SettingsJson | null): boolean {
  return !!(settings?.awsAuthRefresh || settings?.awsCredentialExport)
}

/**
 * Get which setting sources have AWS commands configured.
 * Returns an array of file paths that have awsAuthRefresh or awsCredentialExport.
 */
export function getAwsCommandsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasAwsCommands(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasAwsCommands(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have GCP commands configured
 */
function hasGcpCommands(settings: SettingsJson | null): boolean {
  return !!settings?.gcpAuthRefresh
}

/**
 * Get which setting sources have GCP commands configured.
 * Returns an array of file paths that have gcpAuthRefresh.
 */
export function getGcpCommandsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasGcpCommands(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasGcpCommands(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * Check if settings have dangerous environment variables configured.
 * Any env var NOT in SAFE_ENV_VARS is considered dangerous.
 */
function hasDangerousEnvVars(settings: SettingsJson | null): boolean {
  if (!settings?.env) {
    return false
  }
  return Object.keys(settings.env).some(
    key => !SAFE_ENV_VARS.has(key.toUpperCase()),
  )
}

/**
 * Get which setting sources have dangerous environment variables configured.
 * Returns an array of file paths that have env vars not in SAFE_ENV_VARS.
 */
export function getDangerousEnvVarsSources(): string[] {
  const sources: string[] = []

  const projectSettings = getSettingsForSource('projectSettings')
  if (hasDangerousEnvVars(projectSettings)) {
    sources.push('.claude/settings.json')
  }

  const localSettings = getSettingsForSource('localSettings')
  if (hasDangerousEnvVars(localSettings)) {
    sources.push('.claude/settings.local.json')
  }

  return sources
}

/**
 * densable 2.1.238 SEA `LKe` — English list join with optional max items.
 */
export function formatEnglishSourceList(
  items: string[],
  maxItems?: number,
): string {
  if (items.length === 0) {
    return ''
  }
  const limit = maxItems === 0 ? undefined : maxItems
  if (!limit || items.length <= limit) {
    if (items.length === 1) {
      return items[0]!
    }
    if (items.length === 2) {
      return `${items[0]} and ${items[1]}`
    }
    const last = items.at(-1)
    return `${items.slice(0, -1).join(', ')}, and ${last}`
  }
  const shown = items.slice(0, limit)
  const remaining = items.length - limit
  if (shown.length === 1) {
    return `${shown[0]} and ${remaining} more`
  }
  return `${shown.join(', ')}, and ${remaining} more`
}

type ExtraKnownMarketplaceEntry = {
  source?: {
    source?: string
    url?: string
    headersHelper?: string
    plugins?: Array<{
      name?: string
      headersHelper?: string
      source?: { source?: string; url?: string }
    }>
  }
}

/**
 * densable SEA `kBa` — merge operator-tier (`policy`/`flag`/`user`)
 * extraKnownMarketplaces from allowed sources.
 */
function mergeOperatorExtraKnownMarketplaces(): Record<
  string,
  ExtraKnownMarketplaceEntry
> {
  const out: Record<string, ExtraKnownMarketplaceEntry> = {}
  const allowed = new Set(getAllowedSettingSources())
  for (const source of [
    'policySettings',
    'flagSettings',
    'userSettings',
  ] as const) {
    if (!allowed.has(source)) {
      continue
    }
    const extra = getSettingsForSource(source)?.extraKnownMarketplaces
    if (extra) {
      Object.assign(out, extra)
    }
  }
  return out
}

/**
 * densable SEA `IA0` — url marketplace already declared in operator settings
 * (policy/flag named key) or trusted via non-repo `ret`/`JKp`.
 */
function isUrlMarketplaceAlreadyOperatorTrusted(
  marketplaceName: string,
  url: string,
): boolean {
  const allowed = new Set(getAllowedSettingSources())
  for (const source of ['policySettings', 'flagSettings'] as const) {
    if (
      allowed.has(source) &&
      Object.hasOwn(
        getSettingsForSource(source)?.extraKnownMarketplaces ?? {},
        marketplaceName,
      )
    ) {
      return true
    }
  }
  const trusted = lookupTrustedMarketplaceAuth(
    { source: 'url', url },
    marketplaceName,
  )
  return trusted !== undefined && trusted.authoredBy !== 'repo'
}

/**
 * densable SEA `PA0` — settings-source marketplace name already present in
 * operator-tier merged extraKnownMarketplaces.
 */
function isSettingsMarketplaceAlreadyOperatorKnown(
  marketplaceName: string,
): boolean {
  return Object.hasOwn(mergeOperatorExtraKnownMarketplaces(), marketplaceName)
}

/**
 * densable SEA `BSy` — project/local extraKnownMarketplaces declares a
 * headersHelper that is not already operator-trusted / known.
 * Compares against `localSettings` when checking project (SEA `BSy(e,t)`).
 */
export function settingsDeclareUntrustedMarketplaceHeadersHelper(
  settings: SettingsJson | null,
  localSettings?: SettingsJson | null,
): boolean {
  if (areHeadersHelperCommandsDisabledByPolicy()) {
    return false
  }
  const localExtra = localSettings?.extraKnownMarketplaces ?? {}
  const entries = Object.entries(settings?.extraKnownMarketplaces ?? {})
  return entries.some(([name, entry]) => {
    if (Object.hasOwn(localExtra, name)) {
      return false
    }
    const source = (entry as ExtraKnownMarketplaceEntry | undefined)?.source
    if (!source || typeof source !== 'object') {
      return false
    }
    if (source.source === 'url') {
      if (
        !source.headersHelper ||
        typeof source.url !== 'string' ||
        !/^https:\/\//i.test(source.url)
      ) {
        return false
      }
      const marketplaceSource = {
        source: 'url' as const,
        url: source.url,
        headersHelper: source.headersHelper,
      }
      if (!isSourceAllowedByPolicy(marketplaceSource)) {
        return false
      }
      return !isUrlMarketplaceAlreadyOperatorTrusted(name, source.url)
    }
    if (source.source === 'settings') {
      const marketplaceSource = {
        source: 'settings' as const,
        name,
        plugins: (source.plugins ?? []) as never,
      }
      if (!isSourceAllowedByPolicy(marketplaceSource as never)) {
        return false
      }
      if (isSettingsMarketplaceAlreadyOperatorKnown(name)) {
        return false
      }
      return (source.plugins ?? []).some(plugin => {
        if (!plugin?.headersHelper) {
          return false
        }
        if (
          typeof plugin.source !== 'object' ||
          plugin.source?.source !== 'archive'
        ) {
          return false
        }
        const pluginId = `${plugin.name ?? ''}@${name}`
        return !isPluginBlockedByPolicy(pluginId)
      })
    }
    return false
  })
}

/**
 * densable SEA `aRs` — marketplaceHelperSources for TrustDialog.
 * Home directory → []. Project path only when it does not alias userSettings.
 */
export function getMarketplaceHelperSources(): string[] {
  if (homedir() === getCwd()) {
    return []
  }
  const allowed = getAllowedSettingSources()
  const localSettings = allowed.includes('localSettings')
    ? getSettingsForSource('localSettings')
    : null
  const sources: string[] = []
  if (
    allowed.includes('projectSettings') &&
    !projectSettingsAliasesUserSettings() &&
    settingsDeclareUntrustedMarketplaceHeadersHelper(
      getSettingsForSource('projectSettings'),
      localSettings,
    )
  ) {
    sources.push('.claude/settings.json')
  }
  if (settingsDeclareUntrustedMarketplaceHeadersHelper(localSettings)) {
    sources.push('.claude/settings.local.json')
  }
  return sources
}

/**
 * densable SEA `USy` — project/local MCP configs declare headersHelper.
 * Skips enterprise managed-only lock; project rejected servers excluded.
 * Tip has no SEA `mje`/`B$` host wiring — use managed-only gate only.
 */
function scopeDeclaresMcpHeadersHelper(scope: 'project' | 'local'): boolean {
  if (shouldAllowManagedMcpServersOnly()) {
    return false
  }
  const { servers } = getMcpConfigsByScope(scope)
  return Object.entries(servers).some(([name, config]) => {
    const headersHelper = (config as { headersHelper?: string }).headersHelper
    if (!headersHelper) {
      return false
    }
    if (
      scope === 'project' &&
      getProjectMcpServerStatusStrict(name) === 'rejected'
    ) {
      return false
    }
    const { allowed } = filterMcpServersByPolicy({ [name]: config })
    return Object.hasOwn(allowed, name)
  })
}

/**
 * densable SEA `sRs` — repoHelperSources = marketplace + MCP HH paths.
 */
export function getRepoHeadersHelperSources(
  marketplaceHelperSources: string[] = getMarketplaceHelperSources(),
): string[] {
  const sources = [...marketplaceHelperSources]
  if (scopeDeclaresMcpHeadersHelper('project')) {
    sources.push('.mcp.json')
  }
  if (scopeDeclaresMcpHeadersHelper('local')) {
    sources.push(
      `${getGlobalClaudeFile()} (local-scope MCP servers for this project)`,
    )
  }
  return sources
}
