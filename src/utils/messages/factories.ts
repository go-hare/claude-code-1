/**
 * User, assistant, progress, system, and boundary message factories, plus shutdown-interrupted tool-result rewriters.
 */

import type { APIError } from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaUsage as Usage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type {
  ContentBlock,
  ContentBlockParam,
  ToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { randomUUID, type UUID } from 'crypto'
import type { SDKAssistantMessageError } from 'src/entrypoints/agentSdkTypes.js'
import { NO_CONTENT_MESSAGE } from '../../constants/messages.js'
import {
  COMMAND_ARGS_TAG,
  COMMAND_MESSAGE_TAG,
  COMMAND_NAME_TAG,
  LOCAL_COMMAND_CAVEAT_TAG,
  LOCAL_COMMAND_STDOUT_TAG,
} from '../../constants/xml.js'
import type { AnyObject, Progress, Tool } from '../../Tool.js'
import type {
  AssistantMessage,
  Message,
  MessageOrigin,
  MessageType,
  PartialCompactDirection,
  ProgressMessage,
  StopHookInfo,
  SystemAgentsKilledMessage,
  SystemAPIErrorMessage,
  SystemApiMetricsMessage,
  SystemAwaySummaryMessage,
  SystemBridgeStatusMessage,
  SystemCompactBoundaryMessage,
  SystemInformationalMessage,
  SystemLocalCommandMessage,
  SystemMemorySavedMessage,
  SystemMessageLevel,
  SystemMicrocompactBoundaryMessage,
  SystemPermissionRetryMessage,
  SystemScheduledTaskFireMessage,
  SystemStopHookSummaryMessage,
  SystemTurnDurationMessage,
  ToolUseSummaryMessage,
  UserMessage,
} from '../../types/message.js'
import type { PermissionMode } from '../../types/permissions.js'
import { logForDebugging } from '../debug.js'
import { formatTokens } from '../format.js'
import { em } from '../model/modelNoticeCode.js'
import { jsonStringify } from '../slowOperations.js'
import {
  CANCEL_MESSAGE,
  INTERRUPT_MESSAGE,
  INTERRUPT_MESSAGE_FOR_TOOL_USE,
  SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
  SYNTHETIC_MODEL,
} from './constants.js'

function baseCreateAssistantMessage({
  content,
  isApiErrorMessage = false,
  apiError,
  error,
  errorDetails,
  truncatedAfterOutput,
  requestId,
  apiErrorStatus,
  isVirtual,
  usage = {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 },
    service_tier: null,
    cache_creation: {
      ephemeral_1h_input_tokens: 0,
      ephemeral_5m_input_tokens: 0,
    },
    inference_geo: null,
    iterations: null,
    speed: null,
  },
}: {
  content: BetaContentBlock[]
  isApiErrorMessage?: boolean
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
  truncatedAfterOutput?: boolean
  requestId?: string
  apiErrorStatus?: number
  isVirtual?: true
  usage?: Usage
}): AssistantMessage {
  return {
    type: 'assistant',
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
    message: {
      id: randomUUID(),
      container: null,
      model: SYNTHETIC_MODEL,
      role: 'assistant',
      stop_reason: 'stop_sequence',
      stop_sequence: '',
      type: 'message',
      usage,
      content: content as ContentBlock[],
      context_management: null,
    },
    requestId,
    apiErrorStatus,
    apiError,
    error,
    errorDetails,
    truncatedAfterOutput,
    isApiErrorMessage,
    isVirtual,
  }
}

export function createAssistantMessage({
  content,
  usage,
  isVirtual,
}: {
  content: string | BetaContentBlock[]
  usage?: Usage
  isVirtual?: true
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content:
      typeof content === 'string'
        ? [
            {
              type: 'text' as const,
              text: content === '' ? NO_CONTENT_MESSAGE : content,
            } as BetaContentBlock, // NOTE: citations field is not supported in Bedrock API
          ]
        : content,
    usage,
    isVirtual,
  })
}

