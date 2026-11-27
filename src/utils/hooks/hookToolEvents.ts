import { getSessionId } from '../../bootstrap/state.js'
import { findToolByName, type ToolUseContext } from '../../Tool.js'
import type { PromptRequest, PromptResponse } from '../../types/hooks.js'
import { logForDebugging } from '../debug.js'
import { hasMatchingFunctionHook } from '../plugins/functionHooksModules.js'
import { ownerOfPluginToolServerKey } from '../plugins/pluginToolRegistry.js'
import { hasHookForEvent } from './hookConfigRegistry.js'
import {
  createBaseHookInput,
  TOOL_HOOK_EXECUTION_TIMEOUT_MS,
} from './hookCore.js'
import { executeHooks } from './hookEngine.js'
import type { AggregatedHookResult } from './hookTypes.js'
import {
  matchToolCallManagedPass,
  type ToolCallManagedPass,
} from './toolCallManagedPass.js'
import { END_CONVERSATION_TOOL_NAME } from '@claude-code/builtin-tools/tools/EndConversationTool/prompt.js'
import type {
  PermissionDeniedHookInput,
  PermissionRequestHookInput,
  PermissionUpdate,
  PostToolBatchHookInput,
  PostToolUseFailureHookInput,
  PostToolUseHookInput,
} from 'src/entrypoints/agentSdkTypes.js'

function getToolHookMcpMetadata(
  toolName: string,
  context: ToolUseContext,
): {
  mcp_server?: { name: string; source: string }
} {
  const info = findToolByName(context.options.tools, toolName)?.mcpInfo
  if (!info) return {}
  const client = context.options.mcpClients?.find(
    entry => entry.name === info.serverName,
  )
  return {
    mcp_server: {
      name: info.serverName,
      source:
        info.source ??
        (('pluginTelemetry' in info && info.pluginTelemetry !== undefined) ||
        ((info.scope ?? 'dynamic') === 'dynamic' &&
          ownerOfPluginToolServerKey(info.serverName) !== undefined)
          ? 'plugin'
          : (
                'serverType' in info
                  ? info.serverType === 'sdk'
                  : client?.config.type === 'sdk'
              )
            ? 'sdk'
            : (info.scope ?? 'dynamic')),
    },
  }
}

/**
 * densable `Nx` / `jbe`. Skip JSON tool hooks when settingsHooksOff, bareFork,
 * or the tool is non-MCP EndConversation.
 */
function shouldSkipJsonToolHooks(
  toolName: string,
  context: ToolUseContext,
): boolean {
  if (context.options.settingsHooksOff === true) {
    return true
  }
  if (context.options.bareFork === true) {
    return true
  }
  const tool = findToolByName(context.options.tools, toolName)
  return (
    tool !== undefined &&
    tool.mcpInfo === undefined &&
    tool.name === END_CONVERSATION_TOOL_NAME
  )
}

