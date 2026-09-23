import { plural } from '../../utils/stringUtils.js'

/**
 * densable F — Claude Code MCP servers cannot attach to cloud routines.
 * Skip-reason arms (`safe-mode`, `missing-scope`, …) are not selected here:
 * this session has no connector-fetch skip state.
 */
export const SCHEDULE_CLAUDE_CODE_MCP_NOTE =
  'Note that MCP servers configured directly in Claude Code (e.g. with `claude mcp add`) cannot be attached to cloud routines \u2014 routines can only use claude.ai connectors.'

const NO_CONNECTORS_FOUND =
  'No available MCP connectors found. The user may need to connect servers at https://claude.ai/customize/connectors.'

const NO_CONNECTORS_CONNECT =
  'No MCP connectors \u2014 connect at https://claude.ai/customize/connectors if needed.'

type McpClientLike = {
  config?: { type?: string }
}

/** Local MCP rows that are not claude.ai connectors (`localOnlyServerCount`). */
export function countClaudeCodeConfiguredMcpServers(
  clients: readonly McpClientLike[] | undefined,
): number {
  if (!clients) return 0
  let count = 0
  for (const client of clients) {
    if (client.config?.type === 'claudeai-proxy') continue
    count++
  }
  return count
}

export type ScheduleConnectorRow = {
  uuid: string
  name: string
  url: string
}

/**
 * densable `we` empty-connector line.
 * `o > 0` uses the count sentence. The trailing skip-reason `${e}` is omitted:
 * this session has no connector-fetch skip reason to append.
 */
export function formatScheduleNoConnectorNote(
  localOnlyServerCount: number,
): string {
  if (localOnlyServerCount > 0) {
    const servers = plural(localOnlyServerCount, 'server')
    const them = plural(localOnlyServerCount, 'it', 'them')
    return `No MCP connectors for cloud routines \u2014 ${localOnlyServerCount} MCP ${servers} configured in Claude Code can't be attached to routines (run /mcp to see ${them}); routines can only use claude.ai connectors.`
  }
  return NO_CONNECTORS_CONNECT
}

/**
 * densable F listing. The Note is the `t === 0` arm (no Claude Code MCP servers).
 * When local servers exist, `we` carries the count sentence instead.
 */
export function formatScheduleConnectorsInfo(
  connectors: readonly ScheduleConnectorRow[],
  localOnlyServerCount: number,
  sanitizeName: (name: string) => string,
): string {
  if (connectors.length === 0) {
    if (localOnlyServerCount === 0) {
      return `${NO_CONNECTORS_FOUND}\n${SCHEDULE_CLAUDE_CODE_MCP_NOTE}`
    }
    return NO_CONNECTORS_FOUND
  }
  const lines = ['Available connectors (usable by routines):']
  for (const connector of connectors) {
    const safeName = sanitizeName(connector.name)
    lines.push(
      `- ${connector.name} (connector_uuid: ${connector.uuid}, name: ${safeName}, url: ${connector.url})`,
    )
  }
  return lines.join('\n')
}