export function createAssistantAPIErrorMessage({
  content,
  apiError,
  error,
  errorDetails,
  truncatedAfterOutput,
  requestId,
  apiErrorStatus,
}: {
  content: string
  apiError?: AssistantMessage['apiError']
  error?: SDKAssistantMessageError
  errorDetails?: string
  truncatedAfterOutput?: boolean
  requestId?: string
  apiErrorStatus?: number
}): AssistantMessage {
  return baseCreateAssistantMessage({
    content: [
      {
        type: 'text' as const,
        text: content === '' ? NO_CONTENT_MESSAGE : content,
      } as BetaContentBlock, // NOTE: citations field is not supported in Bedrock API
    ],
    isApiErrorMessage: true,
    apiError,
    error,
    errorDetails,
    truncatedAfterOutput,
    requestId,
    apiErrorStatus,
  })
}

export function createUserMessage({
  content,
  isMeta,
  isVisibleInTranscriptOnly,
  isVirtual,
  isCompactSummary,
  summarizeMetadata,
  toolUseResult,
  mcpMeta,
  toolEndsTurn,
  hostClassifierContext,
  uuid,
  timestamp,
  imagePasteIds,
  sourceToolAssistantUUID,
  permissionMode,
  origin,
  interruptedMessageId,
  interruptedByShutdown,
  turnCompanion,
  replacesSpan,
  sourceToolUseID,
  promptShellHandOff,
  taskDelivery,
}: {
  content: string | ContentBlockParam[]
  isMeta?: true
  isVisibleInTranscriptOnly?: true
  isVirtual?: true
  isCompactSummary?: true
  toolUseResult?: unknown // Matches tool's `Output` type
  /** MCP protocol metadata to pass through to SDK consumers (never sent to model) */
  mcpMeta?: {
    _meta?: Record<string, unknown>
    structuredContent?: Record<string, unknown>
  }
  /**
   * densable 2.1.283 `toolEndsTurn` / smo @ 184413938. Successful StructuredOutput
   * (and MCP claude/endTurn) ask query not to recurse.
   */
  toolEndsTurn?: boolean
  hostClassifierContext?: string
  uuid?: UUID | string
  timestamp?: string
  imagePasteIds?: number[]
  // For tool_result messages: the UUID of the assistant message containing the matching tool_use
  sourceToolAssistantUUID?: UUID
  // Permission mode when message was sent (for rewind restoration)
  permissionMode?: PermissionMode
  summarizeMetadata?: {
    messagesSummarized: number
    userContext?: string
    direction?: PartialCompactDirection
  }
  // Provenance of this message. undefined = human (keyboard).
  origin?: MessageOrigin
  /** densable Tse/jr — Esc-cancelled API msg_* id on interrupt markers */
  interruptedMessageId?: string
  /** densable Ede — shutdown abort path */
  interruptedByShutdown?: boolean
  /** densable leftover #55 GJn — official dt({turnCompanion:!0}) */
  turnCompanion?: true
  /** densable leftover #55 — official dt({replacesSpan}) @217912782. */
  replacesSpan?: true
  /** densable leftover #55 ae @209364706. */
  sourceToolUseID?: string
  /**
   * densable `promptShellHandOff` — skill inline `!` shell commands collected
   * during getPromptForCommand. Skip Be elision when set.
   */
  promptShellHandOff?: {
    agentId: string | null
    commands: Array<{ tool: string; command: string }>
  }
  /** densable BX `taskDelivery` — GetTask snapshot on As. */
  taskDelivery?: unknown
}): UserMessage {
  const m: UserMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: content || NO_CONTENT_MESSAGE, // Make sure we don't send empty messages
    },
    isMeta,
    isVisibleInTranscriptOnly,
    isVirtual,
    isCompactSummary,
    summarizeMetadata,
    uuid: (uuid as UUID | undefined) || randomUUID(),
    timestamp: timestamp ?? new Date().toISOString(),
    toolUseResult,
    mcpMeta,
    toolEndsTurn,
    hostClassifierContext:
      Array.isArray(content) &&
      content.filter(block => block.type === 'tool_result').length === 1
        ? hostClassifierContext
        : undefined,
    imagePasteIds,
    sourceToolAssistantUUID,
    permissionMode,
    origin,
    interruptedMessageId,
    interruptedByShutdown,
    turnCompanion,
    replacesSpan,
    sourceToolUseID,
    ...(promptShellHandOff !== undefined && { promptShellHandOff }),
    ...(taskDelivery !== undefined && { taskDelivery }),
  }
  return m
}

