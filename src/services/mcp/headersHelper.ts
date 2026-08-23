/**
 * densable 2.1.238 MCP `headersHelper` — trust gate + clean child env.
 *
 * Product-separate from marketplace/catalog `marketplaceHeadersHelper.ts`.
 * Reuses SEA `N4S` scrub (`buildHeadersHelperChildEnv`) only as the env builder.
 *
 * SEA:
 *   - Aiv: kiv(project|local)=repo, else operator; OR agentSource maps repo.
 *     Bare dynamic without agentSource is NOT repo-resident.
 *   - Riv scrub iff absolute pluginPath OR scope==="project" OR
 *     (agentSource defined && not operator). local does NOT scrub.
 *   - H4S: persisted $U(origin) OR (origin undefined/home) && cwd===home && tFs().
 *   - cwd: pluginPath / (resident? declaredIn??xn() : dynamic&&!agentSource? xn() : En()).
 *   - overlay only CLAUDE_CODE_MCP_SERVER_{NAME,URL} + absolute pluginPath→CLAUDE_PLUGIN_ROOT.
 *     No process.env CLAUDE_PLUGIN_ROOT/DATA copy.
 */
import { homedir } from 'os'
import { isAbsolute, resolve } from 'path'
import {
  getOriginalCwd,
  getSessionTrustAccepted,
} from '../../bootstrap/state.js'
import { getGlobalConfig, getProjectPathForConfig } from '../../utils/config.js'
import { getClaudeConfigHomeDir } from '../../utils/envUtils.js'
import { getGlobalClaudeFile } from '../../utils/env.js'
import { errorMessage } from '../../utils/errors.js'
import { execFileNoThrowWithCwd } from '../../utils/execFileNoThrow.js'
import { findCanonicalGitRoot } from '../../utils/git.js'
import { logError, logMCPDebug, logMCPError } from '../../utils/log.js'
import { normalizePathForConfigKey } from '../../utils/path.js'
import {
  buildHeadersHelperChildEnv,
  HEADERS_HELPER_MAX_BUFFER,
  HEADERS_HELPER_TIMEOUT_MS,
} from '../../utils/plugins/marketplaceHeadersHelper.js'
import { jsonParse } from '../../utils/slowOperations.js'
import { logEvent } from '../analytics/index.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpWebSocketServerConfig,
  ScopedMcpServerConfig,
} from './types.js'

export type McpRemoteHeadersConfig =
  | McpSSEServerConfig
  | McpHTTPServerConfig
  | McpWebSocketServerConfig

function asScoped(
  config: McpRemoteHeadersConfig,
): ScopedMcpServerConfig | null {
  if (!('scope' in config) || typeof config.scope !== 'string') return null
  return config as ScopedMcpServerConfig
}

/** densable `kiv` */
export function mcpHeadersHelperScopeKind(
  scope: string,
): 'repo' | 'operator' | string {
  switch (scope) {
    case 'project':
    case 'local':
      return 'repo'
    case 'user':
    case 'dynamic':
    case 'enterprise':
    case 'claudeai':
    case 'managed':
    case 'agent':
      return 'operator'
    default:
      return scope
  }
}

/** densable `Umf` */
export function mcpHeadersHelperAgentSourceKind(
  source: string,
): 'repo' | 'thirdParty' | 'operator' | string {
  switch (source) {
    case 'projectSettings':
    case 'localSettings':
      return 'repo'
    case 'plugin':
    case 'additionalDirectory':
      return 'thirdParty'
    case 'userSettings':
    case 'flagSettings':
    case 'policySettings':
    case 'built-in':
      return 'operator'
    default:
      return source
  }
}

/**
 * densable Aiv: project/local, or agentSource mapped to repo.
 * Bare dynamic without agentSource is operator — not resident.
 */
export function isRepoResidentMcpHeadersHelper(
  config: McpRemoteHeadersConfig,
): boolean {
  const scoped = asScoped(config)
  if (!scoped) return false
  return (
    mcpHeadersHelperScopeKind(scoped.scope) === 'repo' ||
    (scoped.agentSource !== undefined &&
      mcpHeadersHelperAgentSourceKind(scoped.agentSource) === 'repo')
  )
}

function absolutePluginPath(
  config: McpRemoteHeadersConfig,
): string | undefined {
  const scoped = asScoped(config)
  const path = scoped?.pluginPath
  return typeof path === 'string' && isAbsolute(path) ? path : undefined
}

/**
 * densable Riv: scrub iff absolute pluginPath OR scope==="project" OR
 * (agentSource defined && not operator). local does NOT scrub.
 */
export function shouldScrubMcpHeadersHelperEnv(
  config: McpRemoteHeadersConfig,
): boolean {
  const pluginPath = absolutePluginPath(config)
  if (pluginPath !== undefined) return true
  const scoped = asScoped(config)
  if (!scoped) return false
  if (scoped.scope === 'project') return true
  return (
    scoped.agentSource !== undefined &&
    mcpHeadersHelperAgentSourceKind(scoped.agentSource) !== 'operator'
  )
}

/** densable `$U` / `itr` — persisted trust at a path's project key. */
function hasPersistedTrustAt(origin?: string): boolean {
  const path = origin ?? getOriginalCwd()
  const gitRoot = findCanonicalGitRoot(path)
  const key = normalizePathForConfigKey(gitRoot ?? resolve(path))
  return getGlobalConfig().projects?.[key]?.hasTrustDialogAccepted === true
}

