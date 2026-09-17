import { truncate } from '../../utils/truncate.js'

/** densable UKc/`Sa` `Me` — display cap for MCP server labels. */
const MCP_SERVER_LABEL_MAX_WIDTH = 80

/**
 * Local hardening, not densable. Server names are record keys from a project's
 * `.mcp.json` — validated only as `z.string()` — and these labels render in the
 * dialog that decides whether to trust that very file. Newlines and CR would
 * let a committed name add or overwrite dialog lines.
 *
 * Narrower than `UNSAFE_PATH_CHARS` (cdPermission `cVo`) because a server name
 * is not a path: only control/format/separator classes are dropped, so ordinary
 * punctuation and non-ASCII names still display. Substitution rather than
 * refusal keeps the name recognisable.
 */
const UNPRINTABLE_LABEL_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

function sanitizeLabelSegment(value: string): string {
  return value.replace(UNPRINTABLE_LABEL_CHARS, '\uFFFD')
}

function labelSegment(value: string): string {
  return truncate(sanitizeLabelSegment(value), MCP_SERVER_LABEL_MAX_WIDTH)
}

/**
 * densable UKc/`es` — `plugin:${pluginName}:${serverName}` (serverName may
 * contain further `:` segments).
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
 * densable UKc/`Sa` (`v` in MCP dialogs).
 * Non-plugin → truncated raw name. Plugin + parseable key →
 * `${server} (from plugin ${plugin})`. Plugin flag but unparseable → truncated
 * raw name (no invented suffix).
 */
export function formatMcpServerLabel(
  name: string,
  isPluginServer = false,
): string {
  if (!isPluginServer) {
    return labelSegment(name)
  }
  const parsed = parsePluginMcpServerName(name)
  if (!parsed) {
    return labelSegment(name)
  }
  return `${labelSegment(parsed.serverName)} (from plugin ${labelSegment(parsed.pluginName)})`
}
