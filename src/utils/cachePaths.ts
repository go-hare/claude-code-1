import envPaths from 'env-paths'
import { join } from 'path'
import { getOriginalCwd } from '../bootstrap/state.js'
import { getFsImplementation } from './fsOperations.js'
import { djb2Hash } from './hash.js'

const paths = envPaths('claude-cli')

// Local sanitizePath using djb2Hash — NOT the shared version from
// sessionStoragePortable.ts which uses Bun.hash (wyhash) when available.
// Cache directory names must remain stable across upgrades so existing cache
// data (error logs, MCP logs) is not orphaned.
const MAX_SANITIZED_LENGTH = 200
function sanitizePath(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9]/g, '-')
  if (sanitized.length <= MAX_SANITIZED_LENGTH) {
    return sanitized
  }
  return `${sanitized.slice(0, MAX_SANITIZED_LENGTH)}-${Math.abs(djb2Hash(name)).toString(36)}`
}

function getProjectDir(cwd: string): string {
  return sanitizePath(cwd)
}

/**
 * densable `IHn` — cache-path slug from live `Cr().cwd()`; `$n()`
 * (`getOriginalCwd`) when the switched-into directory is gone (ENOENT).
 * `getCwd()` cannot substitute: it reads bootstrap state and never throws.
 */
export function getCachePathCwd(): string {
  try {
    return getFsImplementation().cwd()
  } catch {
    return getOriginalCwd()
  }
}

export const CACHE_PATHS = {
  baseLogs: () => join(paths.cache, getProjectDir(getCachePathCwd())),
  errors: () => join(paths.cache, getProjectDir(getCachePathCwd()), 'errors'),
  messages: () =>
    join(paths.cache, getProjectDir(getCachePathCwd()), 'messages'),
  mcpLogs: (serverName: string) =>
    join(
      paths.cache,
      getProjectDir(getCachePathCwd()),
      // Sanitize server name for Windows compatibility (colons are reserved for drive letters)
      `mcp-logs-${sanitizePath(serverName)}`,
    ),
}
