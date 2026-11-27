/**
 * Post-call telemetry, detached-outcome message building, and tool-error
 * handling helpers extracted from `checkPermissionsAndCallTool`.
 */

import type {
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import type { BashToolInput } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { getTokenCapBanner } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  extractMcpToolDetails,
  extractSkillName,
  getFileExtensionForAnalytics,
  getFileExtensionsFromBashCommand,
  isToolDetailsLoggingEnabled,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import { addToToolDuration } from '../../../bootstrap/state.js'
import type { Tool, ToolResult, ToolUseContext } from '../../../Tool.js'
import type { HookProgress } from '../../../types/hooks.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
  StopHookInfo,
} from '../../../types/message.js'
import { getAbortReasonMessage } from '../../../utils/abortController.js'
import { count } from '../../../utils/array.js'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import { getCwd } from '../../../utils/cwd.js'
import { logForDebugging } from '../../../utils/debug.js'
import { AbortError, errorMessage, ShellError } from '../../../utils/errors.js'
import { shouldPreserveManagedToolHookPass } from '../../../utils/hooks/toolCallManagedPass.js'
import { logError } from '../../../utils/log.js'
import {
  createStopHookSummaryMessage,
  createUserMessage,
} from '../../../utils/messages.js'
import {
  capHostClassifierContext,
  type PairedClassifierContext,
  registerLiveHostClassifierContext,
  resolveHostClassifierContext,
} from '../../../utils/permissions/hostClassifierContext.js'
import type { PermissionDecision } from '../../../utils/permissions/PermissionResult.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { logOTelEvent } from '../../../utils/telemetry/events.js'
import {
  addToolContentEvent,
  endToolExecutionSpan,
  endToolSpan,
} from '../../../utils/telemetry/sessionTracing.js'
import { NativeToolElsewhereError } from '../../../utils/toolCreateRuntime.js'
import { formatError } from '../../../utils/toolErrors.js'
import {
  processPreMappedToolResultBlock,
  processToolResultBlock,
} from '../../../utils/toolResultStorage.js'
import { recordToolObservation } from '../../langfuse/index.js'
import {
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../mcp/client.js'
import {
  carrySubagentFrameResult,
  evaluateSubagentFrameResultHolds,
  withSubagentFrameResult,
} from '../../mcp/editResultMeta.js'
import {
  type getLoggingSafeMcpBaseUrl,
  getMcpServerScopeFromToolName,
  isMcpTool,
} from '../../mcp/utils.js'
import { remapPostToolOutput } from '../postToolOutput.js'
import {
  runPostToolUseFailureHooks,
  runPostToolUseHooks,
} from '../toolHooks.js'
import { deriveToolErrorDenialKind } from './permissionGate.js'
import {
  appendCoerceResultNoteToToolResultBlock,
  classifyToolError,
  isGitCommitCommand,
  resolveGitCommitIdForTelemetry,
} from './resultFormatting.js'
import {
  getNextImagePasteId,
  HOOK_TIMING_DISPLAY_THRESHOLD_MS,
  type McpServerType,
  type MessageUpdateLazy,
  SLOW_PHASE_LOG_THRESHOLD_MS,
  type ToolCallCoreCapture,
} from './types.js'

export function buildToolSpanAttributes(
  tool: Tool,
  processedInput: unknown,
): Record<string, string | number | boolean> {
  const toolAttributes: Record<string, string | number | boolean> = {}
  if (processedInput && typeof processedInput === 'object') {
    if (tool.name === FILE_READ_TOOL_NAME && 'file_path' in processedInput) {
      toolAttributes.file_path = String(processedInput.file_path)
    } else if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in processedInput
    ) {
      toolAttributes.file_path = String(processedInput.file_path)
    } else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      toolAttributes.full_command = bashInput.command
    }
  }
  return toolAttributes
}

