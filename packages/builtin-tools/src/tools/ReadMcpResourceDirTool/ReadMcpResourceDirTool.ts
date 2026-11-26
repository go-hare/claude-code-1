/**
 * Official 2.1.331 ReadMcpResourceDirTool (`q5e` / `vU`).
 *
 * Lists the direct children of a directory resource on an MCP server via
 * `resources/directory/read` (paginated up to 20 pages, capped via the shared
 * 16 MiB / 1M sanitize-char listing budget).
 */

import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client'
import { z } from 'zod/v4'
import { ensureConnectedClient } from 'src/services/mcp/client.js'
import { getMcpTimeoutMs } from 'src/services/mcp/mcpConnectTimeout.js'
import { normalizeNameForMCP } from 'src/services/mcp/normalization.js'
import type {
  ConnectedMCPServer,
  MCPServerConnection,
  ServerCapabilities,
} from 'src/services/mcp/types.js'
import {
  buildTool,
  resolveMcpClients,
  type ToolDef,
  type ToolResultBlockParam,
} from 'src/Tool.js'
import { AbortError } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logMCPError } from 'src/utils/log.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { capMcpResourceListing } from '../ListMcpResourcesTool/ListMcpResourcesTool.js'
import { LIST_MCP_RESOURCES_TOOL_NAME } from '../ListMcpResourcesTool/prompt.js'
import {
  MCP_DIRECTORY_MAX_PAGES,
  MCP_DIRECTORY_MIME_TYPE,
  MCP_SKILLS_EXTENSION_KEY,
  READ_MCP_RESOURCE_DIR_LEGACY_ALIAS,
  READ_MCP_RESOURCE_DIR_TOOL_NAME,
} from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'

const READ_MCP_RESOURCE_TOOL_NAME = 'ReadMcpResourceTool'