export async function* executePreToolHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  toolInputSummary?: string | null,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  const replay = !tiers?.managedHooksOnly
    ? matchToolCallManagedPass(
        toolUseContext.managedPass as ToolCallManagedPass | undefined,
        toolUseID,
        toolInput,
      )
    : undefined
  if (replay !== undefined) {
    for (const item of replay.yields) {
      yield item as AggregatedHookResult
    }
    // Uat / pit(managed, core) separates the managed decision from replayable
    // diagnostics. Keep the managed decision as a floor while the excluded user
    // chain runs, and track core decision vs passthrough updatedInput separately
    // so non-deny core/user updatedInput always supersedes managed updatedInput
    // without promoting passthrough-only rewrites onto bare managed allow.
    const managedUpdatedInput: Record<string, unknown> | undefined =
      replay.result.updatedInput
    let latestCoreDecisionUpdatedInput: Record<string, unknown> | undefined
    let hasCorePassthroughUpdatedInput = false
    let decision: AggregatedHookResult =
      replay.result.deny !== undefined
        ? {
            permissionBehavior: 'deny',
            hookPermissionDecisionReason: replay.result.deny,
          }
        : replay.result.ask !== undefined
          ? {
              permissionBehavior: 'ask',
              hookPermissionDecisionReason: replay.result.ask,
              ...(managedUpdatedInput !== undefined && {
                updatedInput: managedUpdatedInput,
              }),
            }
          : replay.result.allow === true
            ? {
                permissionBehavior: 'allow',
                ...(managedUpdatedInput !== undefined && {
                  updatedInput: managedUpdatedInput,
                }),
              }
            : {}
    const rank = (behavior: AggregatedHookResult['permissionBehavior']) =>
      behavior === 'deny'
        ? 3
        : behavior === 'ask'
          ? 2
          : behavior === 'allow'
            ? 1
            : 0
    if (replay.result.additionalContext?.length) {
      yield { additionalContexts: replay.result.additionalContext }
    }
    for await (const item of executeHooks({
      hookInput: {
        ...createBaseHookInput(permissionMode, undefined, toolUseContext),
        hook_event_name: 'PreToolUse' as const,
        tool_name: toolName,
        ...getToolHookMcpMetadata(toolName, toolUseContext),
        tool_input: toolInput,
        tool_use_id: toolUseID,
      },
      toolUseID,
      matchQuery: toolName,
      signal,
      timeoutMs,
      toolUseContext,
      requestPrompt,
      toolInputSummary,
      managedHooksExcluded: true,
    })) {
      if (item.updatedInput !== undefined) {
        if (item.permissionBehavior === undefined) {
          hasCorePassthroughUpdatedInput = true
          latestCoreDecisionUpdatedInput = undefined
        } else if (
          item.permissionBehavior !== 'deny' &&
          item.permissionBehavior !== 'defer'
        ) {
          latestCoreDecisionUpdatedInput = item.updatedInput
          hasCorePassthroughUpdatedInput = false
        }
      }
      const itemMeta = item as AggregatedHookResult & {
        hostsOwnAsk?: boolean
        serversOwnAsk?: boolean
      }
      const decisionMeta = decision as AggregatedHookResult & {
        hostsOwnAsk?: boolean
        serversOwnAsk?: boolean
      }
      const itemRank = rank(item.permissionBehavior)
      const decisionRank = rank(decision.permissionBehavior)
      const askTieBreakWins =
        item.permissionBehavior === 'ask' &&
        decision.permissionBehavior === 'ask' &&
        (itemMeta.serversOwnAsk === true ||
          (decisionMeta.hostsOwnAsk === true && !itemMeta.hostsOwnAsk))
      if (itemRank > decisionRank || askTieBreakWins) {
        decision = {
          permissionBehavior: item.permissionBehavior,
          hookPermissionDecisionReason: item.hookPermissionDecisionReason,
          hookSource: item.hookSource,
          ...(itemMeta.hostsOwnAsk && { hostsOwnAsk: true }),
          ...(itemMeta.serversOwnAsk && { serversOwnAsk: true }),
          ...(item.updatedInput !== undefined &&
            item.permissionBehavior !== 'deny' && {
              updatedInput: item.updatedInput,
            }),
        } as AggregatedHookResult
      }
      // Defer has its own latch in the core consumer; diagnostics and
      // passthrough input rewrites retain their original ordering while
      // decision-attached updatedInput stays on the yielded decision so
      // interactive tools (e.g. AskUserQuestion) see interactionSatisfied.
      const {
        permissionBehavior,
        hookPermissionDecisionReason: _reason,
        updatedInput,
        ...rest
      } = item
      if (permissionBehavior === 'defer') {
        yield item
      } else if (
        permissionBehavior === undefined &&
        updatedInput !== undefined
      ) {
        yield { ...rest, updatedInput }
      } else if (Object.keys(rest).length > 0) {
        yield rest
      }
    }
    if (decision.permissionBehavior !== undefined) {
      if (decision.permissionBehavior === 'deny') {
        const { updatedInput: _drop, ...denyDecision } = decision
        yield denyDecision
      } else if (latestCoreDecisionUpdatedInput !== undefined) {
        yield { ...decision, updatedInput: latestCoreDecisionUpdatedInput }
      } else if (hasCorePassthroughUpdatedInput) {
        const { updatedInput: _dropStale, ...decisionWithoutUpdatedInput } =
          decision
        yield decisionWithoutUpdatedInput
      } else if (
        decision.updatedInput === undefined &&
        managedUpdatedInput !== undefined
      ) {
        yield { ...decision, updatedInput: managedUpdatedInput }
      } else {
        yield decision
      }
    } else if (
      !hasCorePassthroughUpdatedInput &&
      managedUpdatedInput !== undefined
    ) {
      yield { updatedInput: managedUpdatedInput }
    }
    return
  }
  // gold Rze @185182837: early-return only when settings/session AND
  // classic.PreToolUse function-hooks are both absent. hasHookForEvent is
  // gold hT (settings/session); Vp("classic.PreToolUse") is hasMatchingFunctionHook.
  if (
    !tiers?.managedHooksOnly &&
    !hasHookForEvent('PreToolUse', appState, sessionId) &&
    !hasMatchingFunctionHook('PreToolUse')
  ) {
    return
  }

  logForDebugging(`executePreToolHooks called for tool: ${toolName}`, {
    level: 'verbose',
  })

  // gold JSON stdin has tool_name only. densable tVn/uo adds `tool` on the
  // function-hook event record (executeHooks eventRecord), not settings stdin.
  const hookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PreToolUse' as const,
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    requestPrompt,
    toolInputSummary,
    managedHooksOnly: tiers?.managedHooksOnly,
    managedHooksExcluded: tiers?.managedHooksExcluded,
  })
}

