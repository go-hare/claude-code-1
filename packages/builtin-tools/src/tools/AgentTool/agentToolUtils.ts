import { feature } from 'bun:bundle'
import { z } from 'zod/v4'
import { clearInvokedSkillsForAgent } from 'src/bootstrap/state.js'
import {
  ALL_AGENT_DISALLOWED_TOOLS,
  ASYNC_AGENT_ALLOWED_TOOLS,
  CUSTOM_AGENT_DISALLOWED_TOOLS,
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS,
} from 'src/constants/tools.js'
import { startAgentSummarization } from 'src/services/AgentSummary/agentSummary.js'
import {
  buildMcpToolName,
  getMcpPrefix,
  getToolNameForPermissionCheck,
  mcpInfoFromString,
} from 'src/services/mcp/mcpStringUtils.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { clearDumpState } from 'src/services/api/dumpPrompts.js'
import type { AppState } from 'src/state/AppState.js'
import type {
  Tool,
  ToolPermissionContext,
  Tools,
  ToolUseContext,
} from 'src/Tool.js'
import { toolMatchesName } from 'src/Tool.js'
import {
  completeAgentTask as completeAsyncAgent,
  computeLocalAgentIsIdle,
  createActivityDescriptionResolver,
  createProgressTracker,
  enqueueAgentNotification,
  failAgentTask as failAsyncAgent,
  getProgressUpdate,
  getTokenCountFromTracker,
  isLocalAgentTask,
  killAsyncAgent,
  markAgentsNotified,
  type ProgressTracker,
  rebuildProgressFromMessages,
  scheduleDeferredAgentProgressRebuild,
  updateAgentProgress as updateAsyncAgentProgress,
  updateLocalAgentIsIdle,
} from 'src/tasks/LocalAgentTask/LocalAgentTask.js'
import { asAgentId } from 'src/types/ids.js'
import type { Message as MessageType, ContentItem } from 'src/types/message.js'
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js'
import { logForDebugging } from 'src/utils/debug.js'
import { isInProtectedNamespace } from 'src/utils/envUtils.js'
import {
  hashHarnessSectionBlocks,
  splitReportForPersistedToolResultFiles,
} from 'src/utils/harnessTextSanitize.js'
import type { WebFetchSavedFiles } from 'src/utils/subagentSpawnLedger.js'
import { isBackgroundAbortReason } from 'src/utils/abortController.js'
import {
  normalizeModelStringForAPI,
  renderModelName,
} from 'src/utils/model/model.js'
import {
  AgentApiErrorTerminationError,
  AbortError,
  errorMessage,
  isAbortError,
} from 'src/utils/errors.js'
import type { CacheSafeParams } from 'src/utils/forkedAgent.js'
import { lazySchema } from 'src/utils/lazySchema.js'
import {
  createTurnDurationMessage,
  extractTextContent,
  getLastAssistantMessage,
} from 'src/utils/messages.js'
import type { PermissionMode } from 'src/utils/permissions/PermissionMode.js'
import { permissionRuleValueFromString } from 'src/utils/permissions/permissionRuleParser.js'
import {
  buildTranscriptForClassifier,
  classifyYoloAction,
} from 'src/utils/permissions/yoloClassifier.js'
import { emitTaskProgress as emitTaskProgressEvent } from 'src/utils/task/sdkProgress.js'
import { createTaskRegistry } from 'src/utils/taskRegistry.js'
import { isInProcessTeammate } from 'src/utils/teammateContext.js'
import { getTokenCountFromUsage } from 'src/utils/tokens.js'
import { WORKFLOW_TOOL_NAME } from '@claude-code/workflow-engine'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '../ExitPlanModeTool/constants.js'
import { OBSERVER_REPORT_TOOL_NAME } from '../ObserverReportTool/constants.js'
import { ObserverReportTool } from '../ObserverReportTool/ObserverReportTool.js'
import { CRON_CREATE_TOOL_NAME } from '../ScheduleCronTool/prompt.js'
import { SEND_MESSAGE_TOOL_NAME } from '../SendMessageTool/constants.js'
import { SUBAGENT_HANDBACK_TOOL_NAME } from '../SubagentHandbackTool/constants.js'
import {
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  MAX_TURNS_PARTIAL_PREFIX,
  ONE_SHOT_BUILTIN_AGENT_TYPES,
} from './constants.js'
import type { AgentDefinition } from './loadAgentsDir.js'
import {
  isRunAgentSpinnerMode,
  type RunAgentSpinnerMode,
} from './spinnerModeEvent.js'

/**
 * densable Lco / nXg — tools stripped from observer exact pools, then
 * ObserverReport is always re-appended. Official:
 *   nXg = [SendMessage, ObserverReport, Agent, Workflow, ScheduleWakeup,
 *          Monitor, CronCreate]
 * ScheduleWakeup may be absent in this build; still listed for parity.
 */
const OBSERVER_EXACT_STRIP_TOOL_NAMES = [
  SEND_MESSAGE_TOOL_NAME,
  SUBAGENT_HANDBACK_TOOL_NAME,
  OBSERVER_REPORT_TOOL_NAME,
  AGENT_TOOL_NAME,
  LEGACY_AGENT_TOOL_NAME,
  WORKFLOW_TOOL_NAME,
  'ScheduleWakeup',
  'Monitor',
  CRON_CREATE_TOOL_NAME,
] as const
export type ResolvedAgentTools = {
  hasWildcard: boolean
  validTools: string[]
  invalidTools: string[]
  resolvedTools: Tools
  allowedAgentTypes?: string[]
}

/**
 * Official WId surface densable — ObserverReport only for observer async
 * agents (`querySource` family `agent:observer:*`). Other agents and main
 * must not freely resolve it into their tool pool.
 */
export function isObserverAgentToolPool(input: {
  isObserverAgent?: boolean
  querySource?: string
}): boolean {
  if (input.isObserverAgent === true) return true
  const qs = input.querySource
  return typeof qs === 'string' && qs.startsWith('agent:observer:')
}

/**
 * densable Lco(e) — strip nXg tools then always append ObserverReport.
 * Used with useExactTools so runAgent does not re-filter the pool.
 */
export function applyObserverExactToolPool(tools: Tools): Tools {
  const stripped = tools.filter(
    tool =>
      !OBSERVER_EXACT_STRIP_TOOL_NAMES.some(name =>
        toolMatchesName(tool, name),
      ),
  )
  const reportFromInput = tools.find(tool =>
    toolMatchesName(tool, OBSERVER_REPORT_TOOL_NAME),
  )
  // densable always appends ZVu singleton even when stripped from input.
  return [...stripped, reportFromInput ?? ObserverReportTool]
}