function isHomeRootedSession(): boolean {
  return resolve(getOriginalCwd()) === resolve(homedir())
}

/**
 * densable H4S: persisted $U(origin) OR session-only home trust when
 * origin is undefined/home AND cwd is home AND tFs().
 */
export function hasHeadersHelperWorkspaceTrust(origin?: string): boolean {
  if (hasPersistedTrustAt(origin)) return true
  const home = homedir()
  return (
    (origin === undefined || origin === home) &&
    isHomeRootedSession() &&
    getSessionTrustAccepted()
  )
}

/** densable missing-trust user/log copy. */
export function formatMcpHeadersHelperMissingTrustMessage(): string {
  if (isHomeRootedSession()) {
    return (
      'headersHelper not run: this workspace has no persisted trust; ' +
      'not available to a session rooted at the home directory without a person present ' +
      '(home trust is session-only): run Claude Code interactively here and accept the ' +
      'trust dialog for that session, or work from a project directory you have trusted'
    )
  }
  const projectPath = getProjectPathForConfig()
  const settingsFile = getGlobalClaudeFile()
  return (
    `headersHelper not run: this workspace has no persisted trust; ` +
    `accept the trust dialog here once interactively, or set projects[${projectPath}].hasTrustDialogAccepted in ${settingsFile}`
  )
}

function mcpHeadersHelperCwd(config: McpRemoteHeadersConfig): string {
  const pluginPath = absolutePluginPath(config)
  if (pluginPath !== undefined) return pluginPath
  const scoped = asScoped(config)
  const resident = scoped !== null && isRepoResidentMcpHeadersHelper(config)
  if (resident) return scoped.declaredIn ?? getOriginalCwd()
  if (scoped?.scope === 'dynamic' && scoped.agentSource === undefined) {
    return getOriginalCwd()
  }
  return getClaudeConfigHomeDir()
}

function mcpHeadersHelperOverlay(
  serverName: string,
  config: McpRemoteHeadersConfig,
): Record<string, string> {
  const overlay: Record<string, string> = {
    CLAUDE_CODE_MCP_SERVER_NAME: serverName,
    CLAUDE_CODE_MCP_SERVER_URL: config.url,
  }
  const pluginPath = absolutePluginPath(config)
  if (pluginPath !== undefined) {
    overlay.CLAUDE_PLUGIN_ROOT = pluginPath
  }
  return overlay
}

/**
 * Get dynamic headers for an MCP server using the headersHelper script.
 * @returns Headers object or null if not configured or failed
 */
export async function getMcpHeadersFromHelper(
  serverName: string,
  config: McpRemoteHeadersConfig,
): Promise<Record<string, string> | null> {
  if (!config.headersHelper) {
    return null
  }

  const scoped = asScoped(config)
  const resident = scoped !== null && isRepoResidentMcpHeadersHelper(config)
  if (resident && !hasHeadersHelperWorkspaceTrust(scoped.declaredIn)) {
    const message = formatMcpHeadersHelperMissingTrustMessage()
    logMCPError(serverName, message)
    logEvent('tengu_mcp_headersHelper_missing_trust', {})
    return null
  }

  try {
    logMCPDebug(serverName, 'Executing headersHelper to get dynamic headers')
    const execResult = await execFileNoThrowWithCwd(config.headersHelper, [], {
      shell: true,
      timeout: HEADERS_HELPER_TIMEOUT_MS,
      maxBuffer: HEADERS_HELPER_MAX_BUFFER,
      cwd: mcpHeadersHelperCwd(config),
      extendEnv: false,
      env: buildHeadersHelperChildEnv({
        scrubCredentialEnv: shouldScrubMcpHeadersHelperEnv(config),
        env: mcpHeadersHelperOverlay(serverName, config),
      }),
    })
    if (execResult.code !== 0 || !execResult.stdout) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' did not return a valid value`,
      )
    }
    const result = execResult.stdout.trim()

    const headers = jsonParse(result)
    if (
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers)
    ) {
      throw new Error(
        `headersHelper for MCP server '${serverName}' must return a JSON object with string key-value pairs`,
      )
    }

    for (const [key, value] of Object.entries(headers)) {
      if (typeof value !== 'string') {
        throw new Error(
          `headersHelper for MCP server '${serverName}' returned non-string value for key "${key}": ${typeof value}`,
        )
      }
    }

    logMCPDebug(
      serverName,
      `Successfully retrieved ${Object.keys(headers).length} headers from headersHelper`,
    )
    return headers as Record<string, string>
  } catch (error) {
    logMCPError(
      serverName,
      `Error getting headers from headersHelper: ${errorMessage(error)}`,
    )
    logError(
      new Error(
        `Error getting MCP headers from headersHelper for server '${serverName}': ${errorMessage(error)}`,
      ),
    )
    return null
  }
}

/**
 * Get combined headers for an MCP server (static + dynamic).
 */
export async function getMcpServerHeaders(
  serverName: string,
  config: McpRemoteHeadersConfig,
): Promise<Record<string, string>> {
  const staticHeaders = config.headers || {}
  const dynamicHeaders =
    (await getMcpHeadersFromHelper(serverName, config)) || {}

  return {
    ...staticHeaders,
    ...dynamicHeaders,
  }
}
