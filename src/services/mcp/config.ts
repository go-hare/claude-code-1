import { feature } from 'bun:bundle'
import { chmod, open, readFile, rename, stat, unlink } from 'fs/promises'
import mapValues from 'lodash-es/mapValues.js'
import { dirname, join, parse } from 'path'
import { getPlatform } from 'src/utils/platform.js'
import {
  BRIDGE_CARRIER_DROP_MESSAGES,
  isBridgeCarrierChild,
  rewriteBridgeCarrierMcpEntry,
} from '../../bridge/bridgeCarrier.js'
import { createRemoteMetaHttpConfig } from '../../bridge/hearthbotMcp.js'
import type { PluginError } from '../../types/plugin.js'
import { isCliOwnedConfig, markCliOwnedConfig } from './cliOwnedConfigs.js'
import {
  notifyMcpSwitchedOffSaved,
  sanitizeDisabledMcpServers,
} from './mcpSwitchedOffRecord.js'
import { getPluginErrorMessage } from '../../types/plugin.js'
import {
  CLAUDE_IN_CHROME_MCP_SERVER_NAME,
  isClaudeInChromeMCPServer,
} from '../../utils/claudeInChrome/common.js'
import {
  getCurrentProjectConfig,
  getGlobalConfig,
  getProjectPathForConfig,
  saveCurrentProjectConfig,
  saveGlobalConfig,
} from '../../utils/config.js'
import {
  COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMCPServer,
} from '../../utils/computerUse/common.js'
import { getCwd } from '../../utils/cwd.js'
import { logForDebugging } from '../../utils/debug.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import {
  HostSlot,
  getActiveSessionFromAls,
  getBootstrapSessionHost,
  runWithSession,
} from '../../utils/sessionRoot.js'
import {
  getMcpPolicyDenyExpansionEnv,
  getMcpPolicyPrimaryEnv,
} from '../../utils/managedEnv.js'
import { getErrnoCode } from '../../utils/errors.js'
import { getFsImplementation } from '../../utils/fsOperations.js'
import { safeParseJSON } from '../../utils/json.js'
import { logError } from '../../utils/log.js'
import { getPluginMcpServers } from '../../utils/plugins/mcpPluginIntegration.js'
import { loadAllPluginsCacheOnly } from '../../utils/plugins/pluginLoader.js'
import {
  SETTING_SOURCES,
  isSettingSourceEnabled,
} from '../../utils/settings/constants.js'
import { getManagedFilePath } from '../../utils/settings/managedPath.js'
import { isRestrictedToPluginOnly } from '../../utils/settings/pluginOnlyPolicy.js'
import {
  getInitialSettings,
  getSettingsForSource,
} from '../../utils/settings/settings.js'
import {
  isMcpServerCommandEntry,
  isMcpServerNameEntry,
  isMcpServerUrlEntry,
  type SettingsJson,
} from '../../utils/settings/types.js'
import {
  findJsonSyntaxErrorLocation,
  type ValidationError,
} from '../../utils/settings/validation.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../analytics/index.js'
import { randomBytes } from 'crypto'
import {
  parseUrlPattern,
  urlMatchesPattern,
} from '../../utils/hooks/execHttpHook.js'
import { fetchClaudeAIMcpConfigsIfEligible } from './claudeai.js'
import { expandEnvVarsInString } from './envExpansion.js'
import { z } from 'zod/v4'
import {
  type ConfigScope,
  type McpHTTPServerConfig,
  type McpJsonConfig,
  McpClaudeAIProxyServerConfigSchema,
  McpHTTPServerConfigSchema,
  type McpServerConfig,
  McpServerConfigSchema,
  McpSdkServerConfigSchema,
  McpSSEIDEServerConfigSchema,
  McpSSEServerConfigSchema,
  type McpSSEServerConfig,
  McpStdioServerConfigSchema,
  type McpStdioServerConfig,
  McpWebSocketIDEServerConfigSchema,
  McpWebSocketServerConfigSchema,
  type McpWebSocketServerConfig,
  type ScopedMcpServerConfig,
} from './types.js'
import { getProjectMcpServerStatus } from './utils.js'

/**
 * Get the path to the managed MCP configuration file
 */
export function getEnterpriseMcpFilePath(): string {
  return join(getManagedFilePath(), 'managed-mcp.json')
}

/**
 * Internal utility: Add scope (and optional declaredIn folder ownership for
 * project .mcp.json / local configs — Official 2.1.325 #2302) to server configs.
 */
export function addScopeToServers(
  servers: Record<string, McpServerConfig> | undefined,
  scope: ConfigScope,
  declaredIn?: string,
): Record<string, ScopedMcpServerConfig> {
  if (!servers) {
    return {}
  }
  const scopedServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)
  for (const [name, config] of Object.entries(servers)) {
    scopedServers[name] = {
      ...config,
      scope,
      ...(declaredIn !== undefined ? { declaredIn } : {}),
    }
  }
  return scopedServers
}

/**
 * Official 2.1.325 #2302 — merge folder-owned (`.mcp.json` / `local`) MCP
 * configs with host-supplied dynamic configs after a folder move or pre-warmed
 * start so a folder's own servers keep their `project`/`local` scope instead
 * of being relabeled as host-added (`dynamic`) or dropped, and WebSocket (`ws`)
 * configs remain eligible for automatic connection.
 */
export function mergeFolderOwnedMcpConfigs(
  folderConfigs: Record<string, ScopedMcpServerConfig>,
  dynamicConfigs?: Record<string, ScopedMcpServerConfig>,
): Record<string, ScopedMcpServerConfig> {
  const merged: Record<string, ScopedMcpServerConfig> = Object.create(null)
  if (dynamicConfigs) {
    Object.assign(merged, dynamicConfigs)
  }
  for (const [name, cfg] of Object.entries(folderConfigs)) {
    const existing = merged[name]
    // Folder-owned project (.mcp.json) and local configs keep their folder
    // scope when the host also passed the same name (or after a pre-warmed
    // claim / cwd move). Other scopes (user/plugin) yield to explicit host
    // dynamic configs.
    if (
      existing === undefined ||
      cfg.scope === 'project' ||
      cfg.scope === 'local'
    ) {
      merged[name] = cfg
    }
  }
  return merged
}

/**
 * Official 2.1.325 #2302 — transport types that auto-connect on session boot /
 * folder switch (including `ws` WebSocket MCP servers).
 */
export function isAutoConnectMcpTransport(
  config: Pick<ScopedMcpServerConfig, 'type'>,
): boolean {
  switch (config.type) {
    case undefined:
    case 'stdio':
    case 'sse':
    case 'http':
    case 'ws':
    case 'sdk':
    case 'claudeai-proxy':
      return true
    case 'sse-ide':
    case 'ws-ide':
      return false
    default:
      return false
  }
}

/**
 * Official 2.1.325 #2328 — in cloud sessions (`CLAUDE_CODE_REMOTE`), track
 * whether plugin startup is still in flight so a connector tool's approval
 * prompt is never auto-answered before plugins finish loading.
 */
type EnterpriseMcpPresenceState = {
  checked: boolean
  present: boolean
  valid: boolean
  arrivedMidSession: boolean
  arrivalNotice: string | null
}

type HostMcpConfigState = {
  cloudPluginStartupPending: boolean
  mcpConfigServerErrorsStore: McpConfigServerError[]
  enterpriseMcpState: EnterpriseMcpPresenceState
  managedMcpArrivalListeners: Set<(message: string) => void>
}

const hostMcpConfigSlot = new HostSlot<HostMcpConfigState>(() => ({
  cloudPluginStartupPending: false,
  mcpConfigServerErrorsStore: [],
  enterpriseMcpState: {
    checked: false,
    present: false,
    valid: false,
    arrivedMidSession: false,
    arrivalNotice: null,
  },
  managedMcpArrivalListeners: new Set(),
}))

function getHostMcpConfigState(): HostMcpConfigState {
  return hostMcpConfigSlot.of(getBootstrapSessionHost())
}

export function setCloudPluginStartupPending(pending: boolean): void {
  getHostMcpConfigState().cloudPluginStartupPending = pending
}

export function isCloudPluginStartupPending(): boolean {
  return getHostMcpConfigState().cloudPluginStartupPending
}

export function shouldHoldConnectorApprovalWhilePluginsLoading(opts?: {
  isRemote?: boolean
  pluginStartupPending?: boolean
  isConnectorTool?: boolean
}): boolean {
  const isRemote = opts?.isRemote ?? Boolean(process.env.CLAUDE_CODE_REMOTE)
  const pending =
    opts?.pluginStartupPending ??
    getHostMcpConfigState().cloudPluginStartupPending
  const isConnectorTool = opts?.isConnectorTool ?? true
  return isRemote && pending && isConnectorTool
}

/**
 * Internal utility: Write MCP config to .mcp.json file.
 * Preserves file permissions and flushes to disk before rename.
 * Uses the original path for rename (does not follow symlinks).
 */
async function writeMcpjsonFile(
  config: Record<string, unknown>,
): Promise<void> {
  const mcpJsonPath = join(getCwd(), '.mcp.json')

  // Read existing file permissions to preserve them
  let existingMode: number | undefined
  try {
    const stats = await stat(mcpJsonPath)
    existingMode = stats.mode
  } catch (e: unknown) {
    const code = getErrnoCode(e)
    if (code !== 'ENOENT') {
      throw e
    }
    // File doesn't exist yet -- no permissions to preserve
  }

  // Write to temp file, flush to disk, then atomic rename
  const tempPath = `${mcpJsonPath}.tmp.${process.pid}.${Date.now()}`
  const handle = await open(tempPath, 'w', existingMode ?? 0o644)
  try {
    await handle.writeFile(jsonStringify(config, null, 2), {
      encoding: 'utf8',
    })
    await handle.datasync()
  } finally {
    await handle.close()
  }

  try {
    // Restore original file permissions on the temp file before rename
    if (existingMode !== undefined) {
      await chmod(tempPath, existingMode)
    }
    await rename(tempPath, mcpJsonPath)
  } catch (e: unknown) {
    // Clean up temp file on failure
    try {
      await unlink(tempPath)
    } catch {
      // Best-effort cleanup
    }
    throw e
  }
}

/**
 * Extract command array from server config (stdio servers only)
 * Returns null for non-stdio servers
 */
function getServerCommandArray(config: McpServerConfig): string[] | null {
  // Non-stdio servers don't have commands
  if (config.type !== undefined && config.type !== 'stdio') {
    return null
  }
  const stdioConfig = config as McpStdioServerConfig
  return [stdioConfig.command, ...(stdioConfig.args ?? [])]
}

/**
 * Check if two command arrays match exactly
 */
function commandArraysMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  return a.every((val, idx) => val === b[idx])
}

/**
 * Extract URL from server config (remote servers only)
 * Returns null for stdio/sdk servers
 */
function getServerUrl(config: McpServerConfig): string | null {
  return 'url' in config ? config.url : null
}

/**
 * CCR proxy URL path markers. In remote sessions, claude.ai connectors arrive
 * via --mcp-config with URLs rewritten to route through the CCR/session-ingress
 * SHTTP proxy. The original vendor URL is preserved in the mcp_url query param
 * so the proxy knows where to forward. See api-go/ccr/internal/ccrshared/
 * mcp_url_rewriter.go and api-go/ccr/internal/mcpproxy/proxy.go.
 */
const CCR_PROXY_PATH_MARKERS = [
  '/v2/session_ingress/shttp/mcp/',
  '/v2/ccr-sessions/',
]

/**
 * If the URL is a CCR proxy URL, extract the original vendor URL from the
 * mcp_url query parameter. Otherwise return the URL unchanged. This lets
 * signature-based dedup match a plugin's raw vendor URL against a connector's
 * rewritten proxy URL when both point at the same MCP server.
 */
export function unwrapCcrProxyUrl(url: string): string {
  if (!CCR_PROXY_PATH_MARKERS.some(m => url.includes(m))) {
    return url
  }
  try {
    const parsed = new URL(url)
    const original = parsed.searchParams.get('mcp_url')
    return original || url
  } catch {
    return url
  }
}

/**
 * Official `Uei(e)` (#1675) — extract all `mcp_url` upstream URLs from
 * Anthropic / CCR proxy URLs for denylist policy matching.
 */