export function filterToolsForAgent({
  tools,
  isBuiltIn,
  isAsync = false,
  permissionMode,
  isObserverAgent = false,
}: {
  tools: Tools
  isBuiltIn: boolean
  isAsync?: boolean
  permissionMode?: PermissionMode
  /**
   * Official observer agent tool pool densable. When true, ObserverReport
   * is retained for async observers; otherwise stripped even if present in
   * ASYNC_AGENT_ALLOWED_TOOLS.
   */
  isObserverAgent?: boolean
}): Tools {
  return tools.filter(tool => {
    // Allow MCP tools for all agents
    if (tool.name.startsWith('mcp__')) {
      return true
    }
    // Allow ExitPlanMode for agents in plan mode (e.g., in-process teammates)
    // This bypasses both the ALL_AGENT_DISALLOWED_TOOLS and async tool filters
    if (
      toolMatchesName(tool, EXIT_PLAN_MODE_V2_TOOL_NAME) &&
      permissionMode === 'plan'
    ) {
      return true
    }
    // ObserverReport: only observer async agents (WId). Not general agents.
    if (toolMatchesName(tool, OBSERVER_REPORT_TOOL_NAME)) {
      return isAsync === true && isObserverAgent === true
    }
    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name)) {
      return false
    }
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name)) {
      return false
    }
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name)) {
      if (isAgentSwarmsEnabled() && isInProcessTeammate()) {
        // Allow AgentTool for in-process teammates to spawn sync subagents.
        // Validation in AgentTool.call() prevents background agents and teammate spawning.
        if (toolMatchesName(tool, AGENT_TOOL_NAME)) {
          return true
        }
        // Allow task tools for in-process teammates to coordinate via shared task list
        if (IN_PROCESS_TEAMMATE_ALLOWED_TOOLS.has(tool.name)) {
          return true
        }
      }
      return false
    }
    return true
  })
}

/**
 * Resolves and validates agent tools against available tools
 * Handles wildcard expansion and validation in one place
 */
export function resolveAgentTools(
  agentDefinition: Pick<
    AgentDefinition,
    'tools' | 'disallowedTools' | 'source' | 'permissionMode'
  >,
  availableTools: Tools,
  isAsync = false,
  isMainThread = false,
  /**
   * Official observer agent densable — when true (or querySource is
   * agent:observer:* via isObserverAgentToolPool), ObserverReport stays in pool.
   */
  isObserverAgent = false,
): ResolvedAgentTools {
  const {
    tools: agentTools,
    disallowedTools,
    source,
    permissionMode,
  } = agentDefinition
  // When isMainThread is true, skip filterToolsForAgent entirely — the main
  // thread's tool pool is already properly assembled by useMergedTools(), so
  // the sub-agent disallow lists shouldn't apply. Main still does not freely
  // surface ObserverReport (deferred + checkPermissions gate).
  const filteredAvailableTools = isMainThread
    ? availableTools
    : filterToolsForAgent({
        tools: availableTools,
        isBuiltIn: source === 'built-in',
        isAsync,
        permissionMode,
        isObserverAgent,
      })

  // Create a set of disallowed tool names for quick lookup
  const disallowedToolSet = new Set(
    disallowedTools?.map(toolSpec => {
      const { toolName } = permissionRuleValueFromString(toolSpec)
      return toolName
    }) ?? [],
  )

  // Filter available tools based on disallowed list
  const allowedAvailableTools = filteredAvailableTools.filter(
    tool => !disallowedToolSet.has(tool.name),
  )

  // If tools is undefined or ['*'], allow all tools (after filtering disallowed)
  const hasWildcard =
    agentTools === undefined ||
    (agentTools.length === 1 && agentTools[0] === '*')
  if (hasWildcard) {
    return {
      hasWildcard: true,
      validTools: [],
      invalidTools: [],
      resolvedTools: allowedAvailableTools,
    }
  }

  const availableToolMap = new Map<string, Tool>()
  for (const tool of allowedAvailableTools) {
    availableToolMap.set(tool.name, tool)
  }

  const validTools: string[] = []
  const invalidTools: string[] = []
  const resolved: Tool[] = []
  const resolvedToolsSet = new Set<Tool>()
  let allowedAgentTypes: string[] | undefined

  function getMcpServerBases(tool: Tool): string[] {
    if (tool.mcpInfo) {
      const prefix = getMcpPrefix(tool.mcpInfo.serverName)
      return [prefix.slice(0, -2)]
    }
    const bases: string[] = []
    if (!tool.name.startsWith('mcp__')) return bases
    for (
      let i = tool.name.indexOf('__', 5);
      i !== -1;
      i = tool.name.indexOf('__', i + 1)
    ) {
      bases.push(tool.name.slice(0, i))
    }
    return bases
  }

  function matchesMcpServerRule(spec: string, tool: Tool): boolean {
    const parsedSpec = mcpInfoFromString(spec)
    const parsedTool = mcpInfoFromString(getToolNameForPermissionCheck(tool))
    if (parsedSpec === null || parsedTool === null) return false
    if (parsedSpec.serverName !== parsedTool.serverName) return false
    if (parsedSpec.toolName !== undefined && parsedSpec.toolName !== '*') {
      return false
    }
    const bases = getMcpServerBases(tool)
    return bases.every(base => spec === base || spec.startsWith(`${base}__`))
  }

  for (const toolSpec of agentTools) {
    // Parse the tool spec to extract the base tool name and any permission pattern
    const { toolName, ruleContent } = permissionRuleValueFromString(toolSpec)

    // Special case: Agent tool carries allowedAgentTypes metadata in its spec
    if (toolName === AGENT_TOOL_NAME) {
      if (ruleContent) {
        // Parse comma-separated agent types: "worker, researcher" → ["worker", "researcher"]
        allowedAgentTypes = ruleContent.split(',').map(s => s.trim())
      }
      // For sub-agents, Agent is excluded by filterToolsForAgent — mark the spec
      // valid for allowedAgentTypes tracking but skip tool resolution.
      if (!isMainThread) {
        validTools.push(toolSpec)
        continue
      }
      // For main thread, filtering was skipped so Agent is in availableToolMap —
      // fall through to normal resolution below.
    }

    const parsedMcp = mcpInfoFromString(toolName)
    if (
      parsedMcp !== null &&
      parsedMcp.serverName !== '*' &&
      (parsedMcp.toolName === undefined || parsedMcp.toolName === '*')
    ) {
      validTools.push(toolSpec)
      let matchedAny = false
      for (const tool of allowedAvailableTools) {
        if (!matchesMcpServerRule(toolName, tool)) continue
        matchedAny = true
        if (!resolvedToolsSet.has(tool)) {
          resolved.push(tool)
          resolvedToolsSet.add(tool)
        }
      }
      if (!matchedAny) {
        logForDebugging(
          `Agent tools entry "${toolSpec}" takes no tool: no connected MCP server of that name has one.`,
          { level: 'warn' },
        )
      }
      continue
    }

    const serverPrefix = toolName.endsWith('__*')
      ? toolName.slice(0, -3)
      : toolName
    const matchingServerTools =
      parsedMcp === null
        ? []
        : allowedAvailableTools.filter(
            tool =>
              tool.mcpInfo !== undefined &&
              buildMcpToolName(tool.mcpInfo.serverName, '') ===
                `${serverPrefix}__`,
          )
    if (serverPrefix !== toolName && matchingServerTools.length > 0) {
      validTools.push(toolSpec)
      for (const tool of matchingServerTools) {
        if (!resolvedToolsSet.has(tool)) {
          resolved.push(tool)
          resolvedToolsSet.add(tool)
        }
      }
      continue
    }

    const tool = availableToolMap.get(toolName)
    if (tool) {
      validTools.push(toolSpec)
      if (!resolvedToolsSet.has(tool)) {
        resolved.push(tool)
        resolvedToolsSet.add(tool)
      }
    } else {
      invalidTools.push(toolSpec)
    }
  }

  return {
    hasWildcard: false,
    validTools,
    invalidTools,
    resolvedTools: resolved,
    allowedAgentTypes,
  }
}

