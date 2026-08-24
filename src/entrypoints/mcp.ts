import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import { listToolsResult } from 'src/services/mcp/listToolsResult.js'
import type { CallToolResult } from 'src/services/mcp/types.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import review from '../commands/review.js'
import type { Command } from '../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type ToolUseContext,
} from '../Tool.js'
import { getTools } from '../tools.js'
import { createAbortController } from '../utils/abortController.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import { logError } from '../utils/log.js'
import { createAssistantMessage } from '../utils/messages.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'
import { setCwd } from '../utils/Shell.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { formatZodValidationError, getErrorParts } from '../utils/toolErrors.js'
import { zodToJsonSchema } from '../utils/zodToJsonSchema.js'

/** v2 ListToolsResult requires inputSchema.type === "object" at the root. */
type McpToolInputSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}
type McpToolOutputSchema = {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  [key: string]: unknown
}

const MCP_COMMANDS: Command[] = [review]

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
): Promise<void> {
  // Use size-limited LRU cache for readFileState to prevent unbounded memory growth
  // 100 files and 25MB limit should be sufficient for MCP server operations
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  setCwd(cwd)
  const server = new Server(
    {
      name: 'claude/tengu',
      version: MACRO.VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  // densable: setRequestHandler("tools/list", ...)
  // Cast return: nested JSON Schema property types widen vs v2 literal unions.
  server.setRequestHandler('tools/list', async () => {
    // TODO: Also re-expose any MCP tools
    const toolPermissionContext = getEmptyToolPermissionContext()
    const tools = getTools(toolPermissionContext)
    const listed = await Promise.all(
      tools.map(async tool => {
        let outputSchema: McpToolOutputSchema | undefined
        if (tool.outputSchema) {
          const convertedSchema = zodToJsonSchema(tool.outputSchema)
          // MCP SDK requires outputSchema to have type: "object" at root level
          // Skip schemas with anyOf/oneOf at root (from z.union, z.discriminatedUnion, etc.)
          // See: https://github.com/anthropics/claude-code/issues/8014
          if (
            typeof convertedSchema === 'object' &&
            convertedSchema !== null &&
            'type' in convertedSchema &&
            convertedSchema.type === 'object'
          ) {
            outputSchema = convertedSchema as McpToolOutputSchema
          }
        }
        const inputSchema = zodToJsonSchema(
          tool.inputSchema,
        ) as McpToolInputSchema
        // densable/v2 wire: root must be object (zodToJsonSchema may widen)
        inputSchema.type = 'object'
        return {
          name: tool.name,
          description: await tool.prompt({
            getToolPermissionContext: async () => toolPermissionContext,
            tools,
            agents: [],
          }),
          inputSchema,
          ...(outputSchema ? { outputSchema } : {}),
        }
      }),
    )
    // Nested property schemas stay structural; boundary via listToolsResult.
    return listToolsResult(listed)
  })

  // densable: setRequestHandler("tools/call", ...)
  server.setRequestHandler(
    'tools/call',
    async (request): Promise<CallToolResult> => {
      const params = (
        request as {
          params?: { name?: string; arguments?: Record<string, unknown> }
        }
      ).params
      const name = params?.name ?? ''
      const args = params?.arguments
      const toolPermissionContext = getEmptyToolPermissionContext()
      // TODO: Also re-expose any MCP tools
      const tools = getTools(toolPermissionContext)
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      // Assume MCP servers do not read messages separately from the tool
      // call arguments.
      const toolUseContext: ToolUseContext = {
        abortController: createAbortController(),
        options: {
          commands: MCP_COMMANDS,
          tools,
          mainLoopModel: getMainLoopModel(),
          thinkingConfig: { type: 'disabled' },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: true,
          debug,
          verbose,
          agentDefinitions: { activeAgents: [], allAgents: [] },
        },
        getAppState: () => getDefaultAppState(),
        setAppState: () => {},
        // densable y8r no-ops for MCP-exported tool path (no session UI)
        setToolPermissionContext: () => {},
        setSessionToolPermissionContext: () => {},
        messages: [],
        readFileState: readFileStateCache,
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        updateAttributionState: () => {},
      }

      // densable main loop (toolExecution): coerceInput → safeParse → validateInput → call.
      // Same path for MCP-exported built-ins — no invent gateway, no args as never.
      try {
        if (!tool.isEnabled()) {
          throw new Error(`Tool ${name} is not enabled`)
        }
        let parseTarget: unknown = args ?? {}
        if (tool.coerceInput) {
          const coerced = tool.coerceInput(parseTarget)
          if (coerced !== null) {
            parseTarget = coerced.input
          }
        }
        const parsedInput = tool.inputSchema.safeParse(parseTarget)
        if (!parsedInput.success) {
          throw new Error(
            `Tool ${name} input is invalid: ${formatZodValidationError(name, parsedInput.error)}`,
          )
        }
        const validationResult = await tool.validateInput?.(
          parsedInput.data,
          toolUseContext,
        )
        if (validationResult && !validationResult.result) {
          throw new Error(
            `Tool ${name} input is invalid: ${'message' in validationResult ? validationResult.message : String(validationResult)}`,
          )
        }
        const finalResult = await tool.call(
          parsedInput.data,
          toolUseContext,
          hasPermissionsToUseTool,
          createAssistantMessage({
            content: [],
          }),
        )

        return {
          content: [
            {
              type: 'text' as const,
              text:
                typeof finalResult === 'string'
                  ? finalResult
                  : jsonStringify(finalResult.data),
            },
          ],
        }
      } catch (error) {
        logError(error)

        const parts =
          error instanceof Error ? getErrorParts(error) : [String(error)]
        const errorText = parts.filter(Boolean).join('\n').trim() || 'Error'

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: errorText,
            },
          ],
        }
      }
    },
  )

  async function runServer() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return await runServer()
}
