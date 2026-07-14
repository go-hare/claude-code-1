/**
 * Official CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS /
 * CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT portable gates.
 *
 * When SKIP is set, plugin MCP servers are skipped unless the plugin name
 * appears in EXCEPT (comma-separated).
 */

import { isEnvTruthy } from './envUtils.js'

export function shouldSkipPluginMcpServers(
  pluginName: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!isEnvTruthy(env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS)) {
    return false
  }
  const exceptRaw = env.CLAUDE_CODE_SKIP_PLUGIN_MCP_SERVERS_EXCEPT ?? ''
  const except = new Set(
    exceptRaw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),
  )
  if (except.size === 0) return true
  return !except.has(pluginName)
}