export const agentToolResultSchema = lazySchema(() =>
  z.object({
    agentId: z.string(),
    // Optional: older persisted sessions won't have this (resume replays
    // results verbatim without re-validation). Used to gate the sync
    // result trailer — one-shot built-ins skip the SendMessage hint.
    agentType: z.string().optional(),
    content: z.array(z.object({ type: z.literal('text'), text: z.string() })),
    totalToolUseCount: z.number(),
    totalDurationMs: z.number(),
    totalTokens: z.number(),
    // densable C_n note/tail/hash — optional so resume replays without them.
    harnessNoteCount: z.number().optional(),
    harnessTailCount: z.number().optional(),
    harnessSectionHash: z.string().optional(),
    // toolStats — focus transcript folds these into brief summary
    toolStats: z
      .object({
        readCount: z.number(),
        searchCount: z.number(),
        bashCount: z.number(),
        editFileCount: z.number(),
        linesAdded: z.number(),
        linesRemoved: z.number(),
        otherToolCount: z.number(),
        frameCount: z.number().optional(),
      })
      .optional(),
    resolvedModel: z.string().optional(),
    modelsUsed: z.array(z.string()).optional(),
    usage: z.object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_creation_input_tokens: z.number().nullable(),
      cache_read_input_tokens: z.number().nullable(),
      server_tool_use: z
        .object({
          web_search_requests: z.number(),
          web_fetch_requests: z.number(),
        })
        .nullable(),
      service_tier: z.enum(['standard', 'priority', 'batch']).nullable(),
      cache_creation: z
        .object({
          ephemeral_1h_input_tokens: z.number(),
          ephemeral_5m_input_tokens: z.number(),
        })
        .nullable(),
    }),
  }),
)

export type AgentToolResult = z.input<ReturnType<typeof agentToolResultSchema>>

export function countToolUses(messages: MessageType[]): number {
  let count = 0
  for (const m of messages) {
    if (m.type === 'assistant') {
      const content = m.message?.content as ContentItem[] | undefined
      for (const block of content ?? []) {
        if (block.type === 'tool_use') {
          count++
        }
      }
    }
  }
  return count
}

/**
 * densable 2.1.246 #54 `btr` — trailing `max_turns_reached` after the last
 * assistant / real user. Official `bI` skip for some user rows is unused on
 * the yield-then-break path (attachment is last).
 */
export function readMaxTurnsReached(
  messages: MessageType[],
): number | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const n = messages[i]
    if (!n) continue
    if (n.type === 'assistant' || n.type === 'user') return
    if (
      n.type === 'attachment' &&
      n.attachment?.type === 'max_turns_reached' &&
      typeof n.attachment.maxTurns === 'number'
    ) {
      return n.attachment.maxTurns
    }
  }
  return
}

/**
 * densable 2.1.247 tss — parent-visible API error: type / HTTP / request id / model.
 */
export function formatApiErrorForParent(
  message: MessageType,
  model: string,
): string {
  const content = message.message?.content
  const text = Array.isArray(content)
    ? extractTextContent(content, '\n')
    : typeof content === 'string'
      ? content
      : ''
  const apiErrorStatus = (message as { apiErrorStatus?: number }).apiErrorStatus
  const requestId = (message as { requestId?: string }).requestId
  const error = (message as { error?: string }).error
  const includeModel = apiErrorStatus !== undefined || !!requestId
  const parts = [
    error && `error type ${error}`,
    apiErrorStatus !== undefined && `HTTP ${apiErrorStatus}`,
    requestId && `request id ${requestId}`,
    includeModel && `model sent to the API: ${model}`,
  ].filter((part): part is string => typeof part === 'string')
  return parts.length > 0 ? `${text} (${parts.join(', ')})` : text
}

function modelsEqual(a: string, b: string): boolean {
  return normalizeModelStringForAPI(a) === normalizeModelStringForAPI(b)
}

/** SEA `P_r` — append model to used list when it differs from the last entry. */
export function appendModelUsed(
  modelsUsed: readonly string[],
  model: string,
): string[] {
  return modelsUsed.at(-1) === model ? [...modelsUsed] : [...modelsUsed, model]
}

/** Collect all models used across the subagent's messages (SEA `modelsUsed`). */
export function collectModelsUsed(
  agentMessages: readonly MessageType[],
  initialModel: string,
  priorModelsUsed?: readonly string[],
): string[] {
  let result =
    priorModelsUsed && priorModelsUsed.length > 0
      ? [...priorModelsUsed]
      : [initialModel]
  for (const m of agentMessages) {
    if (m.type === 'system' && m.subtype === 'model_fallback') {
      const fallbackModel = (m as { fallbackModel?: unknown }).fallbackModel
      if (typeof fallbackModel === 'string') {
        result = appendModelUsed(result, fallbackModel)
      }
    } else if (
      m.type === 'assistant' &&
      !m.isApiErrorMessage &&
      typeof m.message?.model === 'string'
    ) {
      result = appendModelUsed(result, m.message.model)
    }
  }
  return result
}

/**
 * SEA `Bp(e)` (2.1.305 #1041) — walk backwards from the end of the transcript
 * to check if the final assistant message(s) ran on a `model_fallback` model
 * that differs from `originalModel`.
 */
export function findModelFallbackNotice(
  agentMessages: readonly MessageType[],
): { fallbackModel: string; originalModel: string } | undefined {
  let lastModel: string | undefined
  for (let i = agentMessages.length - 1; i >= 0; i--) {
    const m = agentMessages[i]!
    if (
      m.type === 'user' ||
      (m.type === 'assistant' && (m.isVirtual || m.isApiErrorMessage))
    ) {
      continue
    }
    if (m.type === 'assistant') {
      const model =
        typeof m.message?.model === 'string' ? m.message.model : undefined
      if (model === undefined) return undefined
      if (lastModel === undefined) {
        lastModel = model
      } else if (!modelsEqual(model, lastModel)) {
        return undefined
      }
    } else if (
      lastModel !== undefined &&
      m.type === 'system' &&
      m.subtype === 'model_fallback'
    ) {
      const fallbackModel = (m as { fallbackModel?: unknown }).fallbackModel
      const originalModel = (m as { originalModel?: unknown }).originalModel
      if (
        typeof fallbackModel === 'string' &&
        typeof originalModel === 'string' &&
        modelsEqual(lastModel, fallbackModel) &&
        !modelsEqual(fallbackModel, originalModel)
      ) {
        return { fallbackModel, originalModel }
      }
    }
  }
  return undefined
}

