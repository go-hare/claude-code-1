import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import { sanitizeToolNameForAnalytics } from 'src/services/analytics/metadata.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../../services/analytics/growthbook.js'
import { z } from 'zod/v4'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import type { AnyObject, Tool, ToolUseContext } from '../../Tool.js'
import type { HookProgress } from '../../types/hooks.js'
import type {
  AssistantMessage,
  AttachmentMessage,
  ProgressMessage,
} from '../../types/message.js'
import type { PermissionDecision } from '../../types/permissions.js'
import { createAttachmentMessage } from '../../utils/attachments.js'
import { logForDebugging } from '../../utils/debug.js'
import { isAbortError } from '../../utils/errors.js'
import {
  executePostToolHooks,
  executePostToolUseFailureHooks,
  executePreToolHooks,
  getPreToolHookBlockingMessage,
} from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import {
  getRuleBehaviorDescription,
  type PermissionDecisionReason,
  type PermissionResult,
} from '../../utils/permissions/PermissionResult.js'
import {
  checkRuleBasedPermissions,
  evaluatePermissionWithToolCheck,
  hasEvaluatedToolCheckForCall,
  isCoworkCloudAutoHookAllowBlocked,
} from '../../utils/permissions/permissions.js'
import {
  accountMemoryHookRewriteDenied,
  didAccountMemoryHookRewriteInput,
  shouldPreserveManagedToolHookPass,
} from '../../utils/hooks/toolCallManagedPass.js'
import { getEffectivePermissionMode } from '../../utils/permissions/mcpPermissionMode.js'
import { stripEvalConfinedHookAllow } from '../../utils/permissions/evalConfined.js'
import { hasMatchingFunctionHook } from '../../utils/plugins/functionHooksModules.js'
import {
  formatError,
  formatZodValidationError,
} from '../../utils/toolErrors.js'
import { isMcpTool } from '../mcp/utils.js'
import type { McpServerType, MessageUpdateLazy } from './toolExecution.js'

export type PostToolUseHooksResult<Output> =
  | MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
  | { updatedToolOutput: Output }
  | {
      classifierContext: { value: string; hostPrincipal: boolean }
      pairing: 'none' | 'pending' | 'never-applied'
    }

