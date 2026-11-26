import { LRUCache } from 'lru-cache'
import type { Command } from '../commands.js'
import { normalizeNameForMCP } from '../services/mcp/normalization.js'
import type { MCPServerConnection } from '../services/mcp/types.js'
import { errorMessage } from '../utils/errors.js'
import { parseFrontmatter } from '../utils/frontmatterParser.js'
import { logMCPDebug, logMCPError } from '../utils/log.js'
import { recursivelySanitizeUnicode } from '../utils/sanitization.js'
import { getBootstrapSessionHost, HostSlot } from '../utils/sessionHost.js'
import { getMCPSkillBuilders } from './mcpSkillBuilders.js'

const SKILL_URI_PREFIX = 'skill://'
const MCP_FETCH_CACHE_SIZE = 20

export type McpSkillsCache = {
  get: (key: string) => Promise<Command[]> | undefined
  set: (key: string, value: Promise<Command[]>) => McpSkillsCache
  has: (key: string) => boolean
  delete: (key: string) => boolean
  clear: () => void
  readonly size: number
  keys: () => IterableIterator<string>
  values: () => IterableIterator<Promise<Command[]>>
  entries: () => IterableIterator<[string, Promise<Command[]>]>
  [Symbol.iterator]: () => IterableIterator<[string, Promise<Command[]>]>
}

type HostMcpSkillsBackingCache = {
  get: (key: string) => Promise<Command[]> | undefined
  peek?: (key: string) => Promise<Command[]> | undefined
  set: (key: string, value: Promise<Command[]>) => unknown
  has: (key: string) => boolean
  delete: (key: string) => boolean
  clear: () => void
  readonly size: number
  keys: () => IterableIterator<string>
  values: () => IterableIterator<Promise<Command[]>>
  entries: () => IterableIterator<[string, Promise<Command[]>]>
  [Symbol.iterator]: () => IterableIterator<[string, Promise<Command[]>]>
}

type HostMcpSkillsState = {
  cache: HostMcpSkillsBackingCache
}

const mcpSkillsHostSlot = new HostSlot<HostMcpSkillsState>(() => ({
  cache: new LRUCache<string, Promise<Command[]>>({
    max: MCP_FETCH_CACHE_SIZE,
  }),
}))

function getHostMcpSkillsCache(): HostMcpSkillsBackingCache {
  return mcpSkillsHostSlot.of(getBootstrapSessionHost()).cache
}

const mcpSkillsCacheProxy: McpSkillsCache = {
  get(key: string): Promise<Command[]> | undefined {
    const cache = getHostMcpSkillsCache()
    return typeof cache.peek === 'function' ? cache.peek(key) : cache.get(key)
  },
  set(key: string, value: Promise<Command[]>): McpSkillsCache {
    getHostMcpSkillsCache().set(key, value)
    return mcpSkillsCacheProxy
  },
  has(key: string): boolean {
    return getHostMcpSkillsCache().has(key)
  },
  delete(key: string): boolean {
    return getHostMcpSkillsCache().delete(key)
  },
  clear(): void {
    getHostMcpSkillsCache().clear()
  },
  get size(): number {
    return getHostMcpSkillsCache().size
  },
  keys(): IterableIterator<string> {
    return getHostMcpSkillsCache().keys()
  },
  values(): IterableIterator<Promise<Command[]>> {
    return getHostMcpSkillsCache().values()
  },
  entries(): IterableIterator<[string, Promise<Command[]>]> {
    return getHostMcpSkillsCache().entries()
  },
  [Symbol.iterator](): IterableIterator<[string, Promise<Command[]>]> {
    return getHostMcpSkillsCache()[Symbol.iterator]()
  },
}

