/**
 * densable `qge` / reconnect branch of inline `/mcp` (`ae`).
 * A server disabled in another session is still present here (type is not
 * `disabled`) while config says disabled. Reconnect reports that remedy
 * instead of a generic failure / withheld-detail scrub.
 *
 * Gold callees (2.1.251 #23): `G8`, `YHe`, `Qo`, `XS`, `y$`, `UQ`, `$je`, `qge`.
 */

import { formatMcpServerLabel } from './formatMcpServerLabel.js'

export type McpRemedyClient = {
  name: string
  type: string
  errorCode?: string
}

const STATUS_LABEL: Record<string, string> = {
  connected: 'connected',
  cached: 'cached (connects on first use)',
  pending: 'connecting',
  disabled: 'disabled',
  failed: 'not connected',
  'needs-auth': 'needs authentication',
  'needs-approval': 'pending approval',
}

function countWhere<T>(
  items: readonly T[],
  pred: (item: T) => boolean,
): number {
  let n = 0
  for (const item of items) {
    if (pred(item)) n += 1
  }
  return n
}

/** densable `G8`. */
export function mcpClientType(client: McpRemedyClient): string {
  return client.type
}

/** densable `Qo`. */
export function isConnectedOrCachedMcp(client: McpRemedyClient): boolean {
  return client.type === 'connected' || client.type === 'cached'
}

/** densable `XS`. */
export function isUnconfiguredMcp(client: McpRemedyClient): boolean {
  return client.type === 'failed' && client.errorCode === 'UNCONFIGURED'
}

/** densable `YHe`. */
export function reconnectBlockStatus(
  client: McpRemedyClient,
): 'disabled' | 'pending' | 'needs-approval' | string | null {
  const type = mcpClientType(client)
  switch (type) {
    case 'disabled':
    case 'pending':
    case 'needs-approval':
      return type
    case 'connected':
    case 'failed':
    case 'needs-auth':
    case 'cached':
      return null
    default:
      return type
  }
}

/** densable `UQ`. */
export function mcpDisabledLocallyRemedy(name: string): string {
  return `"${formatMcpServerLabel(name)}" is disabled — enable it in /mcp first`
}

/**
 * densable `y$` — singular RC / reconnect remedy when config is disabled
 * but this session's client type is not yet `disabled`.
 */
export function mcpDisabledElsewhereSingularRemedy(name: string): string {
  return `"${formatMcpServerLabel(name)}" was disabled in another session — disable and re-enable it in /mcp, or restart, to reconnect`
}

/**
 * densable `$je` — singular still-available-here but disabled-elsewhere.
 */
export function mcpStillAvailableElsewhereDisabledRemedy(name: string): string {
  return `"${formatMcpServerLabel(name)}" is still available in this session, but another session disabled it — it keeps working here and won't reconnect after the next launch. Disable and re-enable it in /mcp to persist the re-enable.`
}

/**
 * densable reconnect gate before `reconnectMcpServerImpl` (`_i` + `UQ`/`y$`).
 * Null when reconnect may proceed.
 */
export function mcpReconnectDisabledGateMessage(
  client: McpRemedyClient | undefined,
  name: string,
  isDisabled: (name: string) => boolean,
): string | null {
  if (!isDisabled(name)) return null
  if (client?.type === 'disabled') return mcpDisabledLocallyRemedy(name)
  return mcpDisabledElsewhereSingularRemedy(name)
}

/** densable `B` && !isDisabled — `z`. */
function isReconnectCandidate(
  client: McpRemedyClient,
  isDisabled: (name: string) => boolean,
): boolean {
  const realFailure =
    (client.type === 'failed' && !isUnconfiguredMcp(client)) ||
    client.type === 'needs-auth'
  return realFailure && !isDisabled(client.name)
}

/**
 * densable `qge`.
 * `enabling` false is the disable-didn't-persist copy; true is reconnect.
 */
export function mcpServersDisabledElsewhereRemedy(
  clients: readonly McpRemedyClient[],
  enabling: boolean,
  isDisabled: (name: string) => boolean,
): string | null {
  if (!enabling) {
    const reenabled = countWhere(
      clients,
      client => client.type === 'disabled' && !isDisabled(client.name),
    )
    if (reenabled === 0) return null
    const stillDisabled = countWhere(
      clients,
      client => client.type === 'disabled' && isDisabled(client.name),
    )
    return (
      `${reenabled} MCP server(s) were re-enabled in another session, so this disable didn't persist for them — enable then disable each in /mcp to make it stick. Left alone, they connect on the next launch.` +
      (stillDisabled > 0
        ? ` The other ${stillDisabled} ${stillDisabled === 1 ? 'remains' : 'remain'} disabled.`
        : '')
    )
  }
  // gold: i.type!=="disabled"&&G8(i)!=="needs-approval"&&t(i.name)
  const drifted = clients.filter(
    client =>
      mcpClientType(client) !== 'disabled' &&
      mcpClientType(client) !== 'needs-approval' &&
      isDisabled(client.name),
  )
  if (drifted.length === 0) return null
  const stillHere = countWhere(drifted, isConnectedOrCachedMcp)
  const unconfigured = countWhere(
    drifted,
    client => !isConnectedOrCachedMcp(client) && isUnconfiguredMcp(client),
  )
  const other = drifted.length - stillHere - unconfigured
  const parts: string[] = []
  if (other > 0) {
    parts.push(
      `${other} MCP server(s) were disabled in another session — disable and re-enable them in /mcp, or restart, to reconnect.`,
    )
  }
  if (unconfigured > 0) {
    parts.push(
      `${unconfigured} MCP server(s) were disabled in another session but aren't configured yet — there's nothing to reconnect until they are.`,
    )
  }
  if (stillHere > 0) {
    parts.push(
      `${stillHere} MCP server(s) are still available in this session but were disabled in another — they keep working here and won't reconnect after the next launch. Disable and re-enable them in /mcp to persist the re-enable.`,
    )
  }
  return parts.join(' ')
}