export async function* runPostToolUseHooks<Input extends AnyObject, Output>(
  toolUseContext: ToolUseContext,
  tool: Tool<Input, Output>,
  toolUseID: string,
  messageId: string,
  toolInput: Record<string, unknown>,
  toolResponse: Output,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  _mcpServerBaseUrl: string | undefined,
  durationMs?: number,
): AsyncGenerator<PostToolUseHooksResult<Output>> {
  // densable: settingsHooksOff skips the whole PostToolUse chain.
  // tool.call already drops module handlers; settings hooks must too.
  // disableAllHooks is checked inside executeHooks.
  // densable vVn Nx: settingsHooksOff | bareFork | EndConversation (latter inside executePostToolHooks)
  if (toolUseContext.options.settingsHooksOff === true) return
  if (toolUseContext.options.bareFork === true) return
  const postToolStartTime = Date.now()
  try {
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    const toolOutput = toolResponse
    for await (const result of executePostToolHooks(
      tool.name,
      toolUseID,
      toolInput,
      toolOutput,
      toolUseContext,
      permissionMode,
      toolUseContext.abortController.signal,
      undefined,
      durationMs,
      {
        // densable vVn: managedHooksExcluded: s.managedPass?.toolUseId===n && I$(s,e)
        managedHooksExcluded:
          toolUseContext.managedPass?.toolUseId === toolUseID &&
          (shouldPreserveManagedToolHookPass(toolUseContext, tool) ||
            tool.preserveToolUseResultInSubagents === true),
      },
    )) {
      try {
        // Check if we were aborted during hook execution
        // IMPORTANT: We emit a cancelled event per hook
        if (
          result.message?.type === 'attachment' &&
          result.message.attachment!.type === 'hook_cancelled'
        ) {
          logEvent('tengu_post_tool_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),

            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_cancelled',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
          continue
        }

        // For JSON {decision:"block"} hooks, executeHooks yields two results:
        // {blockingError} and {message: hook_blocking_error attachment}. The
        // blockingError path below creates that same attachment, so skip it
        // here to avoid displaying the block reason twice (#31301). The
        // exit-code-2 path only yields {blockingError}, so it's unaffected.
        if (
          result.message &&
          !(
            result.message.type === 'attachment' &&
            result.message.attachment!.type === 'hook_blocking_error'
          )
        ) {
          yield {
            message: result.message as
              | AttachmentMessage
              | ProgressMessage<HookProgress>,
          }
        }

        if (result.blockingError) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
              blockingError: result.blockingError,
            }),
          }
        }

        const accountMemory = tool.mcpInfo?.accountMemory === true
        if (
          accountMemory &&
          (result.updatedToolOutput !== undefined ||
            result.updatedMCPToolOutput !== undefined)
        ) {
          logForDebugging(
            `PostToolUse hook for ${tool.name} tried to rewrite an account memory server answer; the rewrite was dropped`,
            { level: 'warn' },
          )
        }
        if (result.updatedToolOutput !== undefined && !accountMemory) {
          yield { updatedToolOutput: result.updatedToolOutput as Output }
        }
        if (
          result.updatedMCPToolOutput !== undefined &&
          isMcpTool(tool) &&
          !accountMemory
        ) {
          yield { updatedToolOutput: result.updatedMCPToolOutput as Output }
        }

        // If hook indicated to prevent continuation, yield a stop reason message
        if (result.preventContinuation) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message:
                result.stopReason || 'Execution stopped by PostToolUse hook',
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
          return
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: result.additionalContexts,
              hookName: `PostToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUse',
            }),
          }
        }

        if (result.classifierContexts?.length) {
          const pairing =
            result.pairedRewrite === 'none'
              ? 'none'
              : result.pairedRewrite === 'direct' ||
                  (result.pairedRewrite === 'legacy_mcp' && isMcpTool(tool))
                ? 'pending'
                : 'never-applied'
          for (const classifierContext of result.classifierContexts) {
            yield { classifierContext, pairing }
          }
        }
      } catch (error) {
        const postToolDurationMs = Date.now() - postToolStartTime
        logEvent('tengu_post_tool_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: postToolDurationMs,

          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_error_during_execution',
            content: formatError(error),
            hookName: `PostToolUse:${tool.name}`,
            toolUseID: toolUseID,
            hookEvent: 'PostToolUse',
          }),
        }
      }
    }
  } catch (error) {
    logError(error)
  }
}

export async function* runPostToolUseFailureHooks<Input extends AnyObject>(
  toolUseContext: ToolUseContext,
  tool: Tool<Input, unknown>,
  toolUseID: string,
  messageId: string,
  processedInput: z.infer<Input>,
  error: string,
  isInterrupt: boolean | undefined,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  _mcpServerBaseUrl: string | undefined,
  durationMs?: number,
): AsyncGenerator<
  MessageUpdateLazy<AttachmentMessage | ProgressMessage<HookProgress>>
> {
  if (toolUseContext.options.settingsHooksOff === true) return
  if (toolUseContext.options.bareFork === true) return
  const postToolStartTime = Date.now()
  try {
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    for await (const result of executePostToolUseFailureHooks(
      tool.name,
      toolUseID,
      processedInput,
      error,
      toolUseContext,
      isInterrupt,
      permissionMode,
      toolUseContext.abortController.signal,
      undefined,
      durationMs,
    )) {
      try {
        // Check if we were aborted during hook execution
        if (
          result.message?.type === 'attachment' &&
          result.message.attachment!.type === 'hook_cancelled'
        ) {
          logEvent('tengu_post_tool_failure_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),
            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            message: createAttachmentMessage({
              type: 'hook_cancelled',
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID,
              hookEvent: 'PostToolUseFailure',
            }),
          }
          continue
        }

        // Skip hook_blocking_error in result.message — blockingError path
        // below creates the same attachment (see #31301 / PostToolUse above).
        if (
          result.message &&
          !(
            result.message.type === 'attachment' &&
            result.message.attachment!.type === 'hook_blocking_error'
          )
        ) {
          yield {
            message: result.message as
              | AttachmentMessage
              | ProgressMessage<HookProgress>,
          }
        }

        if (result.blockingError) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_blocking_error',
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUseFailure',
              blockingError: result.blockingError,
            }),
          }
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            message: createAttachmentMessage({
              type: 'hook_additional_context',
              content: result.additionalContexts,
              hookName: `PostToolUseFailure:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PostToolUseFailure',
            }),
          }
        }
      } catch (hookError) {
        const postToolDurationMs = Date.now() - postToolStartTime
        logEvent('tengu_post_tool_failure_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: postToolDurationMs,
          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          message: createAttachmentMessage({
            type: 'hook_error_during_execution',
            content: formatError(hookError),
            hookName: `PostToolUseFailure:${tool.name}`,
            toolUseID: toolUseID,
            hookEvent: 'PostToolUseFailure',
          }),
        }
      }
    }
  } catch (outerError) {
    logError(outerError)
  }
}

