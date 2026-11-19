import { MCPTool } from '@claude-code/builtin-tools/tools/MCPTool/MCPTool.js'
import type { Tool } from '../../Tool.js'
import { isFullscreenEnvEnabled } from '../../utils/fullscreen.js'

const DISPLAY_ONLY_CACHE_MAX = 256
const displayOnlyCache = new Map<string, Tool>()

export type ParsedMcpToolName = {
  serverName: string
  toolName: string
}

/**
 * Parse a fully qualified MCP tool name (`mcp__<server>__<tool>`).
 * Returns undefined for non-MCP or malformed names.
 */
export function parseDisplayMcpToolName(
  fullName: string,
): ParsedMcpToolName | undefined {
  if (!fullName.startsWith('mcp__')) return undefined
  const rest = fullName.slice('mcp__'.length)
  const sep = rest.indexOf('__')
  if (sep <= 0) return undefined
  const serverName = rest.slice(0, sep)
  const toolName = rest.slice(sep + 2)
  if (!serverName || !toolName) return undefined
  return { serverName, toolName }
}

/**
 * Official 2.1.323 (#2032 / #2033) `oae` / `flr` — create a cached display-only
 * MCP Tool stub for transcript rendering and `/export` when an MCP server has
 * not connected yet (resumed session) or is no longer loaded.
 */
export function getDisplayOnlyMcpTool(
  fullName: string,
  options?: { isErrored?: boolean; force?: boolean },
): Tool | undefined {
  const fullscreen = isFullscreenEnvEnabled()
  if (!options?.force && !fullscreen && options?.isErrored) {
    return undefined
  }
  const parsed = parseDisplayMcpToolName(fullName)
  if (!parsed) return undefined

  const cached = displayOnlyCache.get(fullName)
  if (cached) return cached

  const failInvoked = (): never => {
    throw new Error(
      'Display-only MCP tool invoked — it exists only for transcript rendering',
    )
  }

  const stub: Tool = {
    ...(MCPTool as unknown as Tool),
    name: fullName,
    isMcp: true,
    mcpInfo: {
      serverName: parsed.serverName,
      toolName: parsed.toolName,
    },
    isEnabled: () => false,
    userFacingName: () => `${parsed.serverName} - ${parsed.toolName} (MCP)`,
    description: async () => failInvoked(),
    prompt: async () => failInvoked(),
    call: async () => failInvoked(),
    checkPermissions: async () => failInvoked(),
  }

  if (displayOnlyCache.size >= DISPLAY_ONLY_CACHE_MAX) {
    const oldestKey = displayOnlyCache.keys().next().value
    if (oldestKey !== undefined) {
      displayOnlyCache.delete(oldestKey)
    }
  }
  displayOnlyCache.set(fullName, stub)
  return stub
}