export function getAnthropicProxyUpstreamUrls(url: string): string[] {
  if (
    !CCR_PROXY_PATH_MARKERS.some(m => url.includes(m)) &&
    !url.includes('mcp-proxy.anthropic.com')
  ) {
    return []
  }
  try {
    return new URL(url).searchParams.getAll('mcp_url').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Compute a dedup signature for an MCP server config.
 * Two configs with the same signature are considered "the same server" for
 * plugin deduplication. Ignores env (plugins always inject CLAUDE_PLUGIN_ROOT)
 * and headers (same URL = same server regardless of auth).
 * Returns null only for configs with neither command nor url (sdk type).
 */
/**
 * densable WJe — signature for content-based MCP identity.
 * Default ignores env (plugin CLAUDE_PLUGIN_ROOT noise). Pass
 * `{ includeEnv: true }` only when env must distinguish two stdio servers.
 */
/**
 * Official 2.1.325 `gAt` — normalize trailing slash and strip hash for URL
 * dedup signature comparison.
 */
function normalizeSignatureUrl(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    if (!parsed.search) parsed.search = ''
    parsed.pathname = parsed.pathname.replace(/\/$/, '') || '/'
    const str = parsed.toString()
    return parsed.search ? str : str.replace(/\/$/, '')
  } catch {
    return url.includes('?') ? url : url.replace(/\/$/, '')
  }
}

/**
 * Official 2.1.325 `Wso` (#2301) — equivalent connector endpoint URL groups.
 * In cloud sessions (`CLAUDE_CODE_REMOTE`), a dynamic connector may expose one
 * vendor endpoint while a plugin lists a legacy/alternate URL for the same
 * service (Atlassian, Asana, Sentry). Treating them as equivalent suppresses
 * the duplicate plugin entry so Claude doesn't report a working connector as
 * failed.
 */
export const EQUIVALENT_CONNECTOR_URL_GROUPS: readonly (readonly string[])[] = [
  [
    'https://mcp.atlassian.com',
    'https://mcp.atlassian.com/v1/mcp',
    'https://mcp.atlassian.com/v1/mcp/authv2',
    'https://mcp.atlassian.com/v2/mcp',
  ],
  ['https://mcp.asana.com/v2/mcp', 'https://mcp.asana.com/sse'],
  ['https://mcp.sentry.dev/mcp', 'https://mcp.sentry.dev/sse'],
]

/**
 * Official 2.1.325 `Oxr` (#2301) — collapse equivalent vendor connector URL
 * signatures to a shared `connector:<canonical>` key in remote sessions.
 */
export function canonicalizeRemoteConnectorSignature(
  sig: string,
  isRemote: boolean = Boolean(process.env.CLAUDE_CODE_REMOTE),
): string {
  const group = isRemote
    ? EQUIVALENT_CONNECTOR_URL_GROUPS.find(urls =>
        urls.some(u => `url:${u}` === sig),
      )
    : undefined
  return group ? `connector:${group[0]}` : sig
}

export function getMcpServerSignature(
  config: McpServerConfig,
  options?: { includeEnv?: boolean; exactUrl?: boolean },
): string | null {
  if (
    'configError' in config &&
    (config as { configError?: unknown }).configError
  ) {
    return null
  }
  const cmd = getServerCommandArray(config)
  if (cmd) {
    if (options?.includeEnv === false || options?.includeEnv === undefined) {
      // densable WJe includeEnv!==true → command only
      return `stdio:${jsonStringify(cmd)}`
    }
    const envEntries = Object.entries(
      (config as McpStdioServerConfig).env ?? {},
    )
      .filter(
        ([key]) => key !== 'CLAUDE_PLUGIN_ROOT' && key !== 'CLAUDE_PLUGIN_DATA',
      )
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const envSuffix =
      envEntries.length > 0
        ? `:${jsonStringify(Object.fromEntries(envEntries))}`
        : ''
    return `stdio:${jsonStringify(cmd)}${envSuffix}`
  }
  const url = getServerUrl(config)
  if (url) {
    const unwrapped = unwrapCcrProxyUrl(url)
    return options?.exactUrl
      ? `url:${unwrapped}`
      : `url:${normalizeSignatureUrl(unwrapped)}`
  }
  return null
}

/**
 * densable xLv — human endpoint label for diagnostics (url or `command args`).
 */
export function formatMcpServerEndpoint(config: McpServerConfig): string {
  const url = getServerUrl(config)
  if (url) return url
  const cmd = getServerCommandArray(config)
  if (cmd) return cmd.join(' ')
  return config.type ?? 'unknown'
}

/**
 * densable cHr — URL origin only (no path/query/userinfo) for connection-failure UI.
 */
export function getMcpServerUrlOrigin(
  config: Pick<McpServerConfig, never> | { url?: unknown },
): string | undefined {
  if (!('url' in config) || typeof config.url !== 'string') return undefined
  try {
    return new URL(config.url).origin
  } catch {
    return undefined
  }
}

/** densable CYs / K0 — safe `claude <cmd> <name> [args]` suggestion. */
function formatClaudeCliSuggestion(
  command: string,
  serverName: string,
  extraArgs?: string,
): string | null {
  if (!/^\w[\w.@-]*$/.test(serverName)) return null
  return `claude ${command} ${serverName}${extraArgs ? ` ${extraArgs}` : ''}`
}

type McpScopeConflictInput = {
  scope: ConfigScope
  /** Usually expanded (runtime) servers — used for signature compare. */
  servers: Record<string, McpServerConfig>
  /**
   * densable displayServers — unexpanded configs so warnings show `${VAR}`
   * rather than resolved secrets.
   */
  displayServers: Record<string, McpServerConfig>
}

/**
 * densable Gpi — same server name across scopes with different endpoints.
 * Endpoint labels come from `displayServers` (expandVars:false).
 */
export function getMcpScopeConflicts(
  scopes: McpScopeConflictInput[],
): ValidationError[] {
  const byName = new Map<
    string,
    Array<{ scope: ConfigScope; sig: string; endpoint: string }>
  >()

  for (const { scope, servers, displayServers } of scopes) {
    for (const [name, config] of Object.entries(servers)) {
      const sig = getMcpServerSignature(config, {
        includeEnv: false,
        exactUrl: true,
      })
      if (!sig) continue
      let entries = byName.get(name)
      if (!entries) {
        entries = []
        byName.set(name, entries)
      }
      const display = displayServers[name]
      entries.push({
        scope,
        sig,
        endpoint: display
          ? formatMcpServerEndpoint(display)
          : (config.type ?? 'unknown'),
      })
    }
  }

  const conflicts: ValidationError[] = []
  for (const [name, entries] of byName) {
    if (entries.length < 2) continue
    if (new Set(entries.map(e => e.sig)).size < 2) continue

    const suggestions = entries
      .map(e => formatClaudeCliSuggestion('mcp remove', name, `-s ${e.scope}`))
      .filter((s): s is string => s !== null)

    conflicts.push({
      path: `mcpServers.${name}`,
      message: `Server "${name}" is defined in multiple scopes with different endpoints: ${entries
        .map(e => `${e.scope} (${e.endpoint})`)
        .join(
          ', ',
        )}. OAuth tokens are stored per endpoint, so authenticating in one context will not carry over.`,
      suggestion:
        suggestions.length > 0
          ? `Keep the correct endpoint and remove the others: ${suggestions
              .map(s => `\`${s}\``)
              .join(' or ')}`
          : 'Keep the correct endpoint and remove the others from the scopes listed above.',
      mcpErrorMetadata: {
        scope: entries[0]!.scope,
        serverName: name,
        severity: 'warning',
      },
    })
  }
  return conflicts
}

/**
 * Filter plugin MCP servers, dropping any whose signature matches a
 * manually-configured server or an earlier-loaded plugin server.
 * Manual wins over plugin; between plugins, first-loaded wins.
 *
 * Plugin servers are namespaced `plugin:name:server` so they never key-collide
 * with manual servers in the merge — this content-based check catches the case
 * where both actually launch the same underlying process/connection.
 */
export function dedupPluginMcpServers(
  pluginServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  // Map signature -> server name so we can report which server a dup matches
  const manualSigs = new Map<string, string>()
  // Official 2.1.325 #2301 (`qUs`): dynamic non-plugin connectors also index
  // by canonical multi-URL equivalence group in cloud sessions.
  const dynamicConnectorSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    const sig = getMcpServerSignature(config, { includeEnv: false })
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
    if (
      sig &&
      config.scope === 'dynamic' &&
      !('pluginSource' in config && config.pluginSource !== undefined)
    ) {
      const canonical = canonicalizeRemoteConnectorSignature(sig)
      if (!dynamicConnectorSigs.has(canonical)) {
        dynamicConnectorSigs.set(canonical, name)
      }
    }
  }

  const servers: Record<string, ScopedMcpServerConfig> = Object.create(null)
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  const seenPluginSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(pluginServers)) {
    const sig = getMcpServerSignature(config, { includeEnv: true })
    if (sig === null) {
      servers[name] = config
      continue
    }
    const noEnvSig = getMcpServerSignature(config, { includeEnv: false })
    const manualDup =
      noEnvSig !== null
        ? (manualSigs.get(noEnvSig) ??
          dynamicConnectorSigs.get(
            canonicalizeRemoteConnectorSignature(noEnvSig),
          ))
        : undefined
    if (manualDup !== undefined) {
      logForDebugging(
        `Suppressing plugin MCP server "${name}": duplicates manually-configured "${manualDup}"`,
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    const pluginDup = seenPluginSigs.get(sig)
    if (pluginDup !== undefined) {
      logForDebugging(
        `Suppressing plugin MCP server "${name}": duplicates earlier plugin server "${pluginDup}"`,
      )
      suppressed.push({ name, duplicateOf: pluginDup })
      continue
    }
    seenPluginSigs.set(sig, name)
    servers[name] = config
  }
  return { servers, suppressed }
}

/**
 * Filter claude.ai connectors, dropping any whose signature matches an enabled
 * manually-configured server. Manual wins: a user who wrote .mcp.json or ran
 * `claude mcp add` expressed higher intent than a connector toggled in the web UI.
 *
 * Connector keys are `claude.ai <DisplayName>` so they never key-collide with
 * manual servers in the merge — this content-based check catches the case where
 * both point at the same underlying URL (e.g. `mcp__slack__*` and
 * `mcp__claude_ai_Slack__*` both hitting mcp.slack.com, ~600 chars/turn wasted).
 *
 * Only enabled manual servers count as dedup targets — a disabled manual server
 * mustn't suppress its connector twin, or neither runs.
 */
export function dedupClaudeAiMcpServers(
  claudeAiServers: Record<string, ScopedMcpServerConfig>,
  manualServers: Record<string, ScopedMcpServerConfig>,
): {
  servers: Record<string, ScopedMcpServerConfig>
  suppressed: Array<{ name: string; duplicateOf: string }>
} {
  const manualSigs = new Map<string, string>()
  for (const [name, config] of Object.entries(manualServers)) {
    if (isMcpServerDisabled(name)) continue
    const sig = getMcpServerSignature(config)
    if (sig && !manualSigs.has(sig)) manualSigs.set(sig, name)
  }

  const servers: Record<string, ScopedMcpServerConfig> = Object.create(null)
  const suppressed: Array<{ name: string; duplicateOf: string }> = []
  for (const [name, config] of Object.entries(claudeAiServers)) {
    const sig = getMcpServerSignature(config)
    const manualDup = sig !== null ? manualSigs.get(sig) : undefined
    if (manualDup !== undefined) {
      logForDebugging(
        `Suppressing claude.ai connector "${name}": duplicates manually-configured "${manualDup}"`,
      )
      suppressed.push({ name, duplicateOf: manualDup })
      continue
    }
    servers[name] = config
  }
  return { servers, suppressed }
}

const ADMIN_WILDCARD_TOKEN = `zzadminwc${randomBytes(8).toString('hex')}zz`
const NEUTRAL_ENV_SUB = 'zzenvsubzz'
const ENV_VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g
const URL_REST_DELIM_RE = /[/@#?\\\s]/
const URL_SCHEME_DELIM_RE = /[:/@#?\\\s]/
const PATH_DOT_SEGMENT_RE = /(^|\/)(\.|%2e)(\.|%2e)?(\/|$)/i

function neutralizeEnvSubstitution(value: string): string {
  const trailingDots = /\.+$/.exec(value)?.[0]
  if (trailingDots && value.length > trailingDots.length) {
    return `${neutralizeEnvSubstitution(value.slice(0, -trailingDots.length))}${trailingDots}`
  }
  if (/^[0-9]+(\.[0-9]+)*$/.test(value)) {
    return value.replace(/[0-9]+/g, '0')
  }
  if (value.includes(':') && /^[0-9a-fA-F:.]+$/.test(value)) {
    return '::'
  }
  return NEUTRAL_ENV_SUB
}

function classifyPolicyUrlEnvPositions(
  pattern: string,
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): Map<string, 'scheme' | 'authority' | 'rest'> {
  const varNames: string[] = []
  for (const match of pattern.matchAll(
    new RegExp(ENV_VAR_REF_RE.source, 'g'),
  )) {
    const name = match[1]!
    if (
      !varNames.includes(name) &&
      Object.hasOwn(env, name) &&
      typeof env[name] === 'string'
    ) {
      varNames.push(name)
    }
  }
  const positions = new Map<string, 'scheme' | 'authority' | 'rest'>()
  const probe = (
    targetVar: string,
    schemeVars: Set<string>,
  ): 'scheme' | 'authority' | 'rest' => {
    const marker = `zzv${varNames.indexOf(targetVar)}zz`
    const proxy = new Proxy({} as Record<string, string | undefined>, {
      get: (_, key) => {
        if (typeof key !== 'string') return undefined
        if (key === targetVar) return marker
        if (!Object.hasOwn(env, key) || typeof env[key] !== 'string') {
          return undefined
        }
        return schemeVars.has(key)
          ? String(env[key])
          : neutralizeEnvSubstitution(String(env[key]))
      },
    })
    const expanded = expandEnvVarsInString(pattern, proxy).expanded
    const parsed = parseUrlPattern(expanded, ADMIN_WILDCARD_TOKEN)
    if (parsed === null) return 'authority'
    if (parsed.protocol.includes(marker)) return 'scheme'
    if (
      parsed.username.includes(marker) ||
      parsed.password.includes(marker) ||
      parsed.hostname.includes(marker) ||
      parsed.port.includes(marker)
    ) {
      return 'authority'
    }
    if (
      parsed.pathname.includes(marker) ||
      parsed.search.includes(marker) ||
      parsed.hash.includes(marker)
    ) {
      return 'rest'
    }
    return 'scheme'
  }
  const emptySet = new Set<string>()
  const schemeVars = new Set(
    varNames.filter(v => probe(v, emptySet) === 'scheme'),
  )
  for (const v of varNames) {
    positions.set(v, schemeVars.has(v) ? 'scheme' : probe(v, schemeVars))
  }
  return positions
}

function envInjectsUrlDelimiters(
  positions: Map<string, 'scheme' | 'authority' | 'rest'>,
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): boolean {
  for (const [name, pos] of positions) {
    if (pos === 'rest') continue
    const val = env[name]
    if (
      typeof val === 'string' &&
      (pos === 'scheme' ? URL_SCHEME_DELIM_RE : URL_REST_DELIM_RE).test(val)
    ) {
      return true
    }
  }
  return false
}

function envInjectsPathDotsOrQuery(
  pattern: string,
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
): boolean {
  for (const match of pattern.matchAll(
    new RegExp(ENV_VAR_REF_RE.source, 'g'),
  )) {
    const val = env[match[1]!]
    if (typeof val !== 'string') continue
    if (/[?#]/.test(val)) return true
    const normalized = val
      .replace(/[\t\n\r]/g, '')
      .replaceAll('\\', '/')
      .replace(/%2e/gi, '.')
    if (PATH_DOT_SEGMENT_RE.test(normalized)) return true
  }
  return false
}

function urlHasDotSegment(url: string): boolean {
  let start = 0
  let end = url.length
  while (start < end && url.charCodeAt(start) <= 32) start++
  while (end > start && url.charCodeAt(end - 1) <= 32) end--
  const normalized = url
    .slice(start, end)
    .replace(/[\t\n\r]/g, '')
    .replaceAll('\\', '/')
    .replace(/%2e/gi, '.')
  const qIdx = normalized.search(/[?#]/)
  const pathPart = qIdx === -1 ? normalized : normalized.slice(0, qIdx)
  return PATH_DOT_SEGMENT_RE.test(pathPart)
}

/**
 * Official TCt — expand a policy URL predicate and detect unsafe structural
 * restructuring, wildcard injection, or dot-segment path traversal.
 */
export function expandMcpPolicyUrlPredicate(
  pattern: string,
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
  fallbackEnv?: NodeJS.Dict<string> | Record<string, string | undefined>,
): { expanded: string; unsafeExpansion: boolean; missingVars: string[] } {
  const sanitized = pattern.replace(/[\t\n\r]/g, '')
  const masked = sanitized.replaceAll('*', ADMIN_WILDCARD_TOKEN)
  const expandedResult = expandEnvVarsInString(masked, env, fallbackEnv)
  const neutralProxy = new Proxy({} as Record<string, string | undefined>, {
    get: (_, key) =>
      typeof key === 'string' && Object.hasOwn(env, key)
        ? neutralizeEnvSubstitution(String(env[key]))
        : undefined,
  })
  const neutralResult = expandEnvVarsInString(masked, neutralProxy)
  const parsedExpanded = parseUrlPattern(
    expandedResult.expanded,
    ADMIN_WILDCARD_TOKEN,
  )
  const parsedNeutral = parseUrlPattern(
    neutralResult.expanded,
    ADMIN_WILDCARD_TOKEN,
  )
  const expandedHost = parsedExpanded?.hostname ?? null
  const neutralHost = parsedNeutral?.hostname ?? null
  const didExpand = neutralResult.expanded !== masked
  const positions = didExpand
    ? classifyPolicyUrlEnvPositions(masked, env)
    : new Map<
        'scheme' | 'authority' | 'rest' extends never ? never : string,
        'scheme' | 'authority' | 'rest'
      >()
  const hasDotSegment =
    sanitized.includes('$') && urlHasDotSegment(expandedResult.expanded)
  const unsafeExpansion =
    expandedResult.wildcardVars.length > 0 ||
    (didExpand && envInjectsUrlDelimiters(positions, env)) ||
    (expandedHost === null) !== (neutralHost === null) ||
    (didExpand && expandedHost === null) ||
    (parsedExpanded !== null &&
      ((parsedExpanded.hash !== '' && (parsedNeutral?.hash ?? '') === '') ||
        (parsedExpanded.search !== '' &&
          (parsedNeutral?.search ?? '') === ''))) ||
    (didExpand && envInjectsPathDotsOrQuery(masked, env)) ||
    hasDotSegment ||
    (expandedHost !== null &&
      ((expandedHost.includes('*') && !(neutralHost ?? '').includes('*')) ||
        (expandedHost.endsWith('.') && !(neutralHost ?? '').endsWith('.')) ||
        (expandedHost.includes(ADMIN_WILDCARD_TOKEN) &&
          !(neutralHost ?? '').includes(ADMIN_WILDCARD_TOKEN))))

  if (expandedResult.missingVars.length > 0) {
    logForDebugging(
      `MCP policy predicate references environment variable(s) not present in the policy expansion env: ${expandedResult.missingVars.join(', ')}`,
    )
  }
  if (unsafeExpansion) {
    const vars =
      expandedResult.wildcardVars.length > 0
        ? expandedResult.wildcardVars
        : [
            ...Object.keys(env).filter(
              k =>
                pattern.includes('${' + k + '}') ||
                pattern.includes('${' + k + ':'),
            ),
            ...expandedResult.missingVars,
          ]
    const hasRef = new RegExp(ENV_VAR_REF_RE.source).test(sanitized)
    const reason =
      expandedResult.wildcardVars.length > 0
        ? 'a value injected wildcard semantics'
        : hasDotSegment
          ? `the expanded entry's path carries a dot segment ('..' or '.') that URL parsing would collapse — remove dot segments from the pattern${hasRef ? ', or set the referenced variable(s)' : " (the pattern's '$' text is not a ${NAME} reference, so environment values cannot affect it)"}`
          : 'a value restructured the URL, or the expansion is unparseable as a URL (e.g. a whole-URL ${VAR}: rewrite as https://${HOST}/path — hostname-position variables are fully supported)'
    logForDebugging(
      `MCP policy URL predicate expansion was unsafe — ${reason} (variables: ${vars.join(', ') || 'unknown'}) — allowlist URL entries using it fail closed; denylist entries are unaffected`,
    )
  }
  return {
    expanded: expandedResult.expanded.replaceAll(ADMIN_WILDCARD_TOKEN, '*'),
    unsafeExpansion,
    missingVars: expandedResult.missingVars,
  }
}