export const inputSchema = lazySchema(() =>
  z.object({
    server: z.string().describe('The MCP server name'),
    uri: z.string().describe('The directory resource URI to list'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>
export type ReadMcpResourceDirInput = z.infer<InputSchema>

export const outputSchema = lazySchema(() =>
  z.object({
    resources: z
      .array(
        z.object({
          uri: z.string().describe('Child resource URI'),
          name: z.string().describe('Child resource name'),
          mimeType: z.string().optional().describe('Child MIME type'),
        }),
      )
      .describe(
        `Direct children of the directory resource. Subdirectories appear with mimeType "${MCP_DIRECTORY_MIME_TYPE}".`,
      ),
    error: z
      .string()
      .optional()
      .describe(
        'Human-readable error when the server could not list the directory',
      ),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type ReadMcpResourceDirOutput = z.infer<OutputSchema>

export type McpDirectoryResourceEntry = {
  uri: string
  name: string
  mimeType?: string
}

type RawDirectoryReadResponse = {
  resources?: Array<{
    uri?: unknown
    name?: unknown
    mimeType?: unknown
  }>
  nextCursor?: unknown
}

type RawRequestClient = {
  request: (
    payload: { method: string; params?: Record<string, unknown> },
    options?: { timeout?: number; signal?: AbortSignal },
  ) => Promise<RawDirectoryReadResponse>
}

/**
 * Official `serverDeclaresDirectoryRead` (`u(r)` in mcpDirectoryReadModule):
 * true when `capabilities.extensions['io.modelcontextprotocol/skills'].directoryRead === true`.
 */
export function serverDeclaresDirectoryRead(
  capabilities: ServerCapabilities | undefined,
): boolean {
  const extensions = (
    capabilities as { extensions?: Record<string, unknown> } | undefined
  )?.extensions
  const skillsExt = extensions?.[MCP_SKILLS_EXTENSION_KEY]
  return (
    skillsExt != null &&
    typeof skillsExt === 'object' &&
    'directoryRead' in skillsExt &&
    (skillsExt as { directoryRead?: unknown }).directoryRead === true
  )
}

/** Extract numeric JSON-RPC error code from an MCP error object if present. */
export function getMcpErrorCode(error: unknown): number | undefined {
  if (error instanceof ProtocolError) {
    return error.code
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code?: unknown }).code === 'number'
  ) {
    return (error as { code: number }).code
  }
  return undefined
}

/**
 * Official `Wfd` (`isMcpNotADirectoryError`):
 * `resources/directory/read` returns JSON-RPC InvalidParams (-32602) when the
 * target URI is not a directory resource.
 */
export function isMcpNotADirectoryError(error: unknown): boolean {
  return getMcpErrorCode(error) === ProtocolErrorCode.InvalidParams
}

/**
 * Official `readMcpDirectory` (`y(r, e, c)`):
 * Paginates `resources/directory/read` up to 20 pages via `cursor` / `nextCursor`.
 * On InvalidParams for page > 0, returns the entries accumulated from prior pages.
 */
export async function readMcpDirectory(
  connected: Pick<ConnectedMCPServer, 'name' | 'capabilities' | 'client'>,
  uri: string,
  signal?: AbortSignal,
): Promise<McpDirectoryResourceEntry[]> {
  if (!serverDeclaresDirectoryRead(connected.capabilities)) {
    throw new Error(
      'readMcpDirectory called on a server without directoryRead capability',
    )
  }

  const rawClient = connected.client as unknown as RawRequestClient
  const collected: McpDirectoryResourceEntry[] = []
  let cursor: string | undefined
  let pageCount = 0

  do {
    let page: RawDirectoryReadResponse
    try {
      page = await rawClient.request(
        {
          method: 'resources/directory/read',
          params: cursor ? { uri, cursor } : { uri },
        },
        { timeout: getMcpTimeoutMs(), signal },
      )
    } catch (err) {
      if (pageCount === 0 || !isMcpNotADirectoryError(err)) {
        throw err
      }
      logMCPError(
        connected.name,
        `resources/directory/read ${uri}: page ${pageCount + 1} returned InvalidParams on cursor; returning ${collected.length} entries from prior pages`,
      )
      return collected
    }

    const resources = Array.isArray(page?.resources) ? page.resources : []
    for (const item of resources) {
      if (typeof item?.uri === 'string' && typeof item?.name === 'string') {
        collected.push({
          uri: item.uri,
          name: item.name,
          ...(typeof item.mimeType === 'string'
            ? { mimeType: item.mimeType }
            : {}),
        })
      }
    }

    cursor =
      typeof page?.nextCursor === 'string' && page.nextCursor.length > 0
        ? page.nextCursor
        : undefined
    pageCount++
  } while (cursor && pageCount < MCP_DIRECTORY_MAX_PAGES)

  if (cursor) {
    logMCPError(
      connected.name,
      `resources/directory/read ${uri}: stopped at ${MCP_DIRECTORY_MAX_PAGES} pages with more pending`,
    )
  }

  return collected
}

function findMcpClient(
  clients: readonly MCPServerConnection[],
  serverName: string,
): MCPServerConnection | undefined {
  const exact = clients.find(c => c.name === serverName)
  if (exact) return exact
  const normalized = normalizeNameForMCP(serverName)
  return clients.find(c => normalizeNameForMCP(c.name) === normalized)
}

export const ReadMcpResourceDirTool = buildTool({
  name: READ_MCP_RESOURCE_DIR_TOOL_NAME,
  aliases: [READ_MCP_RESOURCE_DIR_LEGACY_ALIAS],
  searchHint: 'list the children of an MCP directory resource',
  backgrounding: 'never',
  shouldDefer: true,
  maxResultSizeChars: 100_000,

  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input: ReadMcpResourceDirInput) {
    return `${input.server} ${input.uri}`
  },

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

  userFacingName() {
    return 'readMcpResourceDir'
  },

  renderToolUseMessage(input: Partial<ReadMcpResourceDirInput>) {
    if (!input.uri || !input.server) return null
    return `List directory resource "${input.uri}" from server "${input.server}"`
  },

  async call(input: ReadMcpResourceDirInput, context) {
    const { server: serverName, uri } = input
    const signal = context.abortController?.signal
    const clients = resolveMcpClients(context)
    const client = findMcpClient(clients, serverName)

    if (!client) {
      throw new Error(
        `Server "${serverName}" not found. Available servers: ${clients.map(c => c.name).join(', ')}`,
      )
    }

    if (client.type !== 'connected') {
      return {
        data: {
          resources: [],
          error: `Server "${client.name}" is not connected yet, so this tool cannot tell if it supports directory listing. First call ${LIST_MCP_RESOURCES_TOOL_NAME} with "server" set to "${client.name}". Then call this tool again.`,
        },
      }
    }

    if (!serverDeclaresDirectoryRead(client.capabilities)) {
      return {
        data: {
          resources: [],
          error: `Server "${client.name}" does not support directory listing.`,
        },
      }
    }

    const connectedClient =
      client.client !== undefined
        ? await ensureConnectedClient(client, {
            signal,
            context: 'MCP resource directory read',
          }).catch(() => client)
        : client

    let entries: McpDirectoryResourceEntry[]
    try {
      entries = await readMcpDirectory(connectedClient, uri, signal)
    } catch (err) {
      if (signal?.aborted) {
        throw new AbortError()
      }
      if (isMcpNotADirectoryError(err)) {
        logMCPError(
          client.name,
          `resources/directory/read returned ${getMcpErrorCode(err)} — not a directory`,
        )
        return {
          data: {
            resources: [],
            error: `Not a directory resource: ${uri}. If it is a file resource, use ${READ_MCP_RESOURCE_TOOL_NAME} instead.`,
          },
        }
      }
      throw err
    }

    const { items, skippedCount } = capMcpResourceListing(entries)
    if (skippedCount > 0) {
      logMCPError(
        client.name,
        `directory entries listing truncated (${entries.length} entries exceeded budget)`,
      )
      return {
        data: {
          resources: [],
          error: `The listing of ${uri} is too large to read.`,
        },
      }
    }

    return {
      data: {
        resources: items,
      },
    }
  },

  mapToolResultToToolResultBlockParam(
    output: ReadMcpResourceDirOutput,
    toolUseID: string,
  ): ToolResultBlockParam {
    if (output.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: output.error,
      }
    }
    const lines = output.resources
      .map(
        entry =>
          `${entry.name}${entry.mimeType === MCP_DIRECTORY_MIME_TYPE ? '/' : ''}`,
      )
      .join('\n')
    const count = output.resources.length
    const summary =
      count > 0
        ? `Directory listing (${count} ${count === 1 ? 'entry' : 'entries'}):\n${lines}`
        : 'Directory is empty.'
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: `${summary}\n\n${jsonStringify(output)}`,
    }
  },
} satisfies ToolDef<InputSchema, ReadMcpResourceDirOutput>)