export function finalizeAgentTool(
  agentMessages: MessageType[],
  agentId: string,
  metadata: {
    prompt: string
    resolvedAgentModel: string
    isBuiltInAgent: boolean
    startTime: number
    agentType: string
    isAsync: boolean
    persistedToolResultFiles?: WebFetchSavedFiles
    modelsUsed?: readonly string[]
  },
  /**
   * densable Cns(..., {suppressTelemetry:Z}) where Z = JXt after Jeo.
   * When the finishing agent still holds any `agent:` keepalive children,
   * skip tengu_agent_tool_completed / cache_eviction_hint (parent is parked
   * for live children — completion telemetry would double-count).
   */
  opts?: { suppressTelemetry?: boolean },
): AgentToolResult {
  const {
    prompt,
    resolvedAgentModel,
    isBuiltInAgent,
    startTime,
    agentType,
    isAsync,
    persistedToolResultFiles,
  } = metadata
  const suppressTelemetry = opts?.suppressTelemetry === true

  const lastAssistantMessage = getLastAssistantMessage(agentMessages)
  if (lastAssistantMessage === undefined) {
    throw new Error('No assistant messages found')
  }
  // Extract text content from the agent's response. If the final assistant
  // message is a pure tool_use block (loop exited mid-turn), fall back to
  // the most recent assistant message that has text content.
  let content = (
    (lastAssistantMessage.message?.content as ContentItem[]) ?? []
  ).filter(_ => _.type === 'text')
  if (content.length === 0) {
    for (let i = agentMessages.length - 1; i >= 0; i--) {
      const m = agentMessages[i]!
      if (m.type !== 'assistant') continue
      const textBlocks = ((m.message?.content as ContentItem[]) ?? []).filter(
        _ => _.type === 'text',
      )
      if (textBlocks.length > 0) {
        content = textBlocks
        break
      }
    }
  }

  // Last-message usage is one API response window, not multi-turn agent spend.
  // Rebuild last-wins per response id so multi-block / multi-turn totals match
  // progress UI (and survive content_block_stop zeros until message_delta).
  const tracker = createProgressTracker()
  rebuildProgressFromMessages(tracker, agentMessages)
  const rebuiltTokens = getTokenCountFromTracker(tracker)
  const lastUsageTokens = getTokenCountFromUsage(
    lastAssistantMessage.message?.usage as Parameters<
      typeof getTokenCountFromUsage
    >[0],
  )
  const totalTokens = Math.max(rebuiltTokens, lastUsageTokens)
  const totalToolUseCount = Math.max(
    countToolUses(agentMessages),
    tracker.toolUseCount,
  )

  const modelsUsed = collectModelsUsed(
    agentMessages,
    resolvedAgentModel,
    metadata.modelsUsed,
  )

  // densable: if(!Z) j("completed"); Cns(..., {suppressTelemetry:Z})
  // Z = JXt after Jeo — suppress when any agent: child KA remains.
  if (!suppressTelemetry) {
    logEvent('tengu_agent_tool_completed', {
      agent_type:
        agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model:
        resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      final_model: (modelsUsed.at(-1) ??
        resolvedAgentModel) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      model_swapped: modelsUsed.length > 1,
      prompt_char_count: prompt.length,
      response_char_count: content.length,
      assistant_message_count: agentMessages.length,
      total_tool_uses: totalToolUseCount,
      duration_ms: Date.now() - startTime,
      total_tokens: totalTokens,
      is_built_in_agent: isBuiltInAgent,
      is_async: isAsync,
    })

    // Signal to inference that this subagent's cache chain can be evicted.
    const lastRequestId = lastAssistantMessage.requestId
    if (lastRequestId) {
      logEvent('tengu_cache_eviction_hint', {
        scope:
          'subagent_end' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        last_request_id:
          lastRequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
    }
  }

  // Optional toolStats for focus-transcript / brief summary fold-in.
  // Lazy-require focusTranscript: a top-level import cycles AgentTool
  // (utils → focusTranscript → messages/Tool package graph → AgentTool) and
  // TDZ's agentToolResultSchema during module init.
  let toolStats:
    | {
        readCount: number
        searchCount: number
        bashCount: number
        editFileCount: number
        linesAdded: number
        linesRemoved: number
        otherToolCount: number
        frameCount?: number
      }
    | undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { computeAgentToolStats } =
      require('src/utils/focusTranscript.js') as typeof import('src/utils/focusTranscript.js')
    toolStats = computeAgentToolStats(agentMessages as never)
  } catch {
    toolStats = undefined
  }

  // densable 2.1.246 #54 Gxt — prepend PARTIAL banner when query hit maxTurns
  const notes: Array<{ type: 'text'; text: string }> = []
  const maxTurnsReached = readMaxTurnsReached(agentMessages)
  if (maxTurnsReached !== undefined) {
    const continueHint = ONE_SHOT_BUILTIN_AGENT_TYPES.has(agentType)
      ? ''
      : ` Send the agent a message (${SEND_MESSAGE_TOOL_NAME}) to let it continue from where it stopped.`
    notes.push({
      type: 'text',
      text: `${MAX_TURNS_PARTIAL_PREFIX}${maxTurnsReached}-turn limit before finishing. The text below is PARTIAL output; treat it as incomplete.${continueHint}\n`,
    })
  }
  if (content.length > 0) {
    const fallbackNotice = findModelFallbackNotice(agentMessages)
    if (fallbackNotice !== undefined) {
      notes.push({
        type: 'text',
        text: `⚠ This agent switched to ${renderModelName(fallbackNotice.fallbackModel)} because its earlier model could not be used.\n`,
      })
    }
  }

  // densable W$n: persistedToolResultFiles?al(B, files, on(Z)):{report:B,harnessTail:[]}
  const notesChars = notes.reduce((sum, block) => sum + block.text.length, 0)
  const { report, harnessTail } = persistedToolResultFiles
    ? splitReportForPersistedToolResultFiles(
        content,
        persistedToolResultFiles,
        notesChars,
      )
    : { report: content, harnessTail: [] }
  content = [...notes, ...report, ...harnessTail]

  return {
    agentId,
    agentType,
    content,
    harnessNoteCount: notes.length,
    harnessTailCount: harnessTail.length,
    harnessSectionHash: hashHarnessSectionBlocks(content),
    resolvedModel: resolvedAgentModel,
    ...(modelsUsed.length > 1 && { modelsUsed }),
    totalDurationMs: Date.now() - startTime,
    totalTokens,
    totalToolUseCount,
    toolStats,
    usage: lastAssistantMessage.message?.usage as AgentToolResult['usage'],
  }
}

/**
 * Returns the name of the last tool_use block in an assistant message,
 * or undefined if the message is not an assistant message with tool_use.
 */
export function getLastToolUseName(message: MessageType): string | undefined {
  if (message.type !== 'assistant') return undefined
  const block = ((message.message?.content as ContentItem[]) ?? []).findLast(
    b => b.type === 'tool_use',
  )
  return block?.type === 'tool_use' ? block.name : undefined
}

export function emitTaskProgress(
  tracker: ProgressTracker,
  taskId: string,
  toolUseId: string | undefined,
  description: string,
  startTime: number,
  lastToolName: string,
): void {
  const progress = getProgressUpdate(tracker)
  emitTaskProgressEvent({
    taskId,
    toolUseId,
    description: progress.lastActivity?.activityDescription ?? description,
    startTime,
    totalTokens: progress.tokenCount,
    toolUses: progress.toolUseCount,
    lastToolName,
  })
}

export async function classifyHandoffIfNeeded({
  agentMessages,
  tools,
  toolPermissionContext,
  abortSignal,
  subagentType,
  totalToolUseCount,
}: {
  agentMessages: MessageType[]
  tools: Tools
  toolPermissionContext: AppState['toolPermissionContext']
  abortSignal: AbortSignal
  subagentType: string
  totalToolUseCount: number
}): Promise<string | null> {
  if (feature('TRANSCRIPT_CLASSIFIER')) {
    if (toolPermissionContext.mode !== 'auto') return null

    const agentTranscript = buildTranscriptForClassifier(agentMessages, tools)
    if (!agentTranscript) return null

    const classifierResult = await classifyYoloAction(
      agentMessages,
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: "Sub-agent has finished and is handing back control to the main agent. Review the sub-agent's work based on the block rules and let the main agent know if any file is dangerous (the main agent will see the reason).",
          },
        ],
      },
      tools,
      toolPermissionContext as ToolPermissionContext,
      abortSignal,
    )

    const handoffDecision = classifierResult.unavailable
      ? 'unavailable'
      : classifierResult.shouldBlock
        ? 'blocked'
        : 'allowed'
    logEvent('tengu_auto_mode_decision', {
      decision:
        handoffDecision as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolName:
        // Use legacy name for analytics continuity across the Task→Agent rename
        LEGACY_AGENT_TOOL_NAME as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      inProtectedNamespace: isInProtectedNamespace(),
      classifierModel:
        classifierResult.model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      agentType:
        subagentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      toolUseCount: totalToolUseCount,
      isHandoff: true,
      // For handoff, the relevant agent completion is the subagent's final
      // assistant message — the last thing the classifier transcript shows
      // before the handoff review prompt.
      agentMsgId: getLastAssistantMessage(agentMessages)?.message
        .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      classifierStage:
        classifierResult.stage as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      classifierStage1RequestId:
        classifierResult.stage1RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      classifierStage1MsgId:
        classifierResult.stage1MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      classifierStage2RequestId:
        classifierResult.stage2RequestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      classifierStage2MsgId:
        classifierResult.stage2MsgId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    if (classifierResult.shouldBlock) {
      // When classifier is unavailable, still propagate the sub-agent's
      // results but with a warning so the parent agent can verify the work.
      if (classifierResult.unavailable) {
        logForDebugging(
          'Handoff classifier unavailable, allowing sub-agent output with warning',
          { level: 'warn' },
        )
        // densable CYu — allow-with-warning (not fail-closed deny). f6d empty in 216.
        const detail = '' // densable f6d(httpStatus, errorKind) body empty in 2.1.216
        const who = classifierResult.model
          ? `${classifierResult.model} (the safety classifier)`
          : 'The safety classifier'
        return `Note: ${who} was unavailable${detail} when reviewing this subagent's work. Please carefully verify the subagent's actions and output before acting on them.`
      }

      logForDebugging(
        `Handoff classifier flagged sub-agent output: ${classifierResult.reason}`,
        { level: 'warn' },
      )
      return `SECURITY WARNING: This sub-agent performed actions that may violate security policy. Reason: ${classifierResult.reason}. Review the sub-agent's actions carefully before acting on its output.`
    }
  }

  return null
}