/**
 * Get the settings to use for MCP server allowlist policy.
 * When allowManagedMcpServersOnly is set in policySettings, only managed settings
 * control which servers are allowed. Otherwise, returns merged settings.
 */
function getMcpAllowlistSettings(): SettingsJson {
  if (shouldAllowManagedMcpServersOnly()) {
    return getSettingsForSource('policySettings') ?? {}
  }
  return getInitialSettings()
}

/**
 * Get the settings to use for MCP server denylist policy.
 * Denylists always merge from all sources — users can always deny servers
 * for themselves, even when allowManagedMcpServersOnly is set.
 */
function getMcpDenylistSettings(): SettingsJson {
  return getInitialSettings()
}

/**
 * densable X6u — expand a policy predicate string against the policy expansion
 * env (and optional deny fallback). Logs missing vars; returns expanded text.
 */
function expandMcpPolicyPredicate(
  value: string,
  env: NodeJS.Dict<string> | Record<string, string | undefined>,
  fallbackEnv?: NodeJS.Dict<string> | Record<string, string | undefined>,
): { expanded: string; wildcardVars: string[] } {
  const { expanded, missingVars, wildcardVars } = expandEnvVarsInString(
    value,
    env,
    fallbackEnv,
  )
  if (missingVars.length > 0) {
    logForDebugging(
      `MCP policy predicate references environment variable(s) not present in the policy expansion env: ${missingVars.join(', ')}`,
    )
  }
  return { expanded, wildcardVars }
}

/**
 * densable E_o — expand server-side command/url tokens from live process.env
 * (after settings.env has been applied), not the policy primary env.
 */
function expandMcpServerSideString(value: string): string {
  return expandEnvVarsInString(value).expanded
}

/**
 * Official 2.1.328 `Wli` (#666): match `claude.ai <displayName>` entries in
 * `deniedMcpServers` against dynamic connector configs (cloud / self-hosted
 * runner sessions) that carry a `displayName`.
 */
export function isDeniedByClaudeAiConnectorDisplayName(
  config: McpServerConfig & { scope?: ConfigScope; displayName?: unknown },
  deniedMcpServers: SettingsJson['deniedMcpServers'] = getMcpDenylistSettings()
    .deniedMcpServers,
): boolean {
  const scope = config.scope ?? 'dynamic'
  const rawDisplayName = (config as { displayName?: unknown }).displayName
  const displayName =
    scope === 'dynamic' && !isCliOwnedConfig(config)
      ? rawDisplayName
      : undefined
  return (
    typeof displayName === 'string' &&
    deniedMcpServers?.some(
      entry =>
        isMcpServerNameEntry(entry) &&
        entry.serverName === `claude.ai ${displayName}`,
    ) === true
  )
}

/**
 * Official 2.1.327 `_0t` (#378 / #499): read raw `.mcp.json` preserving all
 * sibling top-level keys (e.g. `$schema`, `servers`) alongside `mcpServers`.
 */
export async function readRawProjectMcpJson(cwd: string = getCwd()): Promise<{
  mcpJson: Record<string, unknown>
  mcpServers: Record<string, McpServerConfig>
}> {
  const mcpJsonPath = join(cwd, '.mcp.json')
  let content: string
  try {
    content = await readFile(mcpJsonPath, 'utf8')
  } catch (error) {
    if (getErrnoCode(error) === 'ENOENT') {
      return { mcpJson: {}, mcpServers: {} }
    }
    throw error
  }
  if (!content.trim()) {
    return { mcpJson: {}, mcpServers: {} }
  }
  const parsed = safeParseJSON(content)
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const rec = parsed as Record<string, unknown>
    const rawServers = rec.mcpServers === undefined ? {} : rec.mcpServers
    if (
      rawServers &&
      typeof rawServers === 'object' &&
      !Array.isArray(rawServers)
    ) {
      return {
        mcpJson: rec,
        mcpServers: { ...(rawServers as Record<string, McpServerConfig>) },
      }
    }
  }
  throw new Error(
    '.mcp.json is malformed (not valid JSON, or mcpServers is not an object)',
  )
}

export function hasTopLevelServersWithoutMcpServersKey(
  mcpJson: Record<string, unknown>,
): boolean {
  return (
    !Object.hasOwn(mcpJson, 'mcpServers') &&
    Object.values(mcpJson).some(
      value => McpServerConfigSchema().safeParse(value).success,
    )
  )
}

/**
 * Check if an MCP server is denied by enterprise policy
 * Checks name-based, command-based, and URL-based restrictions
 * densable rdt — policy command/url entries expand ${VAR} via Hyy (startup +
 * managed env, with settings-file env only as deny fallback).
 * @param serverName The name of the server to check
 * @param config Optional server config for command/URL-based matching
 * @returns true if denied, false if not on denylist
 */
