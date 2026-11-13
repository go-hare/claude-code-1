import uniqBy from 'lodash-es/uniqBy.js'
import { useMemo } from 'react'
import type { MCPServerConnection } from '../services/mcp/types.js'

export function mergeClients(
  initialClients: MCPServerConnection[] | undefined,
  mcpClients: readonly MCPServerConnection[] | undefined,
): MCPServerConnection[] {
  if (initialClients && mcpClients && mcpClients.length > 0) {
    return uniqBy([...initialClients, ...mcpClients], 'name')
  }
  return initialClients || []
}

/** Live-first uniqBy name. Official GFe find() must not see a stale pending. */
export function preferLiveMcpClients(
  live: readonly MCPServerConnection[] | undefined,
  stale: readonly MCPServerConnection[] | undefined,
): MCPServerConnection[] {
  const preferred = live ?? []
  const fallback = stale ?? []
  if (preferred.length === 0) return [...fallback]
  if (fallback.length === 0) return [...preferred]
  return uniqBy([...preferred, ...fallback], 'name')
}

export function useMergedClients(
  initialClients: MCPServerConnection[] | undefined,
  mcpClients: MCPServerConnection[] | undefined,
): MCPServerConnection[] {
  return useMemo(
    () => preferLiveMcpClients(mcpClients, initialClients),
    [initialClients, mcpClients],
  )
}
