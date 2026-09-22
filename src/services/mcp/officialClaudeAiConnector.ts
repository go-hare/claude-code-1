import type { ScopedMcpServerConfig } from './types.js'

/**
 * densable 2.1.248 `_bt(e)` — plugin-sourced MCP config.
 * `return e?.pluginSource!==void 0`
 */
export function hasMcpPluginSource(
  config: { pluginSource?: string } | null | undefined,
): boolean {
  return config?.pluginSource !== undefined
}

/**
 * densable 2.1.248 `ebn(e)` — official claude.ai connector heading.
 * `if(e.type!=="claudeai-proxy")return!1`
 * `return e.scope==="claudeai"||e.scope==="dynamic"&&!_bt(e)`
 *
 * Project `.mcp.json` `type: claudeai-proxy` stays in its scope heading
 * (Project MCPs), not the trusted `claude.ai` bucket.
 */
export function isOfficialClaudeAiConnector(
  config: Pick<ScopedMcpServerConfig, 'type' | 'scope' | 'pluginSource'>,
): boolean {
  if (config.type !== 'claudeai-proxy') return false
  return (
    config.scope === 'claudeai' ||
    (config.scope === 'dynamic' && !hasMcpPluginSource(config))
  )
}