/**
 * Extract a partial result string from an agent's accumulated messages.
 * Used when an async agent is killed to preserve what it accomplished.
 * Returns undefined if no text content is found.
 */
export function extractPartialResult(
  messages: MessageType[],
): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!
    if (m.type !== 'assistant') continue
    const text = extractTextContent(
      (m.message?.content as ContentItem[]) ?? [],
      '\n',
    )
    if (text) {
      return text
    }
  }
  return undefined
}

type SetAppState = (f: (prev: AppState) => AppState) => void

/**
 * Snapshot AppState via the root setAppState path (setAppStateForTasks).
 * Async/subagent getAppState() can miss root task registry writes (KA holds
 * live on root via rootSetAppState); Jeo mutates through set, so JXt must
 * read the same store.
 */
function readAppStateViaSet(setAppState: SetAppState): AppState {
  let snap: AppState | undefined
  setAppState(prev => {
    snap = prev
    return prev
  })
  // Fallback should never trip when setAppState is the real root updater.
  return snap as AppState
}

/**
 * densable Yqe park-on-keepalive after DSu when JXt:
 * strip old turn_duration, append CWr(duration, pe), defer owner BRt.
 * Shared by runAsyncAgentLifecycle + AgentTool mid-bg complete path.
 */
/**
 * densable Yqe isIdle tracker: N = in-flight tool_use ids, $ = nested Agent/Task.
 * Shared by runAsyncAgentLifecycle and AgentTool mid-bg continuation.
 */
export function createLocalAgentIsIdleTracker(
  taskId: string,
  setAppState: SetAppState,
): {
  track: (message: MessageType) => void
  sync: () => void
  seedFromMessages: (messages: readonly MessageType[]) => void
  inFlightCount?: () => number
} {
  const inFlightToolUseIds = new Set<string>()
  const nestedAgentToolUseIds = new Set<string>()
  const track = (message: MessageType): void => {
    if (message.type === 'assistant') {
      const content = (message.message?.content as ContentItem[]) ?? []
      for (const block of content) {
        if (block.type !== 'tool_use' || typeof block.id !== 'string') continue
        inFlightToolUseIds.add(block.id)
        if (
          block.name === AGENT_TOOL_NAME ||
          block.name === LEGACY_AGENT_TOOL_NAME
        ) {
          nestedAgentToolUseIds.add(block.id)
        }
      }
      return
    }
    if (message.type !== 'user') return
    const content = message.message?.content
    if (!Array.isArray(content)) return
    for (const block of content) {
      if (
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: string }).type === 'tool_result'
      ) {
        const id = (block as { tool_use_id?: string }).tool_use_id
        if (typeof id === 'string') {
          inFlightToolUseIds.delete(id)
          nestedAgentToolUseIds.delete(id)
        }
      }
    }
  }
  const sync = (): void => {
    updateLocalAgentIsIdle(
      taskId,
      computeLocalAgentIsIdle(inFlightToolUseIds, nestedAgentToolUseIds),
      setAppState,
    )
  }
  const seedFromMessages = (messages: readonly MessageType[]): void => {
    for (const m of messages) track(m)
    sync()
  }
  return {
    track,
    sync,
    seedFromMessages,
    inFlightCount: () => inFlightToolUseIds.size,
  }
}