/**
 * densable leftover #55 `ae` @209364706.
 * Companion / tool-sourced user message — not a new human prompt.
 */
export function isCompanionOrToolUserMessage(message: {
  toolUseResult?: unknown
  sourceToolAssistantUUID?: unknown
  sourceToolUseID?: unknown
  turnCompanion?: unknown
}): boolean {
  return (
    message.toolUseResult !== undefined ||
    message.sourceToolAssistantUUID !== undefined ||
    message.sourceToolUseID !== undefined ||
    message.turnCompanion === true
  )
}

function extractExclusiveToolResultIds(message: {
  message?: { content?: unknown }
}): string[] | null {
  const t = message.message?.content
  if (!Array.isArray(t) || t.length === 0) return null
  const n: string[] = []
  for (const r of t) {
    if (
      typeof r !== 'object' ||
      r === null ||
      (r as { type?: unknown }).type !== 'tool_result'
    ) {
      return null
    }
    n.push((r as { tool_use_id: string }).tool_use_id)
  }
  return n
}

function collectToolResultIdsFromContent(message: {
  message?: { content?: unknown }
}): string[] {
  const t = message.message?.content
  return Array.isArray(t)
    ? t.flatMap(n =>
        typeof n === 'object' &&
        n !== null &&
        (n as { type?: unknown }).type === 'tool_result'
          ? [(n as { tool_use_id: string }).tool_use_id]
          : [],
      )
    : []
}

function isSameAssistantMessageById(
  e: { message?: { id?: unknown } },
  t: { message?: { id?: unknown } },
): boolean {
  return (
    e === t || (e.message?.id !== undefined && e.message.id === t.message?.id)
  )
}

/**
 * densable leftover #55 `Ze` @209364748.
 * True when user[t] is only tool_results paired to the preceding assistant
 * tool_uses. `replacesSpan===true` stops the walk.
 */
export function isUserMessageWithPairedToolResultsOnly(
  messages: ReadonlyArray<{
    type?: string
    origin?: unknown
    replacesSpan?: unknown
    message?: { content?: unknown; id?: unknown }
    toolUseResult?: unknown
    sourceToolAssistantUUID?: unknown
    sourceToolUseID?: unknown
    turnCompanion?: unknown
  }>,
  t: number,
): boolean {
  const n = messages[t]
  if (
    n?.type !== 'user' ||
    !(n.origin === undefined || isUnsetOrHumanMessageOrigin(n.origin))
  ) {
    return false
  }
  const r = extractExclusiveToolResultIds(n)
  if (r === null) return false
  const i = new Set(r)
  let p:
    | {
        type?: string
        message?: { content?: unknown; id?: unknown }
      }
    | undefined
  for (let u = t - 1; u >= 0 && i.size > 0; u--) {
    const s = messages[u]
    if (s?.type === 'assistant') {
      if (p !== undefined && !isSameAssistantMessageById(s, p)) break
      p = s
      const d = s.message?.content
      for (const f of Array.isArray(d) ? d : []) {
        if (
          typeof f === 'object' &&
          f !== null &&
          (f as { type?: unknown }).type === 'tool_use'
        ) {
          i.delete((f as { id: string }).id)
        }
      }
    } else if (s?.type === 'user') {
      if (s.replacesSpan === true) break
      const d = isCompanionOrToolUserMessage(s)
        ? collectToolResultIdsFromContent(s)
        : extractExclusiveToolResultIds(s)
      if (d === null) break
      if (d.some(f => i.has(f))) return false
    }
  }
  return i.size === 0
}

