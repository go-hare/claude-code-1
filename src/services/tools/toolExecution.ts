/**
 * Core tool execution orchestrator and public re-export barrel.
 *
 * Delegates cohesive execution phases to `./execution/*`:
 * - `types.ts`: shared types, symbols, and pure helpers
 * - `resultFormatting.ts`: error classification, MCP/deferred/unavailable hints, git commit telemetry
 * - `permissionGate.ts`: denial classification, updatedInput validation, input coercion/validation
 * - `detachedExecution.ts`: send-now detach gate & background settlement
 * - `remoteExecution.ts`: remote host routing, forwarding, approval, and standing requests
 * - `hookPipeline.ts`: managed PreToolUse/PostToolUse, `tool.call` hook chain, progress stream
 * - `postCallResult.ts`: detached outcome messaging, success telemetry, and error handling
 */

import type {
  ContentBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { feature } from 'bun:bundle'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  extractToolInputForTelemetry,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
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
import { findToolByName, type Tool, type ToolUseContext } from '../../Tool.js'
import { getAllBaseTools } from '../../tools.js'
import type { AssistantMessage, StopHookInfo } from '../../types/message.js'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
} from '../../utils/abortController.js'
import {
  getAgentContext,
  isDelegatedObservation,
} from '../../utils/agentContext.js'
import { count } from '../../utils/array.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { ControlStreamClosedError } from '../../utils/errors.js'
import { executePermissionDeniedHooks } from '../../utils/hooks.js'
import { matchToolCallManagedPass } from '../../utils/hooks/toolCallManagedPass.js'
import { logError } from '../../utils/log.js'
import {
  CANCEL_MESSAGE,
  createStopHookSummaryMessage,
  createToolResultStopMessage,
  createUserMessage,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import { decisionReasonToOTelSource } from '../../utils/permissions/permissionDecisionReasons.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import {
  consumePermissionPipelineResult,
  detachedLetGoPermissionDeny,
  recordPersonDeclinedInTurn,
} from '../../utils/permissions/permissions.js'
import { pinValue } from '../../utils/plugins/functionHooksHop.js'
import {
  resolveSessionActivityAgentId,
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { getBootstrapSessionHost, HostSlot } from '../../utils/sessionHost.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import {
  endToolBlockedOnUserSpan,
  endToolSpan,
  injectCurrentTraceparent,
  isBetaTracingEnabled,
  startToolBlockedOnUserSpan,
  startToolExecutionSpan,
  startToolSpan,
} from '../../utils/telemetry/sessionTracing.js'
import { toolSourceAttributes } from '../../utils/telemetry/toolSource.js'
import {
  consumeRemoteNativeToolLocallyChecked,
  getRemoteNativeToolCheck,
  getRemoteNativeToolRunner,
} from '../../utils/toolCreateRuntime.js'
import { startToolHeartbeat } from '../../utils/toolHeartbeat.js'
import {
  agentContextSpawnDepth,
  webFetchHookBlockedHint,
} from '../../utils/webFetchAdmission.js'
import type { getLoggingSafeMcpBaseUrl } from '../mcp/utils.js'
import { isSkillLearningEnabled } from '../skillLearning/featureCheck.js'
import { runWithDetachSupport } from './execution/detachedExecution.js'
import { streamedCheckPermissionsAndCallTool } from './execution/hookPipeline.js'
import {
  applyPermissionUpdatedInput,
  decisionHoldsPersonsWords,
  deriveAllowGivenByApprover,
  deriveToolDenialKind,
  deriveToolDenialUnanswered,
  validateAndPrepareToolInput,
  validateUpdatedInputAgainstSchema,
} from './execution/permissionGate.js'
import {
  buildDetachedOutcomeMessages,
  buildToolParametersForOtel,
  buildToolSpanAttributes,
  finalizeToolCallSuccess,
  handleToolCallError,
  recordToolSuccessTelemetry,
} from './execution/postCallResult.js'
import { tryRunRemoteToolUse } from './execution/remoteExecution.js'
import {
  formatUnavailableBuiltInToolHint,
  formatUnavailableMcpOrResourceToolHint,
  getMcpServerBaseUrlFromToolName,
  getMcpServerType,
  suggestMistypedHostConnectorTool,
} from './execution/resultFormatting.js'
import {
  getNextImagePasteId,
  HOOK_TIMING_DISPLAY_THRESHOLD_MS,
  isEmptyRecord,
  isToolBridgeEvent,
  type McpServerType,
  type MessageUpdateLazy,
  type OnToolProgressFn,
  PERMISSION_STOP_SKIPPED_MESSAGE,
  RUN_TOOL_USE_HANDLES_DETACH,
  SLOW_PHASE_LOG_THRESHOLD_MS,
  type ToolBridgeEvent,
  type ToolCallCoreCapture,
} from './execution/types.js'
import {
  isRemoteToolsForwardEnabled,
  machineServingTool,
  remoteHostNotAvailableMessage,
} from './remoteToolHost.js'
import {
  resolveHookPermissionDecision,
  runPreToolUseHooks,
} from './toolHooks.js'

