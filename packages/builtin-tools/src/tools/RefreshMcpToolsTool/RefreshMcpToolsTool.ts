import reject from 'lodash-es/reject.js'
import { z } from 'zod/v4'
import {
  fetchToolsForClient,
  fetchToolsForClientUncached,
} from 'src/services/mcp/client.js'
import {
  getMcpPrefix,
  toolBelongsToServer,
} from 'src/services/mcp/mcpStringUtils.js'
import type { MCPServerConnection } from 'src/services/mcp/types.js'
import type { AppState } from 'src/state/AppState.js'
import { buildTool, type Tool, type ToolDef } from 'src/Tool.js'
import { errorMessage } from 'src/utils/errors.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import { logMCPError } from 'src/utils/log.js'
import { getDenyRuleForTool } from 'src/utils/permissions/permissions.js'
import { jsonStringify } from 'src/utils/slowOperations.js'
import { isOutputLineTruncated } from 'src/utils/terminal.js'
import { DESCRIPTION, PROMPT, REFRESH_MCP_TOOLS_TOOL_NAME } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.object({
    server: z
      .string()
      .optional()
      .describe(
        'Optional server name: refresh only this server. Omit to refresh all connected servers.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.array(
    z.object({
      server: z.string().describe('Server name'),
      status: z
        .enum(['refreshed', 'error', 'not_connected'])
        .describe(
          'refreshed: tool list re-queried and applied. error: the re-query failed and the previous tool set was kept. not_connected: the server has no live connection to query (this tool never dials).',
        ),
      toolCount: z
        .number()
        .optional()
        .describe('Number of tools now available from this server'),
      added: z
        .array(z.string())
        .optional()
        .describe('Tool names this refresh added'),
      removed: z
        .array(z.string())
        .optional()
        .describe('Tool names this refresh removed'),
      error: z
        .string()
        .optional()
        .describe('Why the refresh failed or the server was unavailable'),
    }),
  ),
)
type OutputSchema = ReturnType<typeof outputSchema>

export type Output = z.infer<OutputSchema>

/** Per-server concurrent refresh bookkeeping (mirrors official Jlo WeakMap). */
const refreshGeneration = new WeakMap<
  MCPServerConnection,
  { started: number; applied: number }
>()

function replaceServerToolsInAppState(
  setAppState: (f: (prev: AppState) => AppState) => void,
  serverName: string,
  newTools: Tool[],
): boolean {
  let applied = false
  const prefix = getMcpPrefix(serverName)
  setAppState(prev => {
    const mcp = prev.mcp
    // Only update when this server is still present in the live client list.
    if (!mcp.clients.some(c => c.name === serverName)) {
      return prev
    }
    applied = true
    return {
      ...prev,
      mcp: {
        ...mcp,
        tools: [
          ...reject(mcp.tools, t => t.name?.startsWith(prefix)),
          ...newTools,
        ],
      },
    }
  })
  return applied
}

export const RefreshMcpToolsTool = buildTool({
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
  name: REFRESH_MCP_TOOLS_TOOL_NAME,
  searchHint:
    'refresh or re-sync tool lists from connected MCP servers, recover missing device or server tools',
  maxResultSizeChars: 50_000,
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
  async call(input, context) {
    const {
      options: { mcpClients, tools },
      setAppState,
      getAppState,
    } = context
    const { server: targetServer } = input

    const clientsToProcess = targetServer
      ? mcpClients.filter(client => client.name === targetServer)
      : mcpClients

    if (targetServer && clientsToProcess.length === 0) {
      throw new Error(
        `Server "${targetServer}" not found. Available servers: ${mcpClients.map(c => c.name).join(', ')}`,
      )
    }

    const permissionContext = getAppState().toolPermissionContext

    const results = await Promise.all(
      clientsToProcess.map(async (client): Promise<Output[number]> => {
        if (client.type !== 'connected') {
          return {
            server: client.name,
            status: 'not_connected',
            error: `server connection state is "${client.type}" — this tool only re-reads tool lists over live connections and never dials`,
          }
        }

        const prefix = getMcpPrefix(client.name)
        const previousNames = new Set(
          tools
            .filter(t => toolBelongsToServer(t, client.name, prefix))
            .map(t => t.name)
            .filter((n): n is string => typeof n === 'string'),
        )

        const gen = refreshGeneration.get(client) ?? {
          started: 0,
          applied: 0,
        }
        refreshGeneration.set(client, gen)
        gen.started += 1
        const myGen = gen.started

        try {
          // Official densable Jlo: drop cache entry, re-query tools/list.
          // Bypass the swallow-to-[] memoized path so failures throw and we
          // report status:error without wiping the pool (official uses vtd
          // WeakMap on [] for the same kept-previous semantics).
          fetchToolsForClient.cache.delete(client.name)
          const newTools = await fetchToolsForClientUncached(client)

          // Official: discoveryAuthFailure && empty → kept-previous / error.
          if (
            client.type === 'connected' &&
            client.discoveryAuthFailure &&
            newTools.length === 0
          ) {
            return {
              server: client.name,
              status: 'error',
              error:
                'the server rejected tool discovery as unauthorized — the user needs to authorize this connector (e.g. via /mcp) before its tools are available',
            }
          }

          if (gen.applied > myGen) {
            return {
              server: client.name,
              status: 'error',
              error:
                'superseded by a newer concurrent refresh of this server — the newer refresh result is the one applied',
            }
          }
          gen.applied = myGen

          const applied = replaceServerToolsInAppState(
            setAppState,
            client.name,
            newTools,
          )
          if (!applied) {
            return {
              server: client.name,
              status: 'error',
              error:
                'refreshed the server, but the live tool pool was not updated — the server may have been removed or disconnected while the refresh was in flight, or its tools are not managed in this session mode; if it is still configured, the refreshed list applies on the next pool rebuild',
            }
          }

          // Mirror filterToolsByDenyRules without importing src/tools (circular).
          const allowedNames = newTools
            .filter(
              t =>
                !getDenyRuleForTool(permissionContext, t) &&
                t.mcpInfo?.effectiveMaxPermission !== 'blocked',
            )
            .map(t => t.name)
            .filter((n): n is string => typeof n === 'string')
          const nextNames = new Set(allowedNames)

          return {
            server: client.name,
            status: 'refreshed',
            toolCount: allowedNames.length,
            added: allowedNames.filter(n => !previousNames.has(n)),
            removed: [...previousNames].filter(n => !nextNames.has(n)),
          }
        } catch (error) {
          logMCPError(
            client.name,
            `Failed to refresh tools: ${errorMessage(error)}`,
          )
          // Official densable: discoveryAuthFailure path after list failure.
          if (client.type === 'connected' && client.discoveryAuthFailure) {
            return {
              server: client.name,
              status: 'error',
              error:
                'the server rejected tool discovery as unauthorized — the user needs to authorize this connector (e.g. via /mcp) before its tools are available',
            }
          }
          return {
            server: client.name,
            status: 'error',
            error:
              errorMessage(error) ||
              'tools/list failed; the previous tool set was kept',
          }
        }
      }),
    )

    return { data: results }
  },
  renderToolUseMessage,
  userFacingName: () => 'refreshMcpTools',
  renderToolResultMessage,
  isResultTruncated(output: Output): boolean {
    return isOutputLineTruncated(jsonStringify(output))
  },
  mapToolResultToToolResultBlockParam(content, toolUseID) {
    if (!content || content.length === 0) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result',
        content: 'No MCP servers to refresh.',
      }
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: jsonStringify(content),
    }
  },
} satisfies ToolDef<InputSchema, Output>)
