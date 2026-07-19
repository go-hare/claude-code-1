import { feature } from 'bun:bundle'
import type {
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { ZodError } from 'zod/v4'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  bashCommandFileExtensionsForAnalytics,
  emitFileActivityForToolSuccess,
  extractMcpToolDetails,
  extractSkillName,
  extractToolInputForTelemetry,
  getFileExtensionForAnalytics,
  getFileExtensionsFromBashCommand,
  isToolDetailsLoggingEnabled,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
  toolFeatureNameForAnalytics,
  toolResultAttachmentBytesFromMessages,
} from 'src/services/analytics/metadata.js'
import {
  addToToolDuration,
  getCodeEditToolDecisionCounter,
  getStatsStore,
} from '../../bootstrap/state.js'
import {
  buildCodeEditToolAttributes,
  isCodeEditingTool,
} from '../../hooks/toolPermission/permissionLogging.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  findToolByName,
  type Tool,
  type Tools,
  type ToolProgress,
  type ToolProgressData,
  type ToolUseContext,
} from '../../Tool.js'
import type { BashToolInput } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { startSpeculativeClassifierCheck } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { parseGitCommitId } from '@claude-code/builtin-tools/tools/shared/gitOperationTracking.js'
import {
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import {
  formatEmptyInputRepairMessage,
  isEmptyPlainObject,
  isJuniperEmptyInputRepairEnabled,
} from '../../utils/systemPromptArms.js'
import { getAllBaseTools } from '../../tools.js'
import { formatToolNotFoundHint } from './toolNotFoundHint.js'
import type { HookProgress } from '../../types/hooks.js'
import { recordToolObservation } from '../langfuse/index.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  StopHookInfo,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import {
  classifyAbortKindForAnalytics,
  isServerFallbackTombstoneAbort,
} from '../../utils/abortController.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  errorAnalyticsFromThrown,
  hashErrorMessageForAnalytics,
  sampleToolMemoryUsage,
  shortSha256Hex12,
  toolMemoryDeltasForAnalytics,
  uniqueJoin,
} from '../../utils/hash.js'
import {
  formatUnparsedToolInputError,
  isUnparsedToolInput,
  UNPARSED_TOOL_INPUT_KEY,
} from '../../utils/unparsedToolInput.js'
import {
  AbortError,
  errorMessage,
  getErrnoCode,
  isAbortError,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import { executePermissionDeniedHooks } from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import {
  CANCEL_MESSAGE,
  createProgressMessage,
  createStopHookSummaryMessage,
  createToolResultStopMessage,
  createUserMessage,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import { mcpMetaForToolResultMessage } from '../../utils/residualUiEnvGates.js'
import { toolDenialKindFromPermissionDecision } from '../../utils/toolDenialKind.js'
import type {
  PermissionDecisionReason,
  PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import {
  agentContextForToolAnalytics,
  getAgentContext,
} from '../../utils/agentContext.js'
import {
  resolveSessionActivityAgentId,
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { Stream } from '../../utils/stream.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import {
  addToolContentEvent,
  endToolBlockedOnUserSpan,
  endToolExecutionSpan,
  endToolSpan,
  isBetaTracingEnabled,
  startToolBlockedOnUserSpan,
  startToolExecutionSpan,
  startToolSpan,
} from '../../utils/telemetry/sessionTracing.js'
import {
  formatError,
  formatZodValidationError,
} from '../../utils/toolErrors.js'
import {
  processPreMappedToolResultBlock,
  processToolResultBlock,
} from '../../utils/toolResultStorage.js'
import {
  extractDiscoveredToolNames,
  isSearchExtraToolsEnabledOptimistic,
  isSearchExtraToolsToolAvailable,
} from '../../utils/searchExtraTools.js'
import {
  McpAuthError,
  McpToolCallError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../mcp/client.js'
import { mcpInfoFromString } from '../mcp/mcpStringUtils.js'
import { normalizeNameForMCP } from '../mcp/normalization.js'
import type { MCPServerConnection } from '../mcp/types.js'
import {
  getLoggingSafeMcpBaseUrl,
  getMcpServerScopeFromToolName,
  isMcpTool,
} from '../mcp/utils.js'
import {
  resolveHookPermissionDecision,
  runPostToolUseFailureHooks,
  runPostToolUseHooks,
  runPreToolUseHooks,
} from './toolHooks.js'
import { resyncReadFileStateAfterPostToolUse } from './postToolUseFileResync.js'
import { isSkillLearningEnabled } from '../skillLearning/featureCheck.js'

// Cached import promise for the skill-learning wrapper — paid once, not per call.
let _skillLearningWrapperCache:
  | Promise<{
      runToolCallWithSkillLearningHooks: <T>(
        toolName: string,
        input: unknown,
        callContext: { sessionId?: string; turn?: number },
        invoke: () => Promise<T>,
      ) => Promise<T>
    }>
  | undefined

function getSkillLearningWrapper() {
  if (!_skillLearningWrapperCache) {
    _skillLearningWrapperCache = import(
      '../skillLearning/toolEventObserver.js'
    ).catch(err => {
      // Clear the cache on rejection so the next tool call can retry the
      // import instead of reusing the same rejected promise forever (which
      // would break every flag-on tool call in the session).
      _skillLearningWrapperCache = undefined
      throw err
    })
  }
  return _skillLearningWrapperCache
}

/** Minimum total hook duration (ms) to show inline timing summary */
export const HOOK_TIMING_DISPLAY_THRESHOLD_MS = 500
/** Log a debug warning when hooks/permission-decision block for this long. Matches
 * BashTool's PROGRESS_THRESHOLD_MS — the collapsed view feels stuck past this. */
const SLOW_PHASE_LOG_THRESHOLD_MS = 2000

/**
 * Classify a tool execution error into a telemetry-safe string.
 *
 * In minified/external builds, `error.constructor.name` is mangled into
 * short identifiers like "nJT" or "Chq" — useless for diagnostics.
 * This function extracts structured, telemetry-safe information instead:
 * - TelemetrySafeError: use its telemetryMessage (already vetted)
 * - Node.js fs errors: log the error code (ENOENT, EACCES, etc.)
 * - Known error types: use their unminified name
 * - Fallback: "Error" (better than a mangled 3-char identifier)
 */
export function classifyToolError(error: unknown): string {
  if (
    error instanceof TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
  ) {
    return error.telemetryMessage.slice(0, 200)
  }
  if (error instanceof Error) {
    // Node.js filesystem errors have a `code` property (ENOENT, EACCES, etc.)
    // These are safe to log and much more useful than the constructor name.
    const errnoCode = getErrnoCode(error)
    if (typeof errnoCode === 'string') {
      return `Error:${errnoCode}`
    }
    // ShellError, ImageSizeError, etc. have stable `.name` properties
    // that survive minification (they're set in the constructor).
    if (error.name && error.name !== 'Error' && error.name.length > 3) {
      return error.name.slice(0, 60)
    }
    return 'Error'
  }
  return 'UnknownError'
}

/**
 * Map a rule's origin to the documented OTel `source` vocabulary, matching
 * the interactive path's semantics (permissionLogging.ts:81): session-scoped
 * grants are temporary, on-disk grants are permanent, and user-authored
 * denies are user_reject regardless of persistence. Everything the user
 * didn't write (cliArg, policySettings, projectSettings, flagSettings) is
 * config.
 */
function ruleSourceToOTelSource(
  ruleSource: string,
  behavior: 'allow' | 'deny',
): string {
  switch (ruleSource) {
    case 'session':
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    case 'localSettings':
    case 'userSettings':
      return behavior === 'allow' ? 'user_permanent' : 'user_reject'
    default:
      return 'config'
  }
}

/**
 * Map a PermissionDecisionReason to the OTel `source` label for the
 * non-interactive tool_decision path, staying within the documented
 * vocabulary (config, hook, user_permanent, user_temporary, user_reject).
 *
 * For permissionPromptTool, the SDK host may set decisionClassification on
 * the PermissionResult to tell us exactly what happened (once vs always vs
 * cache hit — the host knows, we can't tell from {behavior:'allow'} alone).
 * Without it, we fall back conservatively: allow → user_temporary,
 * deny → user_reject.
 */
function decisionReasonToOTelSource(
  reason: PermissionDecisionReason | undefined,
  behavior: 'allow' | 'deny',
): string {
  if (!reason) {
    return 'config'
  }
  switch (reason.type) {
    case 'permissionPromptTool': {
      // toolResult is typed `unknown` on PermissionDecisionReason but carries
      // the parsed Output from PermissionPromptToolResultSchema. Narrow at
      // runtime rather than widen the cross-file type.
      const toolResult = reason.toolResult as
        | { decisionClassification?: string }
        | undefined
      const classified = toolResult?.decisionClassification
      if (
        classified === 'user_temporary' ||
        classified === 'user_permanent' ||
        classified === 'user_reject'
      ) {
        return classified
      }
      return behavior === 'allow' ? 'user_temporary' : 'user_reject'
    }
    case 'rule':
      return ruleSourceToOTelSource(reason.rule.source, behavior)
    case 'hook':
      return 'hook'
    case 'mode':
    case 'classifier':
    case 'subcommandResults':
    case 'asyncAgent':
    case 'sandboxOverride':
    case 'workingDir':
    case 'safetyCheck':
    case 'other':
      return 'config'
    default: {
      const _exhaustive: never = reason
      return 'config'
    }
  }
}

function getNextImagePasteId(messages: Message[]): number {
  let maxId = 0
  for (const message of messages) {
    if (message.type === 'user' && message.imagePasteIds) {
      for (const id of message.imagePasteIds as number[]) {
        if (id > maxId) maxId = id
      }
    }
  }
  return maxId + 1
}

export type MessageUpdateLazy<M extends Message = Message> = {
  message: M
  contextModifier?: {
    toolUseID: string
    modifyContext: (context: ToolUseContext) => ToolUseContext
  }
  /**
   * densable contextLayers on tool-result update — { toolUseID, layers }
   * for concurrent aggregation / exclusive Ter merge.
   */
  contextLayers?: {
    toolUseID: string
    layers: import('../../utils/contextLayers.js').ContextLayer[]
  }
}

export type McpServerType =
  | 'stdio'
  | 'sse'
  | 'http'
  | 'ws'
  | 'sdk'
  | 'sse-ide'
  | 'ws-ide'
  | 'claudeai-proxy'
  | undefined

function findMcpServerConnection(
  toolName: string,
  mcpClients: MCPServerConnection[],
): MCPServerConnection | undefined {
  if (!toolName.startsWith('mcp__')) {
    return undefined
  }

  const mcpInfo = mcpInfoFromString(toolName)
  if (!mcpInfo) {
    return undefined
  }

  // mcpInfo.serverName is normalized (e.g., "claude_ai_Slack"), but client.name
  // is the original name (e.g., "claude.ai Slack"). Normalize both for comparison.
  return mcpClients.find(
    client => normalizeNameForMCP(client.name) === mcpInfo.serverName,
  )
}

/**
 * Extracts the MCP server transport type from a tool name.
 * Returns the server type (stdio, sse, http, ws, sdk, etc.) for MCP tools,
 * or undefined for built-in tools.
 */
function getMcpServerType(
  toolName: string,
  mcpClients: MCPServerConnection[],
): McpServerType {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)

  if (serverConnection?.type === 'connected') {
    // Handle stdio configs where type field is optional (defaults to 'stdio')
    return serverConnection.config.type ?? 'stdio'
  }

  return undefined
}

/**
 * Extracts the MCP server base URL for a tool by looking up its server connection.
 * Returns undefined for stdio servers, built-in tools, or if the server is not connected.
 */
function getMcpServerBaseUrlFromToolName(
  toolName: string,
  mcpClients: MCPServerConnection[],
): string | undefined {
  const serverConnection = findMcpServerConnection(toolName, mcpClients)
  if (serverConnection?.type !== 'connected') {
    return undefined
  }
  return getLoggingSafeMcpBaseUrl(serverConnection.config)
}

/**
 * densable vKu — once-per-process flag for tengu_dead_probe_tool_alias_exec.
 * Set when a tool_use name resolves via a builtin tool alias (name !== primary
 * && aliases.includes(name)). Telemetry-only residual.
 */
let loggedDeadProbeToolAliasExec = false

/** Test-only: reset densable vKu once-flag between unit cases. */
export function resetDeadProbeToolAliasExecForTests(): void {
  loggedDeadProbeToolAliasExec = false
}

/**
 * densable cWr tool resolve:
 * 1. Tc(options.tools, name, toolAliases) — session single-hop + B7c/U7c
 * 2. if miss: Tc(I8(), name) without toolAliases; accept only if aliases.includes
 * 3. once: if resolved via builtin alias, log tengu_dead_probe_tool_alias_exec
 */
export function resolveToolForExecution(
  tools: Tools,
  toolName: string,
  toolAliases?: Readonly<Record<string, string>> | null,
  baseTools: Tools = getAllBaseTools(),
): Tool | undefined {
  let tool = findToolByName(tools, toolName, toolAliases)
  // densable: fallback is Tc(I8(), name) with NO session toolAliases map.
  // Only accept when the call name is a builtin alias of the base tool.
  if (!tool) {
    const fallbackTool = findToolByName(baseTools, toolName)
    if (fallbackTool?.aliases?.includes(toolName)) {
      tool = fallbackTool
    }
  }
  // densable vKu + M("tengu_dead_probe_tool_alias_exec", {alias:Vs(i), tool:Vs(s.name)})
  if (
    !loggedDeadProbeToolAliasExec &&
    tool &&
    tool.name !== toolName &&
    tool.aliases?.includes(toolName)
  ) {
    loggedDeadProbeToolAliasExec = true
    logEvent('tengu_dead_probe_tool_alias_exec', {
      alias: sanitizeToolNameForAnalytics(
        toolName,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      tool: sanitizeToolNameForAnalytics(
        tool.name,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  return tool
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy, void> {
  const toolName = toolUse.name
  // densable Tc + I8 alias fallback + dead_probe (see resolveToolForExecution)
  const tool = resolveToolForExecution(
    toolUseContext.options.tools,
    toolName,
    toolUseContext.options.toolAliases,
  )
  const messageId = assistantMessage.message.id as string
  const requestId = assistantMessage.requestId as string | undefined
  const mcpServerType = getMcpServerType(
    toolName,
    toolUseContext.options.mcpClients,
  )
  const mcpServerBaseUrl = getMcpServerBaseUrlFromToolName(
    toolName,
    toolUseContext.options.mcpClients,
  )

  // Check if the tool exists
  if (!tool) {
    const sanitizedToolName = sanitizeToolNameForAnalytics(toolName)
    // densable qcs — contextual suffix for unknown-tool errors
    const notFoundHint = formatToolNotFoundHint({
      toolName,
      availableTools: toolUseContext.options.tools,
      agentId: toolUseContext.agentId,
      mcpClients: toolUseContext.options.mcpClients as
        | ReadonlyArray<{ name: string; type?: string }>
        | undefined,
    })
    logForDebugging(`Unknown tool ${toolName}: ${toolUse.id}`)
    // densable me(SIt(i),"tool_not_found") → tengu_feature_bad
    logEvent('tengu_feature_bad', {
      feature_name: toolFeatureNameForAnalytics(toolName),
      error_code:
        'tool_not_found' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    // densable errorCode:Ie("NO_SUCH_TOOL") on tengu_tool_use_error
    logEvent('tengu_tool_use_error', {
      error:
        `No such tool available: ${sanitizedToolName}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        'NO_SUCH_TOOL' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizedToolName,
      toolUseID:
        toolUse.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolName.startsWith('mcp__'),
      // densable ...FSt(n.agentContext)
      ...agentContextForToolAnalytics(),
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
      ...mcpToolDetailsForAnalytics(toolName, mcpServerType, mcpServerBaseUrl),
    })
    const notFoundMessage = `Error: No such tool available: ${toolName}${notFoundHint}`
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${notFoundMessage}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: notFoundMessage,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }
  try {
    if (toolUseContext.abortController.signal.aborted) {
      // densable Auo entry: phase:Ie("entry"), abortKind:ve(TVt(reason))
      yield buildToolUseCancelledUpdate({
        tool,
        toolUseID: toolUse.id,
        toolUseContext,
        assistantMessage,
        phase: 'entry',
        requestId,
        mcpServerType,
        mcpServerBaseUrl,
      })
      return
    }

    for await (const update of streamedCheckPermissionsAndCallTool(
      tool,
      toolUse.id,
      toolInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      messageId,
      requestId,
      mcpServerType,
      mcpServerBaseUrl,
    )) {
      yield update
    }
  } catch (error) {
    // densable: if (!wst(E)) { ... me(_,"tool_unexpected_error") } — skip abort-shaped
    if (!isAbortError(error)) {
      logError(error)
      logEvent('tengu_feature_bad', {
        feature_name: toolFeatureNameForAnalytics(tool.name),
        error_code:
          'tool_unexpected_error' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
    const errorMessage = error instanceof Error ? error.message : String(error)
    const toolInfo = tool ? ` (${tool.name})` : ''
    const detailedError = `Error calling tool${toolInfo}: ${errorMessage}`

    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${detailedError}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: detailedError,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
  }
}

function streamedCheckPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: boolean | string | number },
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>,
): AsyncIterable<MessageUpdateLazy> {
  // This is a bit of a hack to get progress events and final results
  // into a single async iterable.
  //
  // Ideally the progress reporting and tool call reporting would
  // be via separate mechanisms.
  const stream = new Stream<MessageUpdateLazy>()
  checkPermissionsAndCallTool(
    tool,
    toolUseID,
    input,
    toolUseContext,
    canUseTool,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
    progress => {
      logEvent('tengu_tool_use_progress', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
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
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
      })
      stream.enqueue({
        message: createProgressMessage({
          toolUseID: progress.toolUseID as string,
          parentToolUseID: toolUseID,
          data: progress.data,
        }),
      })
    },
  )
    .then(results => {
      for (const result of results) {
        stream.enqueue(result)
      }
    })
    .catch(error => {
      stream.error(error)
    })
    .finally(() => {
      stream.done()
    })
  return stream
}

/**
 * densable Auo multiphase cancel phases (entry is handled in runToolUse).
 * Only H9e (server-fallback-tombstone) trips mid-pipeline checkpoints.
 */
export type ToolCancelPhase =
  | 'entry'
  | 'validate_input'
  | 'permission'
  | 'pre_call'
  | 'call'

/**
 * densable Auo — emit tengu_tool_use_cancelled with phase+abortKind and a
 * cancelled tool_result. Shared by entry (runToolUse) and multiphase H9e
 * checkpoints inside checkPermissionsAndCallTool.
 */
function buildToolUseCancelledUpdate(params: {
  tool: Tool
  toolUseID: string
  toolUseContext: ToolUseContext
  assistantMessage: AssistantMessage
  phase: ToolCancelPhase
  requestId: string | undefined
  mcpServerType: McpServerType
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>
}): MessageUpdateLazy {
  const {
    tool,
    toolUseID,
    toolUseContext,
    assistantMessage,
    phase,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
  } = params
  logEvent('tengu_tool_use_cancelled', {
    toolName: sanitizeToolNameForAnalytics(tool.name),
    toolUseID:
      toolUseID as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    isMcp: tool.isMcp ?? false,
    phase: phase as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    abortKind: classifyAbortKindForAnalytics(
      toolUseContext.abortController.signal.reason,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
  const content = createToolResultStopMessage(toolUseID)
  content.content = withMemoryCorrectionHint(CANCEL_MESSAGE)
  return {
    message: createUserMessage({
      content: [content],
      toolUseResult: CANCEL_MESSAGE,
      sourceToolAssistantUUID: assistantMessage.uuid,
    }),
  }
}

/**
 * Appended to Zod errors when a deferred tool wasn't in the discovered-tool
 * set — re-runs the claude.ts schema-filter scan dispatch-time to detect the
 * mismatch. The raw Zod error ("expected array, got string") doesn't tell the
 * model to re-load the tool; this hint does. Null if the schema was sent.
 */
export function buildSchemaNotSentHint(
  tool: Tool,
  messages: Message[],
  tools: readonly { name: string }[],
): string | null {
  // Optimistic gating — reconstructing claude.ts's full useSearchExtraTools
  // computation is fragile. These two gates prevent pointing at a SearchExtraTools
  // that isn't callable; occasional misfires (Haiku, tst-auto below threshold)
  // cost one extra round-trip on an already-failing path.
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  if (!isSearchExtraToolsToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null

  const toolDisplayName = tool.userFacingName
    ? tool.userFacingName(undefined)
    : tool.name

  return (
    `\n\nTool "${toolDisplayName}" is deferred-loading and needs to be discovered before use.\n` +
    `When using OpenAI-compatible models (DeepSeek, Ollama, etc.), follow these steps:\n` +
    `1. First discover the tool with SearchExtraTools: ${SEARCH_EXTRA_TOOLS_TOOL_NAME}("select:${tool.name}")\n` +
    `2. Then call ${toolDisplayName} tool\n` +
    `\nExample:\n` +
    `${SEARCH_EXTRA_TOOLS_TOOL_NAME}("select:${tool.name}") → ${toolDisplayName}({ ... })\n` +
    `\nImportant notes:\n` +
    `• Use camelCase parameter names (e.g., taskId), not snake_case (task_id)\n` +
    `• All task tools (TaskGet, TaskCreate, TaskUpdate, TaskList) need to be discovered first\n` +
    `• You can discover them all at once: ${SEARCH_EXTRA_TOOLS_TOOL_NAME}("select:TaskGet,TaskCreate,TaskUpdate,TaskList")\n` +
    `\nSee docs/openai-task-tools.md for detailed guide.`
  )
}

async function checkPermissionsAndCallTool(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: boolean | string | number },
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  mcpServerBaseUrl: ReturnType<typeof getLoggingSafeMcpBaseUrl>,
  onToolProgress: (
    progress: ToolProgress<ToolProgressData> | ProgressMessage<HookProgress>,
  ) => void,
): Promise<MessageUpdateLazy[]> {
  // densable SIt(e.name) early — feature name for sad/ok/bad
  const featureName = toolFeatureNameForAnalytics(tool.name)
  // densable `m = De(r).length` — raw input size for analytics.
  // For unparsed marker, densable uses payload.len instead of JSON size.
  const toolInputSizeBytes = jsonStringify(input).length

  // densable uTt(r) early path — streamed JSON never parsed (JSON_PARSE)
  if (isUnparsedToolInput(input)) {
    const { len } = input[UNPARSED_TOOL_INPUT_KEY]
    const errorContent = formatUnparsedToolInputError(tool.name, input)
    logEvent('tengu_feature_sad', {
      feature_name: featureName,
      error_code:
        'tool_input_validation_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        'JSON_PARSE' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetailsHash: shortSha256Hex12(
        `${tool.name}: unparsed tool input`,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
      // densable ...FSt(n.agentContext)
      ...agentContextForToolAnalytics(),
      toolInputSizeBytes: len,
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
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `InputValidationError: JSON parse failed (${len} bytes)`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // densable coerceInput before Zod — remap common model shape mistakes.
  let coercedForParse: {
    input: { [key: string]: unknown }
    shapeClass: string
  } | null = null
  let parseTarget: { [key: string]: unknown } = input
  if (tool.coerceInput) {
    coercedForParse = tool.coerceInput(input)
    if (coercedForParse !== null) {
      parseTarget = coercedForParse.input
    }
  }

  // Validate input types with zod (surprisingly, the model is not great at generating valid input)
  const parsedInput = tool.inputSchema.safeParse(parseTarget)
  if (coercedForParse !== null) {
    logEvent('tengu_tool_input_coerced', {
      toolName: sanitizeToolNameForAnalytics(tool.name),
      shapeClass:
        coercedForParse.shapeClass as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      outcome: (parsedInput.success
        ? 'coerced_valid'
        : 'coerced_still_invalid') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolInputSizeBytes,
    })
  }
  if (!parsedInput.success) {
    let errorContent = formatZodValidationError(tool.name, parsedInput.error)
    // densable xHc+h1i+IHc — teasel_cove empty-input repair steers model
    // when the call was literally `{}` against a required ZodObject schema.
    let emptyInputRepaired = false
    if (isJuniperEmptyInputRepairEnabled() && isEmptyPlainObject(input)) {
      const repaired = formatEmptyInputRepairMessage(
        tool.name,
        tool.inputSchema,
        jsonStringify,
      )
      if (repaired !== null) {
        errorContent = repaired
        emptyInputRepaired = true
      }
    }
    // densable validationErrorSteer — append tool-specific recovery text.
    const steer = tool.validationErrorSteer?.(input)
    if (steer) {
      errorContent += `\n\n${steer}`
    }

    const schemaHint = buildSchemaNotSentHint(
      tool,
      toolUseContext.messages,
      toolUseContext.options.tools,
    )
    if (schemaHint) {
      logEvent('tengu_deferred_tool_schema_not_sent', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
        isMcp: tool.isMcp ?? false,
      })
      errorContent += schemaHint
    }

    logForDebugging(
      `${tool.name} tool input error: ${errorContent.slice(0, 200)}`,
    )
    // densable We(f,"tool_input_validation_failed") → tengu_feature_sad
    logEvent('tengu_feature_sad', {
      feature_name: featureName,
      error_code:
        'tool_input_validation_failed' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    // densable errorCode:Ie("ZOD_VALIDATION") + zodIssueCodes:Ho + errorDetailsHash:bu
    const zodIssueCodes = uniqueJoin(
      parsedInput.error.issues.map(issue => String(issue.code)),
    )
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        'ZOD_VALIDATION' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      zodIssueCodes:
        zodIssueCodes as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetailsHash: shortSha256Hex12(
        errorContent,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetails: errorContent.slice(
        0,
        2000,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
      // densable ...FSt(n.agentContext)
      ...agentContextForToolAnalytics(),
      toolInputSizeBytes,
      ...(emptyInputRepaired ? { emptyInputRepaired: true } : {}),

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
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>InputValidationError: ${errorContent}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `InputValidationError: ${parsedInput.error.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(
    parsedInput.data,
    toolUseContext,
  )
  // densable Auo phase:"validate_input" — H9e server-fallback-tombstone only
  if (isServerFallbackTombstoneAbort(toolUseContext.abortController.signal)) {
    return [
      buildToolUseCancelledUpdate({
        tool,
        toolUseID,
        toolUseContext,
        assistantMessage,
        phase: 'validate_input',
        requestId,
        mcpServerType,
        mcpServerBaseUrl,
      }),
    ]
  }
  if (isValidCall?.result === false) {
    logForDebugging(
      `${tool.name} tool validation error: ${isValidCall.message?.slice(0, 200)}`,
    )
    // densable We(f,"tool_validate_input_rejected") → tengu_feature_sad
    logEvent('tengu_feature_sad', {
      feature_name: featureName,
      error_code:
        'tool_validate_input_rejected' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    // densable error:Ie("ValidateInputError"), ...PC(S.message)
    logEvent('tengu_tool_use_error', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      error:
        'ValidateInputError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      error_message_hash: hashErrorMessageForAnalytics(
        isValidCall.message,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode: isValidCall.errorCode,
      isMcp: tool.isMcp ?? false,
      // densable ...FSt(n.agentContext)
      ...agentContextForToolAnalytics(),

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
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${isValidCall.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `Error: ${isValidCall.message}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }
  // Speculatively start the bash allow classifier check early so it runs in
  // parallel with pre-tool hooks, deny/ask classifiers, and permission dialog
  // setup. The UI indicator (setClassifierChecking) is NOT set here — it's
  // set in interactiveHandler.ts only when the permission check returns `ask`
  // with a pendingClassifierCheck. This avoids flashing "classifier running"
  // for commands that auto-allow via prefix rules.
  if (
    tool.name === BASH_TOOL_NAME &&
    parsedInput.data &&
    'command' in parsedInput.data
  ) {
    const appState = toolUseContext.getAppState()
    startSpeculativeClassifierCheck(
      (parsedInput.data as BashToolInput).command,
      appState.toolPermissionContext,
      toolUseContext.abortController.signal,
      toolUseContext.options.isNonInteractiveSession,
    )
  }

  const resultingMessages = []

  // Defense-in-depth: strip _simulatedSedEdit from model-provided Bash input.
  // This field is internal-only — it must only be injected by the permission
  // system (SedEditPermissionRequest) after user approval. If the model supplies
  // it, the schema's strictObject should already reject it, but we strip here
  // as a safeguard against future regressions.
  let processedInput = parsedInput.data
  if (
    tool.name === BASH_TOOL_NAME &&
    processedInput &&
    typeof processedInput === 'object' &&
    '_simulatedSedEdit' in processedInput
  ) {
    const { _simulatedSedEdit: _, ...rest } =
      processedInput as typeof processedInput & {
        _simulatedSedEdit: unknown
      }
    processedInput = rest as typeof processedInput
  }

  // Backfill legacy/derived fields on a shallow clone so hooks/canUseTool see
  // them without affecting tool.call(). SendMessageTool adds fields; file
  // tools overwrite file_path with expandPath — that mutation must not reach
  // call() because tool results embed the input path verbatim (e.g. "File
  // created successfully at: {path}"), and changing it alters the serialized
  // transcript and VCR fixture hashes. If a hook/permission later returns a
  // fresh updatedInput, callInput converges on it below — that replacement
  // is intentional and should reach call().
  let callInput = processedInput
  const backfilledClone =
    tool.backfillObservableInput &&
    typeof processedInput === 'object' &&
    processedInput !== null
      ? ({ ...processedInput } as typeof processedInput)
      : null
  if (backfilledClone) {
    tool.backfillObservableInput!(backfilledClone as Record<string, unknown>)
    processedInput = backfilledClone
  }

  let shouldPreventContinuation = false
  let stopReason: string | undefined
  let hookPermissionResult: PermissionResult | undefined
  const preToolHookInfos: StopHookInfo[] = []
  const preToolHookStart = Date.now()
  for await (const result of runPreToolUseHooks(
    toolUseContext,
    tool,
    processedInput,
    toolUseID,
    assistantMessage.message.id!,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
  )) {
    switch (result.type) {
      case 'message':
        if (result.message.message.type === 'progress') {
          onToolProgress(result.message.message)
        } else {
          resultingMessages.push(result.message)
          const att = result.message.message.attachment
          if (
            att &&
            'command' in att &&
            att.command !== undefined &&
            'durationMs' in att &&
            att.durationMs !== undefined
          ) {
            preToolHookInfos.push({
              command: att.command as string,
              durationMs: att.durationMs as number,
            })
          }
        }
        break
      case 'hookPermissionResult':
        hookPermissionResult = result.hookPermissionResult
        break
      case 'hookUpdatedInput':
        // Hook provided updatedInput without making a permission decision (passthrough)
        // Update processedInput so it's used in the normal permission flow
        processedInput = result.updatedInput
        break
      case 'preventContinuation':
        shouldPreventContinuation = result.shouldPreventContinuation
        break
      case 'stopReason':
        stopReason = result.stopReason
        break
      case 'additionalContext':
        resultingMessages.push(result.message)
        break
      case 'stop':
        getStatsStore()?.observe(
          'pre_tool_hook_duration_ms',
          Date.now() - preToolHookStart,
        )
        resultingMessages.push({
          message: createUserMessage({
            content: [createToolResultStopMessage(toolUseID)],
            toolUseResult: `Error: ${stopReason}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        })
        return resultingMessages
    }
  }
  const preToolHookDurationMs = Date.now() - preToolHookStart
  getStatsStore()?.observe('pre_tool_hook_duration_ms', preToolHookDurationMs)
  if (preToolHookDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS) {
    logForDebugging(
      `Slow PreToolUse hooks: ${preToolHookDurationMs}ms for ${tool.name} (${preToolHookInfos.length} hooks)`,
      { level: 'info' },
    )
  }

  // Emit PreToolUse summary immediately so it's visible while the tool executes.
  // Use wall-clock time (not sum of individual durations) since hooks run in parallel.
  if (process.env.USER_TYPE === 'ant' && preToolHookInfos.length > 0) {
    if (preToolHookDurationMs > HOOK_TIMING_DISPLAY_THRESHOLD_MS) {
      resultingMessages.push({
        message: createStopHookSummaryMessage(
          preToolHookInfos.length,
          preToolHookInfos,
          [],
          false,
          undefined,
          false,
          'suggestion',
          undefined,
          'PreToolUse',
          preToolHookDurationMs,
        ),
      })
    }
  }

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

  startToolSpan(
    tool.name,
    toolAttributes,
    isBetaTracingEnabled() ? jsonStringify(processedInput) : undefined,
  )
  startToolBlockedOnUserSpan()

  // Check whether we have permission to use the tool,
  // and ask the user for permission if we don't
  const permissionMode = toolUseContext.getAppState().toolPermissionContext.mode
  const permissionStart = Date.now()

  const resolved = await resolveHookPermissionDecision(
    hookPermissionResult,
    tool,
    processedInput,
    toolUseContext,
    canUseTool,
    assistantMessage,
    toolUseID,
  )
  const permissionDecision = resolved.decision
  processedInput = resolved.input
  const permissionDurationMs = Date.now() - permissionStart
  // In auto mode, canUseTool awaits the classifier (side_query) — if that's
  // slow the collapsed view shows "Running…" with no (Ns) tick since
  // bash_progress hasn't started yet. Auto-only: in default mode this timer
  // includes interactive-dialog wait (user think time), which is just noise.
  if (
    permissionDurationMs >= SLOW_PHASE_LOG_THRESHOLD_MS &&
    permissionMode === 'auto'
  ) {
    logForDebugging(
      `Slow permission decision: ${permissionDurationMs}ms for ${tool.name} ` +
        `(mode=${permissionMode}, behavior=${permissionDecision.behavior})`,
      { level: 'info' },
    )
  }

  // Emit tool_decision OTel event and code-edit counter if the interactive
  // permission path didn't already log it (headless mode bypasses permission
  // logging, so we need to emit both the generic event and the code-edit
  // counter here)
  if (
    permissionDecision.behavior !== 'ask' &&
    !toolUseContext.toolDecisions?.has(toolUseID)
  ) {
    const decision =
      permissionDecision.behavior === 'allow' ? 'accept' : 'reject'
    const source = decisionReasonToOTelSource(
      permissionDecision.decisionReason,
      permissionDecision.behavior,
    )
    void logOTelEvent('tool_decision', {
      decision,
      source,
      tool_name: sanitizeToolNameForAnalytics(tool.name),
    })

    // Increment code-edit tool decision counter for headless mode
    if (isCodeEditingTool(tool.name)) {
      void buildCodeEditToolAttributes(
        tool,
        processedInput,
        decision,
        source,
      ).then(attributes => getCodeEditToolDecisionCounter()?.add(1, attributes))
    }
  }

  // Add message if permission was granted/denied by PermissionRequest hook
  if (
    permissionDecision.decisionReason?.type === 'hook' &&
    permissionDecision.decisionReason.hookName === 'PermissionRequest' &&
    permissionDecision.behavior !== 'ask'
  ) {
    resultingMessages.push({
      message: createAttachmentMessage({
        type: 'hook_permission_decision',
        decision: permissionDecision.behavior,
        toolUseID,
        hookEvent: 'PermissionRequest',
      }),
    })
  }

  if (permissionDecision.behavior !== 'allow') {
    // densable: non-allow + H9e → Auo phase:"permission" (server-fallback
    // tombstone during permission wait). JFr("cancelled","server_fallback_tombstone")
    if (isServerFallbackTombstoneAbort(toolUseContext.abortController.signal)) {
      const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
      endToolBlockedOnUserSpan(
        'cancelled',
        decisionInfo?.source || 'server_fallback_tombstone',
      )
      endToolSpan()
      resultingMessages.push(
        buildToolUseCancelledUpdate({
          tool,
          toolUseID,
          toolUseContext,
          assistantMessage,
          phase: 'permission',
          requestId,
          mcpServerType,
          mcpServerBaseUrl,
        }),
      )
      return resultingMessages
    }
    logForDebugging(`${tool.name} tool permission denied`)
    const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
    endToolBlockedOnUserSpan('reject', decisionInfo?.source || 'unknown')
    endToolSpan()

    logEvent('tengu_tool_use_can_use_tool_rejected', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),

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
    let errorMessage = permissionDecision.message
    // Only use generic "Execution stopped" message if we don't have a detailed hook message
    if (shouldPreventContinuation && !errorMessage) {
      errorMessage = `Execution stopped by PreToolUse hook${stopReason ? `: ${stopReason}` : ''}`
    }

    // Build top-level content: tool_result (text-only for is_error compatibility) + images alongside
    const messageContent: ContentBlockParam[] = [
      {
        type: 'tool_result',
        content: errorMessage,
        is_error: true,
        tool_use_id: toolUseID,
      },
    ]

    // Add image blocks at top level (not inside tool_result, which rejects non-text with is_error)
    const rejectContentBlocks =
      permissionDecision.behavior === 'ask'
        ? permissionDecision.contentBlocks
        : undefined
    if (rejectContentBlocks?.length) {
      messageContent.push(...rejectContentBlocks)
    }

    // Generate sequential imagePasteIds so each image renders with a distinct label
    let rejectImageIds: number[] | undefined
    if (rejectContentBlocks?.length) {
      const imageCount = count(
        rejectContentBlocks,
        (b: ContentBlockParam) => b.type === 'image',
      )
      if (imageCount > 0) {
        const startId = getNextImagePasteId(toolUseContext.messages)
        rejectImageIds = Array.from(
          { length: imageCount },
          (_, i) => startId + i,
        )
      }
    }

    resultingMessages.push({
      message: createUserMessage({
        content: messageContent,
        imagePasteIds: rejectImageIds,
        toolUseResult: `Error: ${errorMessage}`,
        // densable TKu(B) → toolDenialKind on denied tool_result
        toolDenialKind:
          toolDenialKindFromPermissionDecision(permissionDecision),
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    })

    // Run PermissionDenied hooks for auto mode classifier denials.
    // If a hook returns {retry: true}, tell the model it may retry.
    if (
      feature('TRANSCRIPT_CLASSIFIER') &&
      permissionDecision.decisionReason?.type === 'classifier' &&
      permissionDecision.decisionReason.classifier === 'auto-mode'
    ) {
      let hookSaysRetry = false
      for await (const result of executePermissionDeniedHooks(
        tool.name,
        toolUseID,
        processedInput,
        permissionDecision.decisionReason.reason ?? 'Permission denied',
        toolUseContext,
        permissionMode,
        toolUseContext.abortController.signal,
      )) {
        if (result.retry) hookSaysRetry = true
      }
      if (hookSaysRetry) {
        resultingMessages.push({
          message: createUserMessage({
            content:
              'The PermissionDenied hook indicated this command is now approved. You may retry it if you would like.',
            isMeta: true,
          }),
        })
      }
    }

    return resultingMessages
  }
  logEvent('tengu_tool_use_can_use_tool_allowed', {
    messageID:
      messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolName: sanitizeToolNameForAnalytics(tool.name),

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

  // Use the updated input from permissions if provided
  // (Don't overwrite if undefined - processedInput may have been modified by passthrough hooks)
  // densable: if updatedInput is non-empty {}, re-validate with CKu (safeParse
  // ignoring unrecognized_keys). On real issues → PERMISSION_UPDATED_INPUT.
  // densable: only apply non-empty updatedInput (!h1i). Empty {} is a
  // no-op sentinel — applying it would wipe valid model input.
  if (
    permissionDecision.updatedInput !== undefined &&
    !isEmptyPlainObject(permissionDecision.updatedInput)
  ) {
    const updatedParse = tool.inputSchema.safeParse(
      permissionDecision.updatedInput,
    )
    if (!updatedParse.success) {
      // densable CKu: ignore unrecognized_keys-only failures
      const materialIssues = updatedParse.error.issues.filter(
        issue => issue.code !== 'unrecognized_keys',
      )
      if (materialIssues.length > 0) {
        const filteredError = new ZodError(materialIssues)
        const schemaMsg = formatZodValidationError(tool.name, filteredError)
        const errorContent =
          `The permission handler returned updatedInput for ${tool.name} that failed schema validation: ${schemaMsg}\n` +
          `This is a configuration issue in your canUseTool callback, PermissionRequest hook, or permission-prompt tool — updatedInput must satisfy the tool's input schema. The tool input from the model was valid.`
        const zodIssueCodes = uniqueJoin(
          materialIssues.map(issue => String(issue.code)),
        )
        logForDebugging(
          `Permission handler updatedInput for ${tool.name} failed schema validation (${zodIssueCodes})`,
          { level: 'warn' },
        )
        // densable We(f,"tool_permission_updated_input_invalid")
        logEvent('tengu_feature_sad', {
          feature_name: featureName,
          error_code:
            'tool_permission_updated_input_invalid' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        // densable errorCode:Ie("PERMISSION_UPDATED_INPUT")
        logEvent('tengu_tool_use_error', {
          error:
            'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          errorCode:
            'PERMISSION_UPDATED_INPUT' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          zodIssueCodes:
            zodIssueCodes as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          errorDetailsHash: shortSha256Hex12(
            errorContent,
          ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          // densable ...FSt(n.agentContext)
          ...agentContextForToolAnalytics(),
          toolInputSizeBytes,
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
          ...mcpToolDetailsForAnalytics(
            tool.name,
            mcpServerType,
            mcpServerBaseUrl,
          ),
        })
        // densable JFr("reject","permission_updated_input_invalid") + kVt(D)
        const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
        endToolBlockedOnUserSpan(
          'reject',
          decisionInfo?.source || 'permission_updated_input_invalid',
        )
        endToolSpan()
        resultingMessages.push({
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>${errorContent}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUseID,
              },
            ],
            toolUseResult: `InputValidationError: permission handler updatedInput failed schema for ${tool.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        })
        return resultingMessages
      }
    }
    processedInput = permissionDecision.updatedInput
  }

  // densable Auo phase:"pre_call" — H9e after permission, before tool.call
  if (isServerFallbackTombstoneAbort(toolUseContext.abortController.signal)) {
    resultingMessages.push(
      buildToolUseCancelledUpdate({
        tool,
        toolUseID,
        toolUseContext,
        assistantMessage,
        phase: 'pre_call',
        requestId,
        mcpServerType,
        mcpServerBaseUrl,
      }),
    )
    return resultingMessages
  }

  // Prepare tool parameters for logging in tool_result event.
  // Gated by OTEL_LOG_TOOL_DETAILS — tool parameters can contain sensitive
  // content (bash commands, MCP server names, etc.) so they're opt-in only.
  const telemetryToolInput = extractToolInputForTelemetry(processedInput)
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

  const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
  endToolBlockedOnUserSpan(
    decisionInfo?.decision || 'unknown',
    decisionInfo?.source || 'unknown',
  )
  startToolExecutionSpan()

  const startTime = Date.now()
  // densable G=process.memoryUsage() before tool.call — success/error deltas
  const memBefore = sampleToolMemoryUsage()

  // Official $Qn("tool_exec", HOn(agentContext) ?? (isBackgroundAgent ? agentId))
  const sessionActivityAgentId = resolveSessionActivityAgentId({
    agentContext: getAgentContext(),
    isBackgroundAgent: toolUseContext.isBackgroundAgent,
    agentId: toolUseContext.agentId,
  })
  startSessionActivity('tool_exec', sessionActivityAgentId)

  // Official activity capture is via query() JOu tap (wOg classifies tool_use
  // on assistant messages). Do not dual-enqueue tool_call here — that
  // duplicated digests after the tap landed.
  // If processedInput still points at the backfill clone, no hook/permission
  // replaced it — pass the pre-backfill callInput so call() sees the model's
  // original field values. Otherwise converge on the hook-supplied input.
  // Permission/hook flows may return a fresh object derived from the
  // backfilled clone (e.g. via inputSchema.parse). If its file_path matches
  // the backfill-expanded value, restore the model's original so the tool
  // result string embeds the path the model emitted — keeps transcript/VCR
  // hashes stable. Other hook modifications flow through unchanged.
  if (
    backfilledClone &&
    processedInput !== callInput &&
    typeof processedInput === 'object' &&
    processedInput !== null &&
    'file_path' in processedInput &&
    'file_path' in (callInput as Record<string, unknown>) &&
    (processedInput as Record<string, unknown>).file_path ===
      (backfilledClone as Record<string, unknown>).file_path
  ) {
    callInput = {
      ...processedInput,
      file_path: (callInput as Record<string, unknown>).file_path,
    } as typeof processedInput
  } else if (processedInput !== backfilledClone) {
    callInput = processedInput
  }
  try {
    // AC1 parity: wrap the single canonical tool.call site with deterministic
    // tool-event observation hooks (codex review follow-up). Hooks are
    // fire-and-forget inside the wrapper; tool execution is never blocked or
    // altered by skill-learning plumbing.
    //
    // The invoke lambda is shared between the flag-on (wrapper) and flag-off
    // (direct) paths so that post-call processing is never duplicated.
    const invokeToolCall = () =>
      tool.call(
        callInput,
        {
          ...toolUseContext,
          toolUseId: toolUseID,
          userModified: permissionDecision.userModified ?? false,
        },
        canUseTool,
        assistantMessage,
        progress => {
          onToolProgress({
            toolUseID: progress.toolUseID,
            data: progress.data,
          })
        },
      )
    // Fast-path: skip wrapper entirely when skill-learning is disabled to
    // avoid even the cached-import resolution on the hot path.
    const result = isSkillLearningEnabled()
      ? await (async () => {
          const { runToolCallWithSkillLearningHooks } =
            await getSkillLearningWrapper()
          return runToolCallWithSkillLearningHooks(
            tool.name,
            callInput,
            { sessionId: (toolUseContext as { sessionId?: string }).sessionId },
            invokeToolCall,
          )
        })()
      : await invokeToolCall()
    const durationMs = Date.now() - startTime
    addToToolDuration(durationMs)

    // Log tool content/output as span event if enabled
    if (result.data && typeof result.data === 'object') {
      const contentAttributes: Record<string, string | number | boolean> = {}

      // Read tool: capture file_path and content
      if (tool.name === FILE_READ_TOOL_NAME && 'content' in result.data) {
        if ('file_path' in processedInput) {
          contentAttributes.file_path = String(processedInput.file_path)
        }
        contentAttributes.content = String(result.data.content)
      }

      // Edit/Write tools: capture file_path and diff
      if (
        (tool.name === FILE_EDIT_TOOL_NAME ||
          tool.name === FILE_WRITE_TOOL_NAME) &&
        'file_path' in processedInput
      ) {
        contentAttributes.file_path = String(processedInput.file_path)

        // For Edit, capture the actual changes made
        if (tool.name === FILE_EDIT_TOOL_NAME && 'diff' in result.data) {
          contentAttributes.diff = String(result.data.diff)
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
        if ('output' in result.data) {
          contentAttributes.output = String(result.data.output)
        }
      }

      if (Object.keys(contentAttributes).length > 0) {
        addToolContentEvent('tool.output', contentAttributes)
      }
    }

    // Capture structured output from tool result if present
    if (typeof result === 'object' && 'structured_output' in result) {
      // Store the structured output in an attachment message
      resultingMessages.push({
        message: createAttachmentMessage({
          type: 'structured_output',
          data: result.structured_output,
        }),
      })
    }

    endToolExecutionSpan({ success: true })
    // Pass tool result for new_context logging
    const toolResultStr =
      result.data && typeof result.data === 'object'
        ? jsonStringify(result.data)
        : String(result.data ?? '')
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

    // Map the tool result to API format once and cache it. This block is reused
    // by addToolResult (skipping the remap) and measured here for analytics.
    const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(
      result.data,
      toolUseID,
    )
    const mappedContent = mappedToolResultBlock.content
    const toolResultSizeBytes = !mappedContent
      ? 0
      : typeof mappedContent === 'string'
        ? mappedContent.length
        : jsonStringify(mappedContent).length

    // densable pe/He/Ce/_e + readHasLimit/Offset for success analytics
    let fileExtension: ReturnType<typeof getFileExtensionForAnalytics>
    let filePathLen: number | undefined
    let bashCommandFileExtensions:
      | AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS
      | undefined
    let bashCommandLen: number | undefined
    let readHasLimit: boolean | undefined
    let readHasOffset: boolean | undefined
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
        // densable He from original callInput path (w), not expanded/backfilled
        const originalPath =
          callInput &&
          typeof callInput === 'object' &&
          'file_path' in (callInput as Record<string, unknown>)
            ? String((callInput as Record<string, unknown>).file_path)
            : String(processedInput.file_path)
        filePathLen = originalPath.length
        if (tool.name === FILE_READ_TOOL_NAME) {
          // densable readHasLimit/readHasOffset on Read success
          readHasLimit =
            'limit' in processedInput && processedInput.limit !== undefined
          readHasOffset =
            'offset' in processedInput && processedInput.offset !== undefined
        }
      } else if (
        tool.name === NOTEBOOK_EDIT_TOOL_NAME &&
        'notebook_path' in processedInput
      ) {
        const notebookPath = String(processedInput.notebook_path)
        fileExtension = getFileExtensionForAnalytics(notebookPath)
        filePathLen = notebookPath.length
      } else if (tool.name === BASH_TOOL_NAME && 'command' in processedInput) {
        const bashInput = processedInput as BashToolInput
        fileExtension = getFileExtensionsFromBashCommand(
          bashInput.command,
          bashInput._simulatedSedEdit?.filePath,
        )
        // densable z5n → bashCommandFileExtensions
        bashCommandFileExtensions = bashCommandFileExtensionsForAnalytics(
          bashInput.command,
        )
        bashCommandLen = bashInput.command.length
      } else if (
        tool.name === POWERSHELL_TOOL_NAME &&
        'command' in processedInput &&
        typeof (processedInput as { command?: unknown }).command === 'string'
      ) {
        // densable z5n on PS/shell command tools without qkc fileExtension
        bashCommandFileExtensions = bashCommandFileExtensionsForAnalytics(
          String((processedInput as { command: string }).command),
        )
      }
    }

    // densable Ae=Wkc(newMessages) — document/image attachment payload size
    const toolResultAttachmentBytes = toolResultAttachmentBytesFromMessages(
      result.newMessages as
        | ReadonlyArray<{ type?: string; message?: { content?: unknown } }>
        | undefined,
    )

    // densable jkc(e.name,b,s) → tengu_file_activity before Ee(f)/success
    // local-only: Edit/Write/NotebookEdit/Bash|PowerShell; skip G5n deliver channels
    emitFileActivityForToolSuccess(
      logEvent,
      tool.name,
      processedInput,
      messageId,
      {
        edit: FILE_EDIT_TOOL_NAME,
        write: FILE_WRITE_TOOL_NAME,
        notebookEdit: NOTEBOOK_EDIT_TOOL_NAME,
        bash: BASH_TOOL_NAME,
        powerShell: POWERSHELL_TOOL_NAME,
      },
    )

    // densable Ee(f) → tengu_feature_ok before tengu_tool_use_success
    logEvent('tengu_feature_ok', {
      feature_name: featureName,
    })
    // densable Z=process.memoryUsage(); rss/heap/external deltas on success
    const successMem = toolMemoryDeltasForAnalytics(memBefore)
    logEvent('tengu_tool_use_success', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
      durationMs,
      rssDeltaBytes: successMem.rssDeltaBytes,
      heapUsedDeltaBytes: successMem.heapUsedDeltaBytes,
      externalDeltaBytes: successMem.externalDeltaBytes,
      preToolHookDurationMs,
      permissionDurationMs,
      toolResultSizeBytes,
      ...(toolResultAttachmentBytes > 0 && { toolResultAttachmentBytes }),
      toolInputSizeBytes,
      ...(fileExtension !== undefined && { fileExtension }),
      ...(bashCommandFileExtensions !== undefined && {
        bashCommandFileExtensions,
      }),
      ...(filePathLen !== undefined && { filePathLen }),
      ...(bashCommandLen !== undefined && { bashCommandLen }),
      ...(readHasLimit !== undefined && { readHasLimit }),
      ...(readHasOffset !== undefined && { readHasOffset }),

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
      processedInput.command.match(/\bgit\s+commit\b/) &&
      result.data &&
      typeof result.data === 'object' &&
      'stdout' in result.data
    ) {
      const gitCommitId = parseGitCommitId(String(result.data.stdout))
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

    // Run PostToolUse hooks
    let toolOutput = result.data
    const hookResults = []
    const toolContextModifier = result.contextModifier
    const mcpMeta = result.mcpMeta
    // densable st=se.endsTurn → UserMessage.toolEndsTurn
    const toolEndsTurn = result.endsTurn === true ? true : undefined
    // densable Be=se.contextLayers → update.contextLayers for Ter merge
    const resultContextLayers =
      result.contextLayers && result.contextLayers.length > 0
        ? result.contextLayers
        : undefined

    async function addToolResult(
      toolUseResult: unknown,
      preMappedBlock?: ToolResultBlockParam,
    ) {
      // Use the pre-mapped block when available (non-MCP tools where hooks
      // don't modify the output), otherwise map from scratch.
      const toolResultBlock = preMappedBlock
        ? await processPreMappedToolResultBlock(
            preMappedBlock,
            tool.name,
            tool.maxResultSizeChars,
          )
        : await processToolResultBlock(tool, toolUseResult, toolUseID)

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

      resultingMessages.push({
        message: createUserMessage({
          content: contentBlocks,
          imagePasteIds: allowImageIds,
          toolUseResult:
            toolUseContext.agentId && !toolUseContext.preserveToolUseResults
              ? undefined
              : toolUseResult,
          // densable mts(n.agentId, Me) — subagent only keeps end-turn mcpMeta
          mcpMeta: mcpMetaForToolResultMessage(toolUseContext.agentId, mcpMeta),
          toolEndsTurn,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
        contextModifier: toolContextModifier
          ? {
              toolUseID: toolUseID,
              modifyContext: toolContextModifier,
            }
          : undefined,
        // densable contextLayers:Be&&Be.length>0?{toolUseID:t,layers:Be}:void 0
        ...(resultContextLayers
          ? {
              contextLayers: {
                toolUseID: toolUseID,
                layers: resultContextLayers,
              },
            }
          : {}),
      })
    }

    // TOOD(hackyon): refactor so we don't have different experiences for MCP tools
    if (!isMcpTool(tool)) {
      await addToolResult(toolOutput, mappedToolResultBlock)
    }

    const postToolHookInfos: StopHookInfo[] = []
    const postToolHookStart = Date.now()
    // densable ze — true if any PostToolUse hook yielded (gates Llo resync)
    let postToolHooksYielded = false
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
    )) {
      postToolHooksYielded = true
      if ('updatedMCPToolOutput' in hookResult) {
        if (isMcpTool(tool)) {
          toolOutput = hookResult.updatedMCPToolOutput
        }
      } else if (isMcpTool(tool)) {
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
      } else {
        resultingMessages.push(hookResult)
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

    // densable Llo — only when PostToolUse hooks ran (ze); re-sync readFileState
    // if formatter rewrote disk after Edit/Write (full prior read only).
    if (postToolHooksYielded) {
      const fileResync = resyncReadFileStateAfterPostToolUse(
        tool.name,
        toolUseID,
        processedInput,
        toolUseContext.readFileState,
      )
      if (fileResync) {
        resultingMessages.push({
          message: createAttachmentMessage(fileResync),
        })
      }
    }

    if (isMcpTool(tool)) {
      await addToolResult(toolOutput)
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

    // If the tool provided new messages, add them to the list to return.
    if (result.newMessages && result.newMessages.length > 0) {
      for (const message of result.newMessages) {
        resultingMessages.push({ message })
      }
    }
    // If hook indicated to prevent continuation after successful execution, yield a stop reason message
    if (shouldPreventContinuation) {
      resultingMessages.push({
        message: createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message: stopReason || 'Execution stopped by hook',
          hookName: `PreToolUse:${tool.name}`,
          toolUseID: toolUseID,
          hookEvent: 'PreToolUse',
        }),
      })
    }

    // Yield the remaining hook results after the other messages are sent
    for (const hookResult of hookResults) {
      resultingMessages.push(hookResult)
    }
    return resultingMessages
  } catch (error) {
    const durationMs = Date.now() - startTime
    addToToolDuration(durationMs)

    endToolExecutionSpan({
      success: false,
      error: errorMessage(error),
    })
    endToolSpan()

    // densable: let ce=H9e(...); if (ce) return Auo({phase:"call",...})
    // Tombstone abort during/after tool.call → clean cancel, not tool_use_error.
    const tombstoneDuringCall = isServerFallbackTombstoneAbort(
      toolUseContext.abortController.signal,
    )
    if (tombstoneDuringCall) {
      resultingMessages.push(
        buildToolUseCancelledUpdate({
          tool,
          toolUseID,
          toolUseContext,
          assistantMessage,
          phase: 'call',
          requestId,
          mcpServerType,
          mcpServerBaseUrl,
        }),
      )
      return resultingMessages
    }

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
      // densable ...PC(se) + errorCode:re + mem deltas Z-G
      const classified = classifyToolError(error)
      const catchMem = toolMemoryDeltasForAnalytics(memBefore)
      const pcFields = errorAnalyticsFromThrown(error)
      logEvent('tengu_tool_use_error', {
        messageID:
          messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        toolName: sanitizeToolNameForAnalytics(tool.name),
        error:
          classified as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        ...(pcFields.error_message_hash
          ? {
              error_message_hash:
                pcFields.error_message_hash as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
        ...(pcFields.error_code
          ? {
              error_code:
                pcFields.error_code as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
        ...(pcFields.error_constructor
          ? {
              error_constructor:
                pcFields.error_constructor as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
        ...(pcFields.error_stack_hash
          ? {
              error_stack_hash:
                pcFields.error_stack_hash as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
        ...(pcFields.error_top_frame
          ? {
              error_top_frame:
                pcFields.error_top_frame as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            }
          : {}),
        errorCode:
          classified as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        isMcp: tool.isMcp ?? false,
        // densable ...FSt(n.agentContext)
        ...agentContextForToolAnalytics(),
        rssDeltaBytes: catchMem.rssDeltaBytes,
        heapUsedDeltaBytes: catchMem.heapUsedDeltaBytes,
        externalDeltaBytes: catchMem.externalDeltaBytes,

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
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
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
    )) {
      hookMessages.push(hookResult)
    }

    return [
      {
        message: createUserMessage({
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
        }),
      },
      ...hookMessages,
    ]
  } finally {
    stopSessionActivity('tool_exec', sessionActivityAgentId)
    // Clean up decision info after logging
    if (decisionInfo) {
      toolUseContext.toolDecisions?.delete(toolUseID)
    }
  }
}