async function fetchMcpSkillsForClientImpl(
  client: MCPServerConnection,
  signal: AbortSignal | undefined,
  cache: HostMcpSkillsBackingCache,
): Promise<Command[]> {
  if (client.type !== 'connected') return []
  if (signal?.aborted) {
    cache.delete(client.name)
    return []
  }

  const requestOptions = signal ? { signal } : undefined

  try {
    if (!client.capabilities?.resources) {
      return []
    }

    // List all resources and filter to skill:// URIs
    // v2 Client exposes typed listResources/readResource (no ResultSchema arg)
    const result = await client.client.listResources(undefined, requestOptions)

    if (!result.resources) return []

    const skillResources = result.resources.filter((r: { uri: string }) =>
      r.uri.startsWith(SKILL_URI_PREFIX),
    )

    if (skillResources.length === 0) return []

    logMCPDebug(client.name, `Found ${skillResources.length} skill resource(s)`)

    const { createSkillCommand, parseSkillFrontmatterFields } =
      getMCPSkillBuilders()

    const commands: Command[] = []

    for (const resource of skillResources) {
      if (signal?.aborted) {
        cache.delete(client.name)
        return []
      }
      try {
        // Read the skill resource content
        const readResult = await client.client.readResource(
          {
            uri: resource.uri,
          },
          requestOptions,
        )

        // Extract text content from the resource
        const textContent = readResult.contents
          ?.map(c => ('text' in c ? c.text : undefined))
          .filter((t): t is string => typeof t === 'string' && t.length > 0)
          .join('\n')

        if (!textContent) {
          logMCPDebug(
            client.name,
            `Skill resource ${resource.uri} returned no text content, skipping`,
          )
          continue
        }

        const sanitizedContent = recursivelySanitizeUnicode(textContent)

        // Parse the markdown frontmatter
        const { frontmatter, content: markdownContent } =
          parseFrontmatter(sanitizedContent)

        // Derive a skill name from the resource URI. Strip the skill://
        // prefix and use the remainder, prefixed with the MCP server name
        // so it is unique across servers.
        const rawName = resource.uri.slice(SKILL_URI_PREFIX.length)
        const skillName =
          'mcp__' + normalizeNameForMCP(client.name) + '__' + rawName

        const parsed = parseSkillFrontmatterFields(
          frontmatter,
          markdownContent,
          skillName,
        )

        commands.push(
          createSkillCommand({
            ...parsed,
            skillName,
            markdownContent,
            source: 'mcp',
            loadedFrom: 'mcp',
            baseDir: undefined,
            paths: undefined,
          }),
        )
      } catch (error) {
        logMCPError(
          client.name,
          `Failed to load skill resource ${resource.uri}: ${errorMessage(error)}`,
        )
      }
    }

    logMCPDebug(
      client.name,
      `Loaded ${commands.length} skill(s) from resources`,
    )

    return commands
  } catch (error) {
    if (signal?.aborted) {
      cache.delete(client.name)
      return []
    }
    logMCPError(
      client.name,
      `Failed to fetch skill resources: ${errorMessage(error)}`,
    )
    return []
  }
}

type FetchMcpSkillsFn = {
  (client: MCPServerConnection, signal?: AbortSignal): Promise<Command[]>
  cache: McpSkillsCache
}

const fetchMcpSkillsForClientFn = (
  client: MCPServerConnection,
  signal?: AbortSignal,
): Promise<Command[]> => {
  const cache = getHostMcpSkillsCache()
  const key = client.name
  const cached = cache.get(key)
  if (cached !== undefined) {
    return cached
  }
  if (signal?.aborted) {
    return Promise.resolve([])
  }
  const promise = fetchMcpSkillsForClientImpl(client, signal, cache)
  cache.set(key, promise)
  return promise
}

Object.defineProperty(fetchMcpSkillsForClientFn, 'cache', {
  configurable: true,
  enumerable: true,
  get(): McpSkillsCache {
    return mcpSkillsCacheProxy
  },
  set(next: HostMcpSkillsBackingCache): void {
    if (next === mcpSkillsCacheProxy) return
    mcpSkillsHostSlot.of(getBootstrapSessionHost()).cache = next
  },
})

/**
 * Discovers skills exposed as `skill://` resources by an MCP server.
 *
 * Each matching resource is read, its markdown content is parsed for
 * frontmatter, and the result is converted into a Command that the skill
 * system can index and invoke just like a local `.md` skill file.
 *
 * Memoized per SessionHost by server name via a HostSlot-scoped LRU cache so
 * repeated calls within a connection lifecycle return the cached result and
 * concurrent hosts never share or evict each other's skill caches.
 * Callers invalidate via `.cache.delete(name)`.
 */
export const fetchMcpSkillsForClient: FetchMcpSkillsFn =
  fetchMcpSkillsForClientFn as unknown as FetchMcpSkillsFn
