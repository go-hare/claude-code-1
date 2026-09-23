import { truncate } from '../../utils/truncate.js'

/** densable `pe` — display cap for MCP server labels. */
const MCP_SERVER_LABEL_MAX_WIDTH = 80

/** densable Qt default width for error strings. */
const MCP_ERROR_STRING_MAX_WIDTH = 300

/** densable `An` — Cc / Cf / U+2028 / U+2029 → space. */
function sanitizeMcpLabelControls(value: string): string {
  return value.replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, ' ')
}

/** densable `fr` — An + collapse spaces + NFC + backticks→quote + width cap. */
function formatMcpDisplayString(value: string, maxWidth: number = 160): string {
  const cleaned = sanitizeMcpLabelControls(value)
    .replace(/ {2,}/g, ' ')
    .trim()
    .normalize('NFC')
    .replace(/[`\uff40\u02cb\u1fef\u2035]/g, "'")
  return truncate(cleaned, maxWidth)
}

/**
 * densable `Qt` — fr wrap for error strings.
 */
export function formatMcpErrorString(
  value: string,
  maxWidth: number = MCP_ERROR_STRING_MAX_WIDTH,
): string {
  return formatMcpDisplayString(value ?? '', maxWidth)
    .replace(/[\u02bb\u02bc]/g, '\u2019')
    .replace(/"/g, '\u201D')
    .replace(/'/g, '\u2019')
}

/**
 * densable `ln` — id compare `/[^a-zA-Z0-9_-]/` → `_`.
 */
export function formatMcpServerId(id: string): string {
  let next = id.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (id.startsWith('claude.ai ')) {
    next = next.replace(/_+/g, '_').replace(/^_|_$/g, '')
  }
  return next
}

/**
 * densable BXe / UKc `es` — `plugin:${pluginName}:${serverName}`.
 */
export function parsePluginMcpServerName(name: string):
  | {
      pluginName: string
      serverName: string
    }
  | undefined {
  if (!name.startsWith('plugin:')) {
    return
  }
  const parts = name.split(':')
  if (parts.length < 3) {
    return
  }
  return {
    pluginName: parts[1]!,
    serverName: parts.slice(2).join(':'),
  }
}

/**
 * densable `Bfe` — non-plugin → fr(name, 80). Plugin key →
 * `${fr(server)} (from plugin ${fr(plugin)})`.
 */
export function formatMcpServerLabel(
  name: string,
  isPluginServer = false,
): string {
  if (!isPluginServer) {
    return formatMcpDisplayString(name, MCP_SERVER_LABEL_MAX_WIDTH)
  }
  const parsed = parsePluginMcpServerName(name)
  if (!parsed) {
    return formatMcpDisplayString(name, MCP_SERVER_LABEL_MAX_WIDTH)
  }
  return `${formatMcpDisplayString(parsed.serverName, MCP_SERVER_LABEL_MAX_WIDTH)} (from plugin ${formatMcpDisplayString(parsed.pluginName, MCP_SERVER_LABEL_MAX_WIDTH)})`
}