/**
 * Execute post-tool hooks if configured
 * @param toolName The name of the tool (e.g., 'Write', 'Edit', 'Bash')
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that was passed to the tool
 * @param toolResponse The response from the tool
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and blocking errors for automated feedback
 */
export async function* executePostToolHooks<ToolInput, ToolResponse>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolResponse: ToolResponse,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  durationMs?: number,
  tiers?: { managedHooksOnly?: boolean; managedHooksExcluded?: boolean },
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const hookInput: PostToolUseHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolUse',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_response: toolResponse,
    duration_ms: durationMs,
    tool_use_id: toolUseID,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    managedHooksOnly: tiers?.managedHooksOnly,
    managedHooksExcluded: tiers?.managedHooksExcluded,
  })
}

/**
 * Execute post-tool-use-failure hooks if configured
 * @param toolName The name of the tool (e.g., 'Write', 'Edit', 'Bash')
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that was passed to the tool
 * @param error The error message from the failed tool call
 * @param toolUseContext ToolUseContext for prompt-based hooks
 * @param isInterrupt Whether the tool was interrupted by user
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and blocking errors
 */
export async function* executePostToolUseFailureHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  error: string,
  toolUseContext: ToolUseContext,
  isInterrupt?: boolean,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  durationMs?: number,
): AsyncGenerator<AggregatedHookResult> {
  if (shouldSkipJsonToolHooks(toolName, toolUseContext)) {
    return
  }
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PostToolUseFailure', appState, sessionId)) {
    return
  }

  const hookInput: PostToolUseFailureHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolUseFailure',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
    error,
    is_interrupt: isInterrupt,
    duration_ms: durationMs,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * densable Acn — PostToolBatch after every tool in a batch has resolved.
 * Gold does not pass matchQuery (d0e has no PostToolBatch case).
 */
export async function* executePostToolBatchHooks(
  toolCalls: Array<{
    tool_name: string
    tool_input: unknown
    tool_use_id: string
    tool_response?: unknown
  }>,
  toolUseID: string,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PostToolBatch', appState, sessionId)) {
    return
  }

  const hookInput: PostToolBatchHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PostToolBatch',
    tool_calls: toolCalls,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

export async function* executePermissionDeniedHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  reason: string,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
): AsyncGenerator<AggregatedHookResult> {
  const appState = toolUseContext.getAppState()
  const sessionId = toolUseContext.agentId ?? getSessionId()
  if (!hasHookForEvent('PermissionDenied', appState, sessionId)) {
    return
  }

  const hookInput: PermissionDeniedHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PermissionDenied',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    tool_use_id: toolUseID,
    reason,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
  })
}

/**
 * Execute permission request hooks if configured
 * These hooks are called when a permission dialog would be displayed to the user.
 * Hooks can approve or deny the permission request programmatically.
 * @param toolName The name of the tool requesting permission
 * @param toolUseID The ID of the tool use
 * @param toolInput The input that would be passed to the tool
 * @param toolUseContext ToolUseContext for the request
 * @param permissionMode Optional permission mode from toolPermissionContext
 * @param permissionSuggestions Optional permission suggestions (the "always allow" options)
 * @param signal Optional AbortSignal to cancel hook execution
 * @param timeoutMs Optional timeout in milliseconds for hook execution
 * @returns Async generator that yields progress messages and returns aggregated result
 */
export async function* executePermissionRequestHooks<ToolInput>(
  toolName: string,
  toolUseID: string,
  toolInput: ToolInput,
  toolUseContext: ToolUseContext,
  permissionMode?: string,
  permissionSuggestions?: PermissionUpdate[],
  signal?: AbortSignal,
  timeoutMs: number = TOOL_HOOK_EXECUTION_TIMEOUT_MS,
  requestPrompt?: (
    sourceName: string,
    toolInputSummary?: string | null,
  ) => (request: PromptRequest) => Promise<PromptResponse>,
  toolInputSummary?: string | null,
): AsyncGenerator<AggregatedHookResult> {
  logForDebugging(`executePermissionRequestHooks called for tool: ${toolName}`)

  const hookInput: PermissionRequestHookInput = {
    ...createBaseHookInput(permissionMode, undefined, toolUseContext),
    hook_event_name: 'PermissionRequest',
    tool_name: toolName,
    ...getToolHookMcpMetadata(toolName, toolUseContext),
    tool_input: toolInput,
    permission_suggestions: permissionSuggestions,
  }

  yield* executeHooks({
    hookInput,
    toolUseID,
    matchQuery: toolName,
    signal,
    timeoutMs,
    toolUseContext,
    requestPrompt,
    toolInputSummary,
  })
}