export function parkAgentOnKeepaliveDeferNotify(
  taskId: string,
  durationMs: number,
  setAppState: SetAppState,
  getAppState?: () => AppState,
): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { countAgentKeepaliveChildren } =
    require('src/utils/task/framework.js') as typeof import('src/utils/task/framework.js')
  const { createTaskRegistry } =
    require('src/utils/taskRegistry.js') as typeof import('src/utils/taskRegistry.js')
  const pe =
    getAppState !== undefined
      ? countAgentKeepaliveChildren(
          taskId,
          createTaskRegistry(getAppState, setAppState),
        )
      : 0
  const turnDuration = createTurnDurationMessage(
    durationMs,
    undefined,
    undefined,
    pe || undefined,
  )
  setAppState(prev => {
    const t = prev.tasks[taskId]
    if (!isLocalAgentTask(t)) return prev
    const base = t.messages ?? []
    const filtered = base.filter(
      m =>
        !(
          m.type === 'system' &&
          (m as { subtype?: string }).subtype === 'turn_duration'
        ),
    )
    return {
      ...prev,
      tasks: {
        ...prev.tasks,
        [taskId]: { ...t, messages: [...filtered, turnDuration] },
      },
    }
  })
  logForDebugging(
    `[AsyncAgent ${taskId}] parked on keepalive — deferring owner notification until resume`,
    { level: 'info' },
  )
}

/**
 * densable Jeo → JXt (root registry) after stream ends, before finalize.
 * Returns whether the agent still holds live `agent:` children (Z).
 */
export function sweepAndDetectLiveAgentChildren(
  taskId: string,
  setAppState: SetAppState,
  getAppState?: () => AppState,
): boolean {
  if (!getAppState) return false
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { sweepStaleKeepaliveReasons, hasLiveAgentKeepaliveChildren } =
    require('src/utils/task/framework.js') as typeof import('src/utils/task/framework.js')
  const { createTaskRegistry } =
    require('src/utils/taskRegistry.js') as typeof import('src/utils/taskRegistry.js')
  const registry = createTaskRegistry(getAppState, setAppState)
  sweepStaleKeepaliveReasons(taskId, registry)
  return hasLiveAgentKeepaliveChildren(taskId, registry)
}

const ASYNC_AGENT_STALL_GRACE_MS = 300_000
const ASYNC_AGENT_STALL_FALLBACK_MS = 600_000
const MAX_SET_TIMEOUT_MS = 2_147_483_647
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 90_000

/**
 * Gold 2.1.325 `Hus()` — stall watchdog timeout for async subagents.
 */
export function getAsyncAgentStallTimeoutMs(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const explicit = Number(env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS)
  if (Number.isFinite(explicit) && explicit > 0) {
    return Math.min(explicit, MAX_SET_TIMEOUT_MS)
  }
  const watchdogRaw = env.CLAUDE_ENABLE_STREAM_WATCHDOG
  const watchdogEnabled =
    watchdogRaw === undefined ||
    (watchdogRaw !== '0' &&
      watchdogRaw.toLowerCase() !== 'false' &&
      watchdogRaw.toLowerCase() !== 'no')
  if (!watchdogEnabled) {
    return ASYNC_AGENT_STALL_FALLBACK_MS
  }
  const streamIdle = Number(env.CLAUDE_STREAM_IDLE_TIMEOUT_MS)
  const baseIdleMs =
    Number.isFinite(streamIdle) && streamIdle > 0
      ? streamIdle
      : DEFAULT_STREAM_IDLE_TIMEOUT_MS
  return Math.min(baseIdleMs + ASYNC_AGENT_STALL_GRACE_MS, MAX_SET_TIMEOUT_MS)
}

/**
 * Drives a background agent from spawn to terminal notification.
 * Shared between AgentTool's async-from-start path and resumeAgentBackground.
 */