/** densable leftover #55 `S` — origin unset or kind human. */
function isUnsetOrHumanMessageOrigin(origin: unknown): boolean {
  return (
    origin === undefined ||
    (typeof origin === 'object' &&
      origin !== null &&
      (origin as { kind?: unknown }).kind === 'human')
  )
}

export function prepareUserContent({
  inputString,
  precedingInputBlocks,
}: {
  inputString: string
  precedingInputBlocks: ContentBlockParam[]
}): string | ContentBlockParam[] {
  if (precedingInputBlocks.length === 0) {
    return inputString
  }

  return [
    ...precedingInputBlocks,
    {
      text: inputString,
      type: 'text',
    },
  ]
}

/**
 * densable `Tse` — synthetic `[Request interrupted by user]` marker.
 * Callers must gate with `shouldSuppressInterruptionMessage` (densable `m0e`/`Cxg`)
 * so submit-interrupt and refusal-fallback-edit do not inject a spurious line.
 */
export function createUserInterruptionMessage({
  toolUse = false,
  interruptedMessageId,
  interruptedByShutdown,
}: {
  toolUse?: boolean
  interruptedMessageId?: string
  interruptedByShutdown?: boolean
}): UserMessage {
  const content = toolUse ? INTERRUPT_MESSAGE_FOR_TOOL_USE : INTERRUPT_MESSAGE

  return createUserMessage({
    content: [
      {
        type: 'text',
        text: content,
      },
    ],
    interruptedMessageId,
    interruptedByShutdown,
  })
}

/**
 * Official 2.1.296 (#499) `P3`: true when a user message was marked
 * `interruptedByShutdown` and carries at least one `tool_result` block.
 */
export function isShutdownInterruptedToolResultMessage(
  message: Message,
): boolean {
  if (message.type !== 'user' || message.interruptedByShutdown !== true) {
    return false
  }
  const content = message.message?.content
  return (
    Array.isArray(content) &&
    content.some(block => block.type === 'tool_result')
  )
}

/**
 * Official 2.1.296 (#499) `HKr`: rewrite a shutdown-interrupted user message
 * so resumed subagents see `SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE` instead
 * of a user-rejection / user-interrupt message.
 */
export function rewriteShutdownInterruptedToolResult(
  message: UserMessage,
  replacement: string = SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
): UserMessage {
  if (
    message.interruptedByShutdown !== true ||
    !Array.isArray(message.message.content)
  ) {
    return message
  }
  if (!isShutdownInterruptedToolResultMessage(message)) {
    const isToolUseInterrupt = message.message.content.some(
      block =>
        block.type === 'text' && block.text === INTERRUPT_MESSAGE_FOR_TOOL_USE,
    )
    return isToolUseInterrupt
      ? {
          ...message,
          message: {
            ...message.message,
            content: [{ type: 'text', text: INTERRUPT_MESSAGE }],
          },
        }
      : message
  }
  const { interruptedByShutdown: _interruptedByShutdown, ...rest } = message
  return {
    ...rest,
    toolUseResult: replacement,
    toolDenialKind: 'interrupted',
    message: {
      ...message.message,
      content: message.message.content.map(block =>
        block.type === 'tool_result'
          ? { ...block, content: replacement }
          : block,
      ),
    },
  }
}

/**
 * Official 2.1.296 (#499) `bxn`: rewrite shutdown-interrupted tool_result
 * messages in a resumed subagent's transcript.
 */
export function rewriteResumedSubagentShutdownToolResults(
  messages: Message[],
  replacement: string = SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
): Message[] {
  return messages.map(msg =>
    msg.type === 'user' && msg.interruptedByShutdown === true
      ? rewriteShutdownInterruptedToolResult(msg as UserMessage, replacement)
      : msg,
  )
}

