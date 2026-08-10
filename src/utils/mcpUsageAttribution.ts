/**
 * densable 2.1.222 #6 — MCP usage attribution (sticky stamp fix).
 *
 * SEA:
 * - MCP tool `call` stamps `options.activeMcpServer` / `activeMcpTool`
 * - Query API loop: `Br=V?U.options.activeMcpServer:void 0` then `ARd(U.options,V)`
 * - `V = getQuerySourceFamily(querySource) === 'main' | 'subagent'`
 * - `ARd(e,t){ if(!t) return; e.activeMcpServer=void 0; e.activeMcpTool=void 0 }`
 * - Cost credit attrs: `mcp_server.name` / `mcp_tool.name` only when Br/To set
 *
 * A server's share must only count requests that actually consumed its tool
 * results (stamped on the prior tool call), not every turn after any call.
 */

import type { QuerySourceFamily } from './observerAgents.js'

export type ActiveMcpStamps = {
  activeMcpServer?: string
  activeMcpTool?: string
}

export type CapturedMcpAttribution = {
  activeMcpServer: string | undefined
  activeMcpTool: string | undefined
}

/** densable V — main/subagent queries attribute MCP; auxiliary does not. */
export function shouldAttributeMcpUsage(
  family: QuerySourceFamily | undefined,
): boolean {
  return family === 'main' || family === 'subagent'
}

/**
 * densable ARd — clear sticky stamps after a request that may have attributed.
 * No-op when `shouldAttribute` is false (auxiliary keeps stamps unused).
 */
export function clearActiveMcpStamps(
  options: ActiveMcpStamps,
  shouldAttribute: boolean,
): void {
  if (!shouldAttribute) return
  try {
    options.activeMcpServer = undefined
    options.activeMcpTool = undefined
  } catch {
    // densable xe(r) — ignore non-writable options bags
  }
}

/**
 * densable Br/To capture + ARd clear for one API request.
 * Returns stamps only when `shouldAttribute` is true.
 */
export function captureAndClearActiveMcpAttribution(
  options: ActiveMcpStamps,
  shouldAttribute: boolean,
): CapturedMcpAttribution {
  const activeMcpServer = shouldAttribute ? options.activeMcpServer : undefined
  const activeMcpTool = shouldAttribute ? options.activeMcpTool : undefined
  clearActiveMcpStamps(options, shouldAttribute)
  return { activeMcpServer, activeMcpTool }
}

/** densable qur fragment for cost/token OTEL counters. */
export function mcpUsageCounterAttrs(
  attribution: CapturedMcpAttribution | null | undefined,
): { 'mcp_server.name'?: string; 'mcp_tool.name'?: string } {
  if (!attribution?.activeMcpServer) return {}
  return {
    'mcp_server.name': attribution.activeMcpServer,
    ...(attribution.activeMcpTool
      ? { 'mcp_tool.name': attribution.activeMcpTool }
      : {}),
  }
}

/** Stamp MCP server/tool on tool-use context options (densable call wrap). */
export function stampActiveMcpOnCall(
  options: ActiveMcpStamps,
  serverName: string,
  toolName: string,
): void {
  options.activeMcpServer = serverName
  options.activeMcpTool = toolName
}
