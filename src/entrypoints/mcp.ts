import { randomUUID } from 'node:crypto'
import { Server } from '@modelcontextprotocol/server'
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio'
import {
  type AgentDefinitionsResult,
  getActiveAgentsFromList,
  getAgentDefinitionsWithOverrides,
} from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import {
  attachSubagentFrameResultMeta,
  isEditResultMetaRequested,
} from 'src/services/mcp/editResultMeta.js'
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
  type Tool,
  type ToolResult,
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

export type McpServeResultFormat = 'raw' | 'rendered'

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
  if (typeof finalResult === 'string') {
    return {
      content: [
        {
          type: 'text' as const,
          text: finalResult,
        },
      ],
    }
  }

  let payload: unknown = finalResult.data
  if (
    typeof finalResult.data === 'object' &&
    finalResult.data !== null &&
    'backgroundTaskId' in finalResult.data &&
    typeof finalResult.data.backgroundTaskId === 'string'
  ) {
    try {
      payload = {
        ...finalResult.data,
        backgroundOutputPath: getTaskOutputPath(
          finalResult.data.backgroundTaskId,
        ),
      }
    } catch {
      payload = finalResult.data
    }
  }

  return {
    content: [
      {
        type: 'text' as const,
        text: jsonStringify(payload),
      },
    ],
  }
}

type McpCallToolContentItem = CallToolResult['content'][number]

/**
 * Official 2.1.331 `--result-format rendered`: convert a tool's
 * `mapToolResultToToolResultBlockParam(data, toolUseId)` output to MCP
 * `CallToolResult['content']` (supporting text and base64 image blocks),
 * falling back to `formatMcpServeToolResult` when no renderer is present.
 */
export function formatMcpServeRenderedToolResult(
  tool: Pick<Tool, 'mapToolResultToToolResultBlockParam'>,
  finalResult: string | ToolResult<unknown>,
  toolUseId: string,
): CallToolResult {
  if (
    typeof finalResult === 'string' ||
    typeof tool.mapToolResultToToolResultBlockParam !== 'function'
  ) {
    return formatMcpServeToolResult(finalResult)
  }

  const mapped = tool.mapToolResultToToolResultBlockParam(
    finalResult.data,
    toolUseId,
  )
  const content: McpCallToolContentItem[] = []

  if (typeof mapped.content === 'string') {
    content.push({ type: 'text', text: mapped.content })
  } else if (Array.isArray(mapped.content)) {
    for (const block of mapped.content) {
      if (block.type === 'text') {
        content.push({ type: 'text', text: block.text })
      } else if (block.type === 'image' && block.source.type === 'base64') {
        content.push({
          type: 'image',
          data: block.source.data,
          mimeType: block.source.media_type,
        })
      } else {
        content.push({ type: 'text', text: jsonStringify(block) })
      }
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' })
  }

  return {
    content,
    ...(mapped.is_error === true ? { isError: true } : {}),
  }
}

async function finalizeMcpCallToolResult(
  tool: Tool,
  finalResult: string | ToolResult<unknown>,
  resultFormat: McpServeResultFormat,
  toolUseId: string,
  requestMeta: unknown,
): Promise<CallToolResult> {
  const baseResult =
    resultFormat === 'rendered'
      ? formatMcpServeRenderedToolResult(tool, finalResult, toolUseId)
      : formatMcpServeToolResult(finalResult)

  if (
    typeof finalResult === 'string' ||
    !isEditResultMetaRequested(tool.name, requestMeta)
  ) {
    return baseResult
  }

  const editResultPayload = finalResult.subagentFrameResult ?? finalResult.data
  if (editResultPayload === undefined) {
    return baseResult
  }

  return await attachSubagentFrameResultMeta(baseResult, {
    subagentFrameResult: editResultPayload,
    subagentFrameResultHolds: finalResult.subagentFrameResultHolds,
  })
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
  resultFormat?: McpServeResultFormat
}

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type CreateMcpServeDispatcherOptions = {
  cwd: string
  debug?: boolean
  verbose?: boolean
  storageV5?: unknown
  resultFormat?: McpServeResultFormat
  progressHeartbeatIntervalMs?: number
  getToolsOverride?: () => Tools
  loadAgentDefinitions?: (cwd: string) => Promise<AgentDefinitionsResult>
}

export type McpServeToolDispatcher = {
  readonly ready: Promise<void>
  readonly resultFormat: McpServeResultFormat
  readonly resolveServedTools: () => Tools
  readonly abortController: AbortController
  listTools: () => Promise<ReturnType<typeof listToolsResult>>
  callTool: (
    params: {
      name?: string
      arguments?: Record<string, unknown>
      _meta?: Record<string, unknown>
    },
    options?: {
      signal?: AbortSignal
      sendNotification?: (
        notification: McpProgressNotification,
      ) => Promise<void>
    },
  ) => Promise<CallToolResult>
  checkPermissions: (params: {
    name?: string
    arguments?: Record<string, unknown>
    toolUseId?: string
  }) => Promise<Record<string, unknown>>
  handleJsonRpc: (
    request: JsonRpcRequest,
    options?: {
      signal?: AbortSignal
      sendNotification?: (
        notification: McpProgressNotification,
      ) => Promise<void>
    },
  ) => Promise<JsonRpcResponse | null>
  dispose: () => void
}

const MAX_TOOL_USE_ID_LENGTH = 256

class JsonRpcInvalidParamsError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JsonRpcInvalidParamsError'
  }
}

