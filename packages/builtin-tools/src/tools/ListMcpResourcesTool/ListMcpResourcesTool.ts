import { z } from 'zod/v4'
import {
  ensureConnectedClient,
  fetchResourcesForClient,
} from 'src/services/mcp/client.js'
import { buildTool, type ToolDef } from 'src/Tool.js'
import { logForDebugging } from 'src/utils/debug.js'
import { errorMessage } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logMCPError } from 'src/utils/log.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { isOutputLineTruncated } from 'src/utils/terminal.js'
import { DESCRIPTION, LIST_MCP_RESOURCES_TOOL_NAME, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

/** Official 325 #1888 (`E = { size: 16 MiB, textToSanitize: 1048576 }`). */
export const MAX_MCP_RESOURCE_LISTING_BYTES = 16 * 1024 * 1024
export const MAX_MCP_RESOURCE_SANITIZE_CHARS = 1_048_576
const ENTRY_OVERHEAD = 256
const FIELD_OVERHEAD = 16

function isAsciiOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) return false
  }
  return true
}

/**
 * Official 325 `Qgs` / `L` / `twr` (#1888) — cap MCP resource listings at 16 MiB
 * and 1,048,576 costly-to-normalize characters (weighting non-ASCII `name`
 * fields 16x) to prevent hangs or OOM crashes on cloud connectors with huge
 * resource names.
 */
export function capMcpResourceListing<T extends Record<string, unknown>>(
  resources: readonly T[],
  options?: { maxSize?: number; maxTextToSanitize?: number },
): { items: T[]; skippedCount: number } {
  const maxSize = options?.maxSize ?? MAX_MCP_RESOURCE_LISTING_BYTES
  const maxSixteenths =
    16 * (options?.maxTextToSanitize ?? MAX_MCP_RESOURCE_SANITIZE_CHARS)
  let size = 0
  let sixteenths = 0
  const withinBudget = () => size <= maxSize && sixteenths <= maxSixteenths
  const accountString = (str: string, isTopLevelName: boolean): void => {
    size += str.length
    if (!withinBudget() || isAsciiOnly(str)) return
    sixteenths += isTopLevelName ? 16 * str.length : str.length
  }
  const accountValue = (
    val: unknown,
    isTopLevel: boolean,
    isTopLevelName: boolean,
  ): boolean => {
    size += FIELD_OVERHEAD
    if (typeof val === 'string') {
      accountString(val, isTopLevelName)
    } else if (Array.isArray(val)) {
      for (const el of val) {
        if (!accountValue(el, false, false)) return false
      }
    } else if (val !== null && typeof val === 'object') {
      for (const key of Object.keys(val as Record<string, unknown>)) {
        accountString(key, false)
        if (
          !accountValue(
            (val as Record<string, unknown>)[key],
            false,
            isTopLevel && key === 'name',
          )
        ) {
          return false
        }
      }
    }
    return withinBudget()
  }

  const kept: T[] = []
  for (const item of resources) {
    const prevSize = size
    const prevSixteenths = sixteenths
    size += ENTRY_OVERHEAD
    if (!withinBudget() || !accountValue(item, true, false)) {
      size = prevSize
      sixteenths = prevSixteenths
      break
    }
    kept.push(item)
  }
  return { items: kept, skippedCount: resources.length - kept.length }
}

const inputSchema = lazySchema(() =>
  z.object({
    server: z
      .string()
      .optional()
      .describe('Optional server name to filter resources by'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.array(
    z.object({
      uri: z.string().describe('Resource URI'),
      name: z.string().describe('Resource name'),
      mimeType: z.string().optional().describe('MIME type of the resource'),
      description: z.string().optional().describe('Resource description'),
      server: z.string().describe('Server that provides this resource'),
    }),
  ),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

export const ListMcpResourcesTool = buildTool({
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.server ?? ''
  },
  shouldDefer: true,
  name: LIST_MCP_RESOURCES_TOOL_NAME,
  searchHint: 'list resources from connected MCP servers',
  maxResultSizeChars: 100_000,
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  create(deps) {
    return {
      async call(input) {
        const { server: targetServer } = input
        const mcpClients = deps.mcpClients()
        const preloadedResources = deps.mcpResources

        const clientsToProcess = targetServer
          ? mcpClients.filter(client => client.name === targetServer)
          : mcpClients

        let flat: Output
        if (clientsToProcess.length > 0) {
          // fetchResourcesForClient is LRU-cached (by server name) and already
          // warm from startup prefetch. Cache is invalidated on onclose and on
          // resources/list_changed notifications, so results are never stale.
          // ensureConnectedClient is a no-op when healthy (memoize hit), but after
          // onclose it returns a fresh connection so the re-fetch succeeds.
          const results = await Promise.all(
            clientsToProcess.map(async client => {
              if (client.type !== 'connected') return []
              try {
                const fresh = await ensureConnectedClient(client)
                return await fetchResourcesForClient(fresh)
              } catch (error) {
                // One server's reconnect failure shouldn't sink the whole result.
                logMCPError(client.name, errorMessage(error))
                return []
              }
            }),
          )
          flat = results.flat()
        } else if (
          targetServer &&
          preloadedResources !== undefined &&
          Object.hasOwn(preloadedResources, targetServer)
        ) {
          flat = preloadedResources[targetServer] ?? []
        } else if (targetServer) {
          const available = [
            ...new Set([
              ...mcpClients.map(c => c.name),
              ...Object.keys(preloadedResources ?? {}),
            ]),
          ]
          throw new Error(
            `Server "${targetServer}" not found. Available servers: ${available.join(', ')}`,
          )
        } else if (
          preloadedResources !== undefined &&
          Object.keys(preloadedResources).length > 0
        ) {
          flat = Object.values(preloadedResources).flat()
        } else {
          flat = []
        }

        const { items, skippedCount } = capMcpResourceListing(flat)
        if (skippedCount > 0) {
          logForDebugging(
            `Skipped the last ${skippedCount} of ${flat.length} resources: the listing is too large. Only about the first 16 MB of a listing is used (less if it has many small values), and only about 1 million characters that are costly to normalize. The server must list fewer or shorter resources to get them back.`,
            { level: 'warn' },
          )
        }
        return {
          data: items,
        }
      },
    }
  },
  renderToolUseMessage,
  userFacingName: () => 'listMcpResources',
  renderToolResultMessage,
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(jsonStringify(output))
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    if (!content || content.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content:
          'No resources found. MCP servers may still provide tools even if they have no resources.',
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