/** densable kce — managed-only PostToolUse after the tool.call chain. */
export async function collectManagedOnlyPostToolUse<
  Input extends AnyObject,
  Output,
>(opts: {
  tool: Tool<Input, Output>
  toolUseID: string
  toolInput: Record<string, unknown>
  output: Output
  toolUseContext: ToolUseContext
  durationMs?: number
}): Promise<{
  output: Output
  rewritten: boolean
  messages: MessageUpdateLazy[]
}> {
  const { tool, toolUseID, toolInput, toolUseContext, durationMs } = opts
  if (toolUseContext.options.settingsHooksOff === true) {
    return { output: opts.output, rewritten: false, messages: [] }
  }
  if (toolUseContext.options.bareFork === true) {
    return { output: opts.output, rewritten: false, messages: [] }
  }
  const hookName = `PostToolUse:${tool.name}`
  let output = opts.output
  let rewritten = false
  const messages: MessageUpdateLazy[] = []
  const permissionMode = toolUseContext.getAppState().toolPermissionContext.mode
  for await (const result of executePostToolHooks(
    tool.name,
    toolUseID,
    toolInput,
    output,
    toolUseContext,
    permissionMode,
    toolUseContext.abortController.signal,
    undefined,
    durationMs,
    { managedHooksOnly: true },
  )) {
    if (result.updatedToolOutput !== undefined) {
      if (tool.mcpInfo?.accountMemory === true) {
        logForDebugging(
          `PostToolUse hook for ${tool.name} tried to rewrite an account memory server answer; the rewrite was dropped`,
          { level: 'warn' },
        )
      } else {
        output = result.updatedToolOutput as Output
        rewritten = true
      }
    }
    if (result.updatedMCPToolOutput !== undefined && isMcpTool(tool)) {
      if (tool.mcpInfo?.accountMemory === true) {
        logForDebugging(
          `PostToolUse hook for ${tool.name} tried to rewrite an account memory server answer; the rewrite was dropped`,
          { level: 'warn' },
        )
      } else {
        output = result.updatedMCPToolOutput as Output
        rewritten = true
      }
    }
    if (result.blockingError) {
      messages.push({
        message: createAttachmentMessage({
          type: 'hook_blocking_error',
          blockingError: result.blockingError,
          hookName,
          toolUseID,
          hookEvent: 'PostToolUse',
        }),
      })
    }
    if (result.preventContinuation) {
      messages.push({
        message: createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message: result.stopReason || 'Execution stopped by PostToolUse hook',
          hookName,
          toolUseID,
          hookEvent: 'PostToolUse',
        }),
      })
      break
    }
    if (result.additionalContexts && result.additionalContexts.length > 0) {
      messages.push({
        message: createAttachmentMessage({
          type: 'hook_additional_context',
          content: result.additionalContexts,
          hookName,
          toolUseID,
          hookEvent: 'PostToolUse',
        }),
      })
    }
  }
  return { output, rewritten, messages }
}

/**
 * Resolve a PreToolUse hook's permission result into a final PermissionDecision.
 *
 * Encapsulates the invariant that hook 'allow' does NOT bypass settings.json
 * deny/ask rules — checkRuleBasedPermissions still applies (inc-4788 analog).
 * Also handles the requiresUserInteraction/requireCanUseTool guards and the
 * 'ask' forceDecision passthrough.
 *
 * Shared by toolExecution.ts (main query loop) and REPLTool/toolWrappers.ts
 * (REPL inner calls) so the permission semantics stay in lockstep.
 */
