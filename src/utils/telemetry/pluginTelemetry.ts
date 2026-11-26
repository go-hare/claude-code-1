/**
 * Plugin telemetry helpers — shared field builders for plugin lifecycle events.
 *
 * Implements the twin-column privacy pattern: every user-defined-name field
 * emits both a raw value (routed to PII-tagged _PROTO_* BQ columns) and a
 * redacted twin (real name iff marketplace ∈ allowlist, else 'third-party').
 *
 * plugin_id_hash provides an opaque per-plugin aggregation key with no privacy
 * dependency — sha256(name@marketplace + FIXED_SALT) truncated to 16 chars.
 * This answers distinct-count and per-plugin-trend questions that the
 * redacted column can't, without exposing user-defined names.
 */

import { createHash } from 'crypto'
import { sep } from 'path'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
  logEvent,
} from '../../services/analytics/index.js'
import type {
  LoadedPlugin,
  PluginError,
  PluginManifest,
} from '../../types/plugin.js'
import {
  isOfficialMarketplaceName,
  parsePluginIdentifier,
} from '../plugins/pluginIdentifier.js'
import { SERVER_PLUGIN_ID_RE } from '../plugins/syncedPluginHydrate.js'
import { HostSlot } from '../hostSlot.js'
import { getBootstrapSessionHost } from '../sessionRoot.js'

// builtinPlugins.ts:BUILTIN_MARKETPLACE_NAME — inlined to avoid the cycle
// through commands.js. Marketplace schemas.ts enforces 'builtin' is reserved.
const BUILTIN_MARKETPLACE_NAME = 'builtin'

// Fixed salt for plugin_id_hash. Same constant across all repos and emission
// sites. Not per-org, not rotated — per-org salt would defeat cross-org
// distinct-count, rotation would break trend lines. Customers can compute the
// same hash on their known plugin names to reverse-match their own telemetry.
const PLUGIN_ID_HASH_SALT = 'claude-plugin-telemetry-v1'

/**
 * Opaque per-plugin aggregation key. Input is the name@marketplace string as
 * it appears in enabledPlugins keys, lowercased on the marketplace suffix for
 * reproducibility. 16-char truncation keeps BQ GROUP BY cardinality manageable
 * while making collisions negligible at projected 10k-plugin scale. Name case
 * is preserved in both branches (enabledPlugins keys are case-sensitive).
 */
export function hashPluginId(name: string, marketplace?: string): string {
  const key = marketplace ? `${name}@${marketplace.toLowerCase()}` : name
  return createHash('sha256')
    .update(key + PLUGIN_ID_HASH_SALT)
    .digest('hex')
    .slice(0, 16)
}

/**
 * densable QMe / GG — sanitized command_name plus skill_name_hash.
 * Hash is sha256(canonicalName + claude-plugin-telemetry-v1) first 16 hex,
 * and only when the sanitized name is "custom" (Jxg).
 */