const MCP_TOOL_NAME_PREFIX = 'mcp__'

function isMcpToolNameForShutdownRewrite(name: unknown): boolean {
  return typeof name === 'string' && name.startsWith(MCP_TOOL_NAME_PREFIX)
}

function isHandedOffOrInputAssistant(msg: AssistantMessage): boolean {
  return (
    (msg as { handedOff?: unknown }).handedOff === true ||
    (msg as { madeBy?: unknown }).madeBy === 'input'
  )
}

/**
 * Official 2.1.328 `jqn`: return tool_use IDs from an assistant message only
 * when every tool_use in that message is an MCP tool (`mcp__` prefix) and the
 * message is not handed-off / input-made.
 */
function getMcpOnlyToolUseIds(msg: Message): string[] {
  if (
    msg.type !== 'assistant' ||
    isHandedOffOrInputAssistant(msg as AssistantMessage) ||
    !Array.isArray(msg.message?.content)
  ) {
    return []
  }
  const toolUses = (
    msg.message.content as Array<{
      type: string
      name?: unknown
      id?: unknown
    }>
  ).filter(block => block.type === 'tool_use')
  if (toolUses.length === 0) {
    return []
  }
  return toolUses.every(block => isMcpToolNameForShutdownRewrite(block.name))
    ? toolUses
        .map(block => block.id)
        .filter((id): id is string => typeof id === 'string')
    : []
}

/**
 * Official 2.1.328 `Bqn` (`chunk@294254613.js:2382675`): collect MCP-only
 * tool_use IDs from assistant messages whose entire tool_use group is in
 * `unresolvedIds`.
 */
export function collectMcpOnlyUnresolvedToolUseIds(
  messages: readonly Message[],
  unresolvedIds: ReadonlySet<string>,
): Set<string> {
  return new Set(
    messages
      .map(getMcpOnlyToolUseIds)
      .filter(ids => ids.length > 0 && ids.every(id => unresolvedIds.has(id)))
      .flat(),
  )
}

/**
 * Official 2.1.328 `Uqn` (`chunk@294254613.js:2382763`): rewrite
 * `interruptedByShutdown` tool_result user messages only when every
 * `tool_result` in that user message belongs to an MCP-only (`mcp__`)
 * assistant tool_use group that has no non-shutdown tool_result and is not in
 * `excludeIds`. Strips `interruptedByShutdown` and stamps
 * `toolDenialKind: 'interrupted'`.
 */
export function rewriteMcpShutdownInterruptedToolResults(
  messages: readonly Message[],
  replacement: string = SHUTDOWN_INTERRUPTED_TOOL_RESULT_MESSAGE,
  outRewrittenIds?: Set<string>,
  excludeIds?: Iterable<string>,
): Message[] {
  const alreadyResolved = new Set<string>(excludeIds)
  for (const msg of messages) {
    if (
      msg.type === 'user' &&
      Array.isArray(msg.message?.content) &&
      !isShutdownInterruptedToolResultMessage(msg)
    ) {
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          alreadyResolved.add(block.tool_use_id)
        }
      }
    }
  }

  const eligibleMcpIds = new Set<string>()
  return messages.map(msg => {
    for (const id of getMcpOnlyToolUseIds(msg)) {
      if (!alreadyResolved.has(id)) {
        eligibleMcpIds.add(id)
      }
    }
    if (
      msg.type !== 'user' ||
      !Array.isArray(msg.message?.content) ||
      !isShutdownInterruptedToolResultMessage(msg)
    ) {
      return msg
    }
    const content = msg.message.content
    if (
      !content.every(
        block =>
          block.type !== 'tool_result' || eligibleMcpIds.has(block.tool_use_id),
      )
    ) {
      return msg
    }
    for (const block of content) {
      if (block.type === 'tool_result') {
        outRewrittenIds?.add(block.tool_use_id)
      }
    }
    const { interruptedByShutdown: _interruptedByShutdown, ...rest } =
      msg as UserMessage
    return {
      ...rest,
      toolUseResult: replacement,
      toolDenialKind: 'interrupted',
      message: {
        ...msg.message,
        content: content.map(block =>
          block.type === 'tool_result'
            ? { ...block, content: replacement }
            : block,
        ),
      },
    }
  })
}

