import type { LocalCommandCall } from '../../types/command.js'
import type { MCPServerConnection } from '../../services/mcp/types.js'
import { getMcpReconnectControl, getMcpToggleControl } from './mcpControls.js'

/** densable eSs */
const USAGE =
  'Usage: /mcp [reconnect|enable|disable [<server>|all]]. With no server name, applies to all.'

/** densable VZ */
const HELP_TOKENS = new Set(['help', '-h', '--help'])
/** densable IHe — status summary tokens */
const LIST_TOKENS = new Set([
  'list',
  'show',
  'display',
  'current',
  'view',
  'get',
  'check',
  'describe',
  'print',
  'version',
  'about',
  'status',
  '?',
])

function text(value: string) {
  return { type: 'text' as const, value }
}

function statusLabel(type: string): string {
  switch (type) {
    case 'connected':
      return 'connected'
    case 'pending':
      return 'connecting'
    case 'disabled':
      return 'disabled'
    case 'failed':
      return 'not connected'
    case 'needs-auth':
      return 'needs authentication'
    case 'needs-approval':
      return 'pending approval'
    default:
      return type
  }
}

/** densable tSs — failed (not disabled) or needs-auth */
function needsReconnect(c: MCPServerConnection): boolean {
  return c.type === 'failed' || c.type === 'needs-auth'
}

/** densable yDy / rSs — non-interactive `/mcp`. */
export const call: LocalCommandCall = async (args, context) => {
  const trimmed = args?.trim() || ''
  const clients = (context.getAppState().mcp?.clients ?? []).filter(
    c => c.name !== 'ide',
  )
  const lower = trimmed.toLowerCase()

  // densable: empty or IHe → status; VZ → usage
  if (!trimmed || LIST_TOKENS.has(lower)) {
    if (clients.length === 0) {
      return text(
        `No MCP servers are configured. Add one with \`claude mcp add\`.\n${USAGE}`,
      )
    }
    const connected = clients.filter(c => c.type === 'connected').length
    const pending = clients.filter(c => c.type === 'pending').length
    const disabled = clients.filter(c => c.type === 'disabled').length
    // densable LJ count (not configured) approximated as needs-auth
    const notConfigured = clients.filter(c => c.type === 'needs-auth').length
    const reconnectable = clients.filter(needsReconnect).length
    const notConnected =
      clients.length - connected - pending - disabled - notConfigured
    return text(
      `${clients.length} MCP server(s): ${connected} connected, ` +
        (pending > 0 ? `${pending} connecting, ` : '') +
        `${Math.max(0, notConnected)} not connected, ` +
        (notConfigured > 0 ? `${notConfigured} not configured, ` : '') +
        `${disabled} disabled.` +
        (reconnectable > 0
          ? ' Reply `/mcp reconnect all` here to retry.'
          : '') +
        ` Use \`/mcp\` in the terminal for details.\n${USAGE}`,
    )
  }

  if (HELP_TOKENS.has(lower)) {
    return text(USAGE)
  }

  const m = /^(\S+)\s*(.*)$/.exec(trimmed)
  const action = (m?.[1] ?? '').toLowerCase()
  const target = m?.[2] || 'all'
  if (action !== 'reconnect' && action !== 'enable' && action !== 'disable') {
    return text(
      `"${action}" isn't a recognized /mcp action. Try reconnect, enable, or disable.`,
    )
  }

  const selected =
    target === 'all' ? clients : clients.filter(c => c.name === target)
  if (selected.length === 0) {
    return text(
      target === 'all'
        ? 'No MCP servers are configured. Add one with `claude mcp add`.'
        : `There's no MCP server named "${target}". Run \`/mcp\` in the terminal to see configured servers.`,
    )
  }

  const reconnect = getMcpReconnectControl()
  const toggle = getMcpToggleControl()
  if (!reconnect || !toggle) {
    return text(
      "MCP controls aren't available right now — the terminal is still starting up or is showing another view.",
    )
  }

  if (action === 'reconnect') {
    if (target !== 'all') {
      const one = selected[0]!
      if (one.type === 'disabled') {
        return text(
          `"${target}" is disabled. Run \`/mcp enable ${target}\` to bring it back.`,
        )
      }
      if (one.type === 'pending') {
        return text(
          `"${target}" is already reconnecting — retries can take a few minutes when a server keeps failing.`,
        )
      }
      // densable also handles needs-approval; fork MCPServerConnection omits it.
    }

    const pool = target === 'all' ? selected.filter(needsReconnect) : selected
    if (pool.length === 0) {
      const disabledCount = selected.filter(c => c.type === 'disabled').length
      if (disabledCount > 0) {
        return text(
          `${disabledCount} MCP server(s) are disabled. Run \`/mcp enable all\` to bring them back.`,
        )
      }
      return text(
        'All enabled MCP servers are already connected or connecting.',
      )
    }

    const results = await Promise.allSettled(pool.map(c => reconnect(c.name)))
    const ok = results.filter(
      r => r.status === 'fulfilled' && r.value.client.type === 'connected',
    ).length
    if (target !== 'all') {
      const first = results[0]
      const type =
        first?.status === 'fulfilled' ? first.value.client.type : undefined
      const hint =
        type === 'needs-auth'
          ? 'Authenticate with `/mcp` in the terminal.'
          : 'Check its config with `/mcp` in the terminal.'
      return text(
        type === 'connected'
          ? `Reconnected "${target}".`
          : `Couldn't reconnect "${target}"${type ? ` (${statusLabel(type)})` : ''}. ${hint}`,
      )
    }
    return text(
      `Reconnected ${ok} of ${pool.length} MCP server(s). Run \`/mcp\` in the terminal to see status.`,
    )
  }

  const enabling = action === 'enable'
  const toToggle = selected.filter(c =>
    enabling ? c.type === 'disabled' : c.type !== 'disabled',
  )
  if (toToggle.length === 0) {
    if (enabling) {
      const notConnected = selected.filter(needsReconnect).length
      if (notConnected > 0) {
        return text(
          target === 'all'
            ? `All MCP servers are already enabled, but ${notConnected} ${notConnected === 1 ? "isn't" : "aren't"} connected. Reply \`/mcp reconnect all\` here to retry.`
            : `"${target}" is already enabled but not connected. Run \`/mcp reconnect ${target}\` to retry.`,
        )
      }
    }
    return text(
      target === 'all'
        ? `All MCP servers are already ${enabling ? 'enabled' : 'disabled'}.`
        : `"${target}" is already ${enabling ? 'enabled' : 'disabled'}.`,
    )
  }

  const results = await Promise.allSettled(toToggle.map(c => toggle(c.name)))
  const fulfilled = results.filter(r => r.status === 'fulfilled').length
  if (target !== 'all') {
    if (!enabling) {
      return text(
        fulfilled > 0
          ? `Disabled "${target}".`
          : `Couldn't disable "${target}" — it may have been removed, or its configuration couldn't be read. Run \`/mcp\` in the terminal to check.`,
      )
    }
    return text(
      fulfilled > 0
        ? `Enabled "${target}".`
        : `Couldn't enable "${target}" — it may have been removed, or its configuration couldn't be read. Run \`/mcp\` in the terminal to check.`,
    )
  }
  const failed = toToggle.length - fulfilled
  return text(
    `${enabling ? 'Enabled' : 'Disabled'} ${fulfilled} MCP server(s)` +
      (failed > 0
        ? ` (${failed} couldn't be changed — may have been removed)`
        : '') +
      '. Run `/mcp` in the terminal to see status.',
  )
}
