/**
 * Tool-call hook pipeline:
 * - Managed PreToolUse pass (`drainManagedPreToolUse` / `aggregateManagedPreToolPass`)
 * - `tool.call` function-hook chain wrapper (`dispatchToolCallCore`)
 * - Managed PostToolUse (`collectManagedOnlyPostToolUse`) + context packing (`appendToolCallContextKce`)
 * - Streamed progress/result adapter (`streamedCheckPermissionsAndCallTool`)
 */

import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { END_CONVERSATION_TOOL_NAME } from '@claude-code/builtin-tools/tools/EndConversationTool/prompt.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from 'src/services/analytics/index.js'
import {
  mcpToolDetailsForAnalytics,
  sanitizeToolNameForAnalytics,
} from 'src/services/analytics/metadata.js'
import { getCodeEditToolDecisionCounter } from '../../../bootstrap/state.js'
import {
  buildCodeEditToolAttributes,
  isCodeEditingTool,
} from '../../../hooks/toolPermission/permissionLogging.js'
import type { CanUseToolFn } from '../../../hooks/useCanUseTool.js'
import type { Tool, ToolUseContext } from '../../../Tool.js'
import type { AssistantMessage, Message } from '../../../types/message.js'
import { createAttachmentMessage } from '../../../utils/attachments.js'
import { logForDebugging } from '../../../utils/debug.js'
import { AbortError, errorMessage } from '../../../utils/errors.js'
import {
  executePreToolHooks,
  getPreToolHookBlockingMessage,
} from '../../../utils/hooks.js'
import {
  listOfContextTexts,
  packToolCallContext,
  pinHookAttachment,
  rewrittenToolCallContext,
} from '../../../utils/hooks/toolCallContextPack.js'
import {
  accountMemoryHookRewriteDenied,
  didAccountMemoryHookRewriteInput,
  type ManagedHookPass,
  shouldPreserveManagedToolHookPass,
  type ToolCallManagedPass,
} from '../../../utils/hooks/toolCallManagedPass.js'
import { createProgressMessage } from '../../../utils/messages.js'
import { decisionReasonToOTelSource } from '../../../utils/permissions/permissionDecisionReasons.js'
import {
  pinValue,
  restorePinnedKeys,
} from '../../../utils/plugins/functionHooksHop.js'
import {
  type FunctionHookHopSite,
  hasMatchingFunctionHook,
  isInsideAgentSpawnLaunch,
  runFunctionHookChain,
} from '../../../utils/plugins/functionHooksModules.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import { Stream } from '../../../utils/stream.js'
import { logOTelEvent } from '../../../utils/telemetry/events.js'
import { toolSourceAttributes } from '../../../utils/telemetry/toolSource.js'
import { processToolResultBlock } from '../../../utils/toolResultStorage.js'
import type { getLoggingSafeMcpBaseUrl } from '../../mcp/utils.js'
import { collectManagedOnlyPostToolUse } from '../toolHooks.js'
import { sanitizeHookUpdatedInputSync } from './permissionGate.js'
import {
  buildToolCallDenyMessages,
  extractSuccessfulToolUseResult,
  extractToolResultSummary,
  extractToolUseResultFromMessages,
  rebuildMessagesWithReplacedToolResult,
} from './resultFormatting.js'
import {
  isEmptyRecord,
  isPlainRecord,
  isToolBridgeEvent,
  type McpServerType,
  type MessageUpdateLazy,
  type OnToolProgressFn,
  type ToolBridgeEvent,
  type ToolCallCoreCapture,
} from './types.js'

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

export type ExecuteCoreToolCallFn = (
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
) => Promise<MessageUpdateLazy[]>

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
  onToolProgress: OnToolProgressFn,
  executeCore: ExecuteCoreToolCallFn,
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
              const messages = await executeCore(
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
          executeCore(
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

  return executeCore(
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
  onToolProgress: OnToolProgressFn,
  executeCore: ExecuteCoreToolCallFn,
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
      executeCore,
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

export function streamedCheckPermissionsAndCallTool(
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
  executeCore: ExecuteCoreToolCallFn,
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
    executeCore,
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