export function sanitizeSkillNameForTelemetry(input: {
  rawName: string
  canonicalName: string
  isMcp: boolean
  isBuiltIn: boolean
  isBundled: boolean
  isOfficial: boolean
}): {
  sanitizedName: string
  skillNameHash: {
    skill_name_hash?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  }
} {
  const sanitizedName = input.isMcp
    ? 'mcp'
    : input.isBuiltIn || input.isBundled || input.isOfficial
      ? input.rawName
      : 'custom'
  if (sanitizedName !== 'custom') {
    return { sanitizedName, skillNameHash: {} }
  }
  return {
    sanitizedName,
    skillNameHash: {
      skill_name_hash: hashPluginId(
        input.canonicalName,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    },
  }
}

/**
 * 4-value scope enum for plugin origin. Distinct from PluginScope
 * (managed/user/project/local) which is installation-target — this is
 * marketplace-origin.
 *
 * - official: from an allowlisted Anthropic marketplace
 * - default-bundle: ships with product (@builtin), auto-enabled
 * - org: enterprise admin-pushed via managed settings (policySettings)
 * - user-local: user added marketplace or local plugin
 */
export type TelemetryPluginScope =
  | 'official'
  | 'org'
  | 'user-local'
  | 'default-bundle'

export function getTelemetryPluginScope(
  name: string,
  marketplace: string | undefined,
  managedNames: Set<string> | null,
): TelemetryPluginScope {
  if (marketplace === BUILTIN_MARKETPLACE_NAME) return 'default-bundle'
  if (isOfficialMarketplaceName(marketplace)) return 'official'
  if (managedNames?.has(name)) return 'org'
  return 'user-local'
}

/**
 * How a plugin arrived in the session. Splits self-selected from org-pushed
 * — plugin_scope alone doesn't (an official plugin can be user-installed OR
 * org-pushed; both are scope='official').
 */
export type EnabledVia =
  | 'user-install'
  | 'org-policy'
  | 'default-enable'
  | 'admin-install'
  | 'seed-mount'

/** How a skill/command invocation was triggered. */
export type InvocationTrigger =
  | 'user-slash'
  | 'claude-proactive'
  | 'nested-skill'

/** Where a skill invocation executes. */
export type SkillExecutionContext = 'fork' | 'inline' | 'remote'

/** How a plugin install was initiated. */
export type InstallSource =
  | 'cli-explicit'
  | 'ui-discover'
  | 'ui-suggestion'
  | 'deep-link'

export function getEnabledVia(
  plugin: LoadedPlugin,
  managedNames: Set<string> | null,
  seedDirs: string[],
): EnabledVia {
  if (plugin.isBuiltin) return 'default-enable'
  if (managedNames?.has(plugin.name)) return 'org-policy'
  // densable hyo: required | auto_install → admin-install
  if (
    plugin.installationPreference === 'required' ||
    plugin.installationPreference === 'auto_install'
  ) {
    return 'admin-install'
  }
  // Trailing sep: /opt/plugins must not match /opt/plugins-extra
  if (
    seedDirs.some(dir =>
      plugin.path.startsWith(dir.endsWith(sep) ? dir : dir + sep),
    )
  ) {
    return 'seed-mount'
  }
  return 'user-install'
}

/**
 * Common plugin telemetry fields keyed off name@marketplace. Returns the
 * hash, scope enum, and the redacted-twin columns. Callers add the raw
 * _PROTO_* fields separately (those require the PII-tagged marker type).
 */
export function buildPluginTelemetryFields(
  name: string,
  marketplace: string | undefined,
  managedNames: Set<string> | null = null,
): {
  plugin_id_hash: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_scope: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  plugin_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  marketplace_name_redacted: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  is_official_plugin: boolean
} {
  const scope = getTelemetryPluginScope(name, marketplace, managedNames)
  // Both official marketplaces and builtin plugins are Anthropic-controlled
  // — safe to expose real names in the redacted columns.
  const isAnthropicControlled =
    scope === 'official' || scope === 'default-bundle'
  return {
    plugin_id_hash: hashPluginId(
      name,
      marketplace,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_scope:
      scope as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_name_redacted: (isAnthropicControlled
      ? name
      : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    marketplace_name_redacted: (isAnthropicControlled && marketplace
      ? marketplace
      : 'third-party') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    is_official_plugin: isAnthropicControlled,
  }
}

/**
 * Per-invocation callers (SkillTool, processSlashCommand) pass
 * managedNames=null — the session-level tengu_plugin_enabled_for_session
 * event carries the authoritative plugin_scope, and per-invocation rows can
 * join on plugin_id_hash to recover it. This keeps hot-path call sites free
 * of the extra settings read.
 */
/**
 * densable `Vsn` — `_Ae`=`Nl.test`; emit raw id through Eu (not sha256).
 * `h1` salt-hash is only `plugin_id_hash`.
 */
export function telemetryServerPluginId(
  serverPluginId: string | undefined,
): AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS | undefined {
  if (
    serverPluginId === undefined ||
    !SERVER_PLUGIN_ID_RE.test(serverPluginId)
  ) {
    return
  }
  return serverPluginId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
}

export function buildPluginCommandTelemetryFields(
  pluginInfo: {
    pluginManifest: PluginManifest
    repository: string
    serverPluginId?: string
  },
  managedNames: Set<string> | null = null,
): ReturnType<typeof buildPluginTelemetryFields> & {
  server_plugin_id?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
} {
  const { marketplace } = parsePluginIdentifier(pluginInfo.repository)
  const serverPluginId = telemetryServerPluginId(pluginInfo.serverPluginId)
  return {
    ...buildPluginTelemetryFields(
      pluginInfo.pluginManifest.name,
      marketplace,
      managedNames,
    ),
    ...(serverPluginId !== undefined && { server_plugin_id: serverPluginId }),
  }
}

/**
 * Emit tengu_plugin_enabled_for_session once per enabled plugin at session
 * start. Supplements tengu_skill_loaded (which still fires per-skill) — use
 * this for plugin-level aggregates instead of DISTINCT-on-prefix hacks.
 * A plugin with 5 skills emits 5 skill_loaded rows but 1 of these.
 */
/** densable 2.1.246 ast(name, repoMkt) ?? repoMkt — Nsn remap on the plugin. */
export function telemetryMarketplaceForPlugin(
  plugin: LoadedPlugin,
): string | undefined {
  return (
    plugin.marketplaceName ??
    parsePluginIdentifier(plugin.repository).marketplace
  )
}

export function logPluginsEnabledForSession(
  plugins: LoadedPlugin[],
  managedNames: Set<string> | null,
  seedDirs: string[],
): void {
  for (const plugin of plugins) {
    const marketplace = telemetryMarketplaceForPlugin(plugin)
    const serverPluginId = telemetryServerPluginId(plugin.serverPluginId)
    const scope = getTelemetryPluginScope(
      plugin.name,
      marketplace,
      managedNames,
    )
    if (
      (scope === 'official' || scope === 'default-bundle') &&
      marketplace !== undefined
    ) {
      registerFirstPartyPluginForAttribution(plugin.name, marketplace)
    }

    logEvent('tengu_plugin_enabled_for_session', {
      _PROTO_plugin_name:
        plugin.name as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      ...buildPluginTelemetryFields(plugin.name, marketplace, managedNames),
      ...(serverPluginId !== undefined && { server_plugin_id: serverPluginId }),
      enabled_via: getEnabledVia(
        plugin,
        managedNames,
        seedDirs,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      skill_path_count:
        (plugin.skillsPath ? 1 : 0) + (plugin.skillsPaths?.length ?? 0),
      command_path_count:
        (plugin.commandsPath ? 1 : 0) + (plugin.commandsPaths?.length ?? 0),
      has_mcp: plugin.manifest.mcpServers !== undefined,
      has_hooks:
        plugin.hooksConfig !== undefined || plugin.modulePath !== undefined,
      ...(plugin.manifest.version && {
        version: plugin.manifest
          .version as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
    })
  }
}

/**
 * Bounded-cardinality error bucket for CLI plugin operation failures.
 * Maps free-form error messages to 5 stable categories so dashboard
 * GROUP BY stays tractable.
 */
export type PluginCommandErrorCategory =
  | 'network'
  | 'not-found'
  | 'permission'
  | 'validation'
  | 'unknown'

export function classifyPluginCommandError(
  error: unknown,
): PluginCommandErrorCategory {
  const msg = String((error as { message?: unknown })?.message ?? error)
  if (
    /ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|ECONNRESET|network|Could not resolve|Connection refused|timed out/i.test(
      msg,
    )
  ) {
    return 'network'
  }
  if (/\b404\b|not found|does not exist|no such plugin/i.test(msg)) {
    return 'not-found'
  }
  if (/\b40[13]\b|EACCES|EPERM|permission denied|unauthorized/i.test(msg)) {
    return 'permission'
  }
  if (/invalid|malformed|schema|validation|parse error/i.test(msg)) {
    return 'validation'
  }
  return 'unknown'
}

/**
 * Emit tengu_plugin_load_failed once per error surfaced by session-start
 * plugin loading. Pairs with tengu_plugin_enabled_for_session so dashboards
 * can compute a load-success rate. PluginError.type is already a bounded
 * enum — use it directly as error_category.
 */
export function logPluginLoadErrors(
  errors: PluginError[],
  managedNames: Set<string> | null,
): void {
  for (const err of errors) {
    const { name, marketplace } = parsePluginIdentifier(err.source)
    // Not all PluginError variants carry a plugin name (some have pluginId,
    // some are marketplace-level). Use the 'plugin' property if present,
    // fall back to the name parsed from err.source.
    const pluginName = 'plugin' in err && err.plugin ? err.plugin : name
    logEvent('tengu_plugin_load_failed', {
      error_category:
        err.type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      _PROTO_plugin_name:
        pluginName as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      ...(marketplace && {
        _PROTO_marketplace_name:
          marketplace as AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED,
      }),
      ...buildPluginTelemetryFields(pluginName, marketplace, managedNames),
    })
  }
}

/**
 * In-process registry of loaded official / default-bundle plugins -> marketplace
 * name, mirroring official `fPa` / `_r().firstPartyPlugins` (@282347000).
 */
const firstPartyPluginsHostSlot = new HostSlot<Map<string, string>>(
  () => new Map<string, string>(),
)

function getFirstPartyPluginsRegistry(): Map<string, string> {
  return firstPartyPluginsHostSlot.of(getBootstrapSessionHost())
}

export function registerFirstPartyPluginForAttribution(
  pluginName: string,
  marketplaceName: string,
): void {
  getFirstPartyPluginsRegistry().set(pluginName, marketplaceName)
}

export function getFirstPartyPluginsForAttribution(): ReadonlyMap<
  string,
  string
> {
  return getFirstPartyPluginsRegistry()
}

export function clearFirstPartyPluginsForAttributionForTests(): void {
  getFirstPartyPluginsRegistry().clear()
}

export type OTelAttributionInput = {
  attributionAgent?: string
  attributionSkill?: string
  attributionPlugin?: string
  attributionMcpServer?: string
  attributionMcpTool?: string
}

/**
 * Official `Mu(s)` (@282347600): extract the plugin namespace prefix before
 * the first `:` in a skill or agent name (`plugin:item` -> `plugin`).
 * User-defined subagents without a plugin prefix return `undefined`.
 */
export function extractAttributionPluginPrefix(
  name: string | undefined,
): string | undefined {
  if (!name) return undefined
  const idx = name.indexOf(':')
  return idx > 0 ? name.slice(0, idx) : undefined
}

/**
 * Official `x5` + `Lc` (@282347500): derive raw attribution fields from
 * `querySource` (`agent:builtin:<name>` / `agent:custom:<name>`) and optional
 * active skill/plugin context.
 */
export function deriveAttributionFromQuerySource(
  querySource: string | undefined,
  activeSkill?: string,
  explicitPlugin?: string,
): OTelAttributionInput {
  const withSkill = (
    skill: string | undefined,
    fallbackPlugin?: string,
  ): OTelAttributionInput => {
    if (!skill) {
      return fallbackPlugin ? { attributionPlugin: fallbackPlugin } : {}
    }
    const plugin = extractAttributionPluginPrefix(skill) ?? fallbackPlugin
    return {
      attributionSkill: skill,
      ...(plugin ? { attributionPlugin: plugin } : {}),
    }
  }

  if (!querySource) return {}
  if (querySource.startsWith('agent:builtin:')) {
    return {
      attributionAgent: querySource.slice('agent:builtin:'.length),
      ...withSkill(activeSkill, explicitPlugin),
    }
  }
  if (querySource.startsWith('agent:custom:')) {
    const agentName = querySource.slice('agent:custom:'.length)
    return {
      attributionAgent: agentName,
      ...withSkill(
        activeSkill,
        explicitPlugin ?? extractAttributionPluginPrefix(agentName),
      ),
    }
  }
  if (querySource.startsWith('agent:')) {
    return withSkill(activeSkill, explicitPlugin)
  }
  if (activeSkill || explicitPlugin) {
    return withSkill(activeSkill, explicitPlugin)
  }
  return {}
}

/**
 * Official 2.1.323 (#2126, `aI` @282350766):
 * Redact attribution fields for OpenTelemetry export.
 *
 * Critically, for non-builtin agents (`!querySource?.startsWith('agent:builtin:')`),
 * `agent.name` is only kept unredacted when BOTH the active `attributionPlugin`
 * is a first-party plugin AND the agent's own plugin prefix
 * (`extractAttributionPluginPrefix(attributionAgent)`) is also a first-party
 * plugin. A user-defined subagent launched by an official plugin's skill therefore
 * gets `agent.name = 'custom'` instead of leaking the user-defined name.
 */
export function sanitizeAttributionForOTel(
  querySource: string | undefined,
  attribution: OTelAttributionInput,
  firstPartyPlugins:
    | ReadonlyMap<string, string>
    | ReadonlySet<string> = getFirstPartyPluginsRegistry(),
): OTelAttributionInput {
  const {
    attributionAgent,
    attributionSkill,
    attributionPlugin,
    attributionMcpServer,
    attributionMcpTool,
  } = attribution
  const sanitized: OTelAttributionInput = {}

  if (attributionMcpServer !== undefined) {
    sanitized.attributionMcpServer = attributionMcpServer
    if (attributionMcpTool !== undefined) {
      sanitized.attributionMcpTool = attributionMcpTool
    }
  }

  if (attributionAgent !== undefined) {
    if (querySource?.startsWith('agent:builtin:')) {
      sanitized.attributionAgent = attributionAgent
    } else {
      const agentPlugin = extractAttributionPluginPrefix(attributionAgent)
      const isFirstPartyAgent =
        attributionPlugin !== undefined &&
        firstPartyPlugins.has(attributionPlugin) &&
        agentPlugin !== undefined &&
        firstPartyPlugins.has(agentPlugin)
      sanitized.attributionAgent = isFirstPartyAgent
        ? attributionAgent
        : 'custom'
    }
  }

  if (attributionPlugin !== undefined) {
    if (firstPartyPlugins.has(attributionPlugin)) {
      sanitized.attributionPlugin = attributionPlugin
      if (attributionSkill !== undefined) {
        sanitized.attributionSkill = attributionSkill
      }
    } else {
      sanitized.attributionPlugin = 'third-party'
      if (attributionSkill !== undefined) {
        sanitized.attributionSkill = 'third-party'
      }
    }
  } else if (attributionSkill !== undefined) {
    sanitized.attributionSkill = attributionSkill
  }

  return sanitized
}

/**
 * Official `eI(aI(...))` (@282350400): build OpenTelemetry attribution
 * attributes (`agent.name`, `skill.name`, `plugin.name`, `marketplace.name`,
 * `mcp_server.name`, `mcp_tool.name`) with `#2126` redaction applied.
 */
export function buildOTelAttributionAttributes(
  querySource: string | undefined,
  attribution: OTelAttributionInput,
  firstPartyPlugins:
    | ReadonlyMap<string, string>
    | ReadonlySet<string> = getFirstPartyPluginsRegistry(),
): Record<string, string> {
  const sanitized = sanitizeAttributionForOTel(
    querySource,
    attribution,
    firstPartyPlugins,
  )
  const marketplace =
    sanitized.attributionPlugin && firstPartyPlugins instanceof Map
      ? firstPartyPlugins.get(sanitized.attributionPlugin)
      : undefined
  return {
    ...(sanitized.attributionAgent
      ? { 'agent.name': sanitized.attributionAgent }
      : {}),
    ...(sanitized.attributionSkill
      ? { 'skill.name': sanitized.attributionSkill }
      : {}),
    ...(sanitized.attributionPlugin
      ? { 'plugin.name': sanitized.attributionPlugin }
      : {}),
    ...(marketplace ? { 'marketplace.name': marketplace } : {}),
    ...(sanitized.attributionMcpServer
      ? { 'mcp_server.name': sanitized.attributionMcpServer }
      : {}),
    ...(sanitized.attributionMcpTool
      ? { 'mcp_tool.name': sanitized.attributionMcpTool }
      : {}),
  }
}