function extractProgressToken(meta: unknown): string | number | undefined {
  if (typeof meta !== 'object' || meta === null || !('progressToken' in meta)) {
    return undefined
  }
  const token = (meta as { progressToken?: unknown }).progressToken
  return typeof token === 'string' || typeof token === 'number'
    ? token
    : undefined
}

function extractToolUseId(meta: unknown): string | undefined {
  if (
    typeof meta !== 'object' ||
    meta === null ||
    !('claudecode/toolUseId' in meta)
  ) {
    return undefined
  }
  const raw = (meta as { 'claudecode/toolUseId'?: unknown })[
    'claudecode/toolUseId'
  ]
  if (
    typeof raw === 'string' &&
    raw.trim().length > 0 &&
    raw.length <= MAX_TOOL_USE_ID_LENGTH
  ) {
    return raw
  }
  return undefined
}

/**
 * Reusable MCP tool dispatcher shared by `claude mcp serve` (stdio),
 * `claude mcp serve --transport http`, and `--session-tunnel` (`answerInProcess`).
 * Handles `initialize`, `ping`, `tools/list`, `tools/call` (with `raw` or
 * `rendered` result format + `claudecode/editResult` `_meta`), and
 * `claudecode/checkPermissions` for cross-process `remoteCheck`.
 */