export function isMcpServerDenied(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  const settings = getMcpDenylistSettings()
  if (!settings.deniedMcpServers) {
    return false // No restrictions
  }

  // Check name-based denial
  for (const entry of settings.deniedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }

  // Official 2.1.328 `Wli` (#666): `deniedMcpServers` entries of the form
  // `claude.ai <name>` also apply to dynamic connector servers injected in
  // cloud / self-hosted runner sessions via their `displayName`.
  if (
    config &&
    isDeniedByClaudeAiConnectorDisplayName(config, settings.deniedMcpServers)
  ) {
    return true
  }

  // Check command-based denial (stdio servers only) and URL-based denial (remote servers only)
  if (config) {
    // densable Hyy for deny path (env + fallbackEnv)
    const { env, fallbackEnv } = getMcpPolicyDenyExpansionEnv()
    const serverCommand = getServerCommandArray(config)
    if (serverCommand) {
      // densable: server side E_o(process.env); policy side X6u(cmd, env, fallback)
      const expandedServerCommand = serverCommand.map(expandMcpServerSideString)
      for (const entry of settings.deniedMcpServers) {
        if (!isMcpServerCommandEntry(entry)) continue
        const expandedPolicyCommand = entry.serverCommand.map(
          part => expandMcpPolicyPredicate(part, env, fallbackEnv).expanded,
        )
        if (commandArraysMatch(expandedPolicyCommand, expandedServerCommand)) {
          return true
        }
      }
    }

    const serverUrl = getServerUrl(config)
    const connectorProxyUrl =
      config.type === 'claudeai-proxy' &&
      'id' in config &&
      typeof config.id === 'string' &&
      config.id
        ? `https://mcp-proxy.anthropic.com/v1/mcp/${config.id}`
        : null
    if (serverUrl || connectorProxyUrl) {
      const candidateUrls = new Set<string>()
      if (serverUrl) {
        const expandedServerUrl = expandMcpServerSideString(serverUrl)
        candidateUrls.add(expandedServerUrl)
        for (const upstream of getAnthropicProxyUpstreamUrls(
          expandedServerUrl,
        )) {
          candidateUrls.add(upstream)
        }
      }
      if (connectorProxyUrl) {
        candidateUrls.add(connectorProxyUrl)
        for (const upstream of getAnthropicProxyUpstreamUrls(
          connectorProxyUrl,
        )) {
          candidateUrls.add(upstream)
        }
      }
      for (const entry of settings.deniedMcpServers) {
        if (!isMcpServerUrlEntry(entry)) continue
        // densable: denylist URL expansion is unaffected by J6u unsafe fail-closed
        const { expanded: expandedPattern } = expandMcpPolicyUrlPredicate(
          entry.serverUrl,
          env,
          fallbackEnv,
        )
        for (const candidateUrl of candidateUrls) {
          if (urlMatchesPattern(candidateUrl, expandedPattern)) {
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * Check if an MCP server is allowed by enterprise policy
 * Checks name-based, command-based, and URL-based restrictions
 * densable eUe — policy command/url entries expand ${VAR} via Y6u only
 * (startup freeze + managed-settings env; no settings-file fallback).
 * @param serverName The name of the server to check
 * @param config Optional server config for command/URL-based matching
 * @returns true if allowed, false if blocked by policy
 */
export function isMcpServerAllowedByPolicy(
  serverName: string,
  config?: McpServerConfig,
): boolean {
  // Denylist takes absolute precedence
  if (isMcpServerDenied(serverName, config)) {
    return false
  }

  // 2.1.305 #1056 (SEA ek): enterprise/managed-mcp.json entries that do NOT
  // interpolate `${VAR}` into command/args/url/headers (using `${VAR}` only in
  // `env` is fine) bypass allowedMcpServers.
  const scopedConfig = config as ScopedMcpServerConfig | undefined
  if (
    scopedConfig?.scope !== undefined &&
    (scopedConfig.scope === 'enterprise' || scopedConfig.scope === 'managed') &&
    !scopedConfig.expandedFromEnv &&
    !scopedConfig.pluginSource
  ) {
    return true
  }

  const settings = getMcpAllowlistSettings()
  if (!settings.allowedMcpServers) {
    return true // No allowlist restrictions (undefined)
  }

  // Empty allowlist means block all servers
  if (settings.allowedMcpServers.length === 0) {
    return false
  }

  // Check if allowlist contains any command-based or URL-based entries
  const hasCommandEntries = settings.allowedMcpServers.some(
    isMcpServerCommandEntry,
  )
  const hasUrlEntries = settings.allowedMcpServers.some(isMcpServerUrlEntry)

  if (config) {
    // densable Y6u for allow path (no fallbackEnv)
    const policyEnv = getMcpPolicyPrimaryEnv()
    const serverCommand = getServerCommandArray(config)
    const serverUrl = getServerUrl(config)

    if (serverCommand) {
      // This is a stdio server
      if (hasCommandEntries) {
        // If ANY serverCommand entries exist, stdio servers MUST match one of them
        const expandedServerCommand = serverCommand.map(
          expandMcpServerSideString,
        )
        for (const entry of settings.allowedMcpServers) {
          if (!isMcpServerCommandEntry(entry)) continue
          const expandedPolicyCommand = entry.serverCommand.map(
            part => expandMcpPolicyPredicate(part, policyEnv).expanded,
          )
          if (
            commandArraysMatch(expandedPolicyCommand, expandedServerCommand)
          ) {
            return true
          }
        }
        return false // Stdio server doesn't match any command entry
      } else {
        // No command entries, check name-based allowance
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else if (serverUrl) {
      // This is a remote server (sse, http, ws, etc.)
      if (hasUrlEntries) {
        // If ANY serverUrl entries exist, remote servers MUST match one of them
        const expandedServerUrl = expandMcpServerSideString(serverUrl)
        for (const entry of settings.allowedMcpServers) {
          if (!isMcpServerUrlEntry(entry)) continue
          // densable J6u/TCt: allowlist fail-closed on unsafe URL expansion
          const { expanded: expandedPattern, unsafeExpansion } =
            expandMcpPolicyUrlPredicate(entry.serverUrl, policyEnv)
          if (unsafeExpansion) {
            continue
          }
          if (urlMatchesPattern(expandedServerUrl, expandedPattern)) {
            return true
          }
        }
        return false // Remote server doesn't match any URL entry
      } else {
        // No URL entries, check name-based allowance
        for (const entry of settings.allowedMcpServers) {
          if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
            return true
          }
        }
        return false
      }
    } else {
      // Unknown server type - check name-based allowance only
      for (const entry of settings.allowedMcpServers) {
        if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
          return true
        }
      }
      return false
    }
  }

  // No config provided - check name-based allowance only
  for (const entry of settings.allowedMcpServers) {
    if (isMcpServerNameEntry(entry) && entry.serverName === serverName) {
      return true
    }
  }
  return false
}

/**
 * Filter a record of MCP server configs by managed policy (allowedMcpServers /
 * deniedMcpServers). Servers blocked by policy are dropped and their names
 * returned so callers can warn the user.
 *
 * Intended for user-controlled config entry points that bypass the policy filter
 * in getClaudeCodeMcpConfigs(): --mcp-config (main.tsx) and the mcp_set_servers
 * control message (print.ts, SDK V2 Query.setMcpServers()).
 *
 * SDK-type servers are exempt — they are SDK-managed transport placeholders,
 * not CLI-managed connections. The CLI never spawns a process or opens a
 * network connection for them; tool calls route back to the SDK via
 * mcp_tool_call. URL/command-based allowlist entries are meaningless for them
 * (no url, no command), and gating by name would silently drop them during
 * installPluginsAndApplyMcpInBackground's sdkMcpConfigs carry-forward.
 *
 * The generic has no type constraint because the two callsites use different
 * config type families: main.tsx uses ScopedMcpServerConfig (service type,
 * args: string[] required), print.ts uses McpServerConfigForProcessTransport
 * (SDK wire type, args?: string[] optional). Both are structurally compatible
 * with what isMcpServerAllowedByPolicy actually reads (type/url/command/args)
 * — the policy check only reads, never requires any field to be present.
 * The `as McpServerConfig` widening is safe for that reason; the downstream
 * checks tolerate missing/undefined fields: `config` is optional, and
 * `getServerCommandArray` defaults `args` to `[]` via `?? []`.
 */
export function filterMcpServersByPolicy<T>(configs: Record<string, T>): {
  allowed: Record<string, T>
  blocked: string[]
} {
  const allowed: Record<string, T> = Object.create(null)
  const blocked: string[] = []
  for (const [name, config] of Object.entries(configs)) {
    const c = config as McpServerConfig
    if (c.type === 'sdk' || isMcpServerAllowedByPolicy(name, c)) {
      allowed[name] = config
    } else {
      blocked.push(name)
    }
  }
  return { allowed, blocked }
}

const MCP_ENV_VAR_REF_RE = /\$\{[^}]+\}/

/**
 * 2.1.305 #1056 (SEA pUs): Returns true only when `command`, `args`, `url`,
 * or `headers` contains a `${VAR}` reference — intentionally excludes `env`.
 */
export function hasEnvVarInCommandArgsUrlOrHeaders(
  config: McpServerConfig,
): boolean {
  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = config as McpStdioServerConfig
      if (MCP_ENV_VAR_REF_RE.test(stdioConfig.command)) return true
      return stdioConfig.args.some(arg => MCP_ENV_VAR_REF_RE.test(arg))
    }
    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = config as
        | McpSSEServerConfig
        | McpHTTPServerConfig
        | McpWebSocketServerConfig
      if (MCP_ENV_VAR_REF_RE.test(remoteConfig.url)) return true
      if (remoteConfig.headers) {
        return Object.values(remoteConfig.headers).some(v =>
          MCP_ENV_VAR_REF_RE.test(v),
        )
      }
      return false
    }
    default:
      return false
  }
}

/**
 * Internal utility: Expands environment variables in an MCP server config
 */
function expandEnvVars(config: McpServerConfig): {
  expanded: McpServerConfig
  missingVars: string[]
} {
  const missingVars: string[] = []

  function expandString(str: string): string {
    const { expanded, missingVars: vars } = expandEnvVarsInString(str)
    missingVars.push(...vars)
    return expanded
  }

  let expanded: McpServerConfig

  switch (config.type) {
    case undefined:
    case 'stdio': {
      const stdioConfig = config as McpStdioServerConfig
      expanded = {
        ...stdioConfig,
        command: expandString(stdioConfig.command),
        args: stdioConfig.args.map(expandString),
        env: stdioConfig.env
          ? mapValues(stdioConfig.env, expandString)
          : undefined,
      }
      break
    }
    case 'sse':
    case 'http':
    case 'ws': {
      const remoteConfig = config as
        | McpSSEServerConfig
        | McpHTTPServerConfig
        | McpWebSocketServerConfig
      expanded = {
        ...remoteConfig,
        url: expandString(remoteConfig.url),
        headers: remoteConfig.headers
          ? mapValues(remoteConfig.headers, expandString)
          : undefined,
      }
      break
    }
    case 'sse-ide':
    case 'ws-ide':
      expanded = config
      break
    case 'sdk':
      expanded = config
      break
    case 'claudeai-proxy':
      expanded = config
      break
  }

  return {
    expanded,
    missingVars: [...new Set(missingVars)],
  }
}

const MCP_CONFIG_LOCK_CONFIRM_DELAYS_MS = [50, 150, 450] as const

/**
 * Official `Fje` / `Kso` / `iCt` (#1625) — when locked write to user/local
 * config returns false, wait and re-read from disk to confirm whether another
 * holder wrote or left the file locked, throwing a clear exit-1 error if not.
 */
export async function confirmMcpConfigWrite(
  name: string,
  scope: 'user' | 'local',
  op: 'add' | 'remove',
  readGlobalConfigFromDisk?: () => Promise<Record<string, unknown> | undefined>,
): Promise<void> {
  const filePath = getGlobalClaudeFile()
  const projectKey = scope === 'local' ? getProjectPathForConfig() : undefined
  const readDisk =
    readGlobalConfigFromDisk ??
    (async () => {
      const { readFile } = await import('fs/promises')
      try {
        const raw = await readFile(filePath, 'utf-8')
        return JSON.parse(raw) as Record<string, unknown>
      } catch (err) {
        if ((err as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') {
          return undefined
        }
        throw err
      }
    })

  let parsed: Record<string, unknown> | undefined
  for (let i = 0; ; i++) {
    try {
      parsed = await readDisk()
      break
    } catch (err) {
      const delay = MCP_CONFIG_LOCK_CONFIRM_DELAYS_MS[i]
      if (delay !== undefined) {
        await new Promise(resolve => setTimeout(resolve, delay))
        continue
      }
      const action = op === 'add' ? 'saved' : 'removed'
      const fromScope = projectKey !== undefined ? ` from ${projectKey}` : ''
      throw new Error(
        `MCP server "${name}" may not have been ${action}${fromScope}: ${filePath} could not be read to confirm the change (${err instanceof Error ? err.message : String(err)}).`,
      )
    }
  }

  if (op === 'remove' && parsed === undefined) {
    throw new Error(
      `MCP server "${name}" may not have been removed${projectKey !== undefined ? ` from ${projectKey}` : ''}: ${filePath} could not be read to confirm the change (the file was not found).`,
    )
  }

  const container =
    projectKey === undefined
      ? parsed
      : typeof parsed?.projects === 'object' && parsed.projects !== null
        ? (parsed.projects as Record<string, unknown>)[projectKey]
        : undefined
  const mcpServers =
    typeof container === 'object' && container !== null
      ? (container as Record<string, unknown>).mcpServers
      : undefined
  const isPresent =
    typeof mcpServers === 'object' &&
    mcpServers !== null &&
    Object.hasOwn(mcpServers, name)
  if (isPresent === (op === 'add')) {
    return
  }

  const verb =
    op === 'add'
      ? `was not saved to ${filePath}`
      : `was not removed from ${filePath}`
  const retryVerb =
    op === 'add' ? 'add the server again' : 'remove the server again'
  throw new Error(
    `MCP server "${name}" ${verb}${projectKey !== undefined ? ` for ${projectKey}` : ''}. If other Claude Code processes use that file, they may have kept it locked: ${retryVerb}, with CLAUDE_CODE_CONFIG_LOCK_WAIT_MS=60000 set to wait up to a minute. If that file is read-only or protected by a sandbox, make it writable or run the command outside the sandbox first.`,
  )
}

/**
 * Add a new MCP server configuration
 * @param name The name of the server
 * @param config The server configuration
 * @param scope The configuration scope
 * @throws Error if name is invalid or server already exists, or if the config is invalid
 */
export async function addMcpConfig(
  name: string,
  config: unknown,
  scope: ConfigScope,
): Promise<void> {
  if (name.match(/[^a-zA-Z0-9_-]/)) {
    throw new Error(
      `Invalid name ${name}. Names can only contain letters, numbers, hyphens, and underscores.`,
    )
  }

  // Block reserved server name "claude-in-chrome"
  if (isClaudeInChromeMCPServer(name)) {
    throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
  }

  if (feature('CHICAGO_MCP')) {
    const { isComputerUseMCPServer } = await import(
      '../../utils/computerUse/common.js'
    )
    if (isComputerUseMCPServer(name)) {
      throw new Error(`Cannot add MCP server "${name}": this name is reserved.`)
    }
  }

  // Block adding servers when enterprise MCP config exists (it has exclusive control)
  if (doesEnterpriseMcpConfigExist()) {
    throw new Error(
      `Cannot add MCP server: enterprise MCP configuration is active and has exclusive control over MCP servers`,
    )
  }

  // Validate config first (needed for command-based policy checks)
  const result = McpServerConfigSchema().safeParse(config)
  if (!result.success) {
    throw new Error(formatMcpServerConfigValidationError(config, result.error))
  }
  const validatedConfig = result.data

  // Check denylist (with config for command-based checks)
  if (isMcpServerDenied(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": server is explicitly blocked by enterprise policy`,
    )
  }

  // Check allowlist (with config for command-based checks)
  if (!isMcpServerAllowedByPolicy(name, validatedConfig)) {
    throw new Error(
      `Cannot add MCP server "${name}": not allowed by enterprise policy`,
    )
  }

  // Check if server already exists in the target scope
  switch (scope) {
    case 'project': {
      const { mcpServers } = await readRawProjectMcpJson()
      if (Object.hasOwn(mcpServers, name)) {
        throw new Error(`MCP server ${name} already exists in .mcp.json`)
      }
      break
    }
    case 'user': {
      const globalConfig = getGlobalConfig()
      if (globalConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in user config`)
      }
      break
    }
    case 'local': {
      const projectConfig = getCurrentProjectConfig()
      if (projectConfig.mcpServers?.[name]) {
        throw new Error(`MCP server ${name} already exists in local config`)
      }
      break
    }
    case 'dynamic':
      throw new Error('Cannot add MCP server to scope: dynamic')
    case 'enterprise':
      throw new Error('Cannot add MCP server to scope: enterprise')
    case 'claudeai':
      throw new Error('Cannot add MCP server to scope: claudeai')
  }

  // Add based on scope
  switch (scope) {
    case 'project': {
      const { mcpJson, mcpServers } = await readRawProjectMcpJson()
      if (hasTopLevelServersWithoutMcpServersKey(mcpJson)) {
        throw new Error(
          `Can't add to .mcp.json: it lists servers at the top level, and adding an "mcpServers" key would stop a plugin from loading them. Move them under "mcpServers", then try again. If they aren't servers, add "mcpServers": {} to the file instead.`,
        )
      }
      mcpServers[name] = validatedConfig
      // Preserve all other top-level keys (e.g. $schema, servers) in .mcp.json (#378)
      const nextJson = { ...mcpJson, mcpServers }

      // Write back to .mcp.json
      try {
        await writeMcpjsonFile(nextJson)
      } catch (error) {
        throw new Error(`Failed to write to .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      const saved = (
        saveGlobalConfig as (
          updater: (
            current: ReturnType<typeof getGlobalConfig>,
          ) => ReturnType<typeof getGlobalConfig>,
        ) => unknown
      )(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      if ((await Promise.resolve(saved)) === false) {
        await confirmMcpConfigWrite(name, scope, 'add')
      }
      break
    }

    case 'local': {
      const saved = (
        saveCurrentProjectConfig as (
          updater: (
            current: ReturnType<typeof getCurrentProjectConfig>,
          ) => ReturnType<typeof getCurrentProjectConfig>,
        ) => unknown
      )(current => ({
        ...current,
        mcpServers: {
          ...current.mcpServers,
          [name]: validatedConfig,
        },
      }))
      if ((await Promise.resolve(saved)) === false) {
        await confirmMcpConfigWrite(name, scope, 'add')
      }
      break
    }

    default:
      throw new Error(`Cannot add MCP server to scope: ${scope}`)
  }
}

/**
 * Remove an MCP server configuration
 * @param name The name of the server to remove
 * @param scope The configuration scope
 * @throws Error if server not found in specified scope
 */
export async function removeMcpConfig(
  name: string,
  scope: ConfigScope,
): Promise<void> {
  switch (scope) {
    case 'project': {
      const { mcpJson, mcpServers } = await readRawProjectMcpJson()

      if (!Object.hasOwn(mcpServers, name)) {
        throw new Error(`No MCP server found with name: ${name} in .mcp.json`)
      }

      delete mcpServers[name]
      // Preserve all other top-level keys (e.g. $schema, servers) in .mcp.json (#378)
      const nextJson = { ...mcpJson, mcpServers }
      try {
        await writeMcpjsonFile(nextJson)
      } catch (error) {
        throw new Error(`Failed to remove from .mcp.json: ${error}`)
      }
      break
    }

    case 'user': {
      const config = getGlobalConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No user-scoped MCP server found with name: ${name}`)
      }
      const saved = (
        saveGlobalConfig as (
          updater: (
            current: ReturnType<typeof getGlobalConfig>,
          ) => ReturnType<typeof getGlobalConfig>,
        ) => unknown
      )(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      if ((await Promise.resolve(saved)) === false) {
        await confirmMcpConfigWrite(name, scope, 'remove')
      }
      break
    }

    case 'local': {
      // Check if server exists before updating
      const config = getCurrentProjectConfig()
      if (!config.mcpServers?.[name]) {
        throw new Error(`No project-local MCP server found with name: ${name}`)
      }
      const saved = (
        saveCurrentProjectConfig as (
          updater: (
            current: ReturnType<typeof getCurrentProjectConfig>,
          ) => ReturnType<typeof getCurrentProjectConfig>,
        ) => unknown
      )(current => {
        const { [name]: _, ...restMcpServers } = current.mcpServers ?? {}
        return {
          ...current,
          mcpServers: restMcpServers,
        }
      })
      if ((await Promise.resolve(saved)) === false) {
        await confirmMcpConfigWrite(name, scope, 'remove')
      }
      break
    }

    default:
      throw new Error(`Cannot remove MCP server from scope: ${scope}`)
  }
}

/**
 * Get MCP configs from current directory only (no parent traversal).
 * Used by addMcpConfig and removeMcpConfig to modify the local .mcp.json file.
 * Exported for testing purposes.
 *
 * @returns Servers with scope information and any validation errors from current directory's .mcp.json
 */
export function getProjectMcpConfigsFromCwd(): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  // Check if project source is enabled
  if (!isSettingSourceEnabled('projectSettings')) {
    return { servers: {}, errors: [] }
  }

  const mcpJsonPath = join(getCwd(), '.mcp.json')

  const { config, errors } = parseMcpConfigFromFilePath({
    filePath: mcpJsonPath,
    expandVars: true,
    scope: 'project',
  })

  // Missing .mcp.json is expected, but malformed files should report errors
  if (!config) {
    const nonMissingErrors = errors.filter(
      e => !e.message.startsWith('MCP config file not found'),
    )
    if (nonMissingErrors.length > 0) {
      logForDebugging(
        `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
        { level: 'error' },
      )
      return { servers: {}, errors: nonMissingErrors }
    }
    return { servers: {}, errors: [] }
  }

  return {
    servers: config.mcpServers
      ? addScopeToServers(config.mcpServers, 'project', getCwd())
      : {},
    errors: errors || [],
  }
}

/**
 * densable hP / SZp — MCP configs for one scope.
 * Pass `{ expandVars: false }` for diagnostics that must show configured
 * `${VAR}` forms (densable 2.1.234 #13 displayServers).
 */
export function getMcpConfigsByScope(
  scope: 'project' | 'user' | 'local' | 'enterprise',
  options?: { expandVars?: boolean },
): {
  servers: Record<string, ScopedMcpServerConfig>
  errors: ValidationError[]
} {
  const expandVars = options?.expandVars ?? true
  // Check if this source is enabled
  const sourceMap: Record<
    string,
    'projectSettings' | 'userSettings' | 'localSettings'
  > = {
    project: 'projectSettings',
    user: 'userSettings',
    local: 'localSettings',
  }

  if (scope in sourceMap && !isSettingSourceEnabled(sourceMap[scope]!)) {
    return { servers: Object.create(null), errors: [] }
  }

  switch (scope) {
    case 'project': {
      const allServers: Record<string, ScopedMcpServerConfig> =
        Object.create(null)
      const allErrors: ValidationError[] = []

      // Build list of directories to check
      const dirs: string[] = []
      let currentDir = getCwd()

      while (currentDir !== parse(currentDir).root) {
        dirs.push(currentDir)
        currentDir = dirname(currentDir)
      }

      // Process from root downward to CWD (so closer files have higher priority)
      for (const dir of dirs.reverse()) {
        const mcpJsonPath = join(dir, '.mcp.json')

        const { config, errors } = parseMcpConfigFromFilePath({
          filePath: mcpJsonPath,
          expandVars,
          scope: 'project',
        })

        // Missing .mcp.json in parent directories is expected, but malformed files should report errors
        if (!config) {
          const nonMissingErrors = errors.filter(
            e => !e.message.startsWith('MCP config file not found'),
          )
          if (nonMissingErrors.length > 0) {
            logForDebugging(
              `MCP config errors for ${mcpJsonPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
              { level: 'error' },
            )
            allErrors.push(...nonMissingErrors)
          }
          continue
        }

        if (config.mcpServers) {
          // Merge servers, with files closer to CWD overriding parent configs
          // Official 2.1.325 #2302: stamp declaredIn with the .mcp.json folder.
          Object.assign(
            allServers,
            addScopeToServers(config.mcpServers, scope, dir),
          )
        }

        if (errors.length > 0) {
          allErrors.push(...errors)
        }
      }

      return {
        servers: allServers,
        errors: allErrors,
      }
    }
    case 'user': {
      const mcpServers = getGlobalConfig().mcpServers
      if (!mcpServers) {
        return { servers: Object.create(null), errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars,
        scope: 'user',
        // densable 2.1.243 #30 — ~/.claude.json must be named on /status.
        filePath: getGlobalClaudeFile(),
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope),
        errors,
      }
    }
    case 'local': {
      const mcpServers = getCurrentProjectConfig().mcpServers
      if (!mcpServers) {
        return { servers: {}, errors: [] }
      }

      const { config, errors } = parseMcpConfig({
        configObject: { mcpServers },
        expandVars,
        scope: 'local',
        // Local MCP lives in the same ~/.claude.json projects map.
        filePath: getGlobalClaudeFile(),
      })

      return {
        servers: addScopeToServers(config?.mcpServers, scope, getCwd()),
        errors,
      }
    }
    case 'enterprise': {
      const enterpriseMcpPath = getEnterpriseMcpFilePath()

      const { config, errors } = parseMcpConfigFromFilePath({
        filePath: enterpriseMcpPath,
        expandVars,
        scope: 'enterprise',
      })

      // Missing enterprise config file is expected, but malformed files should report errors
      if (!config) {
        const nonMissingErrors = errors.filter(
          e => !e.message.startsWith('MCP config file not found'),
        )
        if (nonMissingErrors.length > 0) {
          logForDebugging(
            `Enterprise MCP config errors for ${enterpriseMcpPath}: ${jsonStringify(nonMissingErrors.map(e => e.message))}`,
            { level: 'error' },
          )
          return { servers: {}, errors: nonMissingErrors }
        }
        return { servers: {}, errors: [] }
      }

      return {
        servers: addScopeToServers(config.mcpServers, scope),
        errors,
      }
    }
  }
}

/**
 * Official Oio(e, n) @293143537: scope-level policy block reason for an MCP server.
 * Returns 'managed-policy' when enterprise/plugin-only lockdown rejects non-managed scopes,
 * 'project-approval' when a project-scoped server is not approved, or null if admitted.
 */
export function getMcpServerPolicyBlockReason(
  name: string,
  config: ScopedMcpServerConfig,
): 'managed-policy' | 'project-approval' | null {
  const scope = config.scope
  if (scope !== 'user' && scope !== 'project' && scope !== 'local') {
    return null
  }
  if (doesEnterpriseMcpConfigExist() || isRestrictedToPluginOnly('mcp')) {
    return 'managed-policy'
  }
  if (scope === 'project') {
    return getProjectMcpServerStatus(name) === 'approved'
      ? null
      : 'project-approval'
  }
  return null
}

/**
 * Get an MCP server configuration by name
 * @param name The name of the server
 * @returns The server configuration with scope, or undefined if not found
 */
export function getMcpConfigByName(name: string): ScopedMcpServerConfig | null {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  // Official AM/Oio: when enterprise MCP config exists or MCP is locked to
  // plugin-only, only enterprise servers are reachable by name. User/project/local
  // servers are blocked — same as getClaudeCodeMcpConfigs().
  if (doesEnterpriseMcpConfigExist() || isRestrictedToPluginOnly('mcp')) {
    return enterpriseServers[name] ?? null
  }

  const { servers: userServers } = getMcpConfigsByScope('user')
  const { servers: projectServers } = getMcpConfigsByScope('project')
  const { servers: localServers } = getMcpConfigsByScope('local')

  if (enterpriseServers[name]) {
    return enterpriseServers[name]
  }
  if (localServers[name]) {
    return localServers[name]
  }
  // Official: only approved project (.mcp.json) servers are reachable by name
  // for connection paths. Pending/rejected are surfaceable via list/get only.
  if (projectServers[name] && getProjectMcpServerStatus(name) === 'approved') {
    return projectServers[name]
  }
  if (userServers[name]) {
    return userServers[name]
  }

  return null
}

/**
 * Get Claude Code MCP configurations (excludes claude.ai servers from the
 * returned set — they're fetched separately and merged by callers).
 * This is fast: only local file reads; no awaited network calls on the
 * critical path. The optional extraDedupTargets promise (e.g. the in-flight
 * claude.ai connector fetch) is awaited only after loadAllPluginsCacheOnly() completes,
 * so the two overlap rather than serialize.
 * @returns Claude Code server configurations with appropriate scopes
 */
export async function getClaudeCodeMcpConfigs(
  dynamicServers: Record<string, ScopedMcpServerConfig> = {},
  extraDedupTargets: Promise<
    Record<string, ScopedMcpServerConfig>
  > = Promise.resolve({}),
): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  const { servers: enterpriseServers } = getMcpConfigsByScope('enterprise')

  // If an enterprise mcp config exists, do not use any others; this has exclusive control over all MCP servers
  // (enterprise customers often do not want their users to be able to add their own MCP servers).
  if (doesEnterpriseMcpConfigExist()) {
    // Apply policy filtering to enterprise servers
    const filtered: Record<string, ScopedMcpServerConfig> = Object.create(null)

    for (const [name, serverConfig] of Object.entries(enterpriseServers)) {
      if (!isMcpServerAllowedByPolicy(name, serverConfig)) {
        continue
      }
      filtered[name] = serverConfig
    }

    return { servers: filtered, errors: [] }
  }

  // Load other scopes — unless the managed policy locks MCP to plugin-only.
  // Unlike the enterprise-exclusive block above, this keeps plugin servers.
  const mcpLocked = isRestrictedToPluginOnly('mcp')
  const noServers: { servers: Record<string, ScopedMcpServerConfig> } = {
    servers: Object.create(null),
  }
  const { servers: userServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('user')
  const { servers: projectServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('project')
  const { servers: localServers } = mcpLocked
    ? noServers
    : getMcpConfigsByScope('local')

  // Load plugin MCP servers
  const pluginMcpServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)

  setCloudPluginStartupPending(true)
  let pluginResult: Awaited<ReturnType<typeof loadAllPluginsCacheOnly>>
  try {
    pluginResult = await loadAllPluginsCacheOnly()
  } finally {
    setCloudPluginStartupPending(false)
  }

  // Collect MCP-specific errors during server loading
  const mcpErrors: PluginError[] = []

  // Log any plugin loading errors - NEVER silently fail in production
  if (pluginResult.errors.length > 0) {
    for (const error of pluginResult.errors) {
      // Only log as MCP error if it's actually MCP-related
      // Otherwise just log as debug since the plugin might not have MCP servers
      if (
        error.type === 'mcp-config-invalid' ||
        error.type === 'mcpb-download-failed' ||
        error.type === 'mcpb-extract-failed' ||
        error.type === 'mcpb-invalid-manifest'
      ) {
        const errorMessage = `Plugin MCP loading error - ${error.type}: ${getPluginErrorMessage(error)}`
        logError(new Error(errorMessage))
      } else {
        // Plugin doesn't exist or isn't available - this is common and not necessarily an error
        // The plugin system will handle installing it if possible
        const errorType = error.type
        logForDebugging(
          `Plugin not available for MCP: ${error.source} - error type: ${errorType}`,
        )
      }
    }
  }

  // Process enabled plugins for MCP servers in parallel
  const pluginServerResults = await Promise.all(
    pluginResult.enabled.map(plugin => getPluginMcpServers(plugin, mcpErrors)),
  )
  for (const servers of pluginServerResults) {
    if (servers) {
      Object.assign(pluginMcpServers, servers)
    }
  }

  // Add any MCP-specific errors from server loading to plugin errors
  if (mcpErrors.length > 0) {
    for (const error of mcpErrors) {
      const errorMessage = `Plugin MCP server error - ${error.type}: ${getPluginErrorMessage(error)}`
      logError(new Error(errorMessage))
    }
  }

  // Filter project servers to only include approved ones
  const approvedProjectServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)
  for (const [name, config] of Object.entries(projectServers)) {
    if (getProjectMcpServerStatus(name) === 'approved') {
      approvedProjectServers[name] = config
    }
  }

  // Dedup plugin servers against manually-configured ones (and each other).
  // Plugin server keys are namespaced `plugin:x:y` so they never collide with
  // manual keys in the merge below — this content-based filter catches the case
  // where both would launch the same underlying process/connection.
  // Only servers that will actually connect are valid dedup targets — a
  // disabled manual server mustn't suppress a plugin server, or neither runs
  // (manual is skipped by name at connection time; plugin was removed here).
  const extraTargets = await extraDedupTargets
  const enabledManualServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)
  for (const [name, config] of Object.entries(
    Object.assign(
      Object.create(null) as Record<string, ScopedMcpServerConfig>,
      userServers,
      approvedProjectServers,
      localServers,
      dynamicServers,
      extraTargets,
    ) as Record<string, ScopedMcpServerConfig>,
  )) {
    if (
      !isMcpServerDisabled(name) &&
      isMcpServerAllowedByPolicy(name, config)
    ) {
      enabledManualServers[name] = config
    }
  }
  // Split off disabled/policy-blocked plugin servers so they don't win the
  // first-plugin-wins race against an enabled duplicate — same invariant as
  // above. They're merged back after dedup so they still appear in /mcp
  // (policy filtering at the end of this function drops blocked ones).
  const enabledPluginServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)
  const disabledPluginServers: Record<string, ScopedMcpServerConfig> =
    Object.create(null)
  for (const [name, config] of Object.entries(pluginMcpServers)) {
    // Plugin keys now reach the approval dialog (collectPendingProjectMcpApprovals),
    // which persists the answer to enabled/disabledMcpjsonServers — a different
    // key from the disabledMcpServers that isMcpServerDisabled reads. Without
    // this check "don't use this server" writes a setting nothing consults, the
    // server starts anyway, and the status flips to rejected so the user is
    // never asked again. Only an explicit rejection gates here: a plugin server
    // that was never asked about stays enabled, as before 2.1.246.
    if (
      isMcpServerDisabled(name) ||
      getProjectMcpServerStatus(name) === 'rejected' ||
      !isMcpServerAllowedByPolicy(name, config)
    ) {
      disabledPluginServers[name] = config
    } else {
      enabledPluginServers[name] = config
    }
  }
  const { servers: dedupedPluginServers, suppressed } = dedupPluginMcpServers(
    enabledPluginServers,
    enabledManualServers,
  )
  Object.assign(dedupedPluginServers, disabledPluginServers)
  // Surface suppressions in /plugin UI. Pushed AFTER the logError loop above
  // so these don't go to the error log — they're informational, not errors.
  for (const { name, duplicateOf } of suppressed) {
    // name is "plugin:${pluginName}:${serverName}" from addPluginScopeToServers
    const parts = name.split(':')
    if (parts[0] !== 'plugin' || parts.length < 3) continue
    mcpErrors.push({
      type: 'mcp-server-suppressed-duplicate',
      source: name,
      plugin: parts[1]!,
      serverName: parts.slice(2).join(':'),
      duplicateOf,
    })
  }

  // Merge in order of precedence: plugin < user < project < local
  const configs = Object.assign(
    Object.create(null) as Record<string, ScopedMcpServerConfig>,
    dedupedPluginServers,
    userServers,
    approvedProjectServers,
    localServers,
  )

  // Apply policy filtering to merged configs
  const filtered: Record<string, ScopedMcpServerConfig> = Object.create(null)

  for (const [name, serverConfig] of Object.entries(configs)) {
    if (!isMcpServerAllowedByPolicy(name, serverConfig as McpServerConfig)) {
      continue
    }
    filtered[name] = serverConfig as ScopedMcpServerConfig
  }

  return { servers: filtered, errors: mcpErrors }
}

/**
 * Get all MCP configurations across all scopes, including claude.ai servers.
 * This may be slow due to network calls - use getClaudeCodeMcpConfigs() for fast startup.
 * @returns All server configurations with appropriate scopes
 */
export async function getAllMcpConfigs(): Promise<{
  servers: Record<string, ScopedMcpServerConfig>
  errors: PluginError[]
}> {
  // When enterprise lockdown is enabled, suppress claude.ai connectors by default.
  // Admins can override with allowAllClaudeAiMcps: true in managed settings.
  if (shouldSuppressClaudeAiMcps()) {
    return getClaudeCodeMcpConfigs()
  }

  // Kick off the claude.ai fetch before getClaudeCodeMcpConfigs so it overlaps
  // with loadAllPluginsCacheOnly() inside. Memoized — the awaited call below is a cache hit.
  const claudeaiPromise = fetchClaudeAIMcpConfigsIfEligible()
  const { servers: claudeCodeServers, errors } = await getClaudeCodeMcpConfigs(
    {},
    claudeaiPromise,
  )
  const { allowed: claudeaiMcpServers } = filterMcpServersByPolicy(
    await claudeaiPromise,
  )

  // Suppress claude.ai connectors that duplicate an enabled manual server.
  // Keys never collide (`slack` vs `claude.ai Slack`) so the merge below
  // won't catch this — need content-based dedup by URL signature.
  const { servers: dedupedClaudeAi } = dedupClaudeAiMcpServers(
    claudeaiMcpServers as Record<string, ScopedMcpServerConfig>,
    claudeCodeServers,
  )

  // Merge with claude.ai having lowest precedence
  const servers = Object.assign(
    Object.create(null) as Record<string, ScopedMcpServerConfig>,
    dedupedClaudeAi,
    claudeCodeServers,
  )

  return { servers, errors }
}

/**
 * densable 2.1.219 #4 — per-type schema map (densable `uSs`).
 * Unknown type strings soft-skip with skipReason `unknown_type`.
 * `streamable-http` is an alias of `http`.
 */
const MCP_SERVER_TYPE_SCHEMA_MAP: Record<
  string,
  () => z.ZodType<McpServerConfig>
> = {
  stdio: () => McpStdioServerConfigSchema() as z.ZodType<McpServerConfig>,
  sse: () => McpSSEServerConfigSchema() as z.ZodType<McpServerConfig>,
  http: () => McpHTTPServerConfigSchema() as z.ZodType<McpServerConfig>,
  'streamable-http': () =>
    McpHTTPServerConfigSchema() as z.ZodType<McpServerConfig>,
  ws: () => McpWebSocketServerConfigSchema() as z.ZodType<McpServerConfig>,
  sdk: () => McpSdkServerConfigSchema() as z.ZodType<McpServerConfig>,
  'claudeai-proxy': () =>
    McpClaudeAIProxyServerConfigSchema() as z.ZodType<McpServerConfig>,
  // Local extras (IDE transports) — densable uSs omits these; keep for non-CLI sources.
  'sse-ide': () => McpSSEIDEServerConfigSchema() as z.ZodType<McpServerConfig>,
  'ws-ide': () =>
    McpWebSocketIDEServerConfigSchema() as z.ZodType<McpServerConfig>,
}

/** densable `jyy` — collect leading/trailing whitespace field paths. */
function collectMcpConfigWhitespacePaths(config: McpServerConfig): string[] {
  const paths: string[] = []
  const check = (path: string, value: string): void => {
    if (value !== value.trim()) paths.push(path)
  }
  if ('command' in config && typeof config.command === 'string') {
    check('command', config.command)
  }
  if ('url' in config && typeof config.url === 'string') {
    check('url', config.url)
  }
  if ('args' in config && Array.isArray(config.args)) {
    config.args.forEach((arg, i) => {
      if (typeof arg === 'string') check(`args[${i}]`, arg)
    })
  }
  if ('env' in config && config.env && typeof config.env === 'object') {
    for (const [k, v] of Object.entries(config.env)) {
      if (k !== k.trim()) paths.push(`env name ${JSON.stringify(k)}`)
      if (typeof v === 'string') check(`env.${k}`, v)
    }
  }
  if (
    'headers' in config &&
    config.headers &&
    typeof config.headers === 'object'
  ) {
    for (const [k, v] of Object.entries(config.headers)) {
      if (k !== k.trim()) paths.push(`header name ${JSON.stringify(k)}`)
      if (typeof v === 'string') check(`headers.${k}`, v)
    }
  }
  return paths
}

/**
 * densable `$It` subset — reserved built-in MCP server names (non-sdk).
 * Soft-skipped with skipReason `reserved_name` rather than hard-fail.
 */
function isReservedMcpServerName(name: string): boolean {
  return isClaudeInChromeMCPServer(name) || isComputerUseMCPServer(name)
}

/**
 * densable 2.1.219 #4 — store for `--mcp-config` soft-skip entries
 * (densable `gEm` / `yEm` / `hEm`). Surfaced on stream-json init as
 * `mcp_server_errors` and as a TTY startup warning.
 */
export type McpConfigServerError = {
  name: string
  type: string
  message: string
}

/** densable `gEm` */
export function storeMcpConfigServerErrors(
  errors: ReadonlyArray<McpConfigServerError>,
): void {
  getHostMcpConfigState().mcpConfigServerErrorsStore.push(...errors)
}

/** densable `yEm` */
export function getMcpConfigServerErrors(): McpConfigServerError[] {
  return getHostMcpConfigState().mcpConfigServerErrorsStore
}

/** Test / process-reset helper. */
export function resetMcpConfigServerErrors(): void {
  getHostMcpConfigState().mcpConfigServerErrorsStore = []
}

/**
 * Parse and validate an MCP configuration object.
 *
 * densable 2.1.219 #4 (`Tlr`): top-level shape is only
 * `{ mcpServers: Record<string, unknown> }`. Each entry is validated
 * independently — invalid entries are soft-skipped with
 * `mcpErrorMetadata.skipReason` and do NOT null the whole config.
 * Fatal only when the top-level shape itself is invalid.
 */
export function parseMcpConfig(params: {
  configObject: unknown
  expandVars: boolean
  scope: ConfigScope
  filePath?: string
  /** densable `bridgeSessionId` — carrier-child rewrite. */
  bridgeSessionId?: string
  /** densable `hostCarrier` — force carrier-child arm. */
  hostCarrier?: boolean
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const {
    configObject,
    expandVars,
    scope,
    filePath,
    bridgeSessionId,
    hostCarrier,
  } = params
  const carrierChild = isBridgeCarrierChild({ hostCarrier })
  // densable: v.object({mcpServers:v.record(v.string(),v.unknown())})
  const topLevel = z
    .object({ mcpServers: z.record(z.string(), z.unknown()) })
    .safeParse(configObject)
  if (!topLevel.success) {
    const usedServersKey =
      configObject !== null &&
      typeof configObject === 'object' &&
      'servers' in configObject &&
      !('mcpServers' in configObject)
    return {
      config: null,
      errors: topLevel.error.issues.map(issue => ({
        ...(filePath && { file: filePath }),
        path: issue.path.join('.'),
        message: usedServersKey
          ? 'Missing "mcpServers" — found "servers" instead. Claude Code reads MCP servers from the "mcpServers" key.'
          : issue.message,
        ...(usedServersKey && {
          suggestion: `Rename the top-level "servers" key to "mcpServers" in ${filePath ?? 'your MCP config'}.`,
        }),
        mcpErrorMetadata: {
          scope,
          severity: 'fatal' as const,
        },
      })),
    }
  }

  const errors: ValidationError[] = []
  const validatedServers: Record<string, McpServerConfig> = Object.create(null)

  const pushSkip = (
    name: string,
    message: string,
    suggestion: string | undefined,
    skipReason: string,
  ): void => {
    errors.push({
      ...(filePath && { file: filePath }),
      path: `mcpServers.${name}`,
      message,
      ...(suggestion && { suggestion }),
      mcpErrorMetadata: {
        scope,
        serverName: name,
        severity: 'warning',
        skipReason,
      },
    })
  }

  // densable: raw input may carry "__proto__" that Zod stripped
  const rawServers =
    configObject &&
    typeof configObject === 'object' &&
    'mcpServers' in configObject &&
    (configObject as { mcpServers?: unknown }).mcpServers &&
    typeof (configObject as { mcpServers: unknown }).mcpServers === 'object'
      ? ((configObject as { mcpServers: Record<string, unknown> })
          .mcpServers as Record<string, unknown>)
      : null
  if (
    rawServers &&
    Object.hasOwn(rawServers, '__proto__') &&
    !Object.hasOwn(topLevel.data.mcpServers, '__proto__')
  ) {
    pushSkip(
      '__proto__',
      '"__proto__" is a reserved MCP server name and was not loaded',
      'Rename this server in your MCP config — "__proto__" cannot be used as a server name',
      'reserved_name',
    )
  }

  for (const [name, entry] of Object.entries(topLevel.data.mcpServers)) {
    const declaredType =
      entry &&
      typeof entry === 'object' &&
      'type' in entry &&
      typeof (entry as { type: unknown }).type === 'string'
        ? (entry as { type: string }).type
        : 'stdio'
    const schemaFn = Object.hasOwn(MCP_SERVER_TYPE_SCHEMA_MAP, declaredType)
      ? MCP_SERVER_TYPE_SCHEMA_MAP[declaredType]
      : undefined
    if (!schemaFn) {
      pushSkip(
        name,
        `Skipped — unknown MCP server type "${declaredType}" for server "${name}"`,
        'Valid types are: stdio, sse, http (or streamable-http), ws, sdk',
        'unknown_type',
      )
      continue
    }

    // densable uSs maps streamable-http → same schema as http; rewrite
    // type so the http literal schema accepts the entry.
    const entryForParse =
      declaredType === 'streamable-http' && entry && typeof entry === 'object'
        ? { ...(entry as Record<string, unknown>), type: 'http' }
        : entry
    const parsed = schemaFn().safeParse(entryForParse)
    if (!parsed.success) {
      if (
        entry !== null &&
        typeof entry === 'object' &&
        !('type' in entry) &&
        'url' in entry &&
        !('command' in entry)
      ) {
        pushSkip(
          name,
          `Skipped — MCP server "${name}" has a "url" but no "type"; add "type": "http" (or "sse" / "ws") to this entry`,
          undefined,
          'url_missing_type',
        )
        continue
      }
      const detail = parsed.error.issues
        .map(issue => {
          const path = issue.path.join('.') || '(root)'
          const msg = issue.message.replace(/^Invalid input: /, '')
          return `${path}: ${msg}`
        })
        .join('; ')
      pushSkip(
        name,
        `Skipped — invalid MCP server config for "${name}": ${detail}`,
        undefined,
        'invalid_config',
      )
      continue
    }

    const unexpandedConfig = parsed.data as McpServerConfig
    let configToCheck = unexpandedConfig

    // densable eft carrier arm: scope==="dynamic" && isBridgeCarrierChild
    if (scope === 'dynamic' && carrierChild) {
      const rewritten = rewriteBridgeCarrierMcpEntry(
        name,
        configToCheck,
        bridgeSessionId,
      )
      if ('drop' in rewritten) {
        pushSkip(
          name,
          `"${name}" ${BRIDGE_CARRIER_DROP_MESSAGES[rewritten.drop]}`,
          undefined,
          rewritten.drop,
        )
        continue
      }
      validatedServers[name] = markCliOwnedConfig(
        createRemoteMetaHttpConfig(rewritten.url, rewritten.sessionId),
      ) as McpServerConfig
      continue
    }

    // densable `$It` — reserved names soft-skip (sdk exempt)
    if (isReservedMcpServerName(name) && configToCheck.type !== 'sdk') {
      const reserved = isClaudeInChromeMCPServer(name)
        ? CLAUDE_IN_CHROME_MCP_SERVER_NAME
        : isComputerUseMCPServer(name)
          ? COMPUTER_USE_MCP_SERVER_NAME
          : name
      pushSkip(
        name,
        `"${name}" is a reserved MCP server name and was not loaded`,
        `Rename this server in your MCP config — "${reserved}" is reserved for internal use`,
        'reserved_name',
      )
      continue
    }

    const whitespacePaths = collectMcpConfigWhitespacePaths(configToCheck)
    if (whitespacePaths.length > 0) {
      errors.push({
        ...(filePath && { file: filePath }),
        path: `mcpServers.${name}`,
        message: `Leading or trailing whitespace in: ${whitespacePaths.join(', ')}`,
        suggestion: `Remove the whitespace from these values in the "${name}" entry — they are used exactly as written`,
        mcpErrorMetadata: {
          scope,
          serverName: name,
          severity: 'warning',
        },
      })
    }

    if (expandVars) {
      const { expanded, missingVars } = expandEnvVars(configToCheck)
      if (missingVars.length > 0) {
        errors.push({
          ...(filePath && { file: filePath }),
          path: `mcpServers.${name}`,
          message: `Missing environment variables: ${missingVars.join(', ')}`,
          suggestion: `Set the following environment variables: ${missingVars.join(', ')}`,
          mcpErrorMetadata: {
            scope,
            serverName: name,
            severity: 'warning',
          },
        })
      }
      configToCheck = expanded
    }

    // Check for Windows-specific npx usage without cmd wrapper
    if (
      getPlatform() === 'windows' &&
      (!configToCheck.type || configToCheck.type === 'stdio') &&
      'command' in configToCheck &&
      (configToCheck.command === 'npx' ||
        configToCheck.command.endsWith('\\npx') ||
        configToCheck.command.endsWith('/npx'))
    ) {
      errors.push({
        ...(filePath && { file: filePath }),
        path: `mcpServers.${name}`,
        message: `Windows requires 'cmd /c' wrapper to execute npx`,
        suggestion: `Change command to "cmd" with args ["/c", "npx", ...]. See: https://code.claude.com/docs/en/mcp#configure-mcp-servers`,
        mcpErrorMetadata: {
          scope,
          serverName: name,
          severity: 'warning',
        },
      })
    }

    if (
      scope === 'enterprise' &&
      hasEnvVarInCommandArgsUrlOrHeaders(unexpandedConfig)
    ) {
      validatedServers[name] = Object.assign({}, configToCheck, {
        expandedFromEnv: true,
      })
    } else {
      validatedServers[name] = configToCheck
    }
  }

  return {
    config: { mcpServers: validatedServers },
    errors,
  }
}

/**
 * Parse and validate an MCP configuration from a file path
 * @param params Parsing parameters
 * @returns Validated configuration with any errors
 */
export function parseMcpConfigFromFilePath(params: {
  filePath: string
  expandVars: boolean
  scope: ConfigScope
  /** densable `bridgeSessionId` — carrier-child rewrite. */
  bridgeSessionId?: string
  /** densable `hostCarrier` — force carrier-child arm. */
  hostCarrier?: boolean
}): {
  config: McpJsonConfig | null
  errors: ValidationError[]
} {
  const { filePath, expandVars, scope, bridgeSessionId, hostCarrier } = params
  const fs = getFsImplementation()

  let configContent: string
  try {
    configContent = fs.readFileSync(filePath, { encoding: 'utf8' })
  } catch (error: unknown) {
    const code = getErrnoCode(error)
    if (code === 'ENOENT') {
      return {
        config: null,
        errors: [
          {
            file: filePath,
            path: '',
            message: `MCP config file not found: ${filePath}`,
            suggestion: 'Check that the file path is correct',
            mcpErrorMetadata: {
              scope,
              severity: 'fatal',
            },
          },
        ],
      }
    }
    logForDebugging(
      `MCP config read error for ${filePath} (scope=${scope}): ${error}`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `Failed to read file: ${error}`,
          suggestion: 'Check file permissions and ensure the file exists',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  if (scope === 'project' && !configContent.trim()) {
    logForDebugging(`MCP config is blank, read as no servers: ${filePath}`)
    return {
      config: { mcpServers: Object.create(null) },
      errors: [],
    }
  }

  const parsedJson = safeParseJSON(configContent)

  if (!parsedJson) {
    const loc = findJsonSyntaxErrorLocation(configContent)
    const locSuffix = loc ? ` (line ${loc.line}, column ${loc.column})` : ''
    logForDebugging(
      `MCP config is not valid JSON: ${filePath} (scope=${scope}, length=${configContent.length}, first100=${jsonStringify(configContent.slice(0, 100))})`,
      { level: 'error' },
    )
    return {
      config: null,
      errors: [
        {
          file: filePath,
          path: '',
          message: `MCP config is not a valid JSON${locSuffix}`,
          ...(loc ? { line: loc.line, column: loc.column } : {}),
          suggestion: 'Fix the JSON syntax errors in the file',
          mcpErrorMetadata: {
            scope,
            severity: 'fatal',
          },
        },
      ],
    }
  }

  return parseMcpConfig({
    configObject: parsedJson,
    expandVars,
    scope,
    filePath,
    bridgeSessionId,
    hostCarrier,
  })
}

/**
 * Official 2.1.326 #87: Produce actionable per-transport validation errors for
 * `claude mcp add-json` instead of Zod's generic union `: Invalid input`.
 */
export function formatMcpServerConfigValidationError(
  config: unknown,
  unionError?: z.ZodError,
): string {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return 'Invalid configuration: not a JSON object. Pass a server object such as {"command": "..."} or {"type": "http", "url": "..."}.'
  }
  const rec = config as Record<string, unknown>
  if (
    'mcpServers' in rec &&
    !('command' in rec) &&
    !('url' in rec) &&
    !('type' in rec)
  ) {
    return 'Invalid configuration: leave out the "mcpServers" wrapper and pass a single server object directly.'
  }

  const rawType = rec.type
  if (rawType === undefined) {
    if ('url' in rec && !('command' in rec)) {
      return 'Invalid configuration: has a "url" but no "type". Set "type": "http" (or "sse" or "ws").'
    }
    if (!('command' in rec)) {
      return 'Invalid configuration: needs a "command" (for stdio) or a "type" and "url" (for http, sse, or ws).'
    }
    const stdioResult = McpStdioServerConfigSchema().safeParse(config)
    if (!stdioResult.success) {
      return formatZodIssuesForMcpConfig(stdioResult.error)
    }
  } else if (typeof rawType !== 'string') {
    return 'Invalid configuration: "type" must be a string (one of: stdio, http, sse, ws).'
  } else {
    const schemaByType: Record<string, () => z.ZodType> = {
      stdio: McpStdioServerConfigSchema,
      http: McpHTTPServerConfigSchema,
      'streamable-http': McpHTTPServerConfigSchema,
      sse: McpSSEServerConfigSchema,
      ws: McpWebSocketServerConfigSchema,
      sdk: McpSdkServerConfigSchema,
      'sse-ide': McpSSEIDEServerConfigSchema,
      'ws-ide': McpWebSocketIDEServerConfigSchema,
      'claudeai-proxy': McpClaudeAIProxyServerConfigSchema,
    }
    const getSchema = schemaByType[rawType]
    if (!getSchema) {
      return `Invalid configuration: unknown "type" "${rawType}". Expected one of: stdio, http, sse, ws.`
    }
    const transportResult = getSchema().safeParse(config)
    if (!transportResult.success) {
      return formatZodIssuesForMcpConfig(transportResult.error)
    }
  }

  if (unionError) {
    return formatZodIssuesForMcpConfig(unionError)
  }
  return 'Invalid configuration: check the required fields for this MCP server transport.'
}

function formatZodIssuesForMcpConfig(error: z.ZodError): string {
  const formattedErrors = error.issues
    .map(err => {
      const path = err.path.join('.')
      return path ? `${path}: ${err.message}` : err.message
    })
    .join(', ')
  return `Invalid configuration: ${formattedErrors}`
}

/**
 * Official 2.1.326 #3 & #292: Mid-session `managed-mcp.json` arrival detection
 * and user-facing explanation messages.
 */
export const MANAGED_MCP_ARRIVED_VALID_MESSAGE =
  'Your organization now manages MCP servers on this computer, so only the servers it allows will load from now on. To use another server, ask your admin.'

export const MANAGED_MCP_ARRIVED_UNREADABLE_MESSAGE =
  "Your organization now manages MCP servers on this computer, but the file it sent can't be read, so your own servers won't load from now on. Ask your admin to fix the file."

export function subscribeToManagedMcpArrival(
  listener: (message: string) => void,
): () => void {
  const state = getHostMcpConfigState()
  const capturedSession = getActiveSessionFromAls()
  const wrapped =
    capturedSession !== undefined
      ? (message: string) =>
          runWithSession(capturedSession, () => listener(message))
      : listener
  state.managedMcpArrivalListeners.add(wrapped)
  return () => {
    state.managedMcpArrivalListeners.delete(wrapped)
  }
}

export function getManagedMcpArrivalNotice(): string | null {
  return getHostMcpConfigState().enterpriseMcpState.arrivalNotice
}

export function consumeManagedMcpArrivalNotice(): string | null {
  const { enterpriseMcpState } = getHostMcpConfigState()
  const notice = enterpriseMcpState.arrivalNotice
  enterpriseMcpState.arrivalNotice = null
  return notice
}

export function resetEnterpriseMcpConfigCache(): void {
  const { enterpriseMcpState } = getHostMcpConfigState()
  enterpriseMcpState.checked = false
  enterpriseMcpState.present = false
  enterpriseMcpState.valid = false
  enterpriseMcpState.arrivedMidSession = false
  enterpriseMcpState.arrivalNotice = null
}

function evaluateEnterpriseMcpPresence(isRecheckAfterAbsent: boolean): boolean {
  const { enterpriseMcpState, managedMcpArrivalListeners } =
    getHostMcpConfigState()
  const filePath = getEnterpriseMcpFilePath()
  const fs = getFsImplementation()
  const fileExists = fs.existsSync(filePath)
  if (!fileExists) {
    enterpriseMcpState.checked = true
    enterpriseMcpState.present = false
    enterpriseMcpState.valid = false
    return false
  }
  const { config, errors } = parseMcpConfigFromFilePath({
    filePath,
    expandVars: true,
    scope: 'enterprise',
  })
  const hasFatalError =
    config === null ||
    errors.some(err => err.mcpErrorMetadata?.severity !== 'warning')
  enterpriseMcpState.checked = true
  enterpriseMcpState.present = true
  enterpriseMcpState.valid = !hasFatalError
  if (isRecheckAfterAbsent) {
    enterpriseMcpState.arrivedMidSession = true
    const message = hasFatalError
      ? MANAGED_MCP_ARRIVED_UNREADABLE_MESSAGE
      : MANAGED_MCP_ARRIVED_VALID_MESSAGE
    enterpriseMcpState.arrivalNotice = message
    logForDebugging(`[mcp] managed-mcp.json arrived mid-session: ${message}`, {
      level: 'warn',
    })
    for (const listener of managedMcpArrivalListeners) {
      try {
        listener(message)
      } catch {
        // Ignore subscriber errors
      }
    }
  }
  return true
}

export const doesEnterpriseMcpConfigExist: (() => boolean) & {
  cache: { clear: () => void }
} = Object.assign(
  (): boolean => {
    const { enterpriseMcpState } = getHostMcpConfigState()
    if (!enterpriseMcpState.checked) {
      return evaluateEnterpriseMcpPresence(false)
    }
    if (enterpriseMcpState.present) {
      return true
    }
    // Official 2.1.326 #292 & #3: When `managed-mcp.json` was absent earlier in
    // this session, re-check on disk at subsequent checks so a newly deployed
    // managed-mcp.json applies immediately and surfaces an explanation notice.
    const filePath = getEnterpriseMcpFilePath()
    if (getFsImplementation().existsSync(filePath)) {
      return evaluateEnterpriseMcpPresence(true)
    }
    return false
  },
  {
    cache: {
      clear: resetEnterpriseMcpConfigCache,
    },
  },
)

/**
 * Check if MCP allowlist policy should only come from managed settings.
 * This is true when policySettings has allowManagedMcpServersOnly: true.
 * When enabled, allowedMcpServers is read exclusively from managed settings.
 * Users can still add their own MCP servers and deny servers via deniedMcpServers.
 */
export function shouldAllowManagedMcpServersOnly(): boolean {
  return (
    getSettingsForSource('policySettings')?.allowManagedMcpServersOnly === true
  )
}

/**
 * Check whether to suppress claude.ai cloud MCP connectors.
 *
 * When enterprise MCP config exists (managed-mcp.json), claude.ai connectors are
 * suppressed by default so enterprise has exclusive control over MCP servers.
 * Admins can override this by setting allowAllClaudeAiMcps: true in any policy
 * source (managed-settings.json).
 *
 * Equivalent to official GJ8() / shouldSuppressClaudeAiMcps.
 */
export function shouldSuppressClaudeAiMcps(): boolean {
  if (!doesEnterpriseMcpConfigExist()) {
    return false
  }
  // Check all policy-relevant sources for allowAllClaudeAiMcps override.
  // When any policy source explicitly allows Claude AI MCPs, don't suppress.
  for (const source of SETTING_SOURCES) {
    const settings = getSettingsForSource(source)
    if (settings?.allowAllClaudeAiMcps === true) {
      return false
    }
  }
  return true
}

/**
 * Check if all MCP servers in a config are allowed with enterprise MCP config.
 */
export function areMcpConfigsAllowedWithEnterpriseMcpConfig(
  configs: Record<string, ScopedMcpServerConfig>,
): boolean {
  // NOTE: While all SDK MCP servers should be safe from a security perspective, we are still discussing
  // what the best way to do this is. In the meantime, we are limiting this to claude-vscode for now to
  // unbreak the VSCode extension for certain enterprise customers who have enterprise MCP config enabled.
  // https://anthropic.slack.com/archives/C093UA0KLD7/p1764975463670109
  return Object.values(configs).every(
    c => c.type === 'sdk' && c.name === 'claude-vscode',
  )
}

/**
 * Built-in MCP servers that default to disabled. Unlike user-configured servers
 * (opt-out via disabledMcpServers), these require explicit opt-in via
 * enabledMcpServers. They show up in /mcp as disabled until the user enables them.
 *
 * 注意：`computer-use` 已不在此列表——fork 默认开启 Chicago MCP，避免每次重启
 * 都要在 /mcp 里手动 toggle。如需关闭，把 server 名加到项目 config 的
 * `disabledMcpServers` 即可（走 opt-out 通道）。
 */
const DEFAULT_DISABLED_BUILTINS: Set<string> = new Set(['mcp-chrome'])

function isDefaultDisabledBuiltin(name: string): boolean {
  return DEFAULT_DISABLED_BUILTINS.has(name)
}

/**
 * Check if an MCP server is disabled
 * @param name The name of the server
 * @returns true if the server is disabled
 */
/**
 * Official 2.1.200: treat non-array disabled/enabled MCP lists as empty
 * instead of crashing on `.includes` when project config is corrupted.
 */
function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : []
}

export function isMcpServerDisabled(name: string): boolean {
  const projectConfig = getCurrentProjectConfig()
  if (isDefaultDisabledBuiltin(name)) {
    const enabledServers = asStringArray(projectConfig.enabledMcpServers)
    return !enabledServers.includes(name)
  }
  const disabledServers = asStringArray(projectConfig.disabledMcpServers)
  return disabledServers.includes(name)
}

/** Official `rvo()` — read persisted disabled MCP server names for current project. */
export function getDisabledMcpServers(): string[] {
  return asStringArray(getCurrentProjectConfig().disabledMcpServers)
}

/** Official `FAs(names)` — merge sanitized disabled MCP server names into current project config. */
export function saveDisabledMcpServers(names: readonly string[]): void {
  const sanitized = sanitizeDisabledMcpServers(names)
  if (sanitized.length === 0) return
  saveCurrentProjectConfig(current => {
    const prev = asStringArray(current.disabledMcpServers)
    const existing = new Set(prev)
    if (sanitized.every(name => existing.has(name))) {
      return current
    }
    return {
      ...current,
      disabledMcpServers: sanitizeDisabledMcpServers([...prev, ...sanitized]),
    }
  })
}

function toggleMembership(
  list: string[],
  name: string,
  shouldContain: boolean,
): string[] {
  const contains = list.includes(name)
  if (contains === shouldContain) return list
  return shouldContain ? [...list, name] : list.filter(s => s !== name)
}

/**
 * Enable or disable an MCP server
 * @param name The name of the server
 * @param enabled Whether the server should be enabled
 */
export function setMcpServerEnabled(name: string, enabled: boolean): void {
  const isBuiltinStateChange =
    isDefaultDisabledBuiltin(name) && isMcpServerDisabled(name) === enabled

  saveCurrentProjectConfig(current => {
    if (isDefaultDisabledBuiltin(name)) {
      const prev = asStringArray(current.enabledMcpServers)
      const next = toggleMembership(prev, name, enabled)
      if (
        next.length === prev.length &&
        next.every((v, i) => v === prev[i]) &&
        Array.isArray(current.enabledMcpServers)
      ) {
        return current
      }
      return { ...current, enabledMcpServers: next }
    }

    const prev = asStringArray(current.disabledMcpServers)
    const next = toggleMembership(prev, name, !enabled)
    if (
      next.length === prev.length &&
      next.every((v, i) => v === prev[i]) &&
      Array.isArray(current.disabledMcpServers)
    ) {
      return current
    }
    return { ...current, disabledMcpServers: next }
  })

  notifyMcpSwitchedOffSaved(name, enabled)

  if (isBuiltinStateChange) {
    logEvent('tengu_builtin_mcp_toggle', {
      serverName:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      enabled,
    })
  }
}