// Cached import promise for the skill-learning wrapper — paid once per host, not per call.
type SkillLearningWrapperPromise = Promise<{
  runToolCallWithSkillLearningHooks: <T>(
    toolName: string,
    input: unknown,
    callContext: { sessionId?: string; turn?: number },
    invoke: () => Promise<T>,
  ) => Promise<T>
}>

type SkillLearningWrapperHostSlot = {
  cache: SkillLearningWrapperPromise | undefined
}

const skillLearningWrapperCacheByHost =
  new HostSlot<SkillLearningWrapperHostSlot>(() => ({
    cache: undefined,
  }))

function getSkillLearningWrapper() {
  const slot = skillLearningWrapperCacheByHost.of(getBootstrapSessionHost())
  if (!slot.cache) {
    slot.cache = import('../skillLearning/toolEventObserver.js').catch(err => {
      // Clear the cache on rejection so the next tool call can retry the
      // import instead of reusing the same rejected promise forever (which
      // would break every flag-on tool call in the session).
      slot.cache = undefined
      throw err
    })
  }
  return slot.cache
}

export async function* runToolUse(
  toolUse: ToolUseBlock,
  assistantMessage: AssistantMessage,
  canUseTool: CanUseToolFn,
  toolUseContext: ToolUseContext,
): AsyncGenerator<MessageUpdateLazy | ToolBridgeEvent, void> {
  const toolName = toolUse.name
  // First try to find in the available tools (what the model sees)
  let tool = findToolByName(toolUseContext.options.tools, toolName)

  // If not found, check if it's a deprecated tool being called by alias
  // (e.g., old transcripts calling "KillShell" which is now an alias for "TaskStop")
  // Only fall back for tools where the name matches an alias, not the primary name
  if (!tool) {
    const fallbackTool = findToolByName(getAllBaseTools(), toolName)
    // Only use fallback if the tool was found via alias (deprecated name)
    if (fallbackTool && fallbackTool.aliases?.includes(toolName)) {
      tool = fallbackTool
    }
  }
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
    // densable `zi` when `!KJ()`: a machine serves it and this session has
    // no copy. Forwarding on is `KJ`; off is `auo`.
    const servedBy = machineServingTool(toolName, toolUseContext.toolState)
    if (servedBy && !isRemoteToolsForwardEnabled()) {
      const detail = remoteHostNotAvailableMessage(servedBy.name, toolName)
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>Error: ${detail}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: detail,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }
    const sanitizedToolName = sanitizeToolNameForAnalytics(toolName)
    const mistypedHint =
      formatUnavailableBuiltInToolHint(toolName) ||
      suggestMistypedHostConnectorTool(
        toolName,
        toolUseContext.options.tools,
        toolUseContext.options.mcpClients,
        toolUse.input,
      ) ||
      formatUnavailableMcpOrResourceToolHint(
        toolName,
        toolUseContext.options.mcpClients,
        toolUseContext.agentId,
      )
    logForDebugging(`Unknown tool ${toolName}: ${toolUse.id}`)
    logEvent('tengu_tool_use_error', {
      error:
        `No such tool available: ${sanitizedToolName}` as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizedToolName,
      toolUseID:
        toolUse.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      isMcp: toolName.startsWith('mcp__'),
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
    yield {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>Error: No such tool available: ${toolName}${mistypedHint}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUse.id,
          },
        ],
        toolUseResult: `Error: No such tool available: ${toolName}${mistypedHint}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
    }
    return
  }

  const remoteHandled = yield* tryRunRemoteToolUse({
    tool,
    toolName,
    toolUse,
    assistantMessage,
    canUseTool,
    toolUseContext,
  })
  if (remoteHandled) {
    return
  }

  const toolInput = toolUse.input as { [key: string]: string }
  try {
    if (toolUseContext.abortController.signal.aborted) {
      logEvent('tengu_tool_use_cancelled', {
        toolName: sanitizeToolNameForAnalytics(tool.name),
        toolUseID:
          toolUse.id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
      const cancelText =
        getAbortReasonMessage(toolUseContext.abortController.signal.reason) ===
        'permission-stop'
          ? PERMISSION_STOP_SKIPPED_MESSAGE
          : CANCEL_MESSAGE
      const content = createToolResultStopMessage(toolUse.id)
      content.content = withMemoryCorrectionHint(cancelText)
      const cancelledMessage = createUserMessage({
        content: [content],
        toolUseResult: cancelText,
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
      cancelledMessage.toolDenialKind = 'cancelled'
      yield {
        message: cancelledMessage,
      }
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
      checkPermissionsAndCallTool,
    )) {
      yield update
    }
  } catch (error) {
    logError(error)
    const errText = error instanceof Error ? error.message : String(error)
    const toolInfo = tool ? ` (${tool.name})` : ''
    const detailedError = `Error calling tool${toolInfo}: ${errText}`

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

;(runToolUse as unknown as Record<symbol, unknown>)[
  RUN_TOOL_USE_HANDLES_DETACH
] = true

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
  onToolProgress: OnToolProgressFn,
  toolCallCapture?: ToolCallCoreCapture,
): Promise<MessageUpdateLazy[]> {
  const prepared = await validateAndPrepareToolInput({
    tool,
    toolUseID,
    input,
    toolUseContext,
    assistantMessage,
    messageId,
    requestId,
    mcpServerType,
    mcpServerBaseUrl,
  })
  if (!prepared.ok) {
    return prepared.messages
  }

  let processedInput = prepared.processedInput
  let callInput = prepared.callInput
  const backfilledClone = prepared.backfilledClone
  const coerceMeta = prepared.coerceMeta

  const resultingMessages: MessageUpdateLazy[] = []

  // Schema defaults/transforms and observable backfill are core-owned changes.
  // Reuse policy only when the core received the exact approved input; a plugin
  // that changed its input must still run policy for the new call.
  const managed = matchToolCallManagedPass(
    toolUseContext.managedPass,
    toolUseID,
    input,
  )
  if (managed !== undefined) {
    const inputKey = pinValue(processedInput)
    const { updatedInput: _managedInput, ...managedResult } = managed.result
    toolUseContext = {
      ...toolUseContext,
      managedPass: {
        toolUseId: toolUseID,
        input: processedInput,
        inputKey: () => inputKey,
        // AVt/Uat consume the policy rewrite before entering the core. It must
        // not be applied again after the core normalized that approved input.
        pass: {
          result: managedResult,
          yields: managed.yields.map(item => {
            const { updatedInput: _input, ...rest } = item as Record<
              string,
              unknown
            >
            return rest
          }),
        },
      },
    }
  }

  let shouldPreventContinuation = false
  let stopReason: string | undefined
  let hookPermissionResult: PermissionResult | undefined
  const preToolHookInfos: StopHookInfo[] = []
  const preToolHookStart = Date.now()
  /**
   * densable `LKr`: emit PreToolUse `hook_stopped_continuation` so query.ts
   * sets shouldPreventContinuation even when the tool fails, is denied, or
   * stops mid-stream. Without this attachment the halt from `continue:false`
   * is dropped after non-success paths.
   */
  const pushPreToolUsePreventContinuation = (message: string): void => {
    if (
      !shouldPreventContinuation ||
      toolUseContext.abortController.signal.aborted
    ) {
      return
    }
    resultingMessages.push({
      message: createAttachmentMessage({
        type: 'hook_stopped_continuation',
        message,
        hookName: `PreToolUse:${tool.name}`,
        toolUseID: toolUseID,
        hookEvent: 'PreToolUse',
      }),
    })
  }
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
      case 'hookPermissionResult': {
        const incoming = result.hookPermissionResult
        // densable Uat/o5r: deny > ask > allow. Managed replay and user
        // settings may arrive as separate yields in the local hook adapter.
        if (hookPermissionResult?.behavior === 'deny') break
        if (
          hookPermissionResult?.behavior === 'ask' &&
          incoming.behavior === 'allow'
        ) {
          hookPermissionResult = {
            ...hookPermissionResult,
            updatedInput:
              incoming.updatedInput ?? hookPermissionResult.updatedInput,
          }
        } else {
          hookPermissionResult = incoming
        }
        break
      }
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
        // Official 2.1.328 (!Fi(g.agentContext), chunk@294254613.js:4858380):
        // suppress PreToolUse additionalContext in delegated-observation subagents.
        if (!isDelegatedObservation(getAgentContext())) {
          resultingMessages.push(result.message)
        }
        break
      case 'defer': {
        // Official 2.1.239: print-only + solo-only; emit hook_deferred_tool + r1t()
        getStatsStore()?.observe(
          'pre_tool_hook_duration_ms',
          Date.now() - preToolHookStart,
        )
        if (!toolUseContext.options.isNonInteractiveSession) {
          logForDebugging(
            `Hook ${result.hookName} returned permissionDecision=defer in interactive mode; ignoring (defer is print-mode only)`,
            { level: 'warn' },
          )
          break
        }
        const batchToolUses = Array.isArray(assistantMessage.message.content)
          ? count(
              assistantMessage.message.content,
              block => block.type === 'tool_use',
            )
          : 1
        if (batchToolUses > 1) {
          logForDebugging(
            `Hook ${result.hookName} returned permissionDecision=defer but ${batchToolUses} tool calls are in this batch; ignoring (defer is solo-only — siblings would be orphaned on resume)`,
            { level: 'warn' },
          )
          break
        }
        if (toolUseContext.abortController.signal.aborted) {
          resultingMessages.push({
            message: createUserMessage({
              content: [createToolResultStopMessage(toolUseID)],
              toolUseResult: CANCEL_MESSAGE,
              sourceToolAssistantUUID: assistantMessage.uuid,
            }),
          })
          return resultingMessages
        }
        logEvent('tengu_pre_tool_hook_deferred', {
          toolName: sanitizeToolNameForAnalytics(tool.name),
          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
        })
        const traceparent = injectCurrentTraceparent()
        resultingMessages.push({
          message: createAttachmentMessage({
            type: 'hook_deferred_tool',
            toolUseID,
            toolName: tool.name,
            toolInput: processedInput,
            hookName: result.hookName,
            hookEvent: 'PreToolUse',
            permissionMode:
              toolUseContext.getAppState().toolPermissionContext.mode,
            ...(traceparent ? { traceparent } : {}),
          }),
        })
        return resultingMessages
      }
      case 'stop': {
        // densable: stop may carry stopReason (ZFu infra default or continue:false)
        getStatsStore()?.observe(
          'pre_tool_hook_duration_ms',
          Date.now() - preToolHookStart,
        )
        // densable: oe=ae.stopReason??R
        const eventStopReason =
          'stopReason' in result && typeof result.stopReason === 'string'
            ? result.stopReason
            : undefined
        const oe = eventStopReason ?? stopReason
        if (eventStopReason) {
          stopReason = eventStopReason
        }
        // densable MKr: tool_result stop message; content overridden by stopReason
        const stopContent = createToolResultStopMessage(toolUseID)
        if (oe) {
          stopContent.content = oe
        }
        resultingMessages.push({
          message: createUserMessage({
            content: [stopContent],
            toolUseResult: oe ? `Error: ${oe}` : CANCEL_MESSAGE,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        })
        // densable: I&&ae.stopReason&&!aborted → LKr
        // Infra ZFu alone does NOT set I — only continue:false does.
        if (shouldPreventContinuation && eventStopReason) {
          pushPreToolUsePreventContinuation(oe || 'Execution stopped by hook')
        }
        return resultingMessages
      }
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

  const toolAttributes = buildToolSpanAttributes(tool, processedInput)
  startToolSpan(
    tool.name,
    toolAttributes,
    isBetaTracingEnabled() ? jsonStringify(processedInput) : undefined,
  )
  startToolBlockedOnUserSpan()

  // Check whether we have permission to use the tool,
  // and ask the user for permission if we don't
  // densable bn: sticky permission_mode layers
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getToolPermissionContextFromLayers: bnPermissionContext } =
    require('../../engine/permissionLayerReaders.js') as typeof import('../../engine/permissionLayerReaders.js')
  const permissionMode = bnPermissionContext(toolUseContext).mode
  const permissionStart = Date.now()

  // Official 2.1.331 `is = nM(session, name)`, `Nr = nue(session, name) && is`, `hs = Nr ? undefined : is`
  const remoteRunnerAtPermissionStart = getRemoteNativeToolRunner(
    toolUseContext.session,
    tool.name,
  )
  const remotePermissionCheckedFor =
    getRemoteNativeToolCheck(toolUseContext.session, tool.name) !== undefined
      ? remoteRunnerAtPermissionStart
      : undefined
  const remoteRunnerCheckedHere =
    remotePermissionCheckedFor !== undefined
      ? undefined
      : remoteRunnerAtPermissionStart

  toolUseContext.toolDecisions ??= new Map()
  const permissionCheckContext =
    toolUseContext.toolUseId === toolUseID
      ? toolUseContext
      : { ...toolUseContext, toolUseId: toolUseID }
  let permissionPipelineResult: PermissionDecision | undefined
  let resolved: Awaited<ReturnType<typeof resolveHookPermissionDecision>>
  try {
    resolved = await resolveHookPermissionDecision(
      hookPermissionResult,
      tool,
      processedInput,
      permissionCheckContext,
      canUseTool,
      assistantMessage,
      toolUseID,
    )
  } finally {
    permissionPipelineResult = consumePermissionPipelineResult(toolUseID)
  }
  const permissionDecision =
    detachedLetGoPermissionDeny(toolUseID) ?? resolved.decision
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
    // densable u8n(e.mcpInfo) → tool_source; also tool_use_id
    void logOTelEvent('tool_decision', {
      decision,
      source,
      tool_name: sanitizeToolNameForAnalytics(tool.name),
      tool_use_id: toolUseID,
      ...toolSourceAttributes(
        tool.mcpInfo
          ? {
              serverType: mcpServerType,
            }
          : undefined,
      ),
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
    logForDebugging(`${tool.name} tool permission denied`)
    const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
    if (decisionInfo?.source === 'user_reject') {
      recordPersonDeclinedInTurn(toolUseContext, toolUseContext.setAppState)
    }
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
    if (permissionDecision.decisionReason?.type === 'hook') {
      // Keep errorMessage undefined when the hint is empty — '' would defeat
      // the `?? 'Execution stopped by hook'` fallback below.
      const webFetchHint = webFetchHookBlockedHint(
        tool.name,
        processedInput,
        toolUseContext.options.tools,
        toolUseContext.getAppState().toolPermissionContext,
        {
          depth: agentContextSpawnDepth(getAgentContext()),
          allowedAgentTypes:
            toolUseContext.options.agentDefinitions.allowedAgentTypes,
          activeAgents: toolUseContext.options.agentDefinitions.activeAgents,
        },
      )
      if (webFetchHint) {
        errorMessage = (errorMessage ?? '') + webFetchHint
      }
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

    const hasPersonsWords = decisionHoldsPersonsWords(permissionDecision)
    const denialEndsTurn =
      permissionDecision.behavior === 'deny' &&
      (permissionDecision.endsTurn === true ||
        (permissionDecision.decisionReason?.type === 'classifier' &&
          permissionDecision.decisionReason.endsTurn === true))
    const denialMonitorBlocked =
      permissionDecision.behavior === 'deny' &&
      permissionDecision.decisionReason?.type === 'classifier' &&
      'monitorBlocked' in permissionDecision.decisionReason &&
      (permissionDecision.decisionReason as { monitorBlocked?: boolean })
        .monitorBlocked === true
    const denialUnanswered = deriveToolDenialUnanswered(permissionDecision)

    const denialMessage = createUserMessage({
      content: messageContent,
      imagePasteIds: rejectImageIds,
      toolUseResult: `Error: ${errorMessage}`,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
    denialMessage.toolDenialKind = deriveToolDenialKind(permissionDecision)
    if (denialEndsTurn) {
      denialMessage.toolDenialEndsTurn = true
    }
    if (denialMonitorBlocked) {
      denialMessage.toolDenialMonitorBlocked = true
    }
    if (denialUnanswered !== undefined) {
      denialMessage.toolDenialUnanswered = denialUnanswered
    }
    if (
      permissionDecision.behavior === 'ask' &&
      permissionDecision.userFeedback !== undefined
    ) {
      denialMessage.userFeedback = permissionDecision.userFeedback
    }
    if (hasPersonsWords) {
      denialMessage.holdsPersonsWords = true
    }

    resultingMessages.push({
      message: denialMessage,
    })

    // densable: I&&U.behavior==="deny"&&U.decisionReason.type==="hook"&&!aborted → LKr
    // Preserves continue:false halt when PreToolUse both denies and stops.
    if (
      permissionDecision.behavior === 'deny' &&
      permissionDecision.decisionReason?.type === 'hook'
    ) {
      pushPreToolUsePreventContinuation(
        stopReason ?? errorMessage ?? 'Execution stopped by hook',
      )
    }

    // Run PermissionDenied hooks for auto mode classifier denials.
    // If a hook returns {retry: true}, tell the model it may retry.
    if (feature('TRANSCRIPT_CLASSIFIER')) {
      if (
        permissionDecision.decisionReason?.type === 'classifier' &&
        permissionDecision.decisionReason.classifier === 'auto-mode'
      ) {
        let hookSaysRetry = false
        try {
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
        } catch (err) {
          if (!(err instanceof ControlStreamClosedError)) throw err
          logForDebugging(
            'PermissionDenied hooks cancelled (control stream closed)',
          )
        }
        const classifierEndsTurn =
          permissionDecision.behavior === 'deny' &&
          (permissionDecision.endsTurn === true ||
            permissionDecision.decisionReason.endsTurn === true)
        if (
          hookSaysRetry &&
          !permissionDecision.decisionReason.noVerdict &&
          !classifierEndsTurn
        ) {
          resultingMessages.push({
            message: createUserMessage({
              content:
                'The PermissionDenied hook indicated you may retry this tool call.',
              isMeta: true,
              turnCompanion: true,
            }),
          })
        }
      }
    }

    // Official 2.1.328 Ndi (chunk@294254613.js:4868065): abort turn with
    // 'permission-stop' when a deny decision has endsTurn set.
    if (
      permissionDecision.behavior === 'deny' &&
      (permissionDecision.endsTurn === true ||
        (permissionDecision.decisionReason?.type === 'classifier' &&
          permissionDecision.decisionReason.endsTurn === true)) &&
      !toolUseContext.abortController.signal.aborted
    ) {
      toolUseContext.abortController.abort(
        createAbortErrorReason('permission-stop'),
      )
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

  // Use the updated input from permissions if provided (densable zyo @188835250 + Gyo @188820550:
  // ignore empty {} Q2e, and validate against tool.inputSchema ignoring unrecognized_keys).
  if (
    permissionDecision.updatedInput !== undefined &&
    !isEmptyRecord(permissionDecision.updatedInput)
  ) {
    const schemaCheck = validateUpdatedInputAgainstSchema(
      tool,
      permissionDecision.updatedInput,
    )
    if (!schemaCheck.ok) {
      const validationError =
        `The permission handler returned updatedInput for ${tool.name} that failed schema validation: ${schemaCheck.formatted}\n` +
        `This is a configuration issue in your canUseTool callback, PermissionRequest hook, or permission-prompt tool — updatedInput must satisfy the tool's input schema. The tool input from the model was valid.`
      endToolBlockedOnUserSpan('reject', 'permission_updated_input_invalid')
      endToolSpan()
      logForDebugging(
        `Permission handler updatedInput for ${tool.name} failed schema validation (${schemaCheck.issueCodes.join(',')})`,
        { level: 'warn' },
      )
      logEvent('tengu_tool_use_error', {
        error:
          'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        errorCode:
          'PERMISSION_UPDATED_INPUT' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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
      resultingMessages.push({
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${validationError}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: `InputValidationError: permission handler updatedInput failed schema for ${tool.name}`,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      })
      pushPreToolUsePreventContinuation(
        stopReason || 'Execution stopped by hook',
      )
      return resultingMessages
    }
    processedInput = applyPermissionUpdatedInput(
      tool.name,
      permissionDecision.updatedInput,
      processedInput,
    )
  }

  // Prepare tool parameters for logging in tool_result event.
  // Gated by OTEL_LOG_TOOL_DETAILS — tool parameters can contain sensitive
  // content (bash commands, MCP server names, etc.) so they're opt-in only.
  const telemetryToolInput = extractToolInputForTelemetry(processedInput)
  const toolParameters = buildToolParametersForOtel(tool, processedInput)

  const decisionInfo = toolUseContext.toolDecisions?.get(toolUseID)
  endToolBlockedOnUserSpan(
    decisionInfo?.decision || 'unknown',
    decisionInfo?.source || 'unknown',
  )
  startToolExecutionSpan()

  const startTime = Date.now()

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
    'file_path' in callInput &&
    processedInput.file_path === backfilledClone.file_path
  ) {
    callInput = {
      ...processedInput,
      file_path: callInput.file_path,
    }
  } else if (processedInput !== backfilledClone) {
    callInput = processedInput
  }
  // densable: agentId?()=>{}:_Lu(...) — nested agent contexts skip heartbeat;
  // _Lu itself also no-ops when toolName===Agent. Cleanup in finally.
  const stopToolHeartbeat = toolUseContext.agentId
    ? () => {}
    : startToolHeartbeat({
        toolName: tool.name,
        toolUseID,
        abortSignal: toolUseContext.abortController.signal,
        onProgress: progress => {
          onToolProgress({
            toolUseID: progress.toolUseID,
            data: progress.data,
          })
        },
      })

  let innerDenialHeldPersonsWords = false

  try {
    if (toolCallCapture) {
      try {
        if (tool.isReadOnly(callInput)) {
          toolCallCapture.isReadOnly = true
        }
      } catch {
        // Ignore isReadOnly errors on custom/stub tools
      }
    }
    // AC1 parity: wrap the single canonical tool.call site with deterministic
    // tool-event observation hooks (codex review follow-up). Hooks are
    // fire-and-forget inside the wrapper; tool execution is never blocked or
    // altered by skill-learning plumbing.
    //
    // The invoke lambda is shared between the flag-on (wrapper) and flag-off
    // (direct) paths so that post-call processing is never duplicated.
    const runPostPermissionCall = async (
      callCtx: ToolUseContext,
      callCanUseTool: CanUseToolFn,
      progressFn: OnToolProgressFn,
    ) => {
      const allowApprover = deriveAllowGivenByApprover(permissionDecision)
      const existingMeta = callCtx as unknown as {
        allowGivenBy?: { toolUseId?: string; approver?: string }
        permissionPipelineResult?: PermissionDecision
        permissionPhase?: { pipeline?: { result?: PermissionDecision } }
      }
      const effectiveAllowGivenBy =
        existingMeta.allowGivenBy ??
        (allowApprover !== undefined
          ? { toolUseId: toolUseID, approver: allowApprover }
          : undefined)
      const isNonHumanAllowOverride =
        permissionDecision.behavior === 'allow' &&
        permissionDecision.decisionReason !== undefined &&
        permissionDecision.decisionReason.type !== 'permissionPromptTool'
      const effectivePermissionPipelineResult =
        existingMeta.permissionPipelineResult ??
        existingMeta.permissionPhase?.pipeline?.result ??
        (isNonHumanAllowOverride
          ? permissionDecision
          : permissionPipelineResult)
      const isAutoModeClassifiedAllow =
        permissionDecision.behavior === 'allow' &&
        permissionDecision.decisionReason?.type === 'classifier' &&
        permissionDecision.decisionReason.classifier === 'auto-mode' &&
        permissionDecision.decisionReason.noVerdict !== true
      const isAutoModeScriptCheckDeferred =
        permissionDecision.behavior === 'allow' &&
        ((permissionDecision.decisionReason?.type === 'other' &&
          permissionDecision.decisionReason.reason ===
            'deferred_repl_script_check') ||
          (permissionDecision.decisionReason?.type === 'mode' &&
            (
              permissionDecision.decisionReason as {
                scriptCheckDeferred?: boolean
              }
            ).scriptCheckDeferred === true))
      const trackedCanUseTool: CanUseToolFn = async (...args) => {
        const res = await callCanUseTool(...args)
        if (res.behavior !== 'allow' && decisionHoldsPersonsWords(res)) {
          innerDenialHeldPersonsWords = true
        }
        return res
      }
      const runnerLocalCheckDeferred = consumeRemoteNativeToolLocallyChecked(
        callCtx.session,
        toolUseID,
      )
      const invokeToolCall = () =>
        tool.call(
          callInput,
          {
            ...callCtx,
            toolUseId: toolUseID,
            userModified: permissionDecision.userModified ?? false,
            autoModeClassified: isAutoModeClassifiedAllow ? true : undefined,
            autoModeScriptCheckDeferred: isAutoModeScriptCheckDeferred
              ? true
              : undefined,
            ...(effectivePermissionPipelineResult !== undefined && {
              permissionPipelineResult: effectivePermissionPipelineResult,
              permissionPhase: {
                ...existingMeta.permissionPhase,
                pipeline: {
                  ...existingMeta.permissionPhase?.pipeline,
                  result: effectivePermissionPipelineResult,
                },
              },
            }),
            ...(effectiveAllowGivenBy !== undefined && {
              allowGivenBy: effectiveAllowGivenBy,
            }),
            // gold @184489530 — call never inherits the Desktop-forward stamp.
            desktopForwardToolUseId: undefined,
          } as ToolUseContext,
          trackedCanUseTool,
          assistantMessage,
          progress => {
            if (isToolBridgeEvent(progress)) {
              progressFn(progress)
              return
            }
            progressFn({
              toolUseID: progress.toolUseID,
              data: progress.data,
            })
          },
          {
            userModified: permissionDecision.userModified ?? false,
            permissionCheckedFor: remoteRunnerAtPermissionStart ?? null,
            runnerCheckedHere: runnerLocalCheckDeferred
              ? remoteRunnerAtPermissionStart
              : remoteRunnerCheckedHere,
          },
        )
      // Fast-path: skip wrapper entirely when skill-learning is disabled to
      // avoid even the cached-import resolution on the hot path.
      return isSkillLearningEnabled()
        ? await (async () => {
            const { runToolCallWithSkillLearningHooks } =
              await getSkillLearningWrapper()
            return runToolCallWithSkillLearningHooks(
              tool.name,
              callInput,
              {
                sessionId: (callCtx as { sessionId?: string }).sessionId,
              },
              invokeToolCall,
            )
          })()
        : await invokeToolCall()
    }

    const callOutcome = await runWithDetachSupport({
      tool,
      input: callInput,
      toolUseID,
      toolUseContext,
      canUseTool,
      onProgress: onToolProgress,
      run: runPostPermissionCall,
    })
    if (callOutcome.detached) {
      return buildDetachedOutcomeMessages({
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
        detachedText: callOutcome.text,
        resultingMessages,
        toolCallCapture,
        pushPreToolUsePreventContinuation,
        stopReason,
      })
    }
    const result = callOutcome.result
    const durationMs = Date.now() - startTime
    if (toolCallCapture) toolCallCapture.durationMs = durationMs
    addToToolDuration(durationMs)

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

    // Map the tool result to API format once and cache it. This block is reused
    // by addToolResult (skipping the remap) and measured here for analytics.
    const mappedToolResultBlock = tool.mapToolResultToToolResultBlockParam(
      result.data,
      toolUseID,
    )

    await recordToolSuccessTelemetry({
      tool,
      toolUseID,
      processedInput,
      resultData: result.data,
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
    })

    return finalizeToolCallSuccess({
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
    })
  } catch (error) {
    return handleToolCallError({
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
    })
  } finally {
    stopToolHeartbeat()
    stopSessionActivity('tool_exec', sessionActivityAgentId)
    // Clean up decision info after logging
    if (decisionInfo) {
      toolUseContext.toolDecisions?.delete(toolUseID)
    }
  }
}

