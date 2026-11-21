import { feature } from 'bun:bundle'
import { validateBrowserToolInput } from '../../utils/claudeInChrome/chromeCallPermission.js'
import { remapPostToolOutput } from './postToolOutput.js'
import {
  capHostClassifierContext,
  registerLiveHostClassifierContext,
  resolveHostClassifierContext,
  type PairedClassifierContext,
} from '../../utils/permissions/hostClassifierContext.js'
import type {
  ContentBlockParam,
  ToolResultBlockParam,
  ToolUseBlock,
} from '@anthropic-ai/sdk/resources/index.mjs'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  extractMcpToolDetails,
  extractSkillName,
  extractToolInputForTelemetry,
  getFileExtensionForAnalytics,
  getFileExtensionsFromBashCommand,
  isToolDetailsLoggingEnabled,
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import {
  addToToolDuration,
  getCodeEditToolDecisionCounter,
  getMainThreadAgentHooks,
  getRegisteredHooks,
  getSessionId,
  getStatsStore,
  isSingleShotPrintSession,
} from '../../bootstrap/state.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { getPermissionConfirm } from '../../dialog/permissionConfirmRegistry.js'
import { createAbortController } from '../../utils/abortController.js'
import { registerForegroundToolCall } from '../../utils/foregroundToolCalls.js'
import { areBackgroundTasksDisabled } from '../../utils/sessionBackgroundGates.js'
import {
  isDisklessLaunch,
  isUserPromptWaiting,
} from '../../utils/sessionHost.js'
import { plural } from '../../utils/stringUtils.js'
import { escapeXml } from '../../utils/xml.js'
import {
  getHooksConfigFromSnapshot,
  shouldDisableAllHooksIncludingManaged,
} from '../../utils/hooks/hooksConfigSnapshot.js'
import { isDeepStrictEqual } from 'util'
import { z } from 'zod/v4'
import {
  detachedToolCallEnded,
  detachedToolCallLetGo,
  detachedToolCallResultQueued,
  detachedToolCallSetText,
  detachedToolCallSettled,
  detachedToolCallStarted,
  getDetachedToolCallSnapshot,
  isDetachBackgrounding,
} from '../../utils/detachedToolCallStore.js'
import {
  DETACH_RESULT_CAP,
  enqueueDetachedToolCallResult,
  stillRunningDetachText,
} from '../../utils/detachedToolCallNotify.js'
import { TASK_STOP_TOOL_NAME } from '@claude-code/builtin-tools/tools/TaskStopTool/prompt.js'
import {
  buildCodeEditToolAttributes,
  isCodeEditingTool,
} from '../../hooks/toolPermission/permissionLogging.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import {
  consumePermissionPipelineResult,
  detachedLetGoPermissionDeny,
} from '../../utils/permissions/permissions.js'
import {
  findToolByName,
  type Tool,
  type ToolProgress,
  type ToolProgressData,
  type ToolUseContext,
} from '../../Tool.js'
import type { BashToolInput } from '@claude-code/builtin-tools/tools/BashTool/BashTool.js'
import { startSpeculativeClassifierCheck } from '@claude-code/builtin-tools/tools/BashTool/bashPermissions.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import { FILE_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileEditTool/constants.js'
import { getTokenCapBanner } from '@claude-code/builtin-tools/tools/FileReadTool/FileReadTool.js'
import { FILE_READ_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileReadTool/prompt.js'
import { FILE_WRITE_TOOL_NAME } from '@claude-code/builtin-tools/tools/FileWriteTool/prompt.js'
import { NOTEBOOK_EDIT_TOOL_NAME } from '@claude-code/builtin-tools/tools/NotebookEditTool/constants.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/builtin-tools/tools/PowerShellTool/toolName.js'
import { resolve as resolvePath } from 'path'
import { parseGitCommitId } from '@claude-code/builtin-tools/tools/shared/gitOperationTracking.js'
import { getCwd } from '../../utils/cwd.js'
import { getHeadForDir } from '../../utils/git/gitFilesystem.js'
import {
  isDeferredTool,
  SEARCH_EXTRA_TOOLS_TOOL_NAME,
} from '@claude-code/builtin-tools/tools/SearchExtraToolsTool/prompt.js'
import { getAllBaseTools } from '../../tools.js'
import type { HookProgress } from '../../types/hooks.js'
import { recordToolObservation } from '../langfuse/index.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  Message,
  ProgressMessage,
  StopHookInfo,
  UserMessage,
} from '../../types/message.js'
import { count } from '../../utils/array.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  AbortError,
  errorMessage,
  getErrnoCode,
  ShellError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../../utils/errors.js'