export type McpReconnectPlan =
  | { kind: 'missing' }
  | { kind: 'text'; text: string }
  | { kind: 'reconnect'; names: string[]; appendix: string | null }

/**
 * densable `qge` for `/mcp reconnect` and the Remote Control mcp_reconnect
 * result. Null when this target was not disabled in another session.
 *
 * Gold `qge(e,n,t)` always emits the plural "N MCP server(s)…" sentences
 * (`enabling` true arm). Singular `y$` / `$je` stay on the pre-reconnect
 * gate (`mcpReconnectDisabledGateMessage`), not this result helper.
 */
export function reconnectDisabledElsewhereResult(
  clients: readonly McpRemedyClient[],
  target: string,
  isDisabled: (name: string) => boolean,
): string | null {
  const visible = clients.filter(client => client.name !== 'ide')
  const selected =
    target === 'all'
      ? visible
      : visible.filter(client => client.name === target)
  return mcpServersDisabledElsewhereRemedy(selected, true, isDisabled)
}

/**
 * densable `ae` reconnect branch, before the reconnect promises run.
 * `target` is a server name or `"all"`.
 */
export function planMcpReconnect(
  clients: readonly McpRemedyClient[],
  target: string,
  isDisabled: (name: string) => boolean,
): McpReconnectPlan {
  const visible = clients.filter(client => client.name !== 'ide')
  const selected =
    target === 'all'
      ? visible
      : visible.filter(client => client.name === target)
  if (selected.length === 0) return { kind: 'missing' }

  if (target !== 'all') {
    const status = reconnectBlockStatus(selected[0]!)
    if (status === 'disabled') {
      return {
        kind: 'text',
        text: `"${target}" is disabled. Run \`/mcp enable ${target}\` to bring it back.`,
      }
    }
    if (status === 'pending') {
      return {
        kind: 'text',
        text: `"${target}" is already reconnecting — retries can take a few minutes when a server keeps failing.`,
      }
    }
    if (status === 'needs-approval') {
      return {
        kind: 'text',
        text: `"${target}" is pending approval. Approve it with \`/mcp\` in the terminal first.`,
      }
    }
    const drifted = reconnectDisabledElsewhereResult(
      clients,
      target,
      isDisabled,
    )
    if (drifted !== null) return { kind: 'text', text: drifted }
  }

  const candidates =
    target === 'all'
      ? selected.filter(client => isReconnectCandidate(client, isDisabled))
      : selected
  const appendix =
    target === 'all'
      ? mcpServersDisabledElsewhereRemedy(selected, true, isDisabled)
      : null
  if (candidates.length === 0) {
    const disabledCount = countWhere(
      selected,
      client => client.type === 'disabled',
    )
    const unconfigured = countWhere(
      selected,
      client => isUnconfiguredMcp(client) && !isDisabled(client.name),
    )
    if (disabledCount === 0 && appendix === null && unconfigured > 0) {
      return {
        kind: 'text',
        text: `${unconfigured} MCP server(s) aren't configured yet, so there's nothing to reconnect. The rest are already connected or connecting.`,
      }
    }
    const parts = [
      ...(disabledCount > 0
        ? [
            `${disabledCount} MCP server(s) are disabled. Run \`/mcp enable all\` to bring them back.`,
          ]
        : []),
      ...(appendix !== null ? [appendix] : []),
      ...(unconfigured > 0
        ? [
            `${unconfigured} MCP server(s) aren't configured yet, so there's nothing to reconnect.`,
          ]
        : []),
    ]
    if (parts.length > 0) return { kind: 'text', text: parts.join(' ') }
    return {
      kind: 'text',
      text: 'All enabled MCP servers are already connected or connecting.',
    }
  }
  return {
    kind: 'reconnect',
    names: candidates.map(client => client.name),
    appendix,
  }
}

export function formatMcpReconnectOutcome(
  target: string,
  results: ReadonlyArray<{ ok: true; type: string } | { ok: false }>,
  appendix: string | null,
): string {
  if (target !== 'all') {
    const first = results[0]
    if (!first || !first.ok) return `Couldn't reconnect "${target}".`
    if (first.type === 'connected') return `Reconnected "${target}".`
    const hint =
      first.type === 'needs-auth'
        ? 'Authenticate with `/mcp` in the terminal.'
        : 'Check its config with `/mcp` in the terminal.'
    const label = STATUS_LABEL[first.type] ?? first.type
    return `Couldn't reconnect "${target}" (${label}). ${hint}`
  }
  const connected = countWhere(
    results,
    result => result.ok && result.type === 'connected',
  )
  const base = `Reconnected ${connected} of ${results.length} MCP server(s).`
  const withAppendix = appendix !== null ? `${base} ${appendix}` : base
  return `${withAppendix} Run \`/mcp\` in the terminal to see status.`
}

export function missingMcpReconnectTarget(target: string): string {
  if (target === 'all') {
    return 'No MCP servers are configured. Add one with `claude mcp add`.'
  }
  return `There's no MCP server named "${target}". Run \`/mcp\` in the terminal to see configured servers.`
}

/**
 * densable `uer` — wire-safe mcp_reconnect failure (never leak dirty
 * `client.error` through control_response, which RC scrubs to withheld-detail).
 */
export function mcpReconnectControlFailureMessage(client: {
  type: string
  error?: string
}): string {
  if (client.type === 'failed') return 'Connection failed'
  return `Server status: ${client.type}`
}