// ============================================================================
// Re-export cohesive execution submodules (100% backward-compatible barrel)
// ============================================================================

export {
  canDetachToolCall,
  isDetachPermissionDialogOpen,
} from './execution/detachedExecution.js'
export {
  applyPermissionUpdatedInput,
  decisionHoldsPersonsWords,
  deriveToolDenialKind,
  deriveToolDenialUnanswered,
  deriveToolErrorDenialKind,
  validateUpdatedInputAgainstSchema,
} from './execution/permissionGate.js'
export {
  extractRemoteBackgroundTaskId,
  standingRemoteTool,
} from './execution/remoteExecution.js'
export {
  appendCoerceResultNoteToToolResultBlock,
  buildSchemaNotSentHint,
  checkMcpToolNotLoaded,
  classifyNotLoadedMcpToolFamily,
  classifyToolError,
  formatUnavailableBuiltInToolHint,
  formatUnavailableMcpOrResourceToolHint,
  GET_TASK_UNAVAILABLE_HINT,
  isGitCommitCommand,
  resolveGitCommitCwd,
  resolveGitCommitIdForTelemetry,
  suggestMistypedHostConnectorTool,
} from './execution/resultFormatting.js'
export {
  HOOK_TIMING_DISPLAY_THRESHOLD_MS,
  isToolBridgeEvent,
  type McpServerType,
  type MessageUpdateLazy,
  type NotLoadedMcpToolFamily,
  RUN_TOOL_USE_HANDLES_DETACH,
  type ToolBridgeEvent,
  type ToolDenialKind,
} from './execution/types.js'