async function settleResolvedDecisionWithToolCheck(
  decided: PermissionDecision,
  opts: {
    tool: Tool
    input: Record<string, unknown>
    toolUseContext: ToolUseContext
    canUseTool: CanUseToolFn
    assistantMessage: AssistantMessage
    toolUseID: string
  },
): Promise<{ decision: PermissionDecision; input: Record<string, unknown> }> {
  if (!hasMatchingFunctionHook('tool.check', { tool: opts.tool.name })) {
    if (decided.behavior !== 'ask') {
      return { decision: decided, input: opts.input }
    }
    return {
      decision: await opts.canUseTool(
        opts.tool,
        opts.input,
        opts.toolUseContext,
        opts.assistantMessage,
        opts.toolUseID,
        decided,
      ),
      input: opts.input,
    }
  }
  const checked = await evaluatePermissionWithToolCheck({
    tool: opts.tool,
    input: opts.input,
    context: opts.toolUseContext,
    toolUseID: opts.toolUseID,
    evaluate: () => Promise.resolve(decided),
  })
  if (checked.behavior === 'allow' && opts.toolUseContext.requireCanUseTool) {
    return {
      decision: await opts.canUseTool(
        opts.tool,
        opts.input,
        opts.toolUseContext,
        opts.assistantMessage,
        opts.toolUseID,
      ),
      input: opts.input,
    }
  }
  if (checked.behavior !== 'ask') {
    return { decision: checked, input: opts.input }
  }
  return {
    decision: await opts.canUseTool(
      opts.tool,
      opts.input,
      opts.toolUseContext,
      opts.assistantMessage,
      opts.toolUseID,
      checked,
    ),
    input: opts.input,
  }
}

async function runCanUseToolWithToolCheckFallback(
  tool: Tool,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  toolUseID: string,
  forceDecision?: PermissionDecision,
): Promise<PermissionDecision> {
  const rawDecision = await canUseTool(
    tool,
    input,
    toolUseContext,
    assistantMessage,
    toolUseID,
    forceDecision,
  )
  if (
    !hasMatchingFunctionHook('tool.check', { tool: tool.name }) ||
    hasEvaluatedToolCheckForCall(toolUseContext, toolUseID, input)
  ) {
    return rawDecision
  }
  return evaluatePermissionWithToolCheck({
    tool,
    input,
    context: toolUseContext,
    toolUseID,
    evaluate: () => Promise.resolve(rawDecision),
  })
}