export async function runAsyncAgentLifecycle({
  taskId,
  abortController,
  makeStream,
  metadata,
  description,
  toolUseContext,
  rootSetAppState,
  agentIdForCleanup,
  enableSummarization,
  getWorktreeResult,
  onRunSettled,
  onTerminalSuccess,
}: {
  taskId: string
  abortController: AbortController
  makeStream: (
    onCacheSafeParams: ((p: CacheSafeParams) => void) | undefined,
  ) => AsyncGenerator<MessageType | RunAgentSpinnerMode, void>
  metadata: Parameters<typeof finalizeAgentTool>[2]
  description: string
  toolUseContext: ToolUseContext
  rootSetAppState: SetAppState
  agentIdForCleanup: string
  enableSummarization: boolean
  getWorktreeResult: () => Promise<{
    worktreePath?: string
    worktreeBranch?: string
  }>
  /**
   * densable Oze onRunSettled (p) — called from every terminal exit path
   * (complete / cancel / error / stall / finally). Used for concurrent slot
   * release (2.1.217 #18 takeConcurrencySlot).
   */
  onRunSettled?: () => void
  /**
   * Official zqe `onTerminalSuccess` (`m`). Called after finalize/complete
   * and before keepalive park. Swallow throws (official `try{m()}catch`).
   */
  onTerminalSuccess?: () => void
}): Promise<{ finalText: string } | undefined> {
  let stopSummarization: (() => void) | undefined
  const agentMessages: MessageType[] = []
  // densable Yqe D — shared tracker (also used by mid-bg path in AgentTool)
  const isIdleTracker = createLocalAgentIsIdleTracker(taskId, rootSetAppState)
  // densable X8a finalText — return extracted text so awaitCompletion callers
  // do not race task.result AppState writes after lifecycle settles.
  let settledFinalText: string | undefined
  const stallMs = getAsyncAgentStallTimeoutMs()
  let stallTimer: ReturnType<typeof setTimeout> | null = null
  let stallFired = false
  let lastMessageType = 'none'
  let lastStallBumpAt = 0
  const stallBumpThrottleMs = Math.min(stallMs * 0.1, 1000)
  const clearStallWatchdog = () => {
    if (stallTimer !== null) {
      clearTimeout(stallTimer)
      stallTimer = null
    }
  }
  const armStallWatchdog = () => {
    clearStallWatchdog()
    stallTimer = setTimeout(() => {
      stallTimer = null
      if (stallFired) return
      const inFlight = isIdleTracker.inFlightCount?.() ?? 0
      if (inFlight > 0) {
        logForDebugging(
          `[AsyncAgent ${taskId}] stall watchdog deferred — ${inFlight} tool(s) in flight`,
        )
        armStallWatchdog()
        return
      }
      stallFired = true
      logForDebugging(
        `[AsyncAgent ${taskId}] stall watchdog fired after ${stallMs}ms with no progress (last message: ${lastMessageType}); aborting`,
        { level: 'error' },
      )
      logEvent('tengu_async_agent_stall_timeout', {
        agent_type:
          metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        stall_ms: stallMs,
        last_message_type:
          lastMessageType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        message_count: agentMessages.length,
      })
      abortController.abort()
      stopSummarization?.()
      clearStallWatchdog()
      const stallError = `Agent stalled: no progress for ${stallMs / 1000}s (stream watchdog did not recover)`
      const registry = createTaskRegistry(
        toolUseContext.getAppState,
        rootSetAppState,
      )
      failAsyncAgent(taskId, stallError, registry)
      enqueueAgentNotification({
        taskId,
        description,
        status: 'failed',
        error: stallError,
        registry,
        toolUseId: toolUseContext.toolUseId,
      })
    }, stallMs)
    stallTimer.unref?.()
  }
  try {
    // densable N5: T8e at run start. The finally settles it when this run exits.
    try {
      const { clearAgentStopPending, registerAgentKillLoop } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/agentStopBag.js') as typeof import('src/utils/agentStopBag.js')
      registerAgentKillLoop(taskId)
      clearAgentStopPending(agentIdForCleanup)
    } catch {
      // optional bag
    }
    const tracker = createProgressTracker()
    const resolveActivity = createActivityDescriptionResolver(
      toolUseContext.options.tools,
    )
    const onCacheSafeParams = enableSummarization
      ? (params: CacheSafeParams) => {
          const { stop } = startAgentSummarization(
            taskId,
            asAgentId(taskId),
            params,
            rootSetAppState,
          )
          stopSummarization = stop
        }
      : undefined
    armStallWatchdog()
    for await (const message of makeStream(onCacheSafeParams)) {
      // densable Phn/Ohr — query yields spinner_mode for teammate Phn.setMode.
      // Do not retain control events in agentMessages / task.messages.
      if (isRunAgentSpinnerMode(message)) {
        continue
      }
      agentMessages.push(message)
      isIdleTracker.track(message)
      lastMessageType = message.type
      const nowMs = Date.now()
      if (nowMs - lastStallBumpAt >= stallBumpThrottleMs) {
        lastStallBumpAt = nowMs
        armStallWatchdog()
      }
      // Append immediately when UI holds the task (retain). Bootstrap reads
      // disk in parallel and UUID-merges the prefix — disk-write-before-yield
      // means live is always a suffix of disk, so merge is order-correct.
      rootSetAppState(prev => {
        const t = prev.tasks[taskId]
        if (!isLocalAgentTask(t) || !t.retain) return prev
        const base = t.messages ?? []
        return {
          ...prev,
          tasks: {
            ...prev.tasks,
            [taskId]: { ...t, messages: [...base, message] },
          },
        }
      })
      // Rebuild from the full message list so in-place usage mutations from
      // message_delta (after content_block_stop yield) are reflected in the
      // footer token count. Incremental-only updates permanently stuck at 0.
      rebuildProgressFromMessages(
        tracker,
        agentMessages,
        resolveActivity,
        toolUseContext.options.tools,
      )
      updateAsyncAgentProgress(
        taskId,
        getProgressUpdate(tracker, agentMessages),
        rootSetAppState,
      )
      // densable Yqe D after each stream message (tool_use / tool_result)
      isIdleTracker.sync()
      // message_delta often arrives with no further yields until the next tool
      // result — without a deferred rebuild the footer freezes at first count.
      scheduleDeferredAgentProgressRebuild(
        taskId,
        tracker,
        agentMessages,
        rootSetAppState,
        resolveActivity,
        toolUseContext.options.tools,
      )
      const lastToolName = getLastToolUseName(message)
      if (lastToolName) {
        emitTaskProgress(
          tracker,
          taskId,
          toolUseContext.toolUseId,
          description,
          metadata.startTime,
          lastToolName,
        )
      }
    }

    // Final rebuild after stream ends — last message_delta may have mutated
    // usage after the final content_block_stop yield with no further messages.
    rebuildProgressFromMessages(
      tracker,
      agentMessages,
      resolveActivity,
      toolUseContext.options.tools,
    )
    updateAsyncAgentProgress(
      taskId,
      getProgressUpdate(tracker, agentMessages),
      rootSetAppState,
    )

    stopSummarization?.()

    // densable 2.1.247 aK: last assistant API error → l2e(tss()) before finalize.
    const lastAssistant = getLastAssistantMessage(agentMessages)
    if (lastAssistant?.isApiErrorMessage) {
      const model = metadata.resolvedAgentModel
      if (lastAssistant.error === 'model_not_found') {
        logEvent('tengu_api_subagent_model_not_found', {
          model:
            model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          status: (lastAssistant as { apiErrorStatus?: number }).apiErrorStatus,
          request_id:
            lastAssistant.requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          has_fallback_chain: [toolUseContext.options.fallbackModel]
            .flat()
            .some(Boolean),
          is_built_in_agent: metadata.isBuiltInAgent,
        })
      }
      throw new AgentApiErrorTerminationError(
        formatApiErrorForParent(lastAssistant, model),
        typeof lastAssistant.error === 'string'
          ? lastAssistant.error
          : undefined,
      )
    }

    // densable Yqe (single Jeo + same Z):
    //   Jeo(e,s); let Z=JXt(e,s); if(!Z) j("completed");
    //   Cns(..., {suppressTelemetry:Z}); DSu(re,s,...); if(Z) park return
    // JXt reads the same root registry Jeo just mutated (set-snapshot).
    // Do NOT Jeo again inside DSu and do NOT re-sample JXt after DSu —
    // gold uses one Z for suppressTelemetry and park.
    const preCompleteJxt = sweepAndDetectLiveAgentChildren(
      taskId,
      rootSetAppState,
      toolUseContext.getAppState,
    )
    const agentResult = finalizeAgentTool(agentMessages, taskId, metadata, {
      suppressTelemetry: preCompleteJxt,
    })

    // Mark task completed FIRST so TaskOutput(block=true) unblocks
    // immediately. classifyHandoffIfNeeded (API call) and getWorktreeResult
    // (git exec) are notification embellishments that can hang — they must
    // not gate the status transition (gh-20236).
    // skipJeo: Jeo already ran above for Z.
    completeAsyncAgent(
      agentResult,
      createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
      { skipJeo: true },
    )
    // Official zqe: if(m) try{m()}catch — before keepalive park.
    if (onTerminalSuccess) {
      try {
        onTerminalSuccess()
      } catch (err) {
        logForDebugging(
          `onTerminalSuccess threw: ${err instanceof Error ? err.message : String(err)}`,
        )
      }
    }
    // densable X8a finalText = md(result.content, "\n") — capture before park
    // so awaitCompletion does not race AppState task.result writes.
    settledFinalText = extractTextContent(agentResult.content, '\n')

    // densable: if (Z) CWr(pe) + defer owner BRt — same Z as suppressTelemetry.
    // Bot idle-window alone is NOT JXt (only agent: reasons count).
    if (preCompleteJxt) {
      parkAgentOnKeepaliveDeferNotify(
        taskId,
        agentResult.totalDurationMs,
        rootSetAppState,
        toolUseContext.getAppState,
      )
      return settledFinalText !== undefined
        ? { finalText: settledFinalText }
        : undefined
    }

    // Official observer densable: stop armed pairing when observed agent ends.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { maybeStopObserverForObservedTerminal } =
        require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js')
      maybeStopObserverForObservedTerminal(taskId, msg =>
        logForDebugging(msg, { level: 'debug' }),
      )
    } catch {
      // densable optional
    }

    let finalMessage = extractTextContent(agentResult.content, '\n')
    settledFinalText = finalMessage

    if (feature('TRANSCRIPT_CLASSIFIER')) {
      const handoffWarning = await classifyHandoffIfNeeded({
        agentMessages,
        tools: toolUseContext.options.tools,
        toolPermissionContext:
          toolUseContext.getAppState().toolPermissionContext,
        abortSignal: abortController.signal,
        subagentType: metadata.agentType,
        totalToolUseCount: agentResult.totalToolUseCount,
      })
      if (handoffWarning) {
        finalMessage = `${handoffWarning}\n\n${finalMessage}`
        settledFinalText = finalMessage
        agentResult.content = [
          { type: 'text' as const, text: handoffWarning },
          ...agentResult.content,
        ]
        agentResult.harnessNoteCount = (agentResult.harnessNoteCount ?? 0) + 1
        agentResult.harnessSectionHash = hashHarnessSectionBlocks(
          agentResult.content,
        )
      }
    }

    const worktreeResult = await getWorktreeResult()

    enqueueAgentNotification({
      taskId,
      description,
      status: 'completed',
      maxTurnsReached: readMaxTurnsReached(agentMessages),
      registry: createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
      finalMessage,
      usage: {
        totalTokens: getTokenCountFromTracker(tracker),
        toolUses: agentResult.totalToolUseCount,
        durationMs: agentResult.totalDurationMs,
      },
      toolUseId: toolUseContext.toolUseId,
      ...worktreeResult,
    })
  } catch (error) {
    stopSummarization?.()
    clearStallWatchdog()
    if (stallFired) {
      return
    }
    // densable Yqe: te instanceof Xl (AbortError family)
    if (isAbortError(error) || error instanceof AbortError) {
      // densable m(): RT(signal.reason)==="background" → XV + Kle, no BRt
      // Checkpoint handoff (left-arrow / exit) aborts agents with "background"
      // so the fork can resume them; do not surface killed notification.
      if (
        isBackgroundAbortReason(abortController.signal.reason) ||
        isBackgroundAbortReason(
          error instanceof Error ? error.message : undefined,
        )
      ) {
        killAsyncAgent(
          taskId,
          createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
          'user',
        )
        markAgentsNotified(taskId, rootSetAppState)
        return
      }
      // killAsyncAgent is a no-op if TaskStop already set status='killed' —
      // but only this catch handler has agentMessages, so the notification
      // must fire unconditionally. Transition status BEFORE worktree cleanup
      // so TaskOutput unblocks even if git hangs (gh-20236).
      killAsyncAgent(
        taskId,
        createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
        'user',
      )
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { maybeStopObserverForObservedTerminal } =
          require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js')
        maybeStopObserverForObservedTerminal(taskId, msg =>
          logForDebugging(msg, { level: 'debug' }),
        )
      } catch {
        // densable optional
      }
      // densable: reason from task.killedBy after XV (parent|system|user)
      let killedBy: 'user' | 'parent' | 'system' | undefined
      try {
        const t = toolUseContext.getAppState().tasks?.[taskId] as
          | { killedBy?: 'user' | 'parent' | 'system' }
          | undefined
        killedBy = t?.killedBy
      } catch {
        killedBy = undefined
      }
      const killReason =
        killedBy === 'parent'
          ? 'parent_kill_async'
          : killedBy === 'system'
            ? 'system_kill_async'
            : 'user_kill_async'
      logEvent('tengu_agent_tool_terminated', {
        agent_type:
          metadata.agentType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        model:
          metadata.resolvedAgentModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        duration_ms: Date.now() - metadata.startTime,
        is_async: true,
        is_built_in_agent: metadata.isBuiltInAgent,
        reason:
          killReason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      const worktreeResult = await getWorktreeResult()
      const partialResult = extractPartialResult(agentMessages)
      enqueueAgentNotification({
        taskId,
        description,
        status: 'killed',
        killedBy,
        registry: createTaskRegistry(
          toolUseContext.getAppState,
          rootSetAppState,
        ),
        toolUseId: toolUseContext.toolUseId,
        finalMessage: partialResult,
        ...worktreeResult,
      })
      return
    }
    const msg = errorMessage(error)
    failAsyncAgent(
      taskId,
      msg,
      createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
    )
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { maybeStopObserverForObservedTerminal } =
        require('src/utils/observerAgents.js') as typeof import('src/utils/observerAgents.js')
      maybeStopObserverForObservedTerminal(taskId, msg =>
        logForDebugging(msg, { level: 'debug' }),
      )
    } catch {
      // densable optional
    }
    const worktreeResult = await getWorktreeResult()
    enqueueAgentNotification({
      taskId,
      description,
      status: 'failed',
      error: msg,
      registry: createTaskRegistry(toolUseContext.getAppState, rootSetAppState),
      toolUseId: toolUseContext.toolUseId,
      ...worktreeResult,
    })
  } finally {
    clearStallWatchdog()
    try {
      const { settleAgentKillLoop } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('src/utils/agentStopBag.js') as typeof import('src/utils/agentStopBag.js')
      settleAgentKillLoop(taskId)
    } catch {
      // optional bag
    }
    // densable Oze finally: p?.() — concurrent slot release is once-safe
    onRunSettled?.()
    clearInvokedSkillsForAgent(agentIdForCleanup)
    clearDumpState(agentIdForCleanup)
  }
  // densable X8a: only successful complete/park paths set settledFinalText
  return settledFinalText !== undefined
    ? { finalText: settledFinalText }
    : undefined
}
