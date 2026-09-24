import { plural } from '../../utils/stringUtils.js'

/**
 * densable F / we — schedule connectors copy for cloud routines.
 * Gold skip-reason arms (lockdown / restricted / optout / safe-mode /
 * missing-scope) and hasUnlistedTrustedConnector append are selected when
 * the caller passes connectorFetchSkipReason / hasUnlistedTrustedConnector.
 */

export type ConnectorFetchSkipReason =
  | 'lockdown'
  | 'restricted'
  | 'optout'
  | 'safe-mode'
  | 'missing-scope'

export const SCHEDULE_CLAUDE_CODE_MCP_NOTE =
  'Note that MCP servers configured directly in Claude Code (e.g. with `claude mcp add`) cannot be attached to cloud routines — routines can only use claude.ai connectors.'

const NO_CONNECTORS_FOUND =
  'No available MCP connectors found. The user may need to connect servers at https://claude.ai/customize/connectors.'

const NO_CONNECTORS_CONNECT =
  'No MCP connectors — connect at https://claude.ai/customize/connectors if needed.'

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
 * densable we/F skip-reason trailing sentence `${e}`.
 */
export function formatConnectorFetchSkipReasonSentence(
  reason: ConnectorFetchSkipReason | null | undefined,
  hasUnlistedTrustedConnector = false,
): string {
  if (reason === 'lockdown') {
    return 'claude.ai connectors are not loaded in this session (your organization manages MCP servers); any configured on claude.ai remain available to routines there.'
  }
  if (reason === 'restricted') {
    return 'claude.ai connectors are not loaded in this session (MCP servers are restricted to explicitly passed config); any on claude.ai remain available to routines there.'
  }
  if (reason === 'optout') {
    return 'claude.ai connectors are disabled in this session (disableClaudeAiConnectors setting or ENABLE_CLAUDEAI_MCP_SERVERS env var); any already connected on claude.ai remain available to routines there.'
  }
  if (reason === 'safe-mode') {
    return 'claude.ai connectors are not loaded in this session (safe mode); any connected on claude.ai remain available to routines there.'
  }
  if (reason === 'missing-scope') {
    return 'claude.ai connectors could not be loaded in this session (the login token does not include the MCP-connectors permission); any connected on claude.ai remain available to routines there.'
  }
  if (hasUnlistedTrustedConnector) {
    return "A claude.ai connector for this account exists but isn't connected in this session right now (still connecting, or its last connect failed); it remains available to routines on claude.ai."
  }
  return 'Connect one at https://claude.ai/customize/connectors if needed.'
}

/**
 * densable `v` producer for we/F — mirrors gold order:
 * Obe lockdown → tI/ko restricted → ENABLE/BJ optout → ho safe-mode → I2 missing-scope.
 */
export function resolveConnectorFetchSkipReason(input?: {
  orgManagesClaudeAiMcps?: boolean
  allowAllClaudeAiMcps?: boolean
  strictConfig?: boolean
  bareOrSimple?: boolean
  enableClaudeAiMcpServers?: boolean | undefined
  disableClaudeAiConnectors?: boolean
  mcpClaudeAiSafeMode?: boolean
  hasMcpServersScope?: boolean
}): ConnectorFetchSkipReason | null {
  const orgManages = input?.orgManagesClaudeAiMcps === true
  const allowAll = input?.allowAllClaudeAiMcps === true
  // densable Obe: org manages and no allowAll override
  if (orgManages && !allowAll) return 'lockdown'
  if (input?.strictConfig === true || input?.bareOrSimple === true) {
    return 'restricted'
  }
  if (
    input?.enableClaudeAiMcpServers === false ||
    input?.disableClaudeAiConnectors === true
  ) {
    return 'optout'
  }
  if (input?.mcpClaudeAiSafeMode === true) return 'safe-mode'
  if (input?.hasMcpServersScope === false) return 'missing-scope'
  return null
}

/**
 * densable `we` empty-connector line.
 * `o > 0` uses the count sentence + optional skip-reason `${e}`.
 */
export function formatScheduleNoConnectorNote(
  localOnlyServerCount: number,
  opts?: {
    skipReason?: ConnectorFetchSkipReason | null
    hasUnlistedTrustedConnector?: boolean
  },
): string {
  const skip = opts?.skipReason ?? null
  const unlisted = opts?.hasUnlistedTrustedConnector === true
  const reasonSentence = formatConnectorFetchSkipReasonSentence(skip, unlisted)
  if (localOnlyServerCount > 0) {
    const servers = plural(localOnlyServerCount, 'server')
    const them = plural(localOnlyServerCount, 'it', 'them')
    const base = `No MCP connectors for cloud routines — ${localOnlyServerCount} MCP ${servers} configured in Claude Code can't be attached to routines (run /mcp to see ${them}); routines can only use claude.ai connectors.`
    // Gold we always appends `${e}`; when no skip/unlisted, e is the connect tip.
    return `${base} ${reasonSentence}`
  }
  if (skip !== null || unlisted) {
    return `No MCP connectors — ${reasonSentence}`
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
  opts?: {
    skipReason?: ConnectorFetchSkipReason | null
    hasUnlistedTrustedConnector?: boolean
    suppressedTwinCount?: number
    suppressedTwinLabels?: readonly string[]
  },
): string {
  if (connectors.length === 0) {
    if (localOnlyServerCount === 0) {
      // densable F empty + no local MCP: found + NOTE
      return `${NO_CONNECTORS_FOUND}\n${SCHEDULE_CLAUDE_CODE_MCP_NOTE}`
    }
    return formatScheduleNoConnectorNote(localOnlyServerCount, opts)
  }
  const lines = ['Available connectors (usable by routines):']
  for (const connector of connectors) {
    const safeName = sanitizeName(connector.name)
    lines.push(
      `- ${connector.name} (connector_uuid: ${connector.uuid}, name: ${safeName}, url: ${connector.url})`,
    )
  }
  const twinCount = opts?.suppressedTwinCount ?? 0
  if (twinCount > 0) {
    const labels = opts?.suppressedTwinLabels ?? []
    const labelPart = labels.length > 0 ? ` (${labels.join(', ')})` : ''
    const connectorsWord = plural(twinCount, 'connector')
    const isAre = plural(twinCount, 'is', 'are')
    const covers = plural(
      twinCount,
      'a server configured in Claude Code covers',
      'servers configured in Claude Code cover',
    )
    const service = plural(twinCount, 'service')
    const remains = plural(twinCount, 'it remains', 'they remain')
    lines.push(
      `${twinCount} claude.ai ${connectorsWord}${labelPart} ${isAre} not active in this session (${covers} the same ${service}), but ${remains} available to routines on claude.ai.`,
    )
  }
  return lines.join('\n')
}