export async function resolveHookPermissionDecision(
  hookPermissionResult: PermissionResult | undefined,
  tool: Tool,
  input: Record<string, unknown>,
  toolUseContext: ToolUseContext,
  canUseTool: CanUseToolFn,
  assistantMessage: AssistantMessage,
  toolUseID: string,
): Promise<{
  decision: PermissionDecision
  input: Record<string, unknown>
}> {
  const requiresInteraction = tool.requiresUserInteraction?.()
  const requireCanUseTool = toolUseContext.requireCanUseTool

  if (hookPermissionResult?.behavior === 'allow') {
    const hookInput = hookPermissionResult.updatedInput ?? input

    // Hook provided updatedInput for an interactive tool — the hook IS the
    // user interaction (e.g. headless wrapper that collected AskUserQuestion
    // answers). Treat as non-interactive for the rule-check path.
    const interactionSatisfied =
      requiresInteraction && hookPermissionResult.updatedInput !== undefined

    if ((requiresInteraction && !interactionSatisfied) || requireCanUseTool) {
      logForDebugging(
        `Hook approved tool use for ${tool.name}, but canUseTool is required`,
      )
      return {
        decision: await runCanUseToolWithToolCheckFallback(
          tool,
          hookInput,
          toolUseContext,
          canUseTool,
          assistantMessage,
          toolUseID,
        ),
        input: hookInput,
      }
    }

    // Hook allow skips the interactive prompt, but deny/ask rules and plan-mode
    // write floor still apply.
    const ruleCheck = await checkRuleBasedPermissions(
      tool,
      hookInput,
      toolUseContext,
      { crashIsObjection: true, planModeWriteFloor: true },
    )
    if (ruleCheck === null) {
      const effectiveMode = getEffectivePermissionMode(
        tool,
        toolUseContext.getAppState().toolPermissionContext,
      )
      // densable gyo @188786514: auto mode + tengu_virtual_knuth funnels hook allow through classifier.
      if (
        !requiresInteraction &&
        effectiveMode === 'auto' &&
        getFeatureValue_CACHED_MAY_BE_STALE('tengu_virtual_knuth', false)
      ) {
        const rawHookSource =
          hookPermissionResult.decisionReason?.type === 'hook'
            ? hookPermissionResult.decisionReason.hookSource
            : undefined
        const hookSource =
          rawHookSource === undefined
            ? undefined
            : rawHookSource === 'settings'
              ? 'settings'
              : rawHookSource === 'plugin' ||
                  rawHookSource.startsWith('plugin:')
                ? 'plugin'
                : rawHookSource === 'skill' ||
                    rawHookSource.startsWith('skill:')
                  ? 'skill'
                  : 'other'
        logEvent('tengu_auto_mode_hook_allow_funneled', {
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          ...(hookSource !== undefined
            ? {
                hookSource:
                  hookSource as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          agentMsgId: assistantMessage.message
            .id as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolUseId:
            toolUseID as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
        })
        logForDebugging(
          `Hook approved tool use for ${tool.name}, but auto mode requires classifier adjudication`,
        )
        const vouchedContext = {
          ...toolUseContext,
          hookAllowVouched: true,
        } as ToolUseContext
        return {
          decision: await runCanUseToolWithToolCheckFallback(
            tool,
            hookInput,
            vouchedContext,
            canUseTool,
            assistantMessage,
            toolUseID,
          ),
          input: hookInput,
        }
      }
      logForDebugging(
        interactionSatisfied
          ? `Hook satisfied user interaction for ${tool.name} via updatedInput`
          : `Hook approved tool use for ${tool.name}, bypassing permission prompt`,
      )
      return settleResolvedDecisionWithToolCheck(hookPermissionResult, {
        tool,
        input: hookInput,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseID,
      })
    }
    if (ruleCheck.behavior === 'deny') {
      logForDebugging(
        `Hook approved tool use for ${tool.name}, but deny rule overrides: ${ruleCheck.message}`,
      )
      return settleResolvedDecisionWithToolCheck(ruleCheck, {
        tool,
        input: hookInput,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseID,
      })
    }
    // ask rule — dialog required despite hook approval. Gold ge=D==="ask"
    // is false on hook-allow, so this is not hookAskFloor.
    logForDebugging(
      `Hook returned 'allow' for ${tool.name}, but ask rule/safety check requires full permission pipeline`,
    )
    return {
      decision: await runCanUseToolWithToolCheckFallback(
        tool,
        hookInput,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseID,
      ),
      input: hookInput,
    }
  }

  if (hookPermissionResult?.behavior === 'deny') {
    logForDebugging(`Hook denied tool use for ${tool.name}`)
    return settleResolvedDecisionWithToolCheck(hookPermissionResult, {
      tool,
      input,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseID,
    })
  }

  // Hook ask (or no decision). Gold EQn runs FR then, when both hook and
  // rule ask, stamps hookAskFloor so a classifier allow re-surfaces as ask.
  const askInput =
    hookPermissionResult?.behavior === 'ask' &&
    hookPermissionResult.updatedInput
      ? hookPermissionResult.updatedInput
      : input
  if (hookPermissionResult?.behavior === 'ask') {
    const ruleCheck = await checkRuleBasedPermissions(
      tool,
      askInput,
      toolUseContext,
    )
    if (ruleCheck?.behavior === 'deny') {
      logForDebugging(
        `Hook returned 'ask' for ${tool.name}, but deny rule overrides: ${ruleCheck.message}`,
      )
      return settleResolvedDecisionWithToolCheck(ruleCheck, {
        tool,
        input: askInput,
        toolUseContext,
        canUseTool,
        assistantMessage,
        toolUseID,
      })
    }
    if (ruleCheck?.behavior === 'ask') {
      logForDebugging(
        `Hook returned 'ask' for ${tool.name}, but ask rule/safety check requires full permission pipeline (hookAskFloor — a classifier allow re-surfaces as this ask)`,
      )
      return {
        decision: await runCanUseToolWithToolCheckFallback(
          tool,
          askInput,
          { ...toolUseContext, hookAskFloor: true },
          canUseTool,
          assistantMessage,
          toolUseID,
        ),
        input: askInput,
      }
    }
    return settleResolvedDecisionWithToolCheck(hookPermissionResult, {
      tool,
      input: askInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseID,
    })
  }

  return {
    decision: await runCanUseToolWithToolCheckFallback(
      tool,
      askInput,
      toolUseContext,
      canUseTool,
      assistantMessage,
      toolUseID,
    ),
    input: askInput,
  }
}

export async function* runPreToolUseHooks(
  toolUseContext: ToolUseContext,
  tool: Tool,
  processedInput: Record<string, unknown>,
  toolUseID: string,
  messageId: string,
  requestId: string | undefined,
  mcpServerType: McpServerType,
  _mcpServerBaseUrl: string | undefined,
  durationMs?: number,
): AsyncGenerator<
  | {
      type: 'message'
      message: MessageUpdateLazy<
        AttachmentMessage | ProgressMessage<HookProgress>
      >
    }
  | { type: 'hookPermissionResult'; hookPermissionResult: PermissionResult }
  | { type: 'defer'; hookName: string }
  | { type: 'hookUpdatedInput'; updatedInput: Record<string, unknown> }
  | { type: 'preventContinuation'; shouldPreventContinuation: boolean }
  | { type: 'stopReason'; stopReason: string }
  | {
      type: 'additionalContext'
      message: MessageUpdateLazy<AttachmentMessage>
    }
  // stop execution — densable may attach stopReason (ZFu infra default)
  | { type: 'stop'; stopReason?: string }
> {
  if (toolUseContext.options.settingsHooksOff === true) return
  if (toolUseContext.options.bareFork === true) return
  const hookStartTime = Date.now()
  // Official `u` — deny only. Allow/ask do not suppress a latched defer.
  let deniedPermissionResult: PermissionResult | undefined
  // Official `c` — latch defer until the stream ends.
  let deferredHookName: string | undefined
  // densable `d`: last stopReason from preventContinuation
  let lastStopReason: string | undefined
  try {
    const appState = toolUseContext.getAppState()

    for await (const result of executePreToolHooks(
      tool.name,
      toolUseID,
      processedInput,
      toolUseContext,
      appState.toolPermissionContext.mode,
      toolUseContext.abortController.signal,
      undefined, // timeoutMs - use default
      toolUseContext.requestPrompt,
      tool.getToolUseSummary?.(processedInput),
    )) {
      try {
        if (result.message) {
          yield {
            type: 'message',
            message: {
              message: result.message as
                | AttachmentMessage
                | ProgressMessage<HookProgress>,
            },
          }
        }
        if (result.blockingError) {
          const denialMessage = getPreToolHookBlockingMessage(
            `PreToolUse:${tool.name}`,
            result.blockingError,
          )
          const permissionResult: PermissionResult = {
            behavior: 'deny',
            message: denialMessage,
            decisionReason: {
              type: 'hook',
              hookName: `PreToolUse:${tool.name}`,
              reason: denialMessage,
            },
          }
          deniedPermissionResult = permissionResult
          yield {
            type: 'hookPermissionResult',
            hookPermissionResult: permissionResult,
          }
        }
        // densable kVn @188788636: validate updatedInput against tool.inputSchema (ignore unrecognized_keys)
        if (result.updatedInput !== undefined) {
          const parsed = tool.inputSchema.safeParse(result.updatedInput)
          const remainingIssues = parsed.success
            ? []
            : parsed.error.issues.filter(
                issue => issue.code !== 'unrecognized_keys',
              )
          if (!parsed.success && remainingIssues.length > 0) {
            const validationMessage = `PreToolUse hook for ${tool.name} returned updatedInput that failed schema validation: ${formatZodValidationError(tool.name, new z.ZodError(remainingIssues))}`
            logForDebugging(validationMessage, { level: 'warn' })
            const permissionResult: PermissionResult = {
              behavior: 'deny',
              message: validationMessage,
              decisionReason: {
                type: 'hook',
                hookName: `PreToolUse:${tool.name}`,
                hookSource: result.hookSource,
                reason: validationMessage,
              },
            }
            deniedPermissionResult = permissionResult
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: permissionResult,
            }
            continue
          }
        }
        // densable kVn: block Account Memory MCP input rewrite via ere/tre
        const accountMemoryBlocked =
          result.permissionBehavior !== 'deny' &&
          didAccountMemoryHookRewriteInput(
            tool,
            processedInput,
            result.updatedInput,
          )
        if (accountMemoryBlocked) {
          const denial = accountMemoryHookRewriteDenied(
            tool,
            'PreToolUse',
            result.hookSource,
          )
          const permissionResult: PermissionResult = {
            behavior: 'deny',
            message: denial.message,
            decisionReason: {
              type: 'hook',
              hookName: `PreToolUse:${tool.name}`,
              ...(result.hookSource !== undefined
                ? { hookSource: result.hookSource }
                : {}),
              reason: denial.message,
            },
          }
          deniedPermissionResult = permissionResult
          yield {
            type: 'hookPermissionResult',
            hookPermissionResult: permissionResult,
          }
        }
        // Check if hook wants to prevent continuation
        if (result.preventContinuation) {
          yield {
            type: 'preventContinuation',
            shouldPreventContinuation: true,
          }
          if (result.stopReason) {
            lastStopReason = result.stopReason
            yield { type: 'stopReason', stopReason: result.stopReason }
          }
        }
        if (accountMemoryBlocked) {
          continue
        }
        // densable QLn — confined child ignores PreToolUse allow grants
        stripEvalConfinedHookAllow(result, `PreToolUse:${tool.name}`)
        // Official 325 (#1442) — Cowork cloud auto mode blocks PreToolUse allow
        // for Bash, PowerShell, Agent, and mcp__ tools.
        if (
          result.permissionBehavior === 'allow' &&
          isCoworkCloudAutoHookAllowBlocked(
            tool.name,
            appState.toolPermissionContext.mode,
          )
        ) {
          logEvent('tengu_auto_mode_permission_request_allow_ignored', {})
          logForDebugging(
            `PreToolUse:${tool.name} permissionDecision=allow ignored: while auto mode is on (also behind plan mode) a hook cannot approve ${tool.name}`,
          )
          result.permissionBehavior = undefined
        }
        // Check for hook-defined permission behavior
        if (result.permissionBehavior !== undefined) {
          logForDebugging(
            `Hook result has permissionBehavior=${result.permissionBehavior}`,
          )
          const decisionReason: PermissionDecisionReason = {
            type: 'hook',
            hookName: `PreToolUse:${tool.name}`,
            hookSource: result.hookSource,
            reason: result.hookPermissionDecisionReason,
          }
          if (result.permissionBehavior === 'defer') {
            // Official c — latch hookSource; do not yield until the stream ends.
            deferredHookName = result.hookSource || `PreToolUse:${tool.name}`
            continue
          } else if (result.permissionBehavior === 'allow') {
            const permissionResult: PermissionResult = {
              behavior: 'allow',
              updatedInput: result.updatedInput,
              decisionReason,
            }
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: permissionResult,
            }
          } else if (result.permissionBehavior === 'ask') {
            const permissionResult: PermissionResult = {
              behavior: 'ask',
              updatedInput: result.updatedInput,
              message:
                result.hookPermissionDecisionReason ||
                `Hook PreToolUse:${tool.name} ${getRuleBehaviorDescription(result.permissionBehavior)} this tool`,
              decisionReason,
            }
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: permissionResult,
            }
          } else {
            // Official u — deny only.
            const permissionResult: PermissionResult = {
              behavior: result.permissionBehavior,
              message:
                result.hookPermissionDecisionReason ||
                `Hook PreToolUse:${tool.name} ${getRuleBehaviorDescription(result.permissionBehavior)} this tool`,
              decisionReason,
            }
            deniedPermissionResult = permissionResult
            yield {
              type: 'hookPermissionResult',
              hookPermissionResult: permissionResult,
            }
          }
        }

        // Yield updatedInput for passthrough case (no permission decision)
        // This allows hooks to modify input while letting normal permission flow continue
        if (result.updatedInput && result.permissionBehavior === undefined) {
          yield {
            type: 'hookUpdatedInput',
            updatedInput: result.updatedInput,
          }
        }

        // If hooks provided additional context, add it as a message
        if (result.additionalContexts && result.additionalContexts.length > 0) {
          yield {
            type: 'additionalContext',
            message: {
              message: createAttachmentMessage({
                type: 'hook_additional_context',
                content: result.additionalContexts,
                hookName: `PreToolUse:${tool.name}`,
                toolUseID,
                hookEvent: 'PreToolUse',
              }),
            },
          }
        }

        // Check if we were aborted during hook execution
        if (toolUseContext.abortController.signal.aborted) {
          logEvent('tengu_pre_tool_hooks_cancelled', {
            toolName: sanitizeToolNameForAnalytics(tool.name),

            queryChainId: toolUseContext.queryTracking
              ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
            queryDepth: toolUseContext.queryTracking?.depth,
          })
          yield {
            type: 'message',
            message: {
              message: createAttachmentMessage({
                type: 'hook_cancelled',
                hookName: `PreToolUse:${tool.name}`,
                toolUseID,
                hookEvent: 'PreToolUse',
              }),
            },
          }
          yield { type: 'stop' }
          return
        }
      } catch (error) {
        logError(error)
        const durationMs = Date.now() - hookStartTime
        logEvent('tengu_pre_tool_hook_error', {
          messageID:
            messageId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
          isMcp: tool.isMcp ?? false,
          duration: durationMs,

          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          queryDepth: toolUseContext.queryTracking?.depth,
          ...(mcpServerType
            ? {
                mcpServerType:
                  mcpServerType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
          ...(requestId
            ? {
                requestId:
                  requestId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
              }
            : {}),
        })
        yield {
          type: 'message',
          message: {
            message: createAttachmentMessage({
              type: 'hook_error_during_execution',
              content: formatError(error),
              hookName: `PreToolUse:${tool.name}`,
              toolUseID: toolUseID,
              hookEvent: 'PreToolUse',
            }),
          },
        }
        // Official: u → re-yield deny and return. Else if c yield defer, then stop.
        if (deniedPermissionResult) {
          yield {
            type: 'hookPermissionResult',
            hookPermissionResult: deniedPermissionResult,
          }
          return
        }
        if (deferredHookName) {
          yield { type: 'defer', hookName: deferredHookName }
          deferredHookName = undefined
        }
        yield {
          type: 'stop',
          stopReason:
            lastStopReason ??
            'PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.',
        }
      }
    }
    if (deferredHookName && !deniedPermissionResult) {
      yield { type: 'defer', hookName: deferredHookName }
    }
  } catch (error) {
    if (isAbortError(error)) {
      if (toolUseContext.abortController.signal.aborted) {
        logForDebugging('PreToolUse hook cancelled (parent abort)')
      } else {
        logForDebugging('PreToolUse hook timed out (per-hook abort)')
        logEvent('tengu_sdk_hook_callback_timeout', {
          hookEvent:
            'PreToolUse' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          toolName: sanitizeToolNameForAnalytics(tool.name),
        })
        if (deniedPermissionResult) {
          yield {
            type: 'hookPermissionResult',
            hookPermissionResult: deniedPermissionResult,
          }
        } else {
          if (deferredHookName) {
            yield { type: 'defer', hookName: deferredHookName }
          }
          yield {
            type: 'stop',
            stopReason:
              lastStopReason ??
              'PreToolUse hook timed out. The tool call was not executed; other configured hooks may not have completed.',
          }
        }
        return
      }
    } else {
      logError(error)
      if (deniedPermissionResult) {
        yield {
          type: 'hookPermissionResult',
          hookPermissionResult: deniedPermissionResult,
        }
      } else {
        if (deferredHookName) {
          yield { type: 'defer', hookName: deferredHookName }
        }
        yield {
          type: 'stop',
          stopReason:
            lastStopReason ??
            'PreToolUse hook failed with an unexpected error. The tool call was not executed; other configured hooks may not have completed.',
        }
      }
      return
    }
    yield { type: 'stop' }
    return
  }
}
