import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import {
  type AgentDefinitionsResult,
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { listToolsResult } from 'src/services/mcp/listToolsResult.js'
import type { CallToolResult } from 'src/services/mcp/types.js'
import { disableForkSubagent } from 'src/utils/sessionBackgroundGates.js'
import { disableUnsandboxedCommandsForMcpServe } from '@claude-code/builtin-tools/tools/BashTool/shouldUseSandbox.js'
import { getDefaultAppState } from 'src/state/AppStateStore.js'
import review from '../commands/review.js'
import type { Command } from '../commands.js'
import {
  findToolByName,
  getEmptyToolPermissionContext,
  type Tools,
  type ToolUseContext,
} from '../Tool.js'
import { getTools } from '../tools.js'
import {
  createAbortController,
  createAbortErrorReason,
  createChildAbortController,
} from '../utils/abortController.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import { createFileStateCacheWithSizeLimit } from '../utils/fileStateCache.js'
import {
  isAgentHooksOriginTrusted,
  logAgentHooksOriginUntrusted,
} from '../utils/hooks/agentHooksOriginTrust.js'
import { ToolStateSlots } from '../utils/toolState.js'
import { logError } from '../utils/log.js'
import { createAssistantMessage } from '../utils/messages.js'
import { getMainLoopModel } from '../utils/model/model.js'
import { hasPermissionsToUseTool } from '../utils/permissions/permissions.js'
import { settingsChangeDetector } from '../utils/settings/changeDetector.js'
import { onRemoteSettingsLoadStatusChanged } from '../utils/settings/remoteSettingsState.js'
import { setCwd } from '../utils/Shell.js'
import { jsonStringify } from '../utils/slowOperations.js'
import { credentialsStoreFor } from '../utils/storageV5/credentialsStore.js'
import { getTaskOutputPath } from '../utils/task/diskOutput.js'
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

/**
 * densable Ee persist pair. `storageV5` is caller parameter `s`
 * (mcp serve passes "raw", and Ee does not rebind `s`). credentials
 * is Nx(s) via credentialsStoreFor, computed once for the server.
 */
export function mcpServeToolStorage(storageV5: unknown): {
  storageV5: unknown
  credentials: ReturnType<typeof credentialsStoreFor>
} {
  return {
    storageV5,
    credentials: credentialsStoreFor(storageV5),
  }
}

/**
 * Gold `sJr` tools/call result serializer (#411): when a tool returns a
 * `backgroundTaskId`, include `backgroundOutputPath` so MCP callers can read
 * the background Bash/task output file directly.
 */
export function formatMcpServeToolResult(
  finalResult: string | { data: unknown },
): CallToolResult {
  const resultText =
    typeof finalResult === 'string'
      ? finalResult
      : jsonStringify(
          typeof finalResult.data === 'object' &&
            finalResult.data !== null &&
            'backgroundTaskId' in finalResult.data &&
            typeof finalResult.data.backgroundTaskId === 'string'
            ? {
                ...finalResult.data,
                backgroundOutputPath: getTaskOutputPath(
                  finalResult.data.backgroundTaskId,
                ),
              }
            : finalResult.data,
        )
  return {
    content: [
      {
        type: 'text' as const,
        text: resultText,
      },
    ],
  }
}

/**
 * Official 2.1.328 (`Be = 30000`, `J` @chunk@344402012.js): 30-second
 * `notifications/progress` heartbeat interval for `claude mcp serve` tool
 * calls when the caller provides a `_meta.progressToken`.
 */
export const MCP_PROGRESS_HEARTBEAT_INTERVAL_MS = 30_000

export type McpProgressNotification = {
  method: 'notifications/progress'
  params: {
    progressToken: string | number
    progress: number
    message?: string
  }
}

export type McpProgressHeartbeat = {
  report?: (message: string) => Promise<void>
  stop: () => void
}

/**
 * Official 2.1.328 (`J(progressToken, sendNotification, intervalMs)`):
 * emit monotonic `notifications/progress` heartbeats every `intervalMs`
 * (default 30s) while a tool call executes when `progressToken` is supplied.
 */
export function startMcpProgressHeartbeat(
  progressToken: string | number | undefined,
  sendNotification: (notification: McpProgressNotification) => Promise<void>,
  intervalMs: number = MCP_PROGRESS_HEARTBEAT_INTERVAL_MS,
): McpProgressHeartbeat {
  if (progressToken === undefined) {
    return { report: undefined, stop: () => {} }
  }
  let tick = 0
  let lastProgress = 0
  const send = (progressValue: number, message?: string): Promise<void> => {
    lastProgress =
      progressValue > lastProgress ? progressValue : lastProgress + 0.001
    return sendNotification({
      method: 'notifications/progress',
      params: {
        progressToken,
        progress: lastProgress,
        ...(message !== undefined ? { message } : {}),
      },
    })
  }
  const timer = setInterval(() => {
    tick += 1
    const elapsedSeconds = (tick * intervalMs) / 1000
    send(elapsedSeconds, `Running for ${elapsedSeconds}s`).catch(err => {
      logForDebugging(
        `MCP server: progress heartbeat not sent: ${errorMessage(err)}`,
      )
    })
  }, intervalMs)
  timer.unref?.()
  return {
    report: (message: string) => send(0, message),
    stop: () => {
      clearInterval(timer)
    },
  }
}

/**
 * Official 2.1.328 (`z(signal, ...)` @chunk@344402012.js): create a per-call
 * child `AbortController` linked both to the server's lifecycle abort
 * controller (`'shutdown'`) and the incoming MCP request cancellation signal
 * (`'remote-cancel'`).
 */
export function createLinkedMcpCallAbortController(
  serverAbortController: AbortController,
  requestSignal?: AbortSignal,
): { abortController: AbortController; detach: () => void } {
  const abortController = createChildAbortController(serverAbortController)
  const onRemoteCancel = () => {
    abortController.abort(createAbortErrorReason('remote-cancel'))
  }
  if (requestSignal) {
    if (requestSignal.aborted) {
      onRemoteCancel()
    } else {
      requestSignal.addEventListener('abort', onRemoteCancel, { once: true })
    }
  }
  return {
    abortController,
    detach: () => {
      requestSignal?.removeEventListener('abort', onRemoteCancel)
    },
  }
}

function getMcpServeVersion(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (typeof MACRO !== 'undefined' && MACRO.VERSION) || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export type CreateMCPServerOptions = {
  progressHeartbeatIntervalMs?: number
  getToolsOverride?: () => Tools
  loadAgentDefinitions?: (cwd: string) => Promise<AgentDefinitionsResult>
}

export function createMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
  // densable Ee `s`. mcp serve passes the literal "raw".
  storageV5: unknown,
  options?: CreateMCPServerOptions,
): {
  server: Server
  ready: Promise<void>
  dispose: () => void
} {
  const persist = mcpServeToolStorage(storageV5)
  // Use size-limited LRU cache for readFileState to prevent unbounded memory growth
  // 100 files and 25MB limit should be sufficient for MCP server operations
  const READ_FILE_STATE_CACHE_SIZE = 100
  const readFileStateCache = createFileStateCacheWithSizeLimit(
    READ_FILE_STATE_CACHE_SIZE,
  )
  const toolState = new ToolStateSlots()
  setCwd(cwd)
  // Official 2.1.302 #924: `claude mcp serve` never offers fork subagents.
  disableForkSubagent()
  // Official 2.1.326 #304: `claude mcp serve` ignores `sandbox.excludedCommands`.
  disableUnsandboxedCommandsForMcpServe()

  // Official 2.1.328 (`de`/`ve` @chunk@344402012.js): load project agent
  // definitions filtered by workspace origin trust instead of hardcoding empty.
  let agentDefinitions: AgentDefinitionsResult = {
    activeAgents: [],
    allAgents: [],
  }
  const loadAgentsFn =
    options?.loadAgentDefinitions ?? getAgentDefinitionsWithOverrides
  const agentDefinitionsReady = loadAgentsFn(cwd)
    .then(loaded => {
      const trustedAll = loaded.allAgents.filter(agent => {
        if (isAgentHooksOriginTrusted(agent)) {
          return true
        }
        logAgentHooksOriginUntrusted(agent, 'subagent')
        return false
      })
      agentDefinitions = {
        ...loaded,
        allAgents: trustedAll,
        activeAgents: getActiveAgentsFromList(trustedAll),
      }
    })
    .catch(err => {
      logError(err)
    })

  // Official 2.1.328 (`chunk@344402012.js`): declare tools.listChanged: true
  const server = new Server(
    {
      name: 'claude/tengu',
      version: getMcpServeVersion(),
    },
    {
      capabilities: {
        tools: {
          listChanged: true,
        },
      },
    },
  )

  const serverAbortController = createAbortController()
  const resolveServedTools = (): Tools =>
    options?.getToolsOverride
      ? options.getToolsOverride()
      : getTools(getEmptyToolPermissionContext())

  // Official 2.1.328 (`Y`/`Ue`/`Fe`/`E6i` @chunk@344402012.js): track listed
  // tool names and emit `notifications/tools/list_changed` when settings or
  // remote policy change.
  let lastListedToolNames: string | null = null
  let isInitialized = false
  let isClosed = false

  const emitToolListChangedIfNeeded = (forceOnInitialized = false): void => {
    if (isClosed) return
    if (lastListedToolNames === null) {
      if (forceOnInitialized && isInitialized) {
        server.sendToolListChanged().catch(err => {
          logForDebugging(
            `mcp serve: tools/list_changed not sent: ${errorMessage(err)}`,
          )
        })
      }
      return
    }
    const nextToolNames = resolveServedTools()
      .map(t => t.name)
      .join('\n')
    if (!forceOnInitialized && nextToolNames === lastListedToolNames) {
      return
    }
    const previousToolNames = lastListedToolNames
    lastListedToolNames = nextToolNames
    server.sendToolListChanged().catch(err => {
      if (lastListedToolNames === nextToolNames) {
        lastListedToolNames = previousToolNames
      }
      logForDebugging(
        `mcp serve: tools/list_changed not sent: ${errorMessage(err)}`,
      )
    })
  }

  const unsubscribeSettings = settingsChangeDetector.subscribe(() => {
    queueMicrotask(() => {
      if (isClosed) return
      try {
        emitToolListChangedIfNeeded(true)
      } catch (err) {
        logForDebugging(
          `mcp serve: tool re-list on settings change failed: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }
    })
  })

  const unsubscribeRemotePolicy = onRemoteSettingsLoadStatusChanged(() => {
    queueMicrotask(() => {
      if (isClosed) return
      try {
        emitToolListChangedIfNeeded(false)
      } catch (err) {
        logForDebugging(
          `mcp serve: tool re-list on policy verdict failed: ${errorMessage(err)}`,
          { level: 'error' },
        )
      }
    })
  })

  const dispose = (): void => {
    if (isClosed) return
    isClosed = true
    unsubscribeSettings()
    unsubscribeRemotePolicy()
    serverAbortController.abort(createAbortErrorReason('shutdown'))
  }

  server.oninitialized = () => {
    isInitialized = true
  }
  server.onclose = () => {
    dispose()
  }

  // densable: setRequestHandler("tools/list", ...)
  // Cast return: nested JSON Schema property types widen vs v2 literal unions.
  server.setRequestHandler('tools/list', async () => {
    await agentDefinitionsReady
    // TODO: Also re-expose any MCP tools
    const toolPermissionContext = getEmptyToolPermissionContext()
    const tools = resolveServedTools()
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
            agents: agentDefinitions.activeAgents,
          }),
          inputSchema,
          ...(outputSchema ? { outputSchema } : {}),
        }
      }),
    )
    lastListedToolNames = listed.map(item => item.name).join('\n')
    // Nested property schemas stay structural; boundary via listToolsResult.
    return listToolsResult(listed)
  })

  // densable: setRequestHandler("tools/call", ...)
  server.setRequestHandler(
    'tools/call',
    async (request, ctx): Promise<CallToolResult> => {
      await agentDefinitionsReady
      const params = (
        request as {
          params?: {
            name?: string
            arguments?: Record<string, unknown>
            _meta?: { progressToken?: string | number }
          }
        }
      ).params
      const name = params?.name ?? ''
      const args = params?.arguments
      const tools = resolveServedTools()
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      // Extract incoming cancellation signal and progress notification channel
      // from MCP SDK v2 ServerContext (`ctx.mcpReq`) with legacy `extra` fallback.
      const extraLike = ctx as
        | {
            mcpReq?: {
              signal?: AbortSignal
              _meta?: { progressToken?: string | number }
              notify?: (notification: McpProgressNotification) => Promise<void>
            }
            signal?: AbortSignal
            sendNotification?: (
              notification: McpProgressNotification,
            ) => Promise<void>
          }
        | undefined
      const requestSignal = extraLike?.mcpReq?.signal ?? extraLike?.signal
      const progressToken =
        extraLike?.mcpReq?._meta?.progressToken ?? params?._meta?.progressToken
      const sendNotification =
        extraLike?.mcpReq?.notify ?? extraLike?.sendNotification

      const { abortController, detach } = createLinkedMcpCallAbortController(
        serverAbortController,
        requestSignal,
      )

      // Assume MCP servers do not read messages separately from the tool
      // call arguments.
      const toolUseContext: ToolUseContext = {
        abortController,
        options: {
          commands: MCP_COMMANDS,
          tools,
          mainLoopModel: getMainLoopModel(),
          // densable Vm: MCP tools/call host thinkingConfig {type:"disabled",mechanical:!0}
          thinkingConfig: { type: 'disabled', mechanical: true },
          mcpClients: [],
          mcpResources: {},
          isNonInteractiveSession: true,
          debug,
          verbose,
          agentDefinitions,
        },
        getAppState: () => getDefaultAppState(),
        setAppState: () => {},
        // densable y8r no-ops for MCP-exported tool path (no session UI)
        setToolPermissionContext: () => {},
        setSessionToolPermissionContext: () => {},
        messages: [],
        readFileState: readFileStateCache,
        toolState,
        setInProgressToolUseIDs: () => {},
        setResponseLength: () => {},
        updateFileHistoryState: () => {},
        storageV5: persist.storageV5,
        credentials: persist.credentials,
      }

      let heartbeat: McpProgressHeartbeat | undefined
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

        if (sendNotification) {
          heartbeat = startMcpProgressHeartbeat(
            progressToken,
            sendNotification,
            options?.progressHeartbeatIntervalMs ??
              MCP_PROGRESS_HEARTBEAT_INTERVAL_MS,
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

        return formatMcpServeToolResult(finalResult)
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
      } finally {
        heartbeat?.stop()
        detach()
      }
    },
  )

  return { server, ready: agentDefinitionsReady, dispose }
}

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
  // densable Ee `s`. mcp serve passes the literal "raw".
  storageV5: unknown,
): Promise<void> {
  const { server } = createMCPServer(cwd, debug, verbose, storageV5)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