import {
  executePermissionDeniedHooks,
  executePreToolHooks,
  getPreToolHookBlockingMessage,
} from '../../utils/hooks.js'
import {
  listOfContextTexts,
  packToolCallContext,
  pinHookAttachment,
  rewrittenToolCallContext,
} from '../../utils/hooks/toolCallContextPack.js'
import { END_CONVERSATION_TOOL_NAME } from '@claude-code/builtin-tools/tools/EndConversationTool/prompt.js'
import {
  accountMemoryHookRewriteDenied,
  didAccountMemoryHookRewriteInput,
  matchToolCallManagedPass,
  shouldPreserveManagedToolHookPass,
  type ManagedHookPass,
  type ToolCallManagedPass,
} from '../../utils/hooks/toolCallManagedPass.js'
import { logError } from '../../utils/log.js'
import {
  announceWaitAlreadyExpired,
  isRemoteToolsForwardEnabled,
  machineAdoptingMcpTool,
  markRemoteMachineAway,
  noteRemoteMachineHeard,
  REMOTE_ANNOUNCE_WAIT_MS,
  REMOTE_TOOL_HOST_FIELD,
  remoteHostForwardRefusal,
  remoteHostGaveUpEarlierMessage,
  remoteHostGaveUpMessage,
  remoteHostNotAvailableMessage,
  remoteHostOfflineMessage,
  remoteHostIncompatibleMessage,
  remoteHostUnreadableToolMessage,
  remoteHostServesNothingMessage,
  remoteHostToolNotServedMessage,
  remoteHostApprovalUnverifiedMessage,
  remoteHostRefusedByMessage,
  remoteHostRefusedUnrunMessage,
  syncBridgeRemoteHosts,
  syncSessionRemoteHosts,
  type DeviceBridgeMcpClient,
  REMOTE_HOST_INTERRUPTED,
  remoteHostAnsweredErrorMessage,
  remoteHostDisconnectedMessage,
  remoteHostEnvelopeMessage,
  remoteHostGoneMessage,
  remoteHostProbeStalledMessage,
  remoteHostQueuedWithdrawnMessage,
  remoteHostTakenBackMessage,
  remoteHostTimedOutMessage,
  remoteHostTooLargeMessage,
  remoteHostTransitFailedMessage,
  remoteHostUnreadableEnvelopeMessage,
  remoteHostUnresponsiveMessage,
  remoteHostUnreachableOutcome,
  remoteHostUnverifiedRefusalMessage,
  remoteHostWriteUnresolvedMessage,
  machineServingTool,
  askRemoteToolsReannounce,
  remoteHostRoute,
  requestedRemoteHost,
  announcedRemoteMachines,
  resolveAnnouncedMachine,
  waitForAnnouncedMachine,
  type AnnouncedRemoteMachine,
} from './remoteToolHost.js'
import {
  callRemoteTool,
  callRemotePlumbing,
  checkStandingRemoteTool,
  classifyHeldBody,
  classifyRemoteToolsProbe,
  noteRemoteToolHost,
  REMOTE_PLUMBING_TOOLS,
  REMOTE_TOOL_DEADLINE_MS,
  REMOTE_TOOL_MAX_REQUEST_BYTES,
  REMOTE_TOOL_PROBE_CAP_MS,
  type RemoteToolHeld,
} from './remoteToolCall.js'
import { getCurrentStructuredIO } from '../../cli/structuredIO.js'
import {
  CANCEL_MESSAGE,
  createProgressMessage,
  createStopHookSummaryMessage,
  createToolResultStopMessage,
  createUserMessage,
  REJECT_MESSAGE_WITH_REASON_PREFIX,
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  withMemoryCorrectionHint,
} from '../../utils/messages.js'
import type {
  PermissionDecision,
  PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import { decisionReasonToOTelSource } from '../../utils/permissions/permissionDecisionReasons.js'
import { getAgentContext } from '../../utils/agentContext.js'
import {
  agentContextSpawnDepth,
  webFetchHookBlockedHint,
} from '../../utils/webFetchAdmission.js'
import {
  resolveSessionActivityAgentId,
  startSessionActivity,
  stopSessionActivity,
} from '../../utils/sessionActivity.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import { Stream } from '../../utils/stream.js'
import { logOTelEvent } from '../../utils/telemetry/events.js'
import { toolSourceAttributes } from '../../utils/telemetry/toolSource.js'
import { startToolHeartbeat } from '../../utils/toolHeartbeat.js'
import {
  addToolContentEvent,
  endToolBlockedOnUserSpan,
  endToolExecutionSpan,
  endToolSpan,
  isBetaTracingEnabled,
  startToolBlockedOnUserSpan,
  startToolExecutionSpan,
  injectCurrentTraceparent,
  startToolSpan,
} from '../../utils/telemetry/sessionTracing.js'
import {
  formatError,
  formatZodValidationError,
} from '../../utils/toolErrors.js'
import {
  persistToolResult,
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
  collectManagedOnlyPostToolUse,
  resolveHookPermissionDecision,
  runPostToolUseFailureHooks,
  runPostToolUseHooks,
  runPreToolUseHooks,
} from './toolHooks.js'
import { isSkillLearningEnabled } from '../skillLearning/featureCheck.js'
import {
  type FunctionHookHopSite,
  hasMatchingFunctionHook,
  isInsideAgentSpawnLaunch,
  runFunctionHookChain,
} from '../../utils/plugins/functionHooksModules.js'
import {
  pinValue,
  restorePinnedKeys,
} from '../../utils/plugins/functionHooksHop.js'
import {
  RemoteBackgroundShells,
  RemoteToolHosts,
  ToolPermissionPromptsUp,
  type RemoteToolRoutedHost,
} from '../../utils/toolState.js'

export const RUN_TOOL_USE_HANDLES_DETACH: unique symbol = Symbol.for(
  'claude.runToolUseHandlesDetach',
)

const DETACH_CEILING_MS = 300_000

/** densable remote `_r` KLe.started when bash returns backgroundTaskId. */
function rememberRemoteBackgroundShell(
  context: ToolUseContext | undefined,
  input: Record<string, unknown>,
  response: unknown,
  hostName: string,
  callId: string,
): void {
  if (input.run_in_background !== true) return
  const id = extractRemoteBackgroundTaskId(response)
  if (!id || !context?.toolState) return
  context.toolState.get(RemoteBackgroundShells).started(id, {
    hostName,
    callId,
    agentId: context.agentId ?? getAgentContext()?.agentId,
  })
}

/** densable `_r` @213391300 — remote TaskStop must own the started shell ID. */
function checkRemoteTaskStopOwnership(
  toolName: string,
  inputRecord: Record<string, unknown>,
  hostName: string,
  source: 'session' | 'bridge',
  toolUseContext: ToolUseContext,
): string | undefined {
  if (toolName !== TASK_STOP_TOOL_NAME) return undefined
  const callerAgentId = toolUseContext.agentId ?? getAgentContext()?.agentId
  if (callerAgentId === undefined) return undefined
  const taskId = String(inputRecord.task_id ?? inputRecord.shell_id ?? '')
  if (
    toolUseContext.toolState
      ?.get(RemoteBackgroundShells)
      .find(taskId, callerAgentId)?.hostName === hostName
  ) {
    return undefined
  }
  const message = `No background command with that ID was started on ${hostName} by this agent.`
  return source === 'session'
    ? remoteHostRefusedByMessage(hostName, message)
    : remoteHostRefusedUnrunMessage(hostName, message)
}

function detachHookMatcherHitsTool(
  matcherPattern: string | undefined,
  tool: Tool,
): boolean {
  if (!matcherPattern || matcherPattern === '*') return true
  const names = [tool.name, ...(tool.aliases ?? [])]
  if (names.some(name => name === matcherPattern)) return true
  try {
    const regex = new RegExp(`^(${matcherPattern})$`)
    return names.some(name => regex.test(name))
  } catch {
    return false
  }
}

function hasBlockingHookForDetach(
  tool: Tool,
  toolUseContext: ToolUseContext,
): boolean {
  if (shouldDisableAllHooksIncludingManaged()) return false
  if (
    hasMatchingFunctionHook('PostToolUse', { tool_name: tool.name }) ||
    hasMatchingFunctionHook('PostToolUseFailure', { tool_name: tool.name }) ||
    hasMatchingFunctionHook('PostToolBatch') ||
    hasMatchingFunctionHook('tool.call', { tool: tool.name })
  ) {
    return true
  }
  if (toolUseContext.options.settingsHooksOff === true) return false
  let sessionHooksForId:
    | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
    | undefined
  try {
    const appState = toolUseContext.getAppState?.()
    const sessionObj = toolUseContext.session as { id?: string } | undefined
    const sid = toolUseContext.agentId ?? sessionObj?.id ?? getSessionId()
    sessionHooksForId = appState?.sessionHooks?.get(sid)?.hooks as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | undefined
  } catch {
    sessionHooksForId = undefined
  }
  const sources = [
    getHooksConfigFromSnapshot() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    getRegisteredHooks() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    getMainThreadAgentHooks() as
      | Record<string, Array<{ matcher?: string; hooks: unknown[] }>>
      | null
      | undefined,
    sessionHooksForId,
  ]
  for (const event of ['PostToolUse', 'PostToolUseFailure'] as const) {
    for (const src of sources) {
      const matchers = src?.[event]
      if (!Array.isArray(matchers)) continue
      for (const m of matchers) {
        if (m.hooks.length > 0 && detachHookMatcherHitsTool(m.matcher, tool)) {
          return true
        }
      }
    }
  }
  for (const src of sources) {
    const matchers = src?.PostToolBatch
    if (Array.isArray(matchers) && matchers.some(m => m.hooks.length > 0)) {
      return true
    }
  }
  return false
}

/** densable `FDe` @188766400 — gate whether a tool call may detach. */
export function canDetachToolCall(
  tool: Tool,
  _input: unknown,
  toolUseContext: ToolUseContext,
): boolean {
  try {
    if (
      !isDetachBackgrounding(tool) ||
      toolUseContext.session === undefined ||
      toolUseContext.agentId !== undefined ||
      toolUseContext.innerCall === true ||
      (toolUseContext as { remoteCall?: unknown }).remoteCall !== undefined
    ) {
      return false
    }
    if (toolUseContext.options.isNonInteractiveSession) {
      const nonInteractiveDetachAllowed =
        !isSingleShotPrintSession() &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_velvet_panda', true) ===
          true &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_bubbly_meteor', true) ===
          true
      if (!nonInteractiveDetachAllowed) return false
    }
    if (
      areBackgroundTasksDisabled() ||
      getFeatureValue_CACHED_MAY_BE_STALE('tengu_tool_detach', true) !== true
    ) {
      return false
    }
    return !hasBlockingHookForDetach(tool, toolUseContext)
  } catch (err) {
    logForDebugging(
      `[detach] ${tool.name}: the gate threw, so the call runs inline (${errorMessage(err)})`,
      { level: 'error' },
    )
    return false
  }
}

export function isDetachPermissionDialogOpen(
  toolUseContext: ToolUseContext,
  toolUseID: string,
): boolean {
  if ((toolUseContext.toolState?.get(ToolPermissionPromptsUp).count ?? 0) > 0) {
    return true
  }
  if (getPermissionConfirm(toolUseID) !== undefined) {
    return true
  }
  if (toolUseContext.session !== undefined) {
    try {
      if (isUserPromptWaiting(toolUseContext.session)) return true
    } catch {
      // Synthetic session objects without SessionHost slots are treated as non-waiting.
    }
  }
  try {
    const queue = (
      toolUseContext.getAppState?.() as
        | { toolUseConfirmQueue?: unknown[] }
        | undefined
    )?.toolUseConfirmQueue
    if (Array.isArray(queue) && queue.length > 0) return true
  } catch {
    // Ignore partial test appState objects.
  }
  return false
}

function formatDetachedMappedContent(content: unknown): string {
  if (content === undefined) return ''
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return String(content)
  const parts: string[] = []
  let nonText = 0
  for (const s of content) {
    if (
      s &&
      typeof s === 'object' &&
      (s as { type?: string }).type === 'text' &&
      typeof (s as { text?: unknown }).text === 'string'
    ) {
      parts.push((s as { text: string }).text)
    } else {
      nonText++
    }
  }
  if (nonText > 0) {
    parts.push(
      `[${nonText} non-text ${plural(nonText, 'block')} of the result could not be carried in a notification]`,
    )
  }
  return parts.join('\n')
}

/**
 * densable `dOt` + `Zho` (@188766700–@188769600) — wraps post-permission
 * `tool.call` execution so permission prompts never race with send-now detach.
 */
async function runWithDetachSupport<T extends { data: unknown }>(opts: {
  tool: Tool
  input: unknown
  toolUseID: string
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  onProgress: (
    progress:
      | ToolProgress<ToolProgressData>
      | ProgressMessage<HookProgress>
      | ToolBridgeEvent,
  ) => void
  run: (
    ctx: ToolUseContext,
    wrappedCanUseTool: CanUseToolFn,
    onProgress: (
      progress:
        | ToolProgress<ToolProgressData>
        | ProgressMessage<HookProgress>
        | ToolBridgeEvent,
    ) => void,
  ) => Promise<T>
}): Promise<{ detached: false; result: T } | { detached: true; text: string }> {
  const {
    tool,
    input,
    toolUseID,
    toolUseContext,
    canUseTool,
    onProgress,
    run,
  } = opts
  if (!canDetachToolCall(tool, input, toolUseContext)) {
    return {
      detached: false,
      result: await run(toolUseContext, canUseTool, onProgress),
    }
  }

  const session = toolUseContext.session!
  const detachAbortController = createAbortController()
  let inForeground = true
  let localPromptsUp = 0

  const onParentAbort = () => {
    if (inForeground && !detachAbortController.signal.aborted) {
      detachAbortController.abort(toolUseContext.abortController.signal.reason)
    }
  }
  if (toolUseContext.abortController.signal.aborted) {
    onParentAbort()
  } else {
    toolUseContext.abortController.signal.addEventListener(
      'abort',
      onParentAbort,
      { once: true },
    )
  }
  detachAbortController.signal.addEventListener(
    'abort',
    () => {
      if (inForeground && !toolUseContext.abortController.signal.aborted) {
        toolUseContext.abortController.abort(
          detachAbortController.signal.reason,
        )
      }
    },
    { once: true },
  )

  const wrappedCanUseTool: CanUseToolFn = async (
    targetTool,
    targetInput,
    targetCtx,
    parentMsg,
    targetId,
    forceDecision,
  ) => {
    localPromptsUp++
    const slot = toolUseContext.toolState?.get(ToolPermissionPromptsUp)
    if (slot) slot.count++
    try {
      return await canUseTool(
        targetTool,
        targetInput,
        targetCtx,
        parentMsg,
        targetId,
        forceDecision,
      )
    } finally {
      localPromptsUp--
      if (slot) slot.count = Math.max(0, slot.count - 1)
    }
  }

  let signalDetachEarly: (() => void) | undefined
  const detachEarly = new Promise<'detach'>(resolve => {
    signalDetachEarly = () => resolve('detach')
  })

  const unregisterForeground = registerForegroundToolCall(session, {
    toolUseId: toolUseID,
    backgroundNow: () => {
      if (
        !inForeground ||
        localPromptsUp > 0 ||
        detachAbortController.signal.aborted ||
        toolUseContext.abortController.signal.aborted ||
        areBackgroundTasksDisabled() ||
        isDetachPermissionDialogOpen(toolUseContext, toolUseID)
      ) {
        return false
      }
      inForeground = false
      detachedToolCallLetGo(toolUseID, session)
      signalDetachEarly?.()
      return true
    },
  })

  const callPromise = run(
    { ...toolUseContext, abortController: detachAbortController },
    wrappedCanUseTool,
    progress => {
      if (inForeground) onProgress(progress)
    },
  ).finally(() => {
    toolUseContext.abortController.signal.removeEventListener(
      'abort',
      onParentAbort,
    )
    unregisterForeground()
  })

  let race: 'settled' | 'detach'
  try {
    race = await Promise.race([
      callPromise.then(
        () => 'settled' as const,
        () => 'settled' as const,
      ),
      detachEarly,
    ])
  } finally {
    unregisterForeground()
  }

  if (race === 'settled' || toolUseContext.abortController.signal.aborted) {
    try {
      return { detached: false, result: await callPromise }
    } finally {
      detachedToolCallEnded(toolUseID, session)
    }
  }

  const isOnScreen = toolUseContext.options.isNonInteractiveSession !== true
  logEvent('tengu_tool_call_detached', {
    toolName: sanitizeToolNameForAnalytics(tool.name),
  })
  logForDebugging(
    `[detach] ${tool.name} ${toolUseID} moved to the background to deliver a message`,
  )
  detachedToolCallStarted(
    toolUseID,
    {
      tool,
      input,
      detachedAt: Date.now(),
    },
    reason => detachAbortController.abort(reason),
    session,
  )

  let ceilingHit = false
  const ceiling = setTimeout(() => {
    ceilingHit = true
    detachAbortController.abort('detached-ceiling')
  }, DETACH_CEILING_MS)
  ceiling.unref?.()

  const stillHeard = () => getDetachedToolCallSnapshot(session).has(toolUseID)

  void callPromise
    .finally(() => clearTimeout(ceiling))
    .then(res => {
      // densable dOt @188768350: any abort reason routes into the failure arm.
      if (detachAbortController.signal.aborted) {
        throw new AbortError()
      }
      return res
    })
    .then(
      async res => {
        // densable Zho: settle completed data into store BEFORE persistence so
        // in-place UI rendering retains `data` even if disk persistence fails.
        if (
          !detachedToolCallSettled(
            toolUseID,
            { status: 'completed', data: res.data },
            session,
          )
        ) {
          return
        }

        let text = ''
        let notifyStatus: 'completed' | 'failed' = 'completed'
        try {
          const mapped = tool.mapToolResultToToolResultBlockParam(
            res.data as never,
            toolUseID,
          )
          const block = await processPreMappedToolResultBlock(
            mapped,
            tool.name,
            tool.maxResultSizeChars ?? Number.POSITIVE_INFINITY,
          )
          if (!stillHeard()) return
          text = formatDetachedMappedContent(block?.content)
          if (block?.is_error === true) {
            notifyStatus = 'failed'
            if (
              !detachedToolCallSettled(
                toolUseID,
                { status: 'failed', text, data: res.data },
                session,
              )
            ) {
              return
            }
          } else if (escapeXml(text).length > DETACH_RESULT_CAP) {
            const saved = await persistToolResult(text, toolUseID)
            if (!stillHeard()) return
            if ('error' in saved) {
              notifyStatus = 'failed'
              text =
                'The call completed, but its result is too large to carry in a notification and could not be saved to a file.'
            } else {
              text = `The result is ${saved.originalSize} characters, too large to carry in a notification, so none of it is quoted here. ${saved.truncatedAtBytes === undefined ? 'All of it' : `Its first ${saved.truncatedAtBytes} bytes`} was saved to ${saved.filepath}. Read that file to see it.`
              detachedToolCallSetText(toolUseID, text, session)
            }
          } else {
            detachedToolCallSetText(toolUseID, text, session)
          }
        } catch {
          if (!stillHeard()) return
          notifyStatus = 'failed'
          text = 'The call completed but its result could not be rendered.'
        }

        if (!stillHeard()) return
        enqueueDetachedToolCallResult({
          toolName: tool.name,
          toolUseId: toolUseID,
          status: notifyStatus,
          text,
          isOnScreen,
        })
        detachedToolCallResultQueued(toolUseID, session)
      },
      (err: unknown) => {
        const ceilingAbort =
          ceilingHit ||
          detachAbortController.signal.reason === 'detached-ceiling'
        const userCancel =
          !ceilingAbort && detachAbortController.signal.reason === 'user-cancel'
        const text = ceilingAbort
          ? `The call did not finish within ${DETACH_CEILING_MS / 60000} minutes and was stopped.`
          : userCancel
            ? 'The user stopped this call before it finished.'
            : errorMessage(err)
        const status = userCancel ? 'stopped' : 'failed'
        if (!detachedToolCallSettled(toolUseID, { status, text }, session)) {
          return
        }
        enqueueDetachedToolCallResult({
          toolName: tool.name,
          toolUseId: toolUseID,
          status,
          text,
          isOnScreen,
          passive: userCancel,
        })
        detachedToolCallResultQueued(toolUseID, session)
      },
    )
    .finally(() => {
      detachedToolCallEnded(toolUseID, session)
    })

  return {
    detached: true,
    text: stillRunningDetachText(tool.name, isOnScreen),
  }
}

export function extractRemoteBackgroundTaskId(
  response: unknown,
): string | undefined {
  if (response === null || typeof response !== 'object') return undefined
  const rec = response as Record<string, unknown>
  if (typeof rec.backgroundTaskId === 'string') return rec.backgroundTaskId
  const envelope = rec.envelope
  if (envelope !== null && typeof envelope === 'object') {
    const output = (envelope as Record<string, unknown>).output
    if (output !== null && typeof output === 'object') {
      const id = (output as Record<string, unknown>).backgroundTaskId
      if (typeof id === 'string') return id
    }
  }
  const data = rec.data
  if (data !== null && typeof data === 'object') {
    const id = (data as { backgroundTaskId?: unknown }).backgroundTaskId
    if (typeof id === 'string') return id
  }
  const result = rec.result
  if (result !== null && typeof result === 'object') {
    const id = (result as { backgroundTaskId?: unknown }).backgroundTaskId
    if (typeof id === 'string') return id
  }
}

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

/** Requests left standing after their first deadline, keyed by request id. */
const standingRemoteTools = new Map<string, RemoteToolHeld>()

/** densable `h.held` — the standing request for this id, if it is still up. */
export function standingRemoteTool(
  requestId: string,
): RemoteToolHeld | undefined {
  return standingRemoteTools.get(requestId)
}

/**
 * densable `onHeldAtDeadline`. The tool_result is already timed_out.
 * `late` classifies the body that arrives on the same request and does
 * not replace that result. `outcome_of` cannot be taken back.
 */
/**
 * densable `Dge`. The sentence the user sees. `W`'s own detail stays in
 * the debug log.
 */
/** The text of a remote result, after densable `ae` rewrites an envelope. */
function remoteResultText(
  response: Record<string, unknown> | undefined,
  machine: { name: string; source: 'session' | 'bridge'; homeDir?: string },
): {
  content: string | Array<Record<string, unknown>>
  isError: boolean
  output?: Record<string, unknown>
} {
  const envelope = response?.envelope
  if (envelope !== null && typeof envelope === 'object') {
    const record = envelope as Record<string, unknown>
    const rewritten = remoteHostEnvelopeMessage(
      machine.name,
      machine.source,
      record,
      response?.content ?? response?.text,
      machine.homeDir,
    )
    if (rewritten !== undefined) {
      return rewritten
    }
    return {
      content: remoteHostUnreadableEnvelopeMessage(machine.name),
      isError: true,
    }
  }
  const raw =
    typeof response?.text === 'string'
      ? response.text
      : jsonStringify(response ?? {})
  if (response?.is_error === true) {
    return {
      content: remoteHostAnsweredErrorMessage(machine.name, raw),
      isError: true,
    }
  }
  return { content: raw, isError: false }
}

function remoteToolOutcomeMessage(
  sent: {
    kind: string
    detail?: string
    capMs?: number
    request?: 'probe' | 'call'
    takenBack?: boolean
    requestId?: string
    why?: string
    unsent?: boolean
    whyDropped?: 'write_unresolved' | 'unverified_refusal'
    machineNotAnswering?: boolean
    requestBytes?: number
    unreadableResult?: boolean
    left?: boolean
    misses?: number
    whileRunning?: boolean
  },
  machine: { name: string; source: 'session' | 'bridge'; homeDir?: string },
): string {
  const name = machine.name
  const capMs = sent.capMs ?? REMOTE_TOOL_DEADLINE_MS
  switch (sent.kind) {
    case 'timed_out':
      return remoteHostTimedOutMessage(name, capMs, sent.left === true)
    case 'stalled':
      if (sent.request === 'probe') {
        return remoteHostProbeStalledMessage(name, capMs)
      }
      return sent.takenBack
        ? remoteHostTakenBackMessage(name, capMs)
        : remoteHostQueuedWithdrawnMessage(name, capMs)
    case 'unreachable':
      return remoteHostUnreachableOutcome(
        name,
        sent.detail ?? '',
        machine.source,
        sent.machineNotAnswering === true,
      )
    case 'dropped':
      if (sent.whyDropped === 'unverified_refusal') {
        return remoteHostUnverifiedRefusalMessage(name)
      }
      return sent.whyDropped === 'write_unresolved'
        ? remoteHostWriteUnresolvedMessage(name)
        : remoteHostDisconnectedMessage(name)
    case 'host_gone':
      return remoteHostGoneMessage(
        name,
        sent.why ?? 'restarted',
        sent.unsent === true,
      )
    case 'host_unresponsive':
      return remoteHostUnresponsiveMessage(
        name,
        sent.misses ?? 3,
        sent.capMs ?? 10_000,
        sent.whileRunning === true,
      )
    case 'too_large':
      return remoteHostTooLargeMessage(
        name,
        sent.requestBytes ?? 0,
        REMOTE_TOOL_MAX_REQUEST_BYTES,
      )
    case 'transport_error':
      if (sent.unreadableResult === true) {
        return remoteHostUnreadableEnvelopeMessage(name)
      }
      return remoteHostTransitFailedMessage(name, sent.detail ?? 'send failed')
    default:
      return sent.detail ?? sent.kind
  }
}

function noteHeldRemoteTool(
  sent: { requestId?: string; capMs?: number; sentUnderEpoch?: string },
  toolName: string,
  withdrawable: boolean,
): void {
  if (!sent.requestId) return
  const holder = getCurrentStructuredIO()?.takeHeldRemoteTool(sent.requestId)
  if (!holder) return
  const requestId = sent.requestId
  const drop = () => {
    if (!requestId) return
    standingRemoteTools.delete(requestId)
  }
  const held: RemoteToolHeld = {
    late: classifyHeldBody(holder.late, {
      capMs: sent.capMs ?? REMOTE_TOOL_DEADLINE_MS,
      sentUnderEpoch: sent.sentUnderEpoch,
    }),
    withdraw: () => {
      drop()
      holder.withdraw()
    },
    takeBack: () => {
      if (!withdrawable) return false
      drop()
      return holder.takeBack()
    },
    accepted: () => holder.accepted(),
  }
  if (requestId) standingRemoteTools.set(requestId, held)
  void held.late.then(late => {
    const envelope = late.response?.envelope
    const outcome =
      envelope !== null && typeof envelope === 'object'
        ? (envelope as { outcome?: unknown; output_tail?: unknown })
        : undefined
    if (outcome?.outcome === 'in_progress') {
      const tail =
        typeof outcome.output_tail === 'string' ? outcome.output_tail : ''
      logForDebugging(
        `remote tool ${toolName} still running after its deadline: ${tail}`,
      )
    } else {
      logForDebugging(
        `remote tool ${toolName} answered after its deadline: ${late.kind}`,
      )
    }
    drop()
  })
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
  /** #1894: Context/permission layers emitted by tools (consumed by StreamingToolExecutor). */
  contextLayers?: {
    toolUseID: string
    layers: NonNullable<ToolUseContext['permissionLayers']>
  }
  toolDuration?: {
    toolName: string
    durationMs: number
  }
}

/** densable Ta @213400800 — persist oversized remote tool results & gate subagent toolUseResult. */
async function buildRemoteSuccessUserMessage(opts: {
  tool: Tool
  toolUseId: string
  rendered: ReturnType<typeof remoteResultText>
  assistantMessage: AssistantMessage
  toolUseContext: ToolUseContext
}): Promise<UserMessage> {
  const preMapped: ToolResultBlockParam = {
    type: 'tool_result',
    content: opts.rendered.content as ToolResultBlockParam['content'],
    is_error: opts.rendered.isError,
    tool_use_id: opts.toolUseId,
  }
  const processedBlock = opts.rendered.isError
    ? preMapped
    : await processPreMappedToolResultBlock(
        preMapped,
        opts.tool.name,
        opts.tool.maxResultSizeChars,
      )
  return createUserMessage({
    content: [processedBlock],
    toolUseResult: shouldPreserveManagedToolHookPass(
      opts.toolUseContext,
      opts.tool,
    )
      ? (opts.rendered.output ?? opts.rendered.content)
      : undefined,
    sourceToolAssistantUUID: opts.assistantMessage.uuid,
  })
}

function formatTerminalPeriod(words: string): string {
  const trimmed = words.trimEnd()
  return /[.!?\u2026]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

/** densable `_r` / `la` / `ua` @213391380 — subagent requireCanUseTool gate before remote dispatch. */
async function checkRemoteSubagentCallerGate(opts: {
  tool: Tool
  rawInput: Record<string, unknown>
  hostName: string
  source: 'session' | 'bridge'
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
  toolUseId: string
}): Promise<string | undefined> {
  if (
    opts.toolUseContext.requireCanUseTool !== true ||
    opts.toolUseContext.agentId === undefined
  ) {
    return undefined
  }
  const defaultDenial = `Permission to use ${opts.tool.name} has been denied`
  let words: string | undefined
  try {
    const decision = await opts.canUseTool(
      opts.tool,
      opts.rawInput,
      opts.toolUseContext,
      opts.assistantMessage,
      opts.toolUseId,
    )
    if (decision.behavior === 'allow') {
      if (
        decision.updatedInput === undefined ||
        decision.updatedInput === opts.rawInput ||
        isDeepStrictEqual(decision.updatedInput, opts.rawInput)
      ) {
        return undefined
      }
      words = `The permission check for ${opts.tool.name} modified its input, which this background agent cannot apply`
    } else {
      words = decision.message || defaultDenial
    }
  } catch (err) {
    if (
      err instanceof AbortError ||
      opts.toolUseContext.abortController.signal.aborted
    ) {
      throw err
    }
    logError(err)
    words = `The permission check for this ${opts.tool.name} call failed with an error, so the call was refused`
  }
  const formatted = formatTerminalPeriod(words)
  return opts.source === 'session'
    ? remoteHostRefusedByMessage(opts.hostName, formatted)
    : remoteHostRefusedUnrunMessage(opts.hostName, formatted)
}

function extractRemoteRejectionFeedback(
  decision: PermissionDecision,
): string | undefined {
  if (decision.behavior === 'allow') return undefined
  const raw = decision.message?.trim() ?? ''
  for (const prefix of [
    REJECT_MESSAGE_WITH_REASON_PREFIX,
    SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX,
  ]) {
    const trimmedPrefix = prefix.trim()
    if (raw.startsWith(trimmedPrefix)) {
      const rest = raw.slice(trimmedPrefix.length).trim()
      return rest === '' ? undefined : rest
    }
  }
  if (
    decision.behavior === 'deny' &&
    decision.decisionReason?.type === 'permissionPromptTool' &&
    raw !== '' &&
    raw !== 'User denied permission'
  ) {
    return raw
  }
  return undefined
}

/** densable `pa` @213394100 — force interactive approval for remote needs_approval. */
async function approveRemoteToolCall(opts: {
  tool: Tool
  hostName: string
  cleanInput: Record<string, unknown>
  askMessage: unknown
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  assistantMessage: AssistantMessage
  toolUseId: string
}): Promise<
  | { kind: 'refused'; detail: string }
  | {
      kind: 'approved'
      effectiveInput: Record<string, unknown>
      updatedInput?: Record<string, unknown>
      feedback?: string
    }
  | { kind: 'denied'; feedback?: string }
> {
  const { getToolPermissionContextFromLayers } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('../../engine/permissionLayerReaders.js') as typeof import('../../engine/permissionLayerReaders.js')
  const permissionCtx = getToolPermissionContextFromLayers(opts.toolUseContext)
  if (
    permissionCtx.mode === 'dontAsk' ||
    permissionCtx.shouldAvoidPermissionPrompts
  ) {
    const detail =
      permissionCtx.mode === 'dontAsk'
        ? `Permission to use ${opts.tool.name} has been denied because permission mode is dontAsk.`
        : `${opts.hostName} asked for approval, and this context cannot show a permission prompt; the call did not run.`
    return { kind: 'refused', detail }
  }
  const dialogInput: Record<string, unknown> =
    opts.tool.isMcp === true
      ? { ...opts.cleanInput }
      : { ...opts.cleanInput, [REMOTE_TOOL_HOST_FIELD]: opts.hostName }
  const askBody =
    typeof opts.askMessage === 'string' && opts.askMessage.trim() !== ''
      ? opts.askMessage.trim()
      : `Allow ${opts.tool.name}`
  const promptMessage = `(runs on ${opts.hostName}) ${askBody}`
  const forceDecision: PermissionDecision = {
    behavior: 'ask',
    message: promptMessage,
    decisionReason: { type: 'other', reason: promptMessage },
    suppressAlwaysAllowRule: true,
  }
  const promptTool =
    opts.tool.isMcp === true
      ? ({
          ...opts.tool,
          suppressesAlwaysAllowRule: () => true,
        } as Tool)
      : opts.tool
  const resolvedDecision = await opts.canUseTool(
    promptTool,
    dialogInput,
    opts.toolUseContext,
    opts.assistantMessage,
    opts.toolUseId,
    forceDecision,
  )
  const decision =
    detachedLetGoPermissionDeny(opts.toolUseId) ?? resolvedDecision
  if (decision.behavior === 'allow') {
    const edited = decision.updatedInput ?? {}
    const hostChanged =
      opts.tool.isMcp !== true &&
      REMOTE_TOOL_HOST_FIELD in edited &&
      requestedRemoteHost(edited) !== opts.hostName
    const newlyDisabledSandbox =
      edited.dangerouslyDisableSandbox === true &&
      opts.cleanInput.dangerouslyDisableSandbox !== true
    if (hostChanged || newlyDisabledSandbox) {
      return {
        kind: 'refused',
        detail: `The approval given in this session edited the ${opts.tool.name} call in a way ${opts.hostName} cannot honour (it named a different machine, or newly set a privileged field this session does not pass on in an edit); nothing ran.`,
      }
    }
    const { [REMOTE_TOOL_HOST_FIELD]: _dropHost, ...cleanEdited } = edited
    const hasEditedFields =
      Object.keys(cleanEdited).length > 0 &&
      !isDeepStrictEqual(cleanEdited, opts.cleanInput)
    const feedback =
      'acceptFeedback' in decision ? decision.acceptFeedback : undefined
    return {
      kind: 'approved',
      effectiveInput: hasEditedFields ? cleanEdited : opts.cleanInput,
      ...(hasEditedFields && { updatedInput: cleanEdited }),
      ...(feedback !== undefined && { feedback }),
    }
  }
  if (
    decision.behavior === 'deny' &&
    decision.decisionReason?.type === 'hook'
  ) {
    return { kind: 'refused', detail: decision.message }
  }
  const feedback = extractRemoteRejectionFeedback(decision)
  return {
    kind: 'denied',
    ...(feedback !== undefined && { feedback }),
  }
}

/**
 * densable `jR` @184467129 — `"type" in e`. Tool onProgress may enqueue a
 * control event (`set_expanded_view`, `set_in_progress_tool_use_ids`) that is
 * not a `{message}` update. Gold `ve`: `if(ze.type!=="progress") ye.enqueue(ze)`.
 */
export type ToolBridgeEvent = {
  type: string
  [key: string]: unknown
}

const TOOL_BRIDGE_TYPES = new Set([
  'set_expanded_view',
  'set_in_progress_tool_use_ids',
])

export function isToolBridgeEvent(update: object): update is ToolBridgeEvent {
  if (!('type' in update) || 'message' in update) return false
  const type = (update as { type: unknown }).type
  return typeof type === 'string' && TOOL_BRIDGE_TYPES.has(type)
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

const MCP_RESOURCE_TOOL_NAMES = new Set([
  'ListMcpResourcesTool',
  'ListMcpResources',
  'ReadMcpResourceTool',
  'ReadMcpResource',
  'ReadMcpResourceDirTool',
  'ReadMcpResourceDir',
])

/**
 * Official 2.1.326 #83 (`MYe`/`wdi` @299078597): Explain why an approved MCP
 * resource tool or MCP server tool is unavailable (for example after a cloud
 * session's worker was replaced).
 */
export function formatUnavailableMcpOrResourceToolHint(
  toolName: string,
  mcpClients: readonly MCPServerConnection[],
  agentId?: string,
): string {
  if (MCP_RESOURCE_TOOL_NAMES.has(toolName)) {
    const hasPending = mcpClients.some(c => c.type === 'pending')
    if (hasPending) {
      return agentId
        ? `. ${toolName} is not available in this context. Continue without this tool.`
        : `. ${toolName} is unavailable right now while MCP servers are still connecting; try again shortly.`
    }
    return `. ${toolName} is not among the tools available here. Continue with the tools you have.`
  }
  if (!toolName.startsWith('mcp__')) {
    return ''
  }
  const conn = findMcpServerConnection(
    toolName,
    mcpClients as MCPServerConnection[],
  )
  if (!conn) {
    return '. No MCP server in this session provides it; continue without this tool.'
  }
  switch (conn.type) {
    case 'pending':
      return agentId
        ? `. Its MCP server '${conn.name}' is not connected in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' is still connecting; try again shortly.`
    case 'needs-auth':
      return agentId
        ? `. Its MCP server '${conn.name}' is not available in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' needs the user to re-authorize it before its tools work again. Continue without this tool and tell the user if the task depends on it.`
    case 'disabled':
      return `. Its MCP server '${conn.name}' was disabled by the user. Continue without this tool.`
    case 'failed':
      return agentId
        ? `. Its MCP server '${conn.name}' is not available in this context. Continue without this tool.`
        : `. Its MCP server '${conn.name}' has disconnected. Continue without this tool; it becomes callable again only if the server reconnects.`
    case 'connected':
      return `. Its MCP server '${conn.name}' is connected but does not offer this tool here. Continue without it.`
    default:
      return '. No MCP server in this session provides it; continue without this tool.'
  }
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

  // densable `dr` / `lr`: forwarding off, or no machine name, stays local.
  // A resolved online machine that serves the tool is `W`. Anything else
  // is the route's own error (`sOn`, `zAt`, `cuo`).
  if (
    toolUseContext.toolState &&
    (tool.remoteExecution?.supported === true || tool.isMcp === true)
  ) {
    syncSessionRemoteHosts(toolUseContext.toolState, 'resolve')
    if (
      toolUseContext.options.mcpClients.some(
        client => client.name === 'remote-devices',
      )
    ) {
      await syncBridgeRemoteHosts(
        toolUseContext.toolState,
        'resolve',
        toolUseContext.options.mcpClients as unknown as DeviceBridgeMcpClient[],
      )
    }
  }

  const remoteHostsSlot = toolUseContext.toolState?.get(RemoteToolHosts)
  const resolveRoutedHostForTool = (
    host: RemoteToolRoutedHost,
    wireToolName: string,
    isPassthrough: boolean,
  ):
    | { kind: 'routed_host'; host: RemoteToolRoutedHost; wireToolName: string }
    | { kind: 'error'; message: string } => {
    if (host.status === 'offline' && host.source !== 'session') {
      return { kind: 'error', message: remoteHostOfflineMessage(host.name) }
    }
    if (host.protocol?.kind === 'incompatible') {
      return {
        kind: 'error',
        message: remoteHostIncompatibleMessage(
          host.name,
          host.protocol.announced,
          tool.name,
          isPassthrough,
          toolUseContext.toolState,
        ),
      }
    }
    if (host.rejectedPassthroughTools?.has(wireToolName) === true) {
      return {
        kind: 'error',
        message: remoteHostUnreadableToolMessage(host.name, tool.name),
      }
    }
    if (
      !isPassthrough &&
      host.servedTools !== undefined &&
      !host.servedTools.has(tool.name)
    ) {
      return {
        kind: 'error',
        message:
          host.servedTools.size === 0
            ? remoteHostServesNothingMessage(host.name)
            : remoteHostToolNotServedMessage(host.name, tool.name, [
                ...host.servedTools,
              ]),
      }
    }
    return { kind: 'routed_host', host, wireToolName }
  }

  let hostRoute:
    | ReturnType<typeof remoteHostRoute>
    | { kind: 'remote'; machine: AnnouncedRemoteMachine }
    | {
        kind: 'routed_host'
        host: RemoteToolRoutedHost
        wireToolName: string
      } = { kind: 'local' }
  const requestedHostName = requestedRemoteHost(toolUse.input)
  const adopting =
    tool.isMcp === true
      ? machineAdoptingMcpTool(tool.name, toolUseContext.toolState)
      : undefined
  if (adopting && requestedHostName === undefined) {
    hostRoute = { kind: 'remote', machine: adopting }
  } else if (
    tool.isMcp === true &&
    requestedHostName === undefined &&
    remoteHostsSlot &&
    isRemoteToolsForwardEnabled()
  ) {
    const mcpRawName = tool.mcpInfo?.toolName ?? tool.name
    const passEntry = remoteHostsSlot.passthroughHost(mcpRawName)
      ? { host: remoteHostsSlot.passthroughHost(mcpRawName)!, wire: mcpRawName }
      : remoteHostsSlot.passthroughHost(tool.name)
        ? {
            host: remoteHostsSlot.passthroughHost(tool.name)!,
            wire: tool.name,
          }
        : undefined
    if (passEntry) {
      hostRoute = resolveRoutedHostForTool(passEntry.host, passEntry.wire, true)
    }
  } else if (tool.remoteExecution?.supported === true) {
    const requested = requestedHostName
    const routedCandidate =
      requested !== undefined &&
      isRemoteToolsForwardEnabled() &&
      remoteHostsSlot !== undefined
        ? remoteHostsSlot.resolve(requested)
        : undefined
    if (
      routedCandidate?.kind === 'remote' &&
      routedCandidate.host.source !== 'session'
    ) {
      hostRoute = resolveRoutedHostForTool(
        routedCandidate.host,
        tool.name,
        false,
      )
    } else {
      const unknown =
        requested !== undefined &&
        isRemoteToolsForwardEnabled() &&
        resolveAnnouncedMachine(requested, toolUseContext.toolState).kind ===
          'unknown'
      if (unknown && requested !== undefined) {
        const already = announceWaitAlreadyExpired(toolUseContext.toolState)
        if (already !== undefined) {
          hostRoute = {
            kind: 'error',
            message: remoteHostGaveUpEarlierMessage(requested, already),
          }
        } else {
          // densable `Gbo` — only an unknown name waits.
          askRemoteToolsReannounce(
            request => {
              void getCurrentStructuredIO()?.requestRemoteToolsReannounce(
                request,
              )
            },
            REMOTE_ANNOUNCE_WAIT_MS,
            toolUseContext.toolState,
          )
          const waited = await waitForAnnouncedMachine(
            requested,
            toolUseContext.abortController.signal,
            REMOTE_ANNOUNCE_WAIT_MS,
            toolUseContext.toolState,
          )
          hostRoute =
            waited === 'gave_up'
              ? {
                  kind: 'error',
                  message: remoteHostGaveUpMessage(
                    requested,
                    announceWaitAlreadyExpired(toolUseContext.toolState) ?? 0,
                  ),
                }
              : remoteHostRoute(
                  toolUse.input,
                  tool.name,
                  getCurrentStructuredIO() !== undefined,
                  toolUseContext.toolState,
                )
        }
      } else {
        hostRoute = remoteHostRoute(
          toolUse.input,
          tool.name,
          getCurrentStructuredIO() !== undefined,
          toolUseContext.toolState,
        )
      }
    }
  }
  if (hostRoute.kind === 'error') {
    const detail = hostRoute.message
    logForDebugging(`remote tool ${toolName}: ${detail}`)
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

  if (hostRoute.kind === 'routed_host') {
    const { host, wireToolName } = hostRoute
    const hostSource: 'session' | 'bridge' =
      host.source === 'session' ? 'session' : 'bridge'
    const hostMeta = { name: host.name, source: hostSource }
    const rawInputRecord =
      toolUse.input !== null && typeof toolUse.input === 'object'
        ? (toolUse.input as Record<string, unknown>)
        : {}
    const { [REMOTE_TOOL_HOST_FIELD]: _stripHost, ...cleanInput } =
      rawInputRecord
    const ownershipRefusal = checkRemoteTaskStopOwnership(
      tool.name,
      cleanInput,
      host.name,
      hostSource,
      toolUseContext,
    )
    if (ownershipRefusal !== undefined) {
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>Error: ${ownershipRefusal}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: ownershipRefusal,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }
    const deadlineMs =
      host.transport.limits?.defaultDeadlineMs ?? REMOTE_TOOL_DEADLINE_MS
    if (REMOTE_PLUMBING_TOOLS.has(tool.name) && host.transport.callPlumbing) {
      const plumbing = await host.transport.callPlumbing(
        wireToolName,
        cleanInput,
        {
          signal: toolUseContext.abortController.signal,
          deadlineMs,
        },
      )
      if (plumbing?.kind === 'result') {
        const rendered = remoteResultText(
          {
            envelope: plumbing.envelope,
            content: plumbing.content,
            text: plumbing.text,
            is_error: plumbing.isError,
          },
          hostMeta,
        )
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return
      }
      const detail =
        plumbing?.kind === 'cancelled'
          ? REMOTE_HOST_INTERRUPTED
          : remoteToolOutcomeMessage(
              plumbing ?? { kind: 'unreachable' },
              hostMeta,
            )
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

    const callerRefusal = await checkRemoteSubagentCallerGate({
      tool,
      rawInput: rawInputRecord,
      hostName: host.name,
      source: hostSource,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseId: toolUse.id,
    })
    if (callerRefusal !== undefined) {
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>Error: ${callerRefusal}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: callerRefusal,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }

    let effectiveInput = cleanInput
    let sent = await host.transport.call(
      wireToolName,
      effectiveInput,
      { op: 'call', call_id: toolUse.id },
      {
        signal: toolUseContext.abortController.signal,
        deadlineMs,
        toolUseId: toolUse.id,
      },
    )
    let effectiveCallId = toolUse.id
    if (
      sent?.kind === 'result' &&
      sent.envelope &&
      typeof sent.envelope === 'object' &&
      sent.envelope.outcome === 'needs_approval'
    ) {
      const envRec = sent.envelope as Record<string, unknown>
      effectiveCallId =
        typeof envRec.call_id === 'string' ? envRec.call_id : toolUse.id
      const askObj =
        envRec.ask !== null && typeof envRec.ask === 'object'
          ? (envRec.ask as { message?: unknown })
          : undefined
      const approvalResult = await approveRemoteToolCall({
        tool,
        hostName: host.name,
        cleanInput,
        askMessage: askObj?.message ?? envRec.message,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseId: toolUse.id,
      })
      if (approvalResult.kind === 'refused') {
        yield {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: ${approvalResult.detail}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUse.id,
              },
            ],
            toolUseResult: approvalResult.detail,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        }
        return
      }
      const approved = approvalResult.kind === 'approved'
      if (approved) {
        effectiveInput = approvalResult.effectiveInput
      }
      sent = await host.transport.call(
        wireToolName,
        effectiveInput,
        {
          op: 'outcome_of',
          call_id: effectiveCallId,
          decision: approved ? 'allow' : 'deny',
          approval: approved
            ? {
                decision: 'allow',
                ...(approvalResult.updatedInput !== undefined && {
                  updated_input: approvalResult.updatedInput,
                }),
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              }
            : {
                decision: 'deny',
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              },
          ...(approved &&
            approvalResult.updatedInput !== undefined && {
              updatedInput: approvalResult.updatedInput,
            }),
          ...(approvalResult.feedback !== undefined && {
            feedback: approvalResult.feedback,
          }),
        },
        {
          signal: toolUseContext.abortController.signal,
          deadlineMs,
          toolUseId: toolUse.id,
        },
      )
    }
    if (sent?.kind === 'result') {
      const responsePayload = {
        envelope: sent.envelope,
        content: sent.content,
        text: sent.text,
        is_error: sent.isError,
      }
      rememberRemoteBackgroundShell(
        toolUseContext,
        effectiveInput,
        responsePayload,
        host.name,
        effectiveCallId,
      )
      const rendered = remoteResultText(responsePayload, hostMeta)
      yield {
        message: await buildRemoteSuccessUserMessage({
          tool,
          toolUseId: toolUse.id,
          rendered,
          assistantMessage,
          toolUseContext,
        }),
      }
      return
    }
    const detail =
      sent?.kind === 'cancelled'
        ? REMOTE_HOST_INTERRUPTED
        : sent?.kind === 'approval_unverified'
          ? remoteHostApprovalUnverifiedMessage(host.name)
          : remoteToolOutcomeMessage(sent ?? { kind: 'unreachable' }, hostMeta)
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

  if (hostRoute.kind === 'remote') {
    const machine = hostRoute.machine
    const inputRecord =
      toolUse.input !== null && typeof toolUse.input === 'object'
        ? (toolUse.input as Record<string, unknown>)
        : {}
    const ownershipRefusal = checkRemoteTaskStopOwnership(
      tool.name,
      inputRecord,
      machine.name,
      machine.source,
      toolUseContext,
    )
    if (ownershipRefusal !== undefined) {
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>Error: ${ownershipRefusal}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: ownershipRefusal,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }
    if (REMOTE_PLUMBING_TOOLS.has(tool.name)) {
      const plumbing = await callRemotePlumbing({
        host: {
          instanceId: machine.instanceId,
          hostName: machine.name,
          stale: machine.stale,
          live: { status: machine.status, lastHeardAt: machine.lastHeardAt },
        },
        name: tool.name,
        args: inputRecord,
        signal: toolUseContext.abortController.signal,
        send: request =>
          getCurrentStructuredIO()?.requestRemotePlumbingCall(request) ??
          Promise.resolve(undefined),
      })
      if (plumbing.kind === 'result') {
        const rendered = remoteResultText(plumbing.response, machine)
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return
      }
      const detail = remoteToolOutcomeMessage(plumbing, machine)
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
    const callerRefusal = await checkRemoteSubagentCallerGate({
      tool,
      rawInput: inputRecord,
      hostName: machine.name,
      source: machine.source,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseId: toolUse.id,
    })
    if (callerRefusal !== undefined) {
      yield {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>Error: ${callerRefusal}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUse.id,
            },
          ],
          toolUseResult: callerRefusal,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      }
      return
    }
    const sent = await callRemoteTool({
      host: {
        instanceId: machine.instanceId,
        hostName: machine.name,
        stale: machine.stale,
        live: { status: machine.status, lastHeardAt: machine.lastHeardAt },
      },
      name: tool.name,
      input: inputRecord,
      // densable leg 1 is op "call". call_id is this tool use, so a
      // later outcome_of can name the same call.
      envelope: { op: 'call', call_id: toolUse.id },
      toolUseId: toolUse.id,
      signal: toolUseContext.abortController.signal,
      sentUnderEpoch: machine.epoch,
      send: request =>
        getCurrentStructuredIO()?.requestRemoteToolCall(request, phase => {
          logForDebugging(
            phase === 'not_accepted' || phase === 'indeterminate'
              ? `remote tool ${toolName} post not accepted phase=${phase}`
              : `remote tool ${toolName} upload ${phase}`,
          )
        }) ?? Promise.resolve(undefined),
      probe: async () => {
        const io = getCurrentStructuredIO()
        if (!io) return 'unsent'
        const answer = await io.requestRemoteToolsProbe({
          instanceId: machine.instanceId,
          issuedAt: Date.now(),
          deadlineMs: REMOTE_TOOL_PROBE_CAP_MS,
        })
        const probe = classifyRemoteToolsProbe(answer)
        if (probe === 'answered') {
          const result = answer?.result
          const epoch =
            result !== null &&
            typeof result === 'object' &&
            typeof (result as { epoch?: unknown }).epoch === 'string'
              ? (result as { epoch: string }).epoch
              : undefined
          noteRemoteMachineHeard(
            machine.name,
            epoch,
            toolUseContext.toolState,
            machine.instanceId,
          )
        }
        return probe
      },
      onProbeMissed: () =>
        markRemoteMachineAway(
          machine.name,
          'probe_missed',
          toolUseContext.toolState,
          machine.instanceId,
        ),
      rebind: () => {
        const current = announcedRemoteMachines(toolUseContext.toolState).find(
          item => item.name === machine.name,
        )
        if (!current || current.instanceId === machine.instanceId) {
          return undefined
        }
        return {
          instanceId: current.instanceId,
          hostName: current.name,
          stale: current.stale,
          live: { status: current.status, lastHeardAt: current.lastHeardAt },
        }
      },
    })
    if (sent.kind === 'unreachable' || sent.kind === 'host_gone') {
      markRemoteMachineAway(
        machine.name,
        undefined,
        toolUseContext.toolState,
        machine.instanceId,
      )
    }
    if (sent.kind === 'timed_out') {
      noteHeldRemoteTool(sent, toolName, true)
      const standing = sent.requestId
        ? standingRemoteTool(sent.requestId)
        : undefined
      if (standing) {
        const checked = await checkStandingRemoteTool({
          held: standing,
          name: tool.name,
          callId: toolUse.id,
          signal: toolUseContext.abortController.signal,
          poll: envelope =>
            callRemoteTool({
              host: {
                instanceId: machine.instanceId,
                hostName: machine.name,
                stale: false,
                live: {
                  status: 'online',
                  lastHeardAt: Date.now(),
                },
              },
              name: tool.name,
              input: inputRecord,
              envelope,
              toolUseId: toolUse.id,
              signal: toolUseContext.abortController.signal,
              send: request =>
                getCurrentStructuredIO()?.requestRemoteToolCall(request) ??
                Promise.resolve(undefined),
            }),
        })
        if (checked.kind === 'result') {
          const rendered = remoteResultText(checked.response, machine)
          yield {
            message: await buildRemoteSuccessUserMessage({
              tool,
              toolUseId: toolUse.id,
              rendered,
              assistantMessage,
              toolUseContext,
            }),
          }
          return
        }
        const detail = remoteToolOutcomeMessage(checked, machine)
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
    }
    if (sent.kind === 'needs_approval') {
      const envelope =
        sent.response?.envelope !== null &&
        typeof sent.response?.envelope === 'object'
          ? (sent.response.envelope as {
              ask?: { message?: unknown }
              message?: unknown
              call_id?: unknown
            })
          : undefined
      const ask = envelope?.ask?.message ?? envelope?.message
      const callId =
        typeof envelope?.call_id === 'string' ? envelope.call_id : toolUse.id
      const { [REMOTE_TOOL_HOST_FIELD]: _dropHostField, ...cleanRemoteInput } =
        inputRecord
      const approvalResult = await approveRemoteToolCall({
        tool,
        hostName: machine.name,
        cleanInput: cleanRemoteInput,
        askMessage: ask,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseId: toolUse.id,
      })
      if (approvalResult.kind === 'refused') {
        yield {
          message: createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: ${approvalResult.detail}</tool_use_error>`,
                is_error: true,
                tool_use_id: toolUse.id,
              },
            ],
            toolUseResult: approvalResult.detail,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        }
        return
      }
      const approved = approvalResult.kind === 'approved'
      const effectiveRemoteInput = approved
        ? approvalResult.effectiveInput
        : cleanRemoteInput
      const again = await callRemoteTool({
        host: {
          instanceId: machine.instanceId,
          hostName: machine.name,
          stale: false,
          live: { status: 'online', lastHeardAt: Date.now() },
        },
        name: tool.name,
        input: effectiveRemoteInput,
        envelope: {
          op: 'outcome_of',
          call_id: callId,
          decision: approved ? 'allow' : 'deny',
          approval: approved
            ? {
                decision: 'allow',
                ...(approvalResult.updatedInput !== undefined && {
                  updated_input: approvalResult.updatedInput,
                }),
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              }
            : {
                decision: 'deny',
                ...(approvalResult.feedback !== undefined && {
                  feedback: approvalResult.feedback,
                }),
              },
          ...(approved &&
            approvalResult.updatedInput !== undefined && {
              updatedInput: approvalResult.updatedInput,
            }),
          ...(approvalResult.feedback !== undefined && {
            feedback: approvalResult.feedback,
          }),
        },
        toolUseId: toolUse.id,
        signal: toolUseContext.abortController.signal,
        send: request =>
          getCurrentStructuredIO()?.requestRemoteToolCall(request) ??
          Promise.resolve(undefined),
      })
      if (again.kind === 'timed_out') noteHeldRemoteTool(again, toolName, false)
      if (again.kind === 'result') {
        rememberRemoteBackgroundShell(
          toolUseContext,
          effectiveRemoteInput,
          again.response,
          machine.name,
          callId,
        )
        const rendered = remoteResultText(again.response, machine)
        yield {
          message: await buildRemoteSuccessUserMessage({
            tool,
            toolUseId: toolUse.id,
            rendered,
            assistantMessage,
            toolUseContext,
          }),
        }
        return
      }
      const detail = remoteToolOutcomeMessage(again, machine)
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
    if (sent.kind === 'result') {
      rememberRemoteBackgroundShell(
        toolUseContext,
        inputRecord,
        sent.response,
        machine.name,
        toolUse.id,
      )
      const rendered = remoteResultText(sent.response, machine)
      yield {
        message: await buildRemoteSuccessUserMessage({
          tool,
          toolUseId: toolUse.id,
          rendered,
          assistantMessage,
          toolUseContext,
        }),
      }
      return
    }
    if (sent.kind === 'cancelled') {
      const detail = REMOTE_HOST_INTERRUPTED
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
    {
      const detail = remoteToolOutcomeMessage(sent, machine)
      logForDebugging(
        `remote tool ${toolName} on ${machine.name}: ${sent.detail ?? sent.kind}`,
      )
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
    }
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
      const content = createToolResultStopMessage(toolUse.id)
      content.content = withMemoryCorrectionHint(CANCEL_MESSAGE)
      yield {
        message: createUserMessage({
          content: [content],
          toolUseResult: CANCEL_MESSAGE,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
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
    )) {
      yield update
    }
  } catch (error) {
    logError(error)
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

const SHADOWED_TOOL_KEYS_FIELD = '$shadowed'

const RESERVED_TOOL_CALL_ENVELOPE_KEYS = [
  'tool',
  'tool_use_id',
  'agentId',
  'consent',
  SHADOWED_TOOL_KEYS_FIELD,
] as const

const toolCallSite: FunctionHookHopSite = {
  restoreArgument: (passed, original) =>
    restorePinnedKeys(['agentId', SHADOWED_TOOL_KEYS_FIELD], passed, original),
  checkArgument: (passed, original) => {
    for (const key of RESERVED_TOOL_CALL_ENVELOPE_KEYS) {
      if (pinValue(passed[key]) !== pinValue(original[key])) {
        return `a changed ${key} (reserved)`
      }
    }
    return undefined
  },
}

type ToolCallCoreCapture = {
  output?: { value: unknown }
  synthesizedOutput?: { value: unknown }
  hookSynthesized?: {
    rawResult: unknown
    rawText: string | undefined
    priorRun: { messages: MessageUpdateLazy[] } | undefined
    undelivered: MessageUpdateLazy[]
  }
  lastCoreInput?: Record<string, unknown>
  detached?: boolean
  durationMs?: number
  isReadOnly?: boolean
  /** densable DVt `e.deny` — tool.call wrap deny, not permission Error:. */
  deny?: string
  /** densable Iyo `rL(e.context)` */
  context?: string[]
}

function isEmptyRecord(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
}

/**
 * Official 2.1.328 `G3s` (`chunk@294254613.js @4849870`): validate
 * permission-handler `updatedInput` against `tool.inputSchema` while ignoring
 * `unrecognized_keys` — MUST NOT strip trusted internal keys such as
 * `_simulatedSedEdit` set by permission handlers.
 */
export function validateUpdatedInputAgainstSchema(
  tool: Tool,
  updatedInput: Record<string, unknown>,
): { ok: true } | { ok: false; formatted: string; issueCodes: string[] } {
  const parsed = tool.inputSchema.safeParse(updatedInput)
  if (parsed.success) {
    return { ok: true }
  }
  const remainingIssues = parsed.error.issues.filter(
    issue => issue.code !== 'unrecognized_keys',
  )
  if (remainingIssues.length === 0) {
    return { ok: true }
  }
  const issueCodes = Array.from(
    new Set(remainingIssues.map(issue => String(issue.code))),
  )
  return {
    ok: false,
    formatted: formatZodValidationError(
      tool.name,
      new z.ZodError(remainingIssues),
    ),
    issueCodes,
  }
}

const EXIT_PLAN_MODE_STRIP_KEYS = new Set(['plan', 'planFilePath'])

/**
 * Official 2.1.328 `XUo` (`chunk@294254613.js @1163532, @4868654`): preserve
 * trusted permission-handler `updatedInput` (including internal keys like
 * `_simulatedSedEdit`), only stripping unchanged `ExitPlanMode` `plan` /
 * `planFilePath` fields when present identically on `originalInput`.
 */
export function applyPermissionUpdatedInput(
  toolName: string,
  updatedInput: Record<string, unknown>,
  originalInput: Record<string, unknown>,
): Record<string, unknown> {
  if (
    toolName !== 'ExitPlanMode' ||
    (isDisklessLaunch() && !Object.hasOwn(originalInput, 'planFilePath'))
  ) {
    return updatedInput
  }
  let shouldStrip = false
  for (const key of Object.keys(updatedInput)) {
    if (
      EXIT_PLAN_MODE_STRIP_KEYS.has(key) &&
      key in originalInput &&
      updatedInput[key] === originalInput[key]
    ) {
      shouldStrip = true
      break
    }
  }
  if (!shouldStrip) return updatedInput
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(updatedInput)) {
    if (
      EXIT_PLAN_MODE_STRIP_KEYS.has(key) &&
      key in originalInput &&
      val === originalInput[key]
    ) {
      continue
    }
    out[key] = val
  }
  return out
}

function sanitizeHookUpdatedInputSync(
  tool: Tool,
  updatedInput: Record<string, unknown>,
):
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; message: string } {
  const schemaCheck = validateUpdatedInputAgainstSchema(tool, updatedInput)
  if (!schemaCheck.ok) {
    return {
      ok: false,
      message: `PreToolUse hook for ${tool.name} returned updatedInput that failed schema validation: ${schemaCheck.formatted}`,
    }
  }
  if (
    Object.keys(updatedInput).some(k =>
      k.toLowerCase().startsWith('__artifact'),
    )
  ) {
    return {
      ok: false,
      message: `PreToolUse hook for ${tool.name} returned updatedInput with a key starting with "__artifact" (in any letter case). Only Claude Code sets such keys. Remove the key from updatedInput. The tool was not run.`,
    }
  }
  const parsed = tool.inputSchema.safeParse(updatedInput)
  if (parsed.success) {
    return {
      ok: true,
      input:
        parsed.data !== null &&
        typeof parsed.data === 'object' &&
        !Array.isArray(parsed.data)
          ? (parsed.data as Record<string, unknown>)
          : updatedInput,
    }
  }
  const cleaned: Record<string, unknown> = { ...updatedInput }
  for (const issue of parsed.error.issues) {
    if (issue.code === 'unrecognized_keys' && 'keys' in issue) {
      for (const key of issue.keys) {
        delete cleaned[key]
      }
    }
  }
  return { ok: true, input: cleaned }
}

;(runToolUse as unknown as Record<symbol, unknown>)[
  RUN_TOOL_USE_HANDLES_DETACH
] = true

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function buildToolCallHookInput(
  toolName: string,
  toolUseID: string,
  rawInput: Record<string, unknown>,
  agentId: string | undefined,
): Record<string, unknown> {
  const shadowed: Record<string, unknown> = {}
  let hasShadowed = false
  for (const key of RESERVED_TOOL_CALL_ENVELOPE_KEYS) {
    if (Object.hasOwn(rawInput, key)) {
      shadowed[key] = rawInput[key]
      hasShadowed = true
    }
  }
  const { consent: _consent, agentId: _agentId, ...rest } = rawInput
  return {
    ...rest,
    tool: toolName,
    tool_use_id: toolUseID,
    ...(hasShadowed && { [SHADOWED_TOOL_KEYS_FIELD]: shadowed }),
    ...(agentId !== undefined && { agentId }),
  }
}

function extractToolInputFromHookEvent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  const {
    tool: _tool,
    tool_use_id: _toolUseId,
    agentId: _agentId,
    consent: _consent,
    [SHADOWED_TOOL_KEYS_FIELD]: shadowed,
    ...rest
  } = event
  if (isPlainRecord(shadowed)) {
    return { ...rest, ...shadowed }
  }
  return rest
}

function findToolResultBlockInUpdate(
  update: MessageUpdateLazy,
  toolUseID: string,
): ToolResultBlockParam | undefined {
  const msg = update.message
  if (msg.type !== 'user') {
    return undefined
  }
  const userMsg = msg as UserMessage
  const content = userMsg.message.content
  if (typeof content === 'string' || !Array.isArray(content)) {
    return undefined
  }
  for (const block of content) {
    if (block.type === 'tool_result' && block.tool_use_id === toolUseID) {
      return block
    }
  }
  return undefined
}

function formatToolResultBlockText(
  content: ToolResultBlockParam['content'],
): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .flatMap(part =>
      typeof part === 'object' && part !== null && part.type === 'text'
        ? [String(part.text ?? '')]
        : [],
    )
    .join('\n')
}

function extractToolResultSummary(
  updates: readonly MessageUpdateLazy[],
  toolUseID: string,
): { text: string; isError?: true } {
  for (const update of updates) {
    const block = findToolResultBlockInUpdate(update, toolUseID)
    if (block) {
      return {
        text: formatToolResultBlockText(block.content),
        ...(block.is_error === true && { isError: true as const }),
      }
    }
  }
  return { text: '' }
}

function extractToolUseResultFromMessages(
  updates: readonly MessageUpdateLazy[],
): unknown {
  for (const { message } of updates) {
    if (message.type === 'user' && message.toolUseResult !== undefined) {
      return message.toolUseResult
    }
  }
  return undefined
}

/** Skip is_error tool_result so permission deny `Error:` is not kce'd (gold DVt). */
function extractSuccessfulToolUseResult(
  updates: readonly MessageUpdateLazy[],
): unknown {
  for (const { message } of updates) {
    if (message.type !== 'user') continue
    const content = message.message?.content
    if (
      Array.isArray(content) &&
      content.some(
        block => block.type === 'tool_result' && block.is_error === true,
      )
    ) {
      continue
    }
    if (message.toolUseResult !== undefined) {
      return message.toolUseResult
    }
  }
  return undefined
}

function buildToolCallDenyMessages(
  toolUseID: string,
  reason: string,
  assistantUUID: AssistantMessage['uuid'],
): MessageUpdateLazy[] {
  return [
    {
      message: createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${reason}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseID,
          },
        ],
        toolUseResult: `Error: ${reason}`,
        sourceToolAssistantUUID: assistantUUID,
      }),
    },
  ]
}

function rebuildMessagesWithReplacedToolResult(
  priorRun: { messages: MessageUpdateLazy[] } | undefined,
  toolUseID: string,
  newBlock: ToolResultBlockParam,
  toolUseResult: unknown,
  assistantUUID: AssistantMessage['uuid'],
): MessageUpdateLazy[] {
  if (!priorRun) {
    return [
      {
        message: createUserMessage({
          content: [newBlock],
          toolUseResult,
          sourceToolAssistantUUID: assistantUUID,
        }),
      },
    ]
  }
  const existingIdx = priorRun.messages.findIndex(
    update => findToolResultBlockInUpdate(update, toolUseID) !== undefined,
  )
  const rawExistingMsg =
    existingIdx !== -1 ? priorRun.messages[existingIdx]?.message : undefined
  const existingUserMsg =
    rawExistingMsg?.type === 'user'
      ? (rawExistingMsg as UserMessage)
      : undefined
  const existingContextModifier =
    existingIdx !== -1
      ? priorRun.messages[existingIdx]?.contextModifier
      : undefined
  const existingContextLayers =
    existingIdx !== -1
      ? priorRun.messages[existingIdx]?.contextLayers
      : undefined
  const contentBlocks: ContentBlockParam[] =
    existingUserMsg !== undefined &&
    Array.isArray(existingUserMsg.message.content)
      ? existingUserMsg.message.content.map(block =>
          block.type === 'tool_result' && block.tool_use_id === toolUseID
            ? newBlock
            : block,
        )
      : [newBlock]
  const replacedEntry: MessageUpdateLazy = {
    message: createUserMessage({
      content: contentBlocks,
      imagePasteIds: existingUserMsg?.imagePasteIds,
      mcpMeta: existingUserMsg?.mcpMeta,
      toolEndsTurn: existingUserMsg?.toolEndsTurn,
      toolUseResult,
      sourceToolAssistantUUID: assistantUUID,
    }),
    ...(existingContextModifier !== undefined && {
      contextModifier: existingContextModifier,
    }),
    ...(existingContextLayers !== undefined && {
      contextLayers: existingContextLayers,
    }),
  }
  const remaining = priorRun.messages.filter((_, idx) => idx !== existingIdx)
  return [replacedEntry, ...remaining]
}

const MANAGED_PRE_TOOL_RANK = { none: 0, allow: 1, ask: 2, deny: 3 } as const

function aggregateManagedPreToolPass(
  yields: Array<{
    permissionBehavior?: string
    hookPermissionDecisionReason?: string
    blockingError?: { blockingError: string; command: string }
    updatedInput?: Record<string, unknown>
    additionalContexts?: string[]
  }>,
  tool: Tool,
): ManagedHookPass['result'] {
  let kind: keyof typeof MANAGED_PRE_TOOL_RANK = 'none'
  let reason: string | undefined
  let updatedInput: Record<string, unknown> | undefined
  let additionalContext: string[] | undefined
  for (const item of yields) {
    if (item.blockingError) {
      kind = 'deny'
      reason = getPreToolHookBlockingMessage(
        `PreToolUse:${tool.name}`,
        item.blockingError,
      )
    }
    if (item.updatedInput !== undefined && !isEmptyRecord(item.updatedInput)) {
      const hookCheck = sanitizeHookUpdatedInputSync(tool, item.updatedInput)
      if (!hookCheck.ok) {
        logForDebugging(hookCheck.message, { level: 'warn' })
        kind = 'deny'
        reason = hookCheck.message
        continue
      }
      updatedInput = hookCheck.input
    }
    switch (item.permissionBehavior) {
      case 'deny':
        if (MANAGED_PRE_TOOL_RANK[kind] < MANAGED_PRE_TOOL_RANK.deny) {
          kind = 'deny'
          reason = item.hookPermissionDecisionReason ?? 'denied'
        }
        break
      case 'ask':
        if (MANAGED_PRE_TOOL_RANK[kind] < MANAGED_PRE_TOOL_RANK.ask) {
          kind = 'ask'
          reason = item.hookPermissionDecisionReason ?? ''
        }
        break
      case 'allow':
        if (MANAGED_PRE_TOOL_RANK[kind] < MANAGED_PRE_TOOL_RANK.allow) {
          kind = 'allow'
        }
        break
      default:
        break
    }
    if (item.additionalContexts && item.additionalContexts.length > 0) {
      additionalContext = [
        ...(additionalContext ?? []),
        ...item.additionalContexts,
      ]
    }
  }
  const result: ManagedHookPass['result'] = {}
  if (kind === 'deny') result.deny = reason
  if (kind === 'ask') result.ask = reason
  if (kind === 'allow') result.allow = true
  if (updatedInput && kind !== 'deny') result.updatedInput = updatedInput
  if (additionalContext) result.additionalContext = additionalContext
  return result
}

/** densable Rq(zTe(..., {managedHooksOnly:!0})) */
async function drainManagedPreToolUse(
  tool: Tool,
  toolUseID: string,
  input: { [key: string]: boolean | string | number },
  toolUseContext: ToolUseContext,
): Promise<ManagedHookPass> {
  const yields: ManagedHookPass['yields'] = []
  const permissionMode = toolUseContext.getAppState().toolPermissionContext.mode
  for await (const item of executePreToolHooks(
    tool.name,
    toolUseID,
    input,
    toolUseContext,
    permissionMode,
    toolUseContext.abortController.signal,
    undefined,
    undefined,
    undefined,
    { managedHooksOnly: true },
  )) {
    yields.push(item)
  }
  const result = aggregateManagedPreToolPass(
    yields as Parameters<typeof aggregateManagedPreToolPass>[0],
    tool,
  )
  // densable Uat: decisions, rewrites and context live in result; only
  // diagnostics, stops and deferrals are replayed as yields.
  const replayYields: unknown[] = []
  for (const item of yields as Array<Record<string, unknown>>) {
    const {
      permissionBehavior,
      hookPermissionDecisionReason: _reason,
      heldForServedCall: _held,
      blockingError: _blocking,
      updatedInput: _input,
      additionalContexts: _contexts,
      ...rest
    } = item
    if (permissionBehavior === 'defer') {
      replayYields.push({ permissionBehavior, hookSource: rest.hookSource })
    }
    if (Object.keys(rest).some(key => key !== 'hookSource'))
      replayYields.push(rest)
  }
  return { result, yields: replayYields }
}

async function dispatchToolCallCore(
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
    progress:
      | ToolProgress<ToolProgressData>
      | ProgressMessage<HookProgress>
      | ToolBridgeEvent,
  ) => void,
  toolCallCapture?: ToolCallCoreCapture,
): Promise<MessageUpdateLazy[]> {
  if (!isInsideAgentSpawnLaunch() && hasMatchingFunctionHook('tool.call')) {
    const rawCoerced = tool.coerceInput
      ? tool.coerceInput(input)?.input
      : undefined
    const baseInput = isPlainRecord(rawCoerced) ? rawCoerced : input
    const toolCallEnvelope = buildToolCallHookInput(
      tool.name,
      toolUseID,
      baseInput,
      toolUseContext.agentId,
    )
    if (
      hasMatchingFunctionHook('tool.call', toolCallEnvelope) ||
      hasMatchingFunctionHook('tool.call', { tool: tool.name })
    ) {
      type CoreRunEntry = {
        input: Record<string, unknown>
        messages: MessageUpdateLazy[]
        result: unknown
      }
      const coreRuns: CoreRunEntry[] = []
      let coreThrown: { error: unknown } | undefined
      let rawChainOut: unknown
      try {
        rawChainOut = await runFunctionHookChain(
          'tool.call',
          toolCallEnvelope,
          async event => {
            const rewrittenInput = extractToolInputFromHookEvent(event)
            const capture: ToolCallCoreCapture = {}
            try {
              const messages = await checkPermissionsAndCallTool(
                tool,
                toolUseID,
                rewrittenInput as { [key: string]: boolean | string | number },
                toolUseContext,
                canUseTool,
                assistantMessage,
                messageId,
                requestId,
                mcpServerType,
                mcpServerBaseUrl,
                onToolProgress,
                capture,
              )
              const resultValue = capture.output
                ? capture.output.value
                : extractToolUseResultFromMessages(messages)
              if (toolCallCapture) {
                toolCallCapture.lastCoreInput = rewrittenInput
                if (capture.output) {
                  toolCallCapture.output = capture.output
                  toolCallCapture.durationMs = capture.durationMs
                }
              }
              const summary = extractToolResultSummary(messages, toolUseID)
              const ref = coreRuns.push({
                input: rewrittenInput,
                messages,
                result: resultValue,
              })
              return {
                ref,
                result: resultValue,
                ...summary,
                ...(capture.isReadOnly && { isReadOnly: true }),
              }
            } catch (err) {
              coreThrown = { error: err }
              throw err
            }
          },
          undefined,
          undefined,
          {
            signal: toolUseContext.abortController.signal,
            site: toolCallSite,
            // densable `$Ot` — `withoutModuleHandlers: s.options.settingsHooksOff ? true : void 0`
            ...(toolUseContext.options.settingsHooksOff === true
              ? { withoutModuleHandlers: true as const }
              : {}),
          },
        )
      } catch (err) {
        if (
          coreThrown !== undefined ||
          err instanceof AbortError ||
          toolUseContext.abortController.signal.aborted
        ) {
          throw err
        }
        logForDebugging(
          `tool.call ${tool.name} ${toolUseID}: hook dispatch threw (${errorMessage(err)}); running tool`,
        )
        return (
          coreRuns.at(-1)?.messages ??
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
            onToolProgress,
          )
        )
      }

      const out = isPlainRecord(rawChainOut) ? rawChainOut : {}
      const matchedRun =
        typeof out.ref === 'number' ? coreRuns[out.ref - 1] : undefined
      let keptCoreResult =
        matchedRun !== undefined &&
        (out.result === undefined ||
          out.result === matchedRun.result ||
          pinValue(out.result) === pinValue(matchedRun.result))
      const accountMemoryImpersonated =
        !keptCoreResult &&
        out.deny === undefined &&
        tool.mcpInfo?.accountMemory === true
      if (accountMemoryImpersonated) {
        logForDebugging(
          `tool.call ${tool.name} ${toolUseID}: a hooks module answered for the account memory server; its answer was dropped`,
          { level: 'warn' },
        )
      }
      const effectiveRun = keptCoreResult
        ? matchedRun
        : accountMemoryImpersonated
          ? coreRuns.at(-1)
          : undefined
      if (effectiveRun !== undefined) {
        keptCoreResult = true
      }
      const undeliveredManagedMessages = (): MessageUpdateLazy[] => {
        const pass = toolUseContext.managedPass?.pass
        if (!pass || coreRuns.length > 0 || coreThrown !== undefined) return []
        const outMsgs: MessageUpdateLazy[] = []
        if (pass.result.additionalContext?.length) {
          outMsgs.push({
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: pass.result.additionalContext,
              hookName: `PreToolUse:${tool.name}`,
              toolUseID,
              hookEvent: 'PreToolUse',
            }),
          })
        }
        for (const item of pass.yields as Array<{
          message?: Message
          preventContinuation?: boolean
          stopReason?: string
        }>) {
          if (
            item.message !== undefined &&
            item.message.type !== 'progress' &&
            !(
              item.message.type === 'attachment' &&
              item.message.attachment?.type === 'hook_blocking_error'
            )
          ) {
            outMsgs.push({ message: item.message })
          }
          if (item.preventContinuation) {
            outMsgs.push({
              message: createAttachmentMessage({
                type: 'hook_stopped_continuation',
                message:
                  item.stopReason || 'Execution stopped by PreToolUse hook',
                hookName: `PreToolUse:${tool.name}`,
                toolUseID,
                hookEvent: 'PreToolUse',
              }),
            })
          }
        }
        return outMsgs
      }
      if (accountMemoryImpersonated && effectiveRun === undefined) {
        return [
          ...undeliveredManagedMessages(),
          ...buildToolCallDenyMessages(
            toolUseID,
            'A plugin hook answered a call to the account memory server in place of the server; the call is refused.',
            assistantMessage.uuid,
          ),
        ]
      }
      // densable DVt @189565200: if (!ve) log hook-resolved without core.
      if (!keptCoreResult) {
        logForDebugging(
          `tool.call ${tool.name} ${toolUseID}: resolved by a hooks module (` +
            (out.deny === undefined ? 'result' : `deny: ${out.deny}`) +
            ')',
        )
      }
      if (typeof out.deny === 'string') {
        if (toolCallCapture) {
          toolCallCapture.deny = out.deny
        }
        return [
          ...undeliveredManagedMessages(),
          ...buildToolCallDenyMessages(
            toolUseID,
            out.deny,
            assistantMessage.uuid,
          ),
        ]
      }

      let finalMessages: MessageUpdateLazy[]
      if (keptCoreResult && effectiveRun !== undefined) {
        if (toolCallCapture) {
          toolCallCapture.lastCoreInput = effectiveRun.input
        }
        finalMessages = [...effectiveRun.messages]
      } else if (
        toolCallCapture !== undefined &&
        toolUseContext.managedPass !== undefined
      ) {
        // densable DVt @189565600: run managed PostToolUse (kce) BEFORE outputSchema.safeParse!
        toolCallCapture.hookSynthesized = {
          rawResult: out.result,
          rawText: typeof out.text === 'string' ? out.text : undefined,
          priorRun: matchedRun ?? coreRuns.at(-1),
          undelivered: undeliveredManagedMessages(),
        }
        finalMessages = []
      } else {
        let replacementResult = out.result
        if (tool.outputSchema) {
          const parsedOut = tool.outputSchema.safeParse(replacementResult)
          if (!parsedOut.success) {
            const shapeErr = `tool.call step resolved ${tool.name} with a result that does not match its output shape: ${parsedOut.error.message}`
            return buildToolCallDenyMessages(
              toolUseID,
              shapeErr,
              assistantMessage.uuid,
            )
          }
          replacementResult = parsedOut.data
        }
        let mappedBlock: ToolResultBlockParam
        if (replacementResult === undefined) {
          mappedBlock = {
            type: 'tool_result',
            tool_use_id: toolUseID,
            content: typeof out.text === 'string' ? out.text : '',
          }
        } else {
          try {
            mappedBlock = await processToolResultBlock(
              tool,
              replacementResult,
              toolUseID,
            )
          } catch {
            mappedBlock = {
              type: 'tool_result',
              tool_use_id: toolUseID,
              content:
                typeof out.text === 'string'
                  ? out.text
                  : typeof replacementResult === 'string'
                    ? replacementResult
                    : jsonStringify(replacementResult),
            }
          }
        }
        const preserveResult = shouldPreserveManagedToolHookPass(
          toolUseContext,
          tool,
        )
        if (toolCallCapture) {
          toolCallCapture.synthesizedOutput = {
            value:
              replacementResult !== undefined
                ? replacementResult
                : typeof out.text === 'string'
                  ? out.text
                  : '',
          }
        }
        finalMessages = [
          ...undeliveredManagedMessages(),
          ...rebuildMessagesWithReplacedToolResult(
            matchedRun ?? coreRuns.at(-1),
            toolUseID,
            mappedBlock,
            preserveResult ? replacementResult : undefined,
            assistantMessage.uuid,
          ),
        ]
      }

      const contextEntries = listOfContextTexts(out.context)
      if (toolCallCapture && contextEntries !== undefined) {
        toolCallCapture.context = contextEntries
      }
      return finalMessages
    }
  }

  return checkPermissionsAndCallTool(
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
    onToolProgress,
    toolCallCapture,
  )
}

/** densable n2o / Iyo — rlt first, then kce messages minus duplicate attachments. */
async function appendToolCallContextKce(
  messages: MessageUpdateLazy[],
  opts: {
    tool: Tool
    toolUseID: string
    nextInput: { [key: string]: boolean | string | number }
    toolUseContext: ToolUseContext
    context: string[] | undefined
    skip: boolean
    managedRan?: boolean
  },
): Promise<MessageUpdateLazy[]> {
  if (opts.skip || !opts.context || opts.context.length === 0) {
    return messages
  }
  // densable Iyo `!managedRan()` → `[...s, rlt(await kcn(g, "tool.call"))]`
  if (opts.managedRan === false) {
    const packed = await packToolCallContext(opts.context)
    return packed.length === 0
      ? messages
      : [
          ...messages,
          {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: packed,
              hookName: 'tool.call',
              toolUseID: `${opts.toolUseID}-context`,
              hookEvent: 'PostToolUse',
            }),
          },
        ]
  }
  const stopped = [...messages].some(
    update =>
      update.message?.type === 'attachment' &&
      update.message.attachment?.type === 'hook_stopped_continuation',
  )
  const kce = await collectManagedOnlyPostToolUse({
    tool: opts.tool,
    toolUseID: opts.toolUseID,
    toolInput: opts.nextInput as Record<string, unknown>,
    output: opts.context,
    toolUseContext: opts.toolUseContext,
  })
  const rewrite = {
    rewritten: kce.rewritten,
    output: kce.output,
    messages: kce.messages,
  }
  const stoppedAfter =
    stopped ||
    rewrite.messages.some(
      update =>
        update.message?.type === 'attachment' &&
        update.message.attachment?.type === 'hook_stopped_continuation',
    )
  const rewritten = stoppedAfter
    ? undefined
    : rewrittenToolCallContext(opts.context, rewrite)
  const packed =
    rewritten !== undefined && rewritten.length > 0
      ? await packToolCallContext(rewritten)
      : []
  const priorPins = new Set(
    messages.flatMap(update => {
      const message = update.message
      return message?.type === 'attachment'
        ? [pinHookAttachment(message.attachment)]
        : []
    }),
  )
  const rlt =
    packed.length > 0
      ? [
          {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: packed,
              hookName: 'tool.call',
              toolUseID: `${opts.toolUseID}-context`,
              hookEvent: 'PostToolUse',
            }),
          },
        ]
      : []
  const kceMessages = rewrite.messages.filter(update => {
    const message = update.message
    if (message?.type !== 'attachment') {
      return true
    }
    return !priorPins.has(pinHookAttachment(message.attachment))
  })
  return [...messages, ...rlt, ...kceMessages]
}

/** densable AVt — managed PreToolUse before core, managedPass on the clone. */
async function dispatchCheckPermissionsAndCallTool(
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
    progress:
      | ToolProgress<ToolProgressData>
      | ProgressMessage<HookProgress>
      | ToolBridgeEvent,
  ) => void,
): Promise<MessageUpdateLazy[]> {
  const capture: ToolCallCoreCapture = {}
  let managedRan = false
  const runCore = (
    nextInput: { [key: string]: boolean | string | number },
    ctx: ToolUseContext,
  ) =>
    dispatchToolCallCore(
      tool,
      toolUseID,
      nextInput,
      ctx,
      canUseTool,
      assistantMessage,
      messageId,
      requestId,
      mcpServerType,
      mcpServerBaseUrl,
      onToolProgress,
      capture,
    )

  if (
    toolUseContext.options.settingsHooksOff === true ||
    toolUseContext.options.bareFork === true ||
    (tool.mcpInfo === undefined && tool.name === END_CONVERSATION_TOOL_NAME)
  ) {
    return runCore(input, toolUseContext)
  }

  const drained = await drainManagedPreToolUse(
    tool,
    toolUseID,
    input,
    toolUseContext,
  )
  const earlyDenyReason =
    drained.result.deny !== undefined
      ? drained.result.deny
      : didAccountMemoryHookRewriteInput(
            tool,
            input,
            drained.result.updatedInput,
          )
        ? accountMemoryHookRewriteDenied(tool, 'PreToolUse', 'policySettings')
            .message
        : undefined
  if (earlyDenyReason !== undefined) {
    // Official 2.1.326 #28 (@299097904): When a PreToolUse hook in managed
    // settings refuses a direct tool call, still emit the OTel `tool_decision`
    // event, code-edit decision counter, analytics rejection event, and
    // `permission_denials` / `onPermissionDenial` entry.
    if (!toolUseContext.abortController.signal.aborted) {
      const managedDecisionReason = {
        type: 'hook' as const,
        hookName: `PreToolUse:${tool.name}`,
        hookSource: 'policySettings' as const,
        reason: earlyDenyReason,
      }
      const source = decisionReasonToOTelSource(managedDecisionReason, 'deny')
      if (!toolUseContext.toolDecisions?.has(toolUseID)) {
        toolUseContext.toolDecisions?.set(toolUseID, {
          source,
          decision: 'reject',
          timestamp: Date.now(),
        })
        void logOTelEvent('tool_decision', {
          decision: 'reject',
          source,
          tool_name: sanitizeToolNameForAnalytics(tool.name),
          tool_use_id: toolUseID,
          ...toolSourceAttributes(
            tool.mcpInfo ? { serverType: mcpServerType } : undefined,
          ),
        })
        if (isCodeEditingTool(tool.name)) {
          void buildCodeEditToolAttributes(tool, input, 'reject', source).then(
            attributes => getCodeEditToolDecisionCounter()?.add(1, attributes),
          )
        }
      }
      const ctxWithDenials = toolUseContext as ToolUseContext & {
        onPermissionDenial?: (
          deniedTool: Tool,
          deniedToolUseId: string,
          deniedToolInput: Record<string, unknown>,
        ) => void
        permissionDenials?: Array<{
          tool_name: string
          tool_use_id: string
          tool_input: Record<string, unknown>
        }>
      }
      ctxWithDenials.onPermissionDenial?.(tool, toolUseID, input)
      ctxWithDenials.permissionDenials?.push({
        tool_name: tool.name,
        tool_use_id: toolUseID,
        tool_input: input,
      })
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
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
      })
    }
    const messages = buildToolCallDenyMessages(
      toolUseID,
      earlyDenyReason,
      assistantMessage.uuid,
    )
    // A managed refusal never reaches the core PreToolUse consumer.
    // Preserve the stop signal on that early-return path as well (SEA lHs).
    const stoppedYields = (
      drained.yields as Array<{
        preventContinuation?: boolean
        stopReason?: string
      }>
    ).filter(item => item.preventContinuation === true)
    if (
      stoppedYields.length > 0 &&
      !toolUseContext.abortController.signal.aborted
    ) {
      const lastStopReason = stoppedYields.findLast(
        item => item.stopReason,
      )?.stopReason
      messages.push({
        message: createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message:
            lastStopReason || earlyDenyReason || 'Execution stopped by hook',
          hookName: `PreToolUse:${tool.name}`,
          toolUseID,
          hookEvent: 'PreToolUse',
        }),
      })
    }
    return messages
  }

  const nextInput = (drained.result.updatedInput ?? input) as typeof input
  const managedPass: ToolCallManagedPass = {
    toolUseId: toolUseID,
    input: nextInput,
    inputKey: () => pinValue(nextInput),
    pass: drained,
  }
  managedRan = true
  const ctx: ToolUseContext = { ...toolUseContext, managedPass }
  try {
    const messages = await runCore(nextInput, ctx)
    const effectiveHookInput = (capture.lastCoreInput ??
      nextInput) as typeof input

    // densable DVt @189565600 + dlt @187739800: when tool.call resolved without
    // keeping a core run, managed PostToolUse (kce) runs BEFORE outputSchema.safeParse!
    if (capture.hookSynthesized !== undefined) {
      const synth = capture.hookSynthesized
      const kce = await collectManagedOnlyPostToolUse({
        tool,
        toolUseID,
        toolInput: effectiveHookInput as Record<string, unknown>,
        output: synth.rawResult,
        toolUseContext,
        durationMs: capture.durationMs,
      })
      let candidateOutput: unknown = kce.output
      if (tool.outputSchema) {
        const parsedOut = tool.outputSchema.safeParse(candidateOutput)
        if (!parsedOut.success) {
          const shapeErr = `${kce.rewritten ? 'a managed PostToolUse hook rewrote' : 'tool.call step resolved'} ${tool.name} with a result that does not match its output shape: ${parsedOut.error.message}`
          return appendToolCallContextKce(
            [
              ...synth.undelivered,
              ...buildToolCallDenyMessages(
                toolUseID,
                shapeErr,
                assistantMessage.uuid,
              ),
              ...kce.messages,
            ],
            {
              tool,
              toolUseID,
              nextInput: effectiveHookInput,
              toolUseContext,
              context: capture.context,
              skip: false,
              managedRan,
            },
          )
        }
        candidateOutput = parsedOut.data
      }
      let mappedBlock: ToolResultBlockParam
      if (candidateOutput === undefined) {
        mappedBlock = {
          type: 'tool_result',
          tool_use_id: toolUseID,
          content: kce.rewritten ? '' : (synth.rawText ?? ''),
        }
      } else {
        try {
          mappedBlock = await processToolResultBlock(
            tool,
            candidateOutput,
            toolUseID,
          )
        } catch (err) {
          if (kce.rewritten) {
            const shapeErr = `a managed PostToolUse hook rewrote ${tool.name} with a result that does not match its output shape: ${errorMessage(err)}`
            return appendToolCallContextKce(
              [
                ...synth.undelivered,
                ...buildToolCallDenyMessages(
                  toolUseID,
                  shapeErr,
                  assistantMessage.uuid,
                ),
                ...kce.messages,
              ],
              {
                tool,
                toolUseID,
                nextInput: effectiveHookInput,
                toolUseContext,
                context: capture.context,
                skip: false,
                managedRan,
              },
            )
          }
          mappedBlock = {
            type: 'tool_result',
            tool_use_id: toolUseID,
            content:
              synth.rawText ??
              (typeof candidateOutput === 'string'
                ? candidateOutput
                : jsonStringify(candidateOutput)),
          }
        }
      }
      const preserveResult = shouldPreserveManagedToolHookPass(
        toolUseContext,
        tool,
      )
      const built = [
        ...synth.undelivered,
        ...rebuildMessagesWithReplacedToolResult(
          synth.priorRun,
          toolUseID,
          mappedBlock,
          preserveResult ? candidateOutput : undefined,
          assistantMessage.uuid,
        ),
        ...kce.messages,
      ]
      return appendToolCallContextKce(built, {
        tool,
        toolUseID,
        nextInput: effectiveHookInput,
        toolUseContext,
        context: capture.context,
        skip: false,
        managedRan,
      })
    }

    if (!shouldPreserveManagedToolHookPass(toolUseContext, tool)) {
      return appendToolCallContextKce(messages, {
        tool,
        toolUseID,
        nextInput: effectiveHookInput,
        toolUseContext,
        context: capture.context,
        skip: capture.deny !== undefined,
        managedRan,
      })
    }
    const coreOutput = capture.output?.value
    // Official 2.1.328 (#667): managed PostToolUse hooks must NOT fire for
    // tool calls refused before they ran (`!reachedTool && !isHooksAnswer`):
    // no log entry, rewrite, block, or stop there.
    if (capture.deny !== undefined) {
      return messages
    }
    const output = capture.detached
      ? undefined
      : (coreOutput ??
        capture.synthesizedOutput?.value ??
        extractSuccessfulToolUseResult(messages))
    if (output === undefined) {
      return appendToolCallContextKce(messages, {
        tool,
        toolUseID,
        nextInput: effectiveHookInput,
        toolUseContext,
        context: capture.context,
        skip: false,
        managedRan,
      })
    }
    const kce = await collectManagedOnlyPostToolUse({
      tool,
      toolUseID,
      toolInput: effectiveHookInput as Record<string, unknown>,
      output,
      toolUseContext,
      durationMs: capture.durationMs,
    })
    let nextMessages = messages
    if (kce.rewritten) {
      let rewrittenOutput: unknown = kce.output
      if (tool.outputSchema) {
        const parsedOut = tool.outputSchema.safeParse(rewrittenOutput)
        if (!parsedOut.success) {
          const shapeErr = `a managed PostToolUse hook rewrote ${tool.name} with a result that does not match its output shape: ${parsedOut.error.message}`
          return appendToolCallContextKce(
            [
              ...buildToolCallDenyMessages(
                toolUseID,
                shapeErr,
                assistantMessage.uuid,
              ),
              ...kce.messages,
            ],
            {
              tool,
              toolUseID,
              nextInput: effectiveHookInput,
              toolUseContext,
              context: capture.context,
              skip: false,
              managedRan,
            },
          )
        }
        rewrittenOutput = parsedOut.data
      }
      try {
        const mapped = await processToolResultBlock(
          tool,
          rewrittenOutput,
          toolUseID,
        )
        const preserveResult = shouldPreserveManagedToolHookPass(
          toolUseContext,
          tool,
        )
        nextMessages = rebuildMessagesWithReplacedToolResult(
          { messages },
          toolUseID,
          mapped,
          preserveResult ? rewrittenOutput : undefined,
          assistantMessage.uuid,
        )
      } catch (err) {
        const shapeErr = `a managed PostToolUse hook rewrote ${tool.name} with a result that does not match its output shape: ${errorMessage(err)}`
        return appendToolCallContextKce(
          [
            ...buildToolCallDenyMessages(
              toolUseID,
              shapeErr,
              assistantMessage.uuid,
            ),
            ...kce.messages,
          ],
          {
            tool,
            toolUseID,
            nextInput: effectiveHookInput,
            toolUseContext,
            context: capture.context,
            skip: false,
            managedRan,
          },
        )
      }
    }
    return appendToolCallContextKce([...nextMessages, ...kce.messages], {
      tool,
      toolUseID,
      nextInput: effectiveHookInput,
      toolUseContext,
      context: capture.context,
      skip: false,
      managedRan,
    })
  } finally {
    ctx.managedPass = undefined
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
): AsyncIterable<MessageUpdateLazy | ToolBridgeEvent> {
  // This is a bit of a hack to get progress events and final results
  // into a single async iterable.
  //
  // Ideally the progress reporting and tool call reporting would
  // be via separate mechanisms.
  const stream = new Stream<MessageUpdateLazy | ToolBridgeEvent>()
  dispatchCheckPermissionsAndCallTool(
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
      if (isToolBridgeEvent(progress)) {
        stream.enqueue(progress)
        return
      }
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
          // densable 2.1.219 #6: nested agent_progress may carry its own
          // parentToolUseID (depth-2+). Prefer that over the current tool_use id.
          parentToolUseID:
            (progress as { parentToolUseID?: string }).parentToolUseID ??
            toolUseID,
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
  // densable Nzy optimistic gating — prevent pointing at ToolSearch that
  // isn't callable; occasional misfires (Haiku, tst-auto below threshold)
  // cost one extra round-trip on an already-failing path.
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  if (!isSearchExtraToolsToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null

  // densable: load via ToolSearch select, then call the tool directly.
  return (
    ` This tool's schema was not sent to the API — it was not in the discovered-tool set derived from message history. ` +
    `Without the schema in your prompt, typed parameters (arrays, numbers, booleans) get emitted as strings and the client-side parser rejects them. ` +
    `Load the tool first: call ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:${tool.name}", then retry this call.`
  )
}

const MAX_NOT_LOADED_SCHEMA_CHARS = 8000

export type NotLoadedMcpToolFamily =
  | 'browser'
  | 'computer_use'
  | 'simulator'
  | 'linked_computer'
  | 'plugin'

const BROWSER_MCP_TOOL_PREFIXES = [
  'mcp__claude-in-chrome__',
  'mcp__Claude_in_Chrome__',
  'mcp__remote-devices__claude-in-chrome__',
  'mcp__remote-devices__Claude_in_Chrome__',
  'mcp__claude-device__chrome_',
  'mcp__Claude_Preview__',
  'mcp__Claude_Browser__',
  'mcp__remote-devices__Claude_Browser__',
  'mcp__remote-devices__Claude_Preview__',
  'mcp__claude-for-chrome__',
  'mcp__remote-devices__claude-for-chrome__',
] as const

const SIMULATOR_MCP_TOOL_PREFIXES = [
  'mcp__Claude_Code_iOS_Simulator__',
  'mcp__remote-devices__Claude_Code_iOS_Simulator__',
  'mcp__Claude_Code_Android_Emulator__',
  'mcp__remote-devices__Claude_Code_Android_Emulator__',
] as const

const LINKED_COMPUTER_MCP_TOOL_NAMES = new Set([
  'mcp__remote-devices__device_commit_files',
  'mcp__remote-devices__device_bash',
  'mcp__remote-devices__create_artifact',
  'mcp__remote-devices__list_artifacts',
  'mcp__remote-devices__list_legacy_live_artifacts',
  'mcp__remote-devices__update_artifact',
])

const REMOTE_DEVICES_PREFIX = 'mcp__remote-devices__'
const REMOTE_DEVICES_PLUGIN_PREFIX = 'mcp__remote-devices__plugin_'

function isBrowserMcpToolName(name: string): boolean {
  return BROWSER_MCP_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isComputerUseMcpToolName(name: string): boolean {
  if (name.startsWith('mcp__computer-use__')) return true
  if (!name.startsWith(REMOTE_DEVICES_PREFIX)) return false
  const rest = name.slice(REMOTE_DEVICES_PREFIX.length)
  return (
    rest.startsWith('computer_') &&
    !rest.startsWith('computer__') &&
    !rest.includes('__')
  )
}

function isSimulatorMcpToolName(name: string): boolean {
  return SIMULATOR_MCP_TOOL_PREFIXES.some(prefix => name.startsWith(prefix))
}

function isLinkedComputerMcpTool(tool: Tool): boolean {
  if (tool.isMcp !== true) return false
  const serverName = tool.mcpInfo?.serverName
  if (serverName !== 'remote-devices') return false
  return (
    LINKED_COMPUTER_MCP_TOOL_NAMES.has(tool.name) ||
    tool.name.startsWith(REMOTE_DEVICES_PLUGIN_PREFIX)
  )
}

function isPluginMcpToolSurfacedInMessages(
  toolName: string,
  messages: Message[],
): boolean {
  return messages.some(msg => {
    if (msg.type !== 'attachment') return false
    const attachment = (msg as { attachment?: Record<string, unknown> })
      .attachment
    if (
      !attachment ||
      attachment.type !== 'deferred_tools_delta' ||
      attachment.toolSearchAbsent === true
    ) {
      return false
    }
    const surfaced = attachment.surfacedNames
    return Array.isArray(surfaced) && surfaced.includes(toolName)
  })
}

/**
 * Official 2.1.328 `EWe` + `rri` (`chunk@294254613.js @2828693, @4846960`):
 * Classify an MCP tool into one of the 5 families subject to `TOOL_NOT_LOADED`
 * enforcement (`browser`, `computer_use`, `simulator`, `linked_computer`,
 * `plugin`). Ordinary third-party MCP tools return `undefined`.
 */
export function classifyNotLoadedMcpToolFamily(
  tool: Tool,
  messages: Message[] = [],
): NotLoadedMcpToolFamily | undefined {
  if (tool.isMcp !== true) return undefined
  const name = tool.name
  if (isBrowserMcpToolName(name)) return 'browser'
  if (isComputerUseMcpToolName(name)) return 'computer_use'
  if (isSimulatorMcpToolName(name)) return 'simulator'
  if (isLinkedComputerMcpTool(tool)) return 'linked_computer'
  const source = (tool.mcpInfo as { source?: string } | undefined)?.source
  if (
    source === 'plugin' &&
    (tool.alwaysLoad === true ||
      tool.shouldDefer === true ||
      isPluginMcpToolSurfacedInMessages(name, messages))
  ) {
    return 'plugin'
  }
  return undefined
}

/**
 * Official 2.1.328 `W3s` / `EWe` (`chunk@294254613.js @2828693, @4846960`):
 * intercept unloaded MCP tool calls strictly for the 5 official `EWe` families
 * (`browser`, `computer_use`, `simulator`, `linked_computer`, `plugin`),
 * returning `TOOL_NOT_LOADED` guidance instead of blocking arbitrary user MCP
 * servers.
 */
export function checkMcpToolNotLoaded(
  tool: Tool,
  messages: Message[],
  tools: readonly { name: string }[],
): { enforced: true; family: NotLoadedMcpToolFamily; message: string } | null {
  const family = classifyNotLoadedMcpToolFamily(tool, messages)
  if (family === undefined) return null
  if (!isSearchExtraToolsEnabledOptimistic()) return null
  if (!isSearchExtraToolsToolAvailable(tools)) return null
  if (!isDeferredTool(tool)) return null
  const discovered = extractDiscoveredToolNames(messages)
  if (discovered.has(tool.name)) return null

  let schemaHint = ''
  if (tool.inputJSONSchema !== undefined) {
    try {
      const serialized = jsonStringify(tool.inputJSONSchema)
      if (serialized.length <= MAX_NOT_LOADED_SCHEMA_CHARS) {
        schemaHint = `\n\nThe input schema is: ${serialized}`
      }
    } catch {
      // ignore unserializable schema
    }
  }
  return {
    enforced: true,
    family,
    message: `Tool "${tool.name}" has not been loaded yet. Call ${SEARCH_EXTRA_TOOLS_TOOL_NAME} with query "select:${tool.name}" to load the tool, then call it again.${schemaHint}`,
  }
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
    progress:
      | ToolProgress<ToolProgressData>
      | ProgressMessage<HookProgress>
      | ToolBridgeEvent,
  ) => void,
  toolCallCapture?: ToolCallCoreCapture,
): Promise<MessageUpdateLazy[]> {
  // Official 2.1.328 `W3s`/`EWe`: intercept unloaded EWe-family MCP tools before validation/execution
  const notLoaded = checkMcpToolNotLoaded(
    tool,
    toolUseContext.messages,
    toolUseContext.options.tools,
  )
  if (notLoaded?.enforced) {
    logEvent('tengu_tool_use_not_loaded', {
      enforced: true,
      family:
        notLoaded.family as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: true,
    })
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        'TOOL_NOT_LOADED' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: true,
    })
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${notLoaded.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: notLoaded.message,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // 2.1.323 #2198: refuse escaped \uXXXX / JSON-text inputs on browser MCP tools
  const browserInputErr = validateBrowserToolInput(tool, input)
  if (browserInputErr !== null) {
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode:
        browserInputErr.errorCode as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      isMcp: tool.isMcp ?? false,
    })
    return [
      {
        message: createUserMessage({
          content: [
            {
              type: 'tool_result',
              content: `<tool_use_error>${browserInputErr.message}</tool_use_error>`,
              is_error: true,
              tool_use_id: toolUseID,
            },
          ],
          toolUseResult: browserInputErr.message,
          sourceToolAssistantUUID: assistantMessage.uuid,
        }),
      },
    ]
  }

  // densable: coerceInput (legacy aliases / soft truncates) then safeParse.
  // SendMessage Cpr=200 summary truncate lands here via shapeClass truncate_summary.
  let parseTarget: unknown = input
  let coerceMeta: { shapeClass: string; resultNote?: string } | null = null
  if (tool.coerceInput) {
    const coerced = tool.coerceInput(input)
    if (coerced !== null) {
      parseTarget = coerced.input
      coerceMeta = {
        shapeClass: coerced.shapeClass,
        ...(coerced.resultNote !== undefined
          ? { resultNote: coerced.resultNote }
          : {}),
      }
    }
  }
  const parsedInput = tool.inputSchema.safeParse(parseTarget)
  if (coerceMeta) {
    logEvent('tengu_tool_input_coerced', {
      toolName: sanitizeToolNameForAnalytics(tool.name),
      shapeClass:
        coerceMeta.shapeClass as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      outcome: (parsedInput.success
        ? 'coerced_valid'
        : 'coerced_still_invalid') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
  }
  if (!parsedInput.success) {
    let errorContent = formatZodValidationError(tool.name, parsedInput.error)

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
    logEvent('tengu_tool_use_error', {
      error:
        'InputValidationError' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorDetails: errorContent.slice(
        0,
        2000,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
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

  // densable `xd` reads `_host` before schema parse. strictObject strips
  // the field, so put a real machine name back for validateInput.
  const namedHost = requestedRemoteHost(input)
  const validateTarget =
    namedHost !== undefined &&
    parsedInput.data !== null &&
    typeof parsedInput.data === 'object'
      ? { ...parsedInput.data, [REMOTE_TOOL_HOST_FIELD]: namedHost }
      : parsedInput.data

  // Validate input values. Each tool has its own validation logic
  const isValidCall = await tool.validateInput?.(validateTarget, toolUseContext)
  if (isValidCall?.result === false) {
    logForDebugging(
      `${tool.name} tool validation error: ${isValidCall.message?.slice(0, 200)}`,
    )
    logEvent('tengu_tool_use_error', {
      messageID:
        messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName: sanitizeToolNameForAnalytics(tool.name),
      error:
        isValidCall.message as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      errorCode: isValidCall.errorCode,
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
    // densable bn: sticky permission layers for speculative classifier mode
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getToolPermissionContextFromLayers } =
      require('../../engine/permissionLayerReaders.js') as typeof import('../../engine/permissionLayerReaders.js')
    startSpeculativeClassifierCheck(
      (parsedInput.data as BashToolInput).command,
      getToolPermissionContextFromLayers(toolUseContext),
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
        resultingMessages.push(result.message)
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
  // densable bn: sticky permission_mode layers
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getToolPermissionContextFromLayers: bnPermissionContext } =
    require('../../engine/permissionLayerReaders.js') as typeof import('../../engine/permissionLayerReaders.js')
  const permissionMode = bnPermissionContext(toolUseContext).mode
  const permissionStart = Date.now()

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

    resultingMessages.push({
      message: createUserMessage({
        content: messageContent,
        imagePasteIds: rejectImageIds,
        toolUseResult: `Error: ${errorMessage}`,
        sourceToolAssistantUUID: assistantMessage.uuid,
      }),
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
      if (
        hookSaysRetry &&
        !permissionDecision.decisionReason.noVerdict &&
        !(permissionDecision.behavior === 'deny' && permissionDecision.endsTurn)
      ) {
        resultingMessages.push({
          message: createUserMessage({
            content:
              'The PermissionDenied hook indicated you may retry this tool call.',
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
    ) as typeof processedInput
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
    const deriveAllowGivenByApprover = (
      decision: PermissionDecision,
    ): 'user' | 'classifier' | 'auto_mode' | 'hook' | undefined => {
      const reason =
        decision.behavior === 'allow' ? decision.decisionReason : undefined
      switch (reason?.type) {
        case 'permissionPromptTool':
          return 'user'
        case 'classifier':
          return reason.classifier === 'auto-mode' &&
            (reason as { classifierAllowed?: boolean }).classifierAllowed ===
              true
            ? 'classifier'
            : undefined
        case 'mode':
          return reason.mode === 'auto' &&
            (reason as { denialLimitRun?: boolean }).denialLimitRun !== true &&
            (reason as { scriptCheckDeferred?: boolean })
              .scriptCheckDeferred !== true
            ? 'auto_mode'
            : undefined
        case 'hook':
          return 'hook'
        default:
          return undefined
      }
    }

    const runPostPermissionCall = async (
      callCtx: ToolUseContext,
      callCanUseTool: CanUseToolFn,
      progressFn: typeof onToolProgress,
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
          callCanUseTool,
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
      const durationMs = Date.now() - startTime
      if (toolCallCapture) {
        toolCallCapture.detached = true
        toolCallCapture.durationMs = durationMs
      }
      addToToolDuration(durationMs)
      endToolExecutionSpan({ success: true })
      endToolSpan('[detached]')
      const toolResultSizeBytes = callOutcome.text.length
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
        ...mcpToolDetailsForAnalytics(
          tool.name,
          mcpServerType,
          mcpServerBaseUrl,
        ),
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
          content: callOutcome.text,
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
          allowImageIds = Array.from(
            { length: imageCount },
            (_, i) => startId + i,
          )
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
      pushPreToolUsePreventContinuation(
        stopReason || 'Execution stopped by hook',
      )
      return resultingMessages
    }
    const result = callOutcome.result
    const durationMs = Date.now() - startTime
    if (toolCallCapture) toolCallCapture.durationMs = durationMs
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
      result.data &&
      typeof result.data === 'object' &&
      'stdout' in result.data
    ) {
      const isBgOrInterrupted =
        ('backgroundTaskId' in result.data &&
          Boolean(result.data.backgroundTaskId)) ||
        ('interrupted' in result.data && result.data.interrupted === true)
      const gitCommitId = await resolveGitCommitIdForTelemetry(
        processedInput.command,
        String(result.data.stdout),
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

    // Run PostToolUse hooks
    let toolOutput = result.data
    const hookResults = []
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
      const toolResultBlock = appendCoerceResultNoteToToolResultBlock(
        rawToolResultBlock,
        coerceMeta?.resultNote,
      )

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
    if (result.newMessages && result.newMessages.length > 0) {
      for (const message of result.newMessages) {
        resultingMessages.push({ message })
      }
    }
    // densable success path: I&&!aborted → LKr
    pushPreToolUsePreventContinuation(stopReason || 'Execution stopped by hook')

    if (toolCallCapture) {
      toolCallCapture.output = { value: toolOutput }
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
      durationMs,
    )) {
      hookMessages.push(hookResult)
    }

    // densable catch: after error tool_result + PostToolUseFailure hooks,
    // still LKr when continue:false and not abort — halt must not be dropped
    // when the tool fails mid-stream.
    const errorMessages = [
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
  } finally {
    stopToolHeartbeat()
    stopSessionActivity('tool_exec', sessionActivityAgentId)
    // Clean up decision info after logging
    if (decisionInfo) {
      toolUseContext.toolDecisions?.delete(toolUseID)
    }
  }
}

const GIT_COMMIT_COMMAND_RE =
  /\bgit(?:\s+-[cC]\s+\S+|\s+--[^\s=]+=\S+)*\s+commit\b/
const GIT_DASH_C_RE = /\bgit\s+(?:-\S+\s+)*-C\s+("([^"]+)"|'([^']+)'|(\S+))/

/** Official `hZi` (2.1.296 #529) — matches `git commit` and `git -C <dir> commit`. */
export function isGitCommitCommand(command: string): boolean {
  return GIT_COMMIT_COMMAND_RE.test(command)
}

/** Resolve target git working directory when `-C <dir>` is passed. */
export function resolveGitCommitCwd(
  command: string,
  baseCwd: string | null,
): string | null {
  const m = command.match(GIT_DASH_C_RE)
  const dir = m?.[2] ?? m?.[3] ?? m?.[4]
  if (!dir) return baseCwd
  return baseCwd ? resolvePath(baseCwd, dir) : dir
}

/**
 * Official `gZi` + `WEn` (2.1.296 #529) — parse `git_commit_id` from stdout,
 * falling back to `getHeadForDir(targetCwd)` when `git commit -q` emits no stdout,
 * and expanding short SHAs to full HEAD SHA when they prefix-match.
 */
export async function resolveGitCommitIdForTelemetry(
  command: string,
  stdout: string,
  baseCwd: string | null,
  isBackgroundOrInterrupted = false,
  getHeadFn: (cwd: string) => Promise<string | null> = getHeadForDir,
): Promise<string | undefined> {
  const targetCwd = resolveGitCommitCwd(command, baseCwd)
  const parsedSha = parseGitCommitId(stdout)
  if (!parsedSha) {
    if (isBackgroundOrInterrupted || !targetCwd) return undefined
    const head = await getHeadFn(targetCwd).catch(() => null)
    return head ?? undefined
  }
  if (!targetCwd) return parsedSha
  const head = await getHeadFn(targetCwd).catch(() => null)
  return head?.startsWith(parsedSha) ? head : parsedSha
}

function boundedEditDistance(a: string, b: string, maxDist: number): number {
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const curr = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const val = Math.min(
        (prev[j] ?? maxDist + 1) + 1,
        (curr[j - 1] ?? maxDist + 1) + 1,
        (prev[j - 1] ?? maxDist + 1) + cost,
      )
      curr[j] = val
      if (val < rowMin) rowMin = val
    }
    if (rowMin > maxDist) return maxDist + 1
    prev = curr
  }
  return prev[b.length] ?? maxDist + 1
}

const UUID_LIKE_CONNECTOR_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseMcpServerAndTool(
  name: string,
): { serverName: string; toolName: string } | null {
  if (!name.startsWith('mcp__')) return null
  const rest = name.slice(5)
  const sep = rest.indexOf('__')
  if (sep <= 0) return null
  return { serverName: rest.slice(0, sep), toolName: rest.slice(sep + 2) }
}

function inputFitsSchemaProperties(
  tool: {
    inputJSONSchema?: {
      properties?: Record<string, unknown>
      required?: string[]
    }
  },
  input: unknown,
): boolean {
  const props = tool.inputJSONSchema?.properties
  if (props === undefined) return true
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return false
  }
  const keys = Object.keys(input as Record<string, unknown>)
  return keys.every(k => Object.hasOwn(props, k))
}

/**
 * 2.1.323 #2153 (official `Ijs` tail): when an MCP tool call's connector ID is
 * mistyped by 1–2 characters for a host-registered (`sdk`) MCP server, return
 * a suggestion naming the exact tool to call.
 */
export function suggestMistypedHostConnectorTool(
  requestedName: string,
  tools: readonly Tool[],
  mcpClients: ReadonlyArray<{ name: string; config?: { type?: string } }>,
  input?: unknown,
): string {
  const parsedReq = parseMcpServerAndTool(requestedName)
  if (!parsedReq || !parsedReq.toolName) return ''

  const normalize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (mcpClients.some(c => normalize(c.name) === parsedReq.serverName)) {
    return ''
  }

  const sdkServerNames = new Set(
    mcpClients
      .filter(c => c.config?.type === 'sdk')
      .map(c => normalize(c.name)),
  )

  const candidates = tools.filter(t => {
    const parsed = parseMcpServerAndTool(t.name)
    if (!parsed || parsed.toolName !== parsedReq.toolName) return false
    const isHostSdk =
      (t.mcpInfo as { source?: string } | undefined)?.source === 'sdk' ||
      sdkServerNames.has(parsed.serverName)
    if (!isHostSdk) return false
    if (!UUID_LIKE_CONNECTOR_RE.test(parsed.serverName)) return false
    return boundedEditDistance(parsedReq.serverName, parsed.serverName, 2) <= 2
  })

  if (candidates.length !== 1) return ''
  const [match] = candidates
  if (!match || !inputFitsSchemaProperties(match, input)) return ''
  return `. Did you mean ${match.name}? Call ${match.name} instead.`
}

/**
 * Official 2.1.328 (#493): attach `coerceInput().resultNote` (e.g. ignored
 * Artifact `prompt`/`limit`/`label` fields) to the mapped `tool_result` block
 * so Claude sees what was dropped without rejecting the call.
 */
export function appendCoerceResultNoteToToolResultBlock(
  block: ToolResultBlockParam,
  resultNote?: string,
): ToolResultBlockParam {
  if (!resultNote) return block
  const content = block.content
  if (typeof content === 'string') {
    return {
      ...block,
      content: content.length > 0 ? `${content}\n\n${resultNote}` : resultNote,
    }
  }
  if (Array.isArray(content)) {
    return {
      ...block,
      content: [...content, { type: 'text', text: resultNote }],
    }
  }
  return {
    ...block,
    content: resultNote,
  }
}