export function createMcpServeDispatcher(
  opts: CreateMcpServeDispatcherOptions,
): McpServeToolDispatcher {
  const {
    cwd,
    debug = false,
    verbose = false,
    storageV5 = 'raw',
    resultFormat = 'raw',
  } = opts
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
    opts.loadAgentDefinitions ?? getAgentDefinitionsWithOverrides
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

  const serverAbortController = createAbortController()
  const resolveServedTools = (): Tools =>
    opts.getToolsOverride
      ? opts.getToolsOverride()
      : getTools(getEmptyToolPermissionContext())

  const buildToolUseContext = (
    tools: Tools,
    abortController: AbortController,
    extra?: { toolUseId?: string; forRemoteExecution?: boolean },
  ): ToolUseContext => ({
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
    ...(extra?.toolUseId !== undefined ? { toolUseId: extra.toolUseId } : {}),
    ...(extra?.forRemoteExecution !== undefined
      ? { forRemoteExecution: extra.forRemoteExecution }
      : {}),
  })

  const listTools: McpServeToolDispatcher['listTools'] = async () => {
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
    // Nested property schemas stay structural; boundary via listToolsResult.
    return listToolsResult(listed)
  }

  const callTool: McpServeToolDispatcher['callTool'] = async (
    params,
    callOpts,
  ): Promise<CallToolResult> => {
    await agentDefinitionsReady
    const name = params.name ?? ''
    const args = params.arguments
    const tools = resolveServedTools()
    const tool = findToolByName(tools, name)
    if (!tool) {
      throw new JsonRpcInvalidParamsError(`Tool ${name} not found`)
    }

    const progressToken = extractProgressToken(params._meta)
    const { abortController, detach } = createLinkedMcpCallAbortController(
      serverAbortController,
      callOpts?.signal,
    )
    const toolUseId = extractToolUseId(params._meta) ?? randomUUID()
    const toolUseContext = buildToolUseContext(tools, abortController, {
      toolUseId,
    })

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

      if (callOpts?.sendNotification) {
        heartbeat = startMcpProgressHeartbeat(
          progressToken,
          callOpts.sendNotification,
          opts.progressHeartbeatIntervalMs ??
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

      return await finalizeMcpCallToolResult(
        tool,
        finalResult,
        resultFormat,
        toolUseId,
        params._meta,
      )
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
  }

  const checkPermissions: McpServeToolDispatcher['checkPermissions'] =
    async params => {
      await agentDefinitionsReady
      const name = params.name ?? ''
      const tools = resolveServedTools()
      const tool = findToolByName(tools, name)
      if (!tool) {
        throw new JsonRpcInvalidParamsError(`Tool ${name} not found`)
      }
      const toolUseId = params.toolUseId ?? randomUUID()
      const childAbort = createChildAbortController(serverAbortController)
      const toolUseContext = buildToolUseContext(tools, childAbort, {
        toolUseId,
        forRemoteExecution: true,
      })

      if (!tool.isEnabled()) {
        return {
          behavior: 'deny',
          message: `Tool ${name} is not enabled`,
        }
      }

      let parseTarget: unknown = params.arguments ?? {}
      if (tool.coerceInput) {
        const coerced = tool.coerceInput(parseTarget)
        if (coerced !== null) {
          parseTarget = coerced.input
        }
      }
      const parsedInput = tool.inputSchema.safeParse(parseTarget)
      if (!parsedInput.success) {
        return {
          behavior: 'deny',
          message: `Tool ${name} input is invalid: ${formatZodValidationError(name, parsedInput.error)}`,
        }
      }

      const decision = await hasPermissionsToUseTool(
        tool,
        parsedInput.data,
        toolUseContext,
        createAssistantMessage({ content: [] }),
        toolUseId,
      )
      return decision as unknown as Record<string, unknown>
    }

  const handleJsonRpc: McpServeToolDispatcher['handleJsonRpc'] = async (
    request,
    callOpts,
  ) => {
    const isNotification =
      request.id === undefined ||
      request.method === 'notifications/initialized' ||
      request.method.startsWith('notifications/')
    const id = request.id ?? null

    if (isNotification && request.id === undefined) {
      return null
    }

    try {
      switch (request.method) {
        case 'initialize': {
          const protocolVersion =
            typeof request.params?.protocolVersion === 'string'
              ? request.params.protocolVersion
              : '2025-03-26'
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion,
              capabilities: {
                tools: {
                  listChanged: true,
                },
              },
              serverInfo: {
                name: 'claude/tengu',
                version: getMcpServeVersion(),
              },
            },
          }
        }
        case 'notifications/initialized':
          return null
        case 'ping':
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          }
        case 'tools/list': {
          const result = await listTools()
          return {
            jsonrpc: '2.0',
            id,
            result,
          }
        }
        case 'tools/call': {
          if (
            request.params !== undefined &&
            (typeof request.params !== 'object' ||
              request.params === null ||
              Array.isArray(request.params))
          ) {
            throw new JsonRpcInvalidParamsError('Invalid params for tools/call')
          }
          const params = request.params ?? {}
          const result = await callTool(
            {
              name: typeof params.name === 'string' ? params.name : undefined,
              arguments:
                typeof params.arguments === 'object' &&
                params.arguments !== null &&
                !Array.isArray(params.arguments)
                  ? (params.arguments as Record<string, unknown>)
                  : undefined,
              _meta:
                typeof params._meta === 'object' &&
                params._meta !== null &&
                !Array.isArray(params._meta)
                  ? (params._meta as Record<string, unknown>)
                  : undefined,
            },
            callOpts,
          )
          return {
            jsonrpc: '2.0',
            id,
            result,
          }
        }
        case 'claudecode/checkPermissions': {
          if (
            request.params !== undefined &&
            (typeof request.params !== 'object' ||
              request.params === null ||
              Array.isArray(request.params))
          ) {
            throw new JsonRpcInvalidParamsError(
              'Invalid params for claudecode/checkPermissions',
            )
          }
          const params = request.params ?? {}
          const result = await checkPermissions({
            name: typeof params.name === 'string' ? params.name : undefined,
            arguments:
              typeof params.arguments === 'object' &&
              params.arguments !== null &&
              !Array.isArray(params.arguments)
                ? (params.arguments as Record<string, unknown>)
                : undefined,
            toolUseId:
              typeof params.toolUseId === 'string'
                ? params.toolUseId
                : undefined,
          })
          return {
            jsonrpc: '2.0',
            id,
            result,
          }
        }
        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${request.method}`,
            },
          }
      }
    } catch (error) {
      const isInvalidParams =
        error instanceof JsonRpcInvalidParamsError ||
        (error instanceof Error && error.name === 'ZodError')
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: isInvalidParams ? -32602 : -32603,
          message: errorMessage(error),
        },
      }
    }
  }

  let disposed = false
  const dispose = (): void => {
    if (disposed) return
    disposed = true
    serverAbortController.abort(createAbortErrorReason('shutdown'))
  }

  return {
    ready: agentDefinitionsReady,
    resultFormat,
    resolveServedTools,
    abortController: serverAbortController,
    listTools,
    callTool,
    checkPermissions,
    handleJsonRpc,
    dispose,
  }
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
  const dispatcher = createMcpServeDispatcher({
    cwd,
    debug,
    verbose,
    storageV5,
    resultFormat: options?.resultFormat ?? 'raw',
    progressHeartbeatIntervalMs: options?.progressHeartbeatIntervalMs,
    getToolsOverride: options?.getToolsOverride,
    loadAgentDefinitions: options?.loadAgentDefinitions,
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
    const nextToolNames = dispatcher
      .resolveServedTools()
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
    dispatcher.dispose()
  }

  server.oninitialized = () => {
    isInitialized = true
  }
  server.onclose = () => {
    dispose()
  }

  // densable: setRequestHandler("tools/list", ...)
  server.setRequestHandler('tools/list', async () => {
    const result = await dispatcher.listTools()
    lastListedToolNames = result.tools.map(item => item.name).join('\n')
    return result
  })

  // densable: setRequestHandler("tools/call", ...)
  server.setRequestHandler(
    'tools/call',
    async (request, ctx): Promise<CallToolResult> => {
      const params = (
        request as {
          params?: {
            name?: string
            arguments?: Record<string, unknown>
            _meta?: Record<string, unknown>
          }
        }
      ).params

      // Extract incoming cancellation signal and progress notification channel
      // from MCP SDK v2 ServerContext (`ctx.mcpReq`) with legacy `extra` fallback.
      const extraLike = ctx as
        | {
            mcpReq?: {
              signal?: AbortSignal
              _meta?: Record<string, unknown>
              notify?: (notification: McpProgressNotification) => Promise<void>
            }
            signal?: AbortSignal
            sendNotification?: (
              notification: McpProgressNotification,
            ) => Promise<void>
          }
        | undefined
      const requestSignal = extraLike?.mcpReq?.signal ?? extraLike?.signal
      const sendNotification =
        extraLike?.mcpReq?.notify ?? extraLike?.sendNotification
      const mergedMeta: Record<string, unknown> | undefined =
        extraLike?.mcpReq?._meta || params?._meta
          ? {
              ...params?._meta,
              ...extraLike?.mcpReq?._meta,
            }
          : undefined

      return await dispatcher.callTool(
        {
          name: params?.name,
          arguments: params?.arguments,
          _meta: mergedMeta,
        },
        {
          signal: requestSignal,
          sendNotification,
        },
      )
    },
  )

  return { server, ready: dispatcher.ready, dispose }
}

export async function startMCPServer(
  cwd: string,
  debug: boolean,
  verbose: boolean,
  // densable Ee `s`. mcp serve passes the literal "raw".
  storageV5: unknown,
  options?: CreateMCPServerOptions,
): Promise<void> {
  const { server } = createMCPServer(cwd, debug, verbose, storageV5, options)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