/**
 * Creates a new synthetic user caveat message for local commands (eg. bash, slash).
 * We need to create a new message each time because messages must have unique uuids.
 */
export function createSyntheticUserCaveatMessage(): UserMessage {
  return createUserMessage({
    content: `<${LOCAL_COMMAND_CAVEAT_TAG}>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</${LOCAL_COMMAND_CAVEAT_TAG}>`,
    isMeta: true,
  })
}

/**
 * Formats the command-input breadcrumb the model sees when a slash command runs.
 */
export function formatCommandInputTags(
  commandName: string,
  args: string,
): string {
  return `<${COMMAND_NAME_TAG}>/${commandName}</${COMMAND_NAME_TAG}>
            <${COMMAND_MESSAGE_TAG}>${commandName}</${COMMAND_MESSAGE_TAG}>
            <${COMMAND_ARGS_TAG}>${args}</${COMMAND_ARGS_TAG}>`
}

/**
 * Builds the breadcrumb trail the SDK set_model control handler injects
 * so the model can see mid-conversation switches. Same shape the CLI's
 * /model command produces via processSlashCommand.
 */
export function createModelSwitchBreadcrumbs(
  modelArg: string,
  resolvedDisplay: string,
): UserMessage[] {
  return [
    createSyntheticUserCaveatMessage(),
    createUserMessage({ content: formatCommandInputTags('model', modelArg) }),
    createUserMessage({
      content: `<${LOCAL_COMMAND_STDOUT_TAG}>Set model to ${em(resolvedDisplay)}</${LOCAL_COMMAND_STDOUT_TAG}>`,
    }),
  ]
}