export function buildToolParametersForOtel(
  tool: Tool,
  processedInput: Record<string, unknown>,
): Record<string, unknown> {
  let toolParameters: Record<string, unknown> = {}
  if (isToolDetailsLoggingEnabled()) {
    if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      const commandParts = bashInput.command.trim().split(/\s+/)
      const bashCommand = commandParts[0] || ''

      toolParameters = {
        bash_command: bashCommand,
        full_command: bashInput.command,
        ...(bashInput.timeout !== undefined && {
          timeout: bashInput.timeout,
        }),
        ...(bashInput.description !== undefined && {
          description: bashInput.description,
        }),
        ...('dangerouslyDisableSandbox' in bashInput && {
          dangerouslyDisableSandbox: bashInput.dangerouslyDisableSandbox,
        }),
      }
    }

    const mcpDetails = extractMcpToolDetails(tool.name)
    if (mcpDetails) {
      toolParameters.mcp_server_name = mcpDetails.serverName
      toolParameters.mcp_tool_name = mcpDetails.mcpToolName
    }
    const skillName = extractSkillName(tool.name, processedInput)
    if (skillName) {
      toolParameters.skill_name = skillName
    }
  }
  return toolParameters
}

export function buildDetachedOutcomeMessages(opts: {
  tool: Tool
  toolUseID: string
  toolUseContext: ToolUseContext
  assistantMessage: AssistantMessage
  messageId: string
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
  permissionDecision: PermissionDecision
  decisionInfo: { source: string; decision: string } | undefined
  toolParameters: Record<string, unknown>
  telemetryToolInput: string | undefined
  preToolHookDurationMs: number
  startTime: number
  detachedText: string
  resultingMessages: MessageUpdateLazy[]
  toolCallCapture: ToolCallCoreCapture | undefined
  pushPreToolUsePreventContinuation: (message: string) => void
  stopReason: string | undefined
}): MessageUpdateLazy[] {
  const {
    tool,
    toolUseID,
    toolUseContext,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    permissionDecision,
    decisionInfo,
    toolParameters,
    telemetryToolInput,
    preToolHookDurationMs,
    startTime,
    detachedText,
    resultingMessages,
    toolCallCapture,
    pushPreToolUsePreventContinuation,
    stopReason,
  } = opts
  const durationMs = Date.now() - startTime
  if (toolCallCapture) {
    toolCallCapture.detached = true
    toolCallCapture.durationMs = durationMs
  }
  addToToolDuration(durationMs)
  endToolExecutionSpan({ success: true })
  endToolSpan('[detached]')
  const toolResultSizeBytes = detachedText.length
  logEvent('tengu_tool_use_success', {
    messageID:
      messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolName: sanitizeToolNameForAnalytics(tool.name),
    isMcp: tool.isMcp ?? false,
    durationMs,
    detached: true,
    preToolHookDurationMs,
    toolResultSizeBytes,
    queryChainId: toolUseContext.queryTracking
      ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    queryDepth: toolUseContext.queryTracking?.depth,
    ...(mcpServerType && {
      mcpServerType:
        mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(mcpServerBaseUrl && {
      mcpServerBaseUrl:
        mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(requestId && {
      requestId:
        requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
  })
  const mcpServerScope = isMcpTool(tool)
    ? getMcpServerScopeFromToolName(tool.name)
    : null
  void logOTelEvent('tool_result', {
    tool_name: sanitizeToolNameForAnalytics(tool.name),
    success: 'true',
    duration_ms: String(durationMs),
    ...(Object.keys(toolParameters).length > 0 && {
      tool_parameters: jsonStringify(toolParameters),
    }),
    ...(telemetryToolInput && { tool_input: telemetryToolInput }),
    tool_result_size_bytes: String(toolResultSizeBytes),
    ...(decisionInfo && {
      decision_source: decisionInfo.source,
      decision_type: decisionInfo.decision,
    }),
    ...(mcpServerScope && { mcp_server_scope: mcpServerScope }),
  })

  // densable zyo Fr @188844900: preserve acceptFeedback, contentBlocks, imagePasteIds, toolDuration
  const detachedContentBlocks: ContentBlockParam[] = [
    {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: detachedText,
    },
  ]
  if (
    'acceptFeedback' in permissionDecision &&
    permissionDecision.acceptFeedback
  ) {
    detachedContentBlocks.push({
      type: 'text',
      text: permissionDecision.acceptFeedback,
    })
  }
  const allowContentBlocks =
    'contentBlocks' in permissionDecision
      ? permissionDecision.contentBlocks
      : undefined
  if (allowContentBlocks?.length) {
    detachedContentBlocks.push(...allowContentBlocks)
  }
  let allowImageIds: number[] | undefined
  if (allowContentBlocks?.length) {
    const imageCount = count(
      allowContentBlocks,
      (b: ContentBlockParam) => b.type === 'image',
    )
    if (imageCount > 0) {
      const startId = getNextImagePasteId(toolUseContext.messages)
      allowImageIds = Array.from({ length: imageCount }, (_, i) => startId + i)
    }
  }
  resultingMessages.push({
    message: createUserMessage({
      content: detachedContentBlocks,
      imagePasteIds: allowImageIds,
      toolUseResult: shouldPreserveManagedToolHookPass(toolUseContext, tool)
        ? { detachedToolCall: true }
        : undefined,
      sourceToolAssistantUUID: assistantMessage.uuid,
    }),
    toolDuration: { toolName: tool.name, durationMs },
  })
  pushPreToolUsePreventContinuation(stopReason || 'Execution stopped by hook')
  return resultingMessages
}

export async function recordToolSuccessTelemetry(opts: {
  tool: Tool
  toolUseID: string
  processedInput: Record<string, unknown>
  resultData: unknown
  mappedToolResultBlock: ToolResultBlockParam
  toolUseContext: ToolUseContext
  messageId: string
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
  decisionInfo: { source: string; decision: string } | undefined
  toolParameters: Record<string, unknown>
  telemetryToolInput: string | undefined
  preToolHookDurationMs: number
  startTime: number
  durationMs: number
}): Promise<void> {
  const {
    tool,
    toolUseID,
    processedInput,
    resultData,
    mappedToolResultBlock,
    toolUseContext,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    decisionInfo,
    toolParameters,
    telemetryToolInput,
    preToolHookDurationMs,
    startTime,
    durationMs,
  } = opts

  // Log tool content/output as span event if enabled
  if (resultData && typeof resultData === 'object') {
    const contentAttributes: Record<string, string | number | boolean> = {}

    // Read tool: capture file_path and content
    if (tool.name === FILE_READ_TOOL_NAME && 'content' in resultData) {
      if ('file_path' in processedInput) {
        contentAttributes.file_path = String(processedInput.file_path)
      }
      contentAttributes.content = String(resultData.content)
    }

    // Edit/Write tools: capture file_path and diff
    if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in processedInput
    ) {
      contentAttributes.file_path = String(processedInput.file_path)

      // For Edit, capture the actual changes made
      if (tool.name === FILE_EDIT_TOOL_NAME && 'diff' in resultData) {
        contentAttributes.diff = String(resultData.diff)
      }
      // For Write, capture the written content
      if (tool.name === FILE_WRITE_TOOL_NAME && 'content' in processedInput) {
        contentAttributes.content = String(processedInput.content)
      }
    }

    // Bash tool: capture command
    if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      contentAttributes.bash_command = bashInput.command
      // Also capture output if available
      if ('output' in resultData) {
        contentAttributes.output = String(resultData.output)
      }
    }

    if (Object.keys(contentAttributes).length > 0) {
      addToolContentEvent('tool.output', contentAttributes)
    }
  }

  endToolExecutionSpan({ success: true })
  // Pass tool result for new_context logging
  const toolResultStr =
    resultData && typeof resultData === 'object'
      ? jsonStringify(resultData)
      : String(resultData ?? '')
  endToolSpan(toolResultStr)

  // Record tool observation in Langfuse (no-op if not configured)
  recordToolObservation(toolUseContext.langfuseTrace ?? null, {
    toolName: tool.name,
    toolUseId: toolUseID,
    input: processedInput,
    output: toolResultStr,
    startTime: new Date(startTime),
    isError: false,
    parentBatchSpan: toolUseContext.langfuseBatchSpan,
  })

  const mappedContent = mappedToolResultBlock.content
  const toolResultSizeBytes = !mappedContent
    ? 0
    : typeof mappedContent === 'string'
      ? mappedContent.length
      : jsonStringify(mappedContent).length

  // Extract file extension for file-related tools
  let fileExtension: ReturnType<typeof getFileExtensionForAnalytics>
  if (processedInput && typeof processedInput === 'object') {
    if (
      (tool.name === FILE_READ_TOOL_NAME ||
        tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in processedInput
    ) {
      fileExtension = getFileExtensionForAnalytics(
        String(processedInput.file_path),
      )
    } else if (
      tool.name === NOTEBOOK_EDIT_TOOL_NAME &&
      'notebook_path' in processedInput
    ) {
      fileExtension = getFileExtensionForAnalytics(
        String(processedInput.notebook_path),
      )
    } else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
      const bashInput = processedInput as BashToolInput
      fileExtension = getFileExtensionsFromBashCommand(
        bashInput.command,
        bashInput._simulatedSedEdit?.filePath,
      )
    }
  }

  logEvent('tengu_tool_use_success', {
    messageID:
      messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolName: sanitizeToolNameForAnalytics(tool.name),
    isMcp: tool.isMcp ?? false,
    durationMs,
    preToolHookDurationMs,
    toolResultSizeBytes,
    ...(fileExtension !== undefined && { fileExtension }),

    queryChainId: toolUseContext.queryTracking
      ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    queryDepth: toolUseContext.queryTracking?.depth,
    ...(mcpServerType && {
      mcpServerType:
        mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(mcpServerBaseUrl && {
      mcpServerBaseUrl:
        mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...(requestId && {
      requestId:
        requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    }),
    ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
  })

  // Enrich tool parameters with git commit ID from successful git commit output
  if (
    isToolDetailsLoggingEnabled() &&
    (tool.name === BASH_TOOL_NAME || tool.name === POWERSHELL_TOOL_NAME) &&
    'command' in processedInput &&
    typeof processedInput.command === 'string' &&
    isGitCommitCommand(processedInput.command) &&
    resultData &&
    typeof resultData === 'object' &&
    'stdout' in resultData
  ) {
    const isBgOrInterrupted =
      ('backgroundTaskId' in resultData &&
        Boolean(resultData.backgroundTaskId)) ||
      ('interrupted' in resultData && resultData.interrupted === true)
    const gitCommitId = await resolveGitCommitIdForTelemetry(
      processedInput.command,
      String(resultData.stdout),
      getCwd(),
      isBgOrInterrupted,
    )
    if (gitCommitId) {
      toolParameters.git_commit_id = gitCommitId
    }
  }

  // Log tool result event for OTLP with tool parameters and decision context
  const mcpServerScope = isMcpTool(tool)
    ? getMcpServerScopeFromToolName(tool.name)
    : null

  void logOTelEvent('tool_result', {
    tool_name: sanitizeToolNameForAnalytics(tool.name),
    success: 'true',
    duration_ms: String(durationMs),
    ...(Object.keys(toolParameters).length > 0 && {
      tool_parameters: jsonStringify(toolParameters),
    }),
    ...(telemetryToolInput && { tool_input: telemetryToolInput }),
    tool_result_size_bytes: String(toolResultSizeBytes),
    ...(decisionInfo && {
      decision_source: decisionInfo.source,
      decision_type: decisionInfo.decision,
    }),
    ...(mcpServerScope && { mcp_server_scope: mcpServerScope }),
  })
}

export async function handleToolCallError(opts: {
  error: unknown
  tool: Tool
  toolUseID: string
  input: Record<string, unknown>
  processedInput: Record<string, unknown>
  toolUseContext: ToolUseContext
  assistantMessage: AssistantMessage
  messageId: string
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
  decisionInfo: { source: string; decision: string } | undefined
  toolParameters: Record<string, unknown>
  telemetryToolInput: string | undefined
  startTime: number
  innerDenialHeldPersonsWords: boolean
  shouldPreventContinuation: boolean
  stopReason: string | undefined
}): Promise<MessageUpdateLazy[]> {
  const {
    error,
    tool,
    toolUseID,
    input,
    processedInput,
    toolUseContext,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    decisionInfo,
    toolParameters,
    telemetryToolInput,
    startTime,
    innerDenialHeldPersonsWords,
    shouldPreventContinuation,
    stopReason,
  } = opts
  const durationMs = Date.now() - startTime
  addToToolDuration(durationMs)

  endToolExecutionSpan({
    success: false,
    error: errorMessage(error),
  })
  endToolSpan()

  // Record error observation in Langfuse (no-op if not configured)
  recordToolObservation(toolUseContext.langfuseTrace ?? null, {
    toolName: tool?.name ?? 'unknown',
    toolUseId: toolUseID,
    input: processedInput ?? input,
    output: errorMessage(error),
    startTime: new Date(startTime),
    isError: true,
    parentBatchSpan: toolUseContext.langfuseBatchSpan,
  })

  // Handle MCP auth errors by updating the client status to 'needs-auth'
  // This updates the /mcp display to show the server needs re-authorization
  if (error instanceof McpAuthError) {
    toolUseContext.setAppState(prevState => {
      const serverName = error.serverName
      const existingClientIndex = prevState.mcp.clients.findIndex(
        c => c.name === serverName,
      )
      if (existingClientIndex === -1) {
        return prevState
      }
      const existingClient = prevState.mcp.clients[existingClientIndex]
      // Only update if client was connected (don't overwrite other states)
      if (!existingClient || existingClient.type !== 'connected') {
        return prevState
      }
      const updatedClients = [...prevState.mcp.clients]
      updatedClients[existingClientIndex] = {
        name: serverName,
        type: 'needs-auth' as const,
        config: existingClient.config,
      }
      return {
        ...prevState,
        mcp: {
          ...prevState.mcp,
          clients: updatedClients,
        },
      }
    })
  }

  if (!(error instanceof AbortError)) {
    const errorMsg = errorMessage(error)
    logForDebugging(
      `${tool.name} tool error (${durationMs}ms): ${errorMsg.slice(0, 200)}`,
    )
    if (!(error instanceof ShellError)) {
      logError(error)
    }
    logEvent('tengu_tool_use_error', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      error: classifyToolError(
        error,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: tool.isMcp ?? false,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
      ...(mcpServerType && {
        mcpServerType:
          mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(mcpServerBaseUrl && {
        mcpServerBaseUrl:
          mcpServerBaseUrl as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...(requestId && {
        requestId:
          requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      }),
      ...mcpToolDetailsForAnalytics(tool.name, mcpServerType, mcpServerBaseUrl),
    })
    // Log tool result error event for OTLP with tool parameters and decision context
    const mcpServerScope = isMcpTool(tool)
      ? getMcpServerScopeFromToolName(tool.name)
      : null

    void logOTelEvent('tool_result', {
      tool_name: sanitizeToolNameForAnalytics(tool.name),
      use_id: toolUseID,
      success: 'false',
      duration_ms: String(durationMs),
      error: errorMessage(error),
      ...(Object.keys(toolParameters).length > 0 && {
        tool_parameters: jsonStringify(toolParameters),
      }),
      ...(telemetryToolInput && { tool_input: telemetryToolInput }),
      ...(decisionInfo && {
        decision_source: decisionInfo.source,
        decision_type: decisionInfo.decision,
      }),
      ...(mcpServerScope && { mcp_server_scope: mcpServerScope }),
    })
  }
  const content = formatError(error)

  // Determine if this was a user interrupt
  const isInterrupt = error instanceof AbortError

  // Run PostToolUseFailure hooks
  const hookMessages: MessageUpdateLazy<
    AttachmentMessage | ProgressMessage<HookProgress>
  >[] = []
  for await (const hookResult of runPostToolUseFailureHooks(
    toolUseContext,
    tool,
    toolUseID,
    messageId,
    processedInput,
    content,
    isInterrupt,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    durationMs,
  )) {
    hookMessages.push(hookResult)
  }

  // Official 2.1.328 Ndi catch (chunk@294254613.js:4890700): stamp
  // toolDenialKind (X6r), holdsPersonsWords (Zi), and toolDenialEndsTurn.
  const errorDenialKind = deriveToolErrorDenialKind(
    error,
    toolUseContext.abortController.signal,
  )
  const errorUserMessage = createUserMessage({
    content: [
      {
        type: 'tool_result',
        content,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ],
    toolUseResult: `Error: ${content}`,
    mcpMeta: toolUseContext.agentId
      ? undefined
      : error instanceof
          McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
        ? error.mcpMeta
        : undefined,
    sourceToolAssistantUUID: assistantMessage.uuid,
  })
  if (errorDenialKind !== undefined) {
    errorUserMessage.toolDenialKind = errorDenialKind
  }
  if (innerDenialHeldPersonsWords) {
    errorUserMessage.holdsPersonsWords = true
  }
  if (
    toolUseContext.abortController.signal.aborted &&
    getAbortReasonMessage(toolUseContext.abortController.signal.reason) ===
      'permission-stop'
  ) {
    errorUserMessage.toolDenialEndsTurn = true
  }

  // densable catch: after error tool_result + PostToolUseFailure hooks,
  // still LKr when continue:false and not abort — halt must not be dropped
  // when the tool fails mid-stream.
  const errorMessages: MessageUpdateLazy[] = [
    {
      message: errorUserMessage,
    },
    ...hookMessages,
  ]
  if (
    error instanceof NativeToolElsewhereError &&
    error.noteBehindResult !== undefined &&
    !isInterrupt &&
    !toolUseContext.abortController.signal.aborted
  ) {
    errorMessages.push({
      message: createAttachmentMessage({
        type: 'critical_system_reminder',
        content: error.noteBehindResult,
      }),
    })
  }
  if (
    shouldPreventContinuation &&
    !isInterrupt &&
    !toolUseContext.abortController.signal.aborted
  ) {
    errorMessages.push({
      message: createAttachmentMessage({
        type: 'hook_stopped_continuation',
        message: stopReason || 'Execution stopped by hook',
        hookName: `PreToolUse:${tool.name}`,
        toolUseID: toolUseID,
        hookEvent: 'PreToolUse',
      }),
    })
  }
  return errorMessages
}

export async function finalizeToolCallSuccess(opts: {
  tool: Tool
  toolUseID: string
  processedInput: Record<string, unknown>
  result: ToolResult<unknown>
  mappedToolResultBlock: ToolResultBlockParam
  coerceMeta: { shapeClass: string; resultNote?: string } | null
  permissionDecision: PermissionDecision
  toolUseContext: ToolUseContext
  assistantMessage: AssistantMessage
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
  durationMs: number
  innerDenialHeldPersonsWords: boolean
  resultingMessages: MessageUpdateLazy[]
  pushPreToolUsePreventContinuation: (message: string) => void
  stopReason: string | undefined
  toolCallCapture: ToolCallCoreCapture | undefined
}): Promise<MessageUpdateLazy[]> {
  const {
    tool,
    toolUseID,
    processedInput,
    result,
    mappedToolResultBlock,
    coerceMeta,
    permissionDecision,
    toolUseContext,
    assistantMessage,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    durationMs,
    innerDenialHeldPersonsWords,
    resultingMessages,
    pushPreToolUsePreventContinuation,
    stopReason,
    toolCallCapture,
  } = opts

  // Run PostToolUse hooks
  let toolOutput = result.data
  const hookResults: MessageUpdateLazy[] = []
  let rewriteSeq = 0
  let rewritesReverted = false
  const classifierContexts: PairedClassifierContext[] = []
  if (
    result.classifierContext !== undefined &&
    (!tool.isMcp || mcpServerType === 'sdk')
  ) {
    classifierContexts.push({
      value: capHostClassifierContext(result.classifierContext),
      hostPrincipal: true,
      pairedRewriteSeq: 0,
    })
  }
  const toolContextModifier = result.contextModifier
  const toolContextLayers = result.contextLayers
  const mcpMeta = result.mcpMeta
  // densable 2.1.283 `mr=oo.endsTurn` @ 184495149 → createUserMessage.toolEndsTurn
  const endsTurn = result.endsTurn

  async function addToolResult(
    toolUseResult: unknown,
    preMappedBlock?: ToolResultBlockParam,
  ) {
    // Use the pre-mapped block when available (non-MCP tools where hooks
    // don't modify the output), otherwise map from scratch.
    const rawToolResultBlock = preMappedBlock
      ? await processPreMappedToolResultBlock(
          preMappedBlock,
          tool.name,
          tool.maxResultSizeChars,
        )
      : await processToolResultBlock(tool, toolUseResult, toolUseID)
    const baseToolResultBlock = appendCoerceResultNoteToToolResultBlock(
      rawToolResultBlock,
      coerceMeta?.resultNote,
    )

    // Official 2.1.331 chunk #775 (`mle`/`yxe`/`YQt`): honor `subagentFrameResultHolds?.()`
    // freshness predicate (bounded by abort signal + 5s timeout) and carry
    // `SUBAGENT_FRAME_RESULT_SYMBOL` onto non-error result blocks and message metadata.
    let resolvedSubagentFrameResult =
      baseToolResultBlock.is_error === true
        ? undefined
        : result.subagentFrameResult
    if (
      resolvedSubagentFrameResult !== undefined &&
      result.subagentFrameResultHolds !== undefined
    ) {
      const holds = await evaluateSubagentFrameResultHolds(
        result.subagentFrameResultHolds,
        { signal: toolUseContext.abortController?.signal },
      )
      if (!holds) {
        resolvedSubagentFrameResult = undefined
      }
    }
    const toolResultBlock: ToolResultBlockParam =
      resolvedSubagentFrameResult !== undefined
        ? {
            ...baseToolResultBlock,
            ...withSubagentFrameResult(resolvedSubagentFrameResult),
          }
        : baseToolResultBlock

    // Build content blocks - tool result first, then optional feedback
    const contentBlocks: ContentBlockParam[] = [toolResultBlock]
    // Add accept feedback if user provided feedback when approving
    // (acceptFeedback only exists on PermissionAllowDecision, which is guaranteed here)
    if (
      'acceptFeedback' in permissionDecision &&
      permissionDecision.acceptFeedback
    ) {
      contentBlocks.push({
        type: 'text',
        text: permissionDecision.acceptFeedback,
      })
    }

    // Add content blocks (e.g., pasted images) from the permission decision
    const allowContentBlocks =
      'contentBlocks' in permissionDecision
        ? permissionDecision.contentBlocks
        : undefined
    if (allowContentBlocks?.length) {
      contentBlocks.push(...allowContentBlocks)
    }

    // Generate sequential imagePasteIds so each image renders with a distinct label
    let allowImageIds: number[] | undefined
    if (allowContentBlocks?.length) {
      const imageCount = count(
        allowContentBlocks,
        (b: ContentBlockParam) => b.type === 'image',
      )
      if (imageCount > 0) {
        const startId = getNextImagePasteId(toolUseContext.messages)
        allowImageIds = Array.from(
          { length: imageCount },
          (_, i) => startId + i,
        )
      }
    }

    const hostContext = resolveHostClassifierContext(
      classifierContexts,
      rewriteSeq,
      rewritesReverted,
    )
    const resultMessage = createUserMessage({
      content: contentBlocks,
      hostClassifierContext: hostContext.value,
      imagePasteIds: allowImageIds,
      toolUseResult: shouldPreserveManagedToolHookPass(toolUseContext, tool)
        ? toolUseResult
        : undefined,
      mcpMeta: toolUseContext.agentId ? undefined : mcpMeta,
      toolEndsTurn: endsTurn,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
    if (resolvedSubagentFrameResult !== undefined) {
      Object.assign(resultMessage, carrySubagentFrameResult(toolResultBlock))
    }
    if (innerDenialHeldPersonsWords) {
      resultMessage.holdsPersonsWords = true
    }
    if (
      hostContext.hostPrincipal &&
      !toolUseContext.abortController.signal.aborted
    ) {
      registerLiveHostClassifierContext(resultMessage)
    }
    resultingMessages.push({
      message: resultMessage,
      contextModifier: toolContextModifier
        ? {
            toolUseID: toolUseID,
            modifyContext: toolContextModifier,
          }
        : undefined,
      contextLayers:
        toolContextLayers && toolContextLayers.length > 0
          ? {
              toolUseID: toolUseID,
              layers: toolContextLayers,
            }
          : undefined,
    })
  }

  const postToolHookInfos: StopHookInfo[] = []
  const postToolHookStart = Date.now()
  for await (const hookResult of runPostToolUseHooks(
    toolUseContext,
    tool,
    toolUseID,
    assistantMessage.message.id!,
    processedInput,
    toolOutput,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    durationMs,
  )) {
    if ('updatedToolOutput' in hookResult) {
      toolOutput = hookResult.updatedToolOutput
      rewriteSeq++
    } else if ('classifierContext' in hookResult) {
      classifierContexts.push({
        ...hookResult.classifierContext,
        pairedRewriteSeq:
          hookResult.pairing === 'none'
            ? undefined
            : hookResult.pairing === 'pending' && rewriteSeq > 0
              ? rewriteSeq
              : -1,
      })
    } else {
      hookResults.push(hookResult)
      if (hookResult.message.type === 'attachment') {
        const att = hookResult.message.attachment
        if (
          'command' in att &&
          att.command !== undefined &&
          'durationMs' in att &&
          att.durationMs !== undefined
        ) {
          postToolHookInfos.push({
            command: att.command as string,
            durationMs: att.durationMs as number,
          })
        }
      }
    }
  }
  const postToolHookDurationMs = Date.now() - postToolHookStart
  if (postToolHookDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS) {
    logForDebugging(
      `Slow PostToolUse hooks: ${postToolHookDurationMs}ms for ${tool.name} (${postToolHookInfos.length} hooks)`,
      { level: 'info' },
    )
  }

  if (isMcpTool(tool)) {
    await addToolResult(toolOutput)
  } else {
    let mappedBlock = mappedToolResultBlock
    if (rewriteSeq > 0) {
      const remapped = remapPostToolOutput(
        tool,
        result.data,
        toolOutput,
        toolUseID,
        logError,
      )
      toolOutput = remapped.output
      if (remapped.error !== undefined) {
        rewritesReverted = true
        const discarded = classifierContexts.some(
          context => context.pairedRewriteSeq === rewriteSeq,
        )
        logForDebugging(
          `PostToolUse hook returned invalid updatedToolOutput for ${tool.name}`,
          { level: 'error' },
        )
        hookResults.push({
          message: createAttachmentMessage({
            type: 'hook_error_during_execution',
            content: `PostToolUse hook returned updatedToolOutput that does not match ${tool.name}'s output shape; using original output.${discarded ? ' A host-asserted classifier context attached by the same hook was discarded with the rejected rewrite.' : ''} ${remapped.error}`,
            hookName: `PostToolUse:${tool.name}`,
            toolUseID,
            hookEvent: 'PostToolUse',
          }),
        })
      } else {
        mappedBlock = remapped.block!
      }
    }
    await addToolResult(toolOutput, mappedBlock)
  }

  // Result first, then notices and PostToolUse diagnostics.
  if (
    tool.name === FILE_READ_TOOL_NAME &&
    result.data &&
    typeof result.data === 'object'
  ) {
    const banner = getTokenCapBanner(result.data as object)
    if (banner !== undefined)
      resultingMessages.push({
        message: createAttachmentMessage({
          type: 'read_truncation_notice',
          banner,
          toolUseID,
        }),
      })
  }

  // Show PostToolUse hook timing inline below tool result when > 500ms.
  // Use wall-clock time (not sum of individual durations) since hooks run in parallel.
  if (process.env.USER_TYPE === 'ant' && postToolHookInfos.length > 0) {
    if (postToolHookDurationMs > HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
      resultingMessages.push({
        message: createStopHookSummaryMessage(
          postToolHookInfos.length,
          postToolHookInfos,
          [],
          false,
          undefined,
          false,
          'suggestion',
          undefined,
          'PostToolUse',
          postToolHookDurationMs,
        ),
      })
    }
  }

  for (const hookResult of hookResults) {
    resultingMessages.push(hookResult)
  }

  // If the tool provided new messages, add them to the list to return.
  // Official 2.1.328 Ndi (chunk@294254613.js:4886350): stamp turnCompanion: true
  // on user messages in result.newMessages so they ride the same turn.
  if (result.newMessages && result.newMessages.length > 0) {
    for (const message of result.newMessages) {
      resultingMessages.push({
        message:
          message.type === 'user'
            ? { ...message, turnCompanion: true }
            : message,
      })
    }
  }
  // densable success path: I&&!aborted → LKr
  pushPreToolUsePreventContinuation(stopReason || 'Execution stopped by hook')

  if (toolCallCapture) {
    toolCallCapture.output = { value: toolOutput }
  }
  return resultingMessages
}