export function createProgressMessage<P extends Progress>({
  toolUseID,
  parentToolUseID,
  data,
}: {
  toolUseID: string
  parentToolUseID: string
  data: P
}): ProgressMessage<P> {
  return {
    type: 'progress',
    data,
    toolUseID,
    parentToolUseID,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}

export function createToolResultStopMessage(
  toolUseID: string,
): ToolResultBlockParam {
  return {
    type: 'tool_result',
    content: CANCEL_MESSAGE,
    is_error: true,
    tool_use_id: toolUseID,
  }
}

export function createToolResultMessage<Output>(
  tool: Tool<AnyObject, Output>,
  toolUseResult: Output,
): UserMessage {
  try {
    const result = tool.mapToolResultToToolResultBlockParam(toolUseResult, '1')

    // If the result contains image content blocks, preserve them as is
    if (
      Array.isArray(result.content) &&
      result.content.some(block => block.type === 'image')
    ) {
      return createUserMessage({
        content: result.content as ContentBlockParam[],
        isMeta: true,
      })
    }

    // For string content, use raw string — jsonStringify would escape \n→\\n,
    // wasting ~1 token per newline (a 2000-line @-file = ~1000 wasted tokens).
    // Keep jsonStringify for array/object content where structure matters.
    const contentStr =
      typeof result.content === 'string'
        ? result.content
        : jsonStringify(result.content)
    return createUserMessage({
      content: `Result of calling the ${tool.name} tool:\n${contentStr}`,
      isMeta: true,
    })
  } catch {
    return createUserMessage({
      content: `Result of calling the ${tool.name} tool: Error`,
      isMeta: true,
    })
  }
}

export function createToolUseMessage(
  toolName: string,
  input: { [key: string]: string | number },
): UserMessage {
  return createUserMessage({
    content: `Called the ${toolName} tool with the following input: ${jsonStringify(input)}`,
    isMeta: true,
  })
}

export function createSystemMessage(
  content: string,
  level: SystemMessageLevel,
  toolUseID?: string,
  preventContinuation?: boolean,
): SystemInformationalMessage {
  return {
    type: 'system',
    subtype: 'informational',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    level,
    ...(preventContinuation && { preventContinuation }),
  }
}

/**
 * Gold `Mtn` (#1426): lead-in text for `permission_retry` system messages.
 */
export function formatPermissionRetryPrefix(
  heardAtNextPrompt?: boolean,
): string {
  return heardAtNextPrompt
    ? 'At your next prompt, Claude will be told it may retry'
    : 'Told Claude it may retry'
}

/**
 * Gold `Dtn` (#1426): trailing explanation for `permission_retry` system messages.
 */
export function formatPermissionRetrySuffix(commandCount: number): string {
  return `Auto mode checks ${commandCount === 1 ? 'it' : 'them'} again; this adds no rule.`
}

export function createPermissionRetryMessage(
  commands: string[],
  heardAtNextPrompt = false,
): SystemPermissionRetryMessage {
  return {
    type: 'system',
    subtype: 'permission_retry',
    content: `${formatPermissionRetryPrefix(heardAtNextPrompt)} ${commands.join(', ')}. ${formatPermissionRetrySuffix(commands.length)}`,
    commands,
    heardAtNextPrompt,
    level: 'info',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createBridgeStatusMessage(
  url: string,
  upgradeNudge?: string,
): SystemBridgeStatusMessage {
  return {
    type: 'system',
    subtype: 'bridge_status',
    content: `/remote-control is active. Code in CLI or at ${url}`,
    url,
    upgradeNudge,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createScheduledTaskFireMessage(
  content: string,
): SystemScheduledTaskFireMessage {
  return {
    type: 'system',
    subtype: 'scheduled_task_fire',
    content,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

export function createStopHookSummaryMessage(
  hookCount: number,
  hookInfos: StopHookInfo[],
  hookErrors: string[],
  preventedContinuation: boolean,
  stopReason: string | undefined,
  hasOutput: boolean,
  level: SystemMessageLevel,
  toolUseID?: string,
  hookLabel?: string,
  totalDurationMs?: number,
  hookAdditionalContext?: string[],
): SystemStopHookSummaryMessage {
  return {
    type: 'system',
    subtype: 'stop_hook_summary',
    hookCount,
    hookInfos,
    hookErrors,
    hookAdditionalContext,
    preventedContinuation,
    stopReason,
    hasOutput,
    level,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    toolUseID,
    hookLabel: hookLabel ?? '',
    totalDurationMs,
  }
}

/**
 * densable CWr(durationMs, budget?, messageCount?, pe?).
 * pe = pendingBackgroundAgentCount — live `agent:` keepalive children when
 * the agent parks on JXt (Yqe) instead of BRt-notifying the owner.
 */
export function createTurnDurationMessage(
  durationMs: number,
  budget?: { tokens: number; limit: number; nudges: number },
  messageCount?: number,
  pendingBackgroundAgentCount?: number,
  pendingWorkflowCount?: number,
): SystemTurnDurationMessage {
  return {
    type: 'system',
    subtype: 'turn_duration',
    durationMs,
    budgetTokens: budget?.tokens,
    budgetLimit: budget?.limit,
    budgetNudges: budget?.nudges,
    messageCount,
    ...(pendingBackgroundAgentCount !== undefined
      ? { pendingBackgroundAgentCount }
      : {}),
    ...(pendingWorkflowCount !== undefined ? { pendingWorkflowCount } : {}),
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  } as SystemTurnDurationMessage
}

export function createAwaySummaryMessage(
  content: string,
): SystemAwaySummaryMessage {
  return {
    type: 'system',
    subtype: 'away_summary',
    content,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createMemorySavedMessage(
  writtenPaths: string[],
): SystemMemorySavedMessage {
  return {
    type: 'system',
    subtype: 'memory_saved',
    writtenPaths,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createAgentsKilledMessage(): SystemAgentsKilledMessage {
  return {
    type: 'system',
    subtype: 'agents_killed',
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export function createApiMetricsMessage(metrics: {
  ttftMs: number
  otps: number
  isP50?: boolean
  hookDurationMs?: number
  turnDurationMs?: number
  toolDurationMs?: number
  classifierDurationMs?: number
  toolCount?: number
  hookCount?: number
  classifierCount?: number
  configWriteCount?: number
}): SystemApiMetricsMessage {
  return {
    type: 'system',
    subtype: 'api_metrics',
    ttftMs: metrics.ttftMs,
    otps: metrics.otps,
    isP50: metrics.isP50,
    hookDurationMs: metrics.hookDurationMs,
    turnDurationMs: metrics.turnDurationMs,
    toolDurationMs: metrics.toolDurationMs,
    classifierDurationMs: metrics.classifierDurationMs,
    toolCount: metrics.toolCount,
    hookCount: metrics.hookCount,
    classifierCount: metrics.classifierCount,
    configWriteCount: metrics.configWriteCount,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
  }
}

export type LocalCommandRun = { command: string; args?: string }

export function createCommandInputMessage(
  content: string,
  extras?: { commandRun?: LocalCommandRun; isDisplayOnly?: boolean },
): SystemLocalCommandMessage {
  return {
    type: 'system',
    subtype: 'local_command',
    content,
    level: 'info',
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    isMeta: false,
    ...(extras?.commandRun !== undefined && { commandRun: extras.commandRun }),
    ...(extras?.isDisplayOnly === true && { isDisplayOnly: true }),
  } as SystemLocalCommandMessage
}

export function createCompactBoundaryMessage(
  trigger: 'manual' | 'auto',
  preTokens: number,
  lastPreCompactMessageUuid?: UUID,
  userContext?: string,
  messagesSummarized?: number,
): SystemCompactBoundaryMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    content: `Conversation compacted`,
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    compactMetadata: {
      trigger,
      preTokens,
      userContext,
      messagesSummarized,
    },
    ...(lastPreCompactMessageUuid && {
      logicalParentUuid: lastPreCompactMessageUuid,
    }),
  }
}

export function createMicrocompactBoundaryMessage(
  trigger: 'auto',
  preTokens: number,
  tokensSaved: number,
  compactedToolIds: string[],
  clearedAttachmentUUIDs: string[],
): SystemMicrocompactBoundaryMessage {
  logForDebugging(
    `[microcompact] saved ~${formatTokens(tokensSaved)} tokens (cleared ${compactedToolIds.length} tool results)`,
  )
  return {
    type: 'system',
    subtype: 'microcompact_boundary',
    content: 'Context microcompacted',
    isMeta: false,
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
    level: 'info',
    microcompactMetadata: {
      trigger,
      preTokens,
      tokensSaved,
      compactedToolIds,
      clearedAttachmentUUIDs,
    },
  }
}

export type ApiErrorRetrySource = 'request_retry' | 'cut_retry'

export function createSystemAPIErrorMessage(
  error: APIError,
  retryInMs: number,
  retryAttempt: number,
  maxRetries: number,
  source?: ApiErrorRetrySource,
): SystemAPIErrorMessage {
  return {
    type: 'system',
    subtype: 'api_error',
    level: 'error',
    cause: error.cause instanceof Error ? error.cause : undefined,
    error,
    retryInMs,
    retryAttempt,
    maxRetries,
    ...(source !== undefined ? { source } : {}),
    timestamp: new Date().toISOString(),
    uuid: randomUUID(),
  }
}

/**
 * Creates a tool use summary message for SDK emission.
 * Tool use summaries provide human-readable progress updates after tool batches complete.
 */
export function createToolUseSummaryMessage(
  summary: string,
  precedingToolUseIds: string[],
): ToolUseSummaryMessage {
  return {
    type: 'tool_use_summary' as MessageType,
    summary,
    precedingToolUseIds,
    uuid: randomUUID(),
    timestamp: new Date().toISOString(),
  }
}
