import type { ToolUseBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import {
  createUserMessage,
  REJECT_MESSAGE,
  STOPPED_WHILE_RUNNING_REJECT_MESSAGE,
  withMemoryCorrectionHint,
} from 'src/utils/messages.js'
import type { CanUseToolFn } from '../../hooks/useCanUseTool.js'
import { findToolByName, type Tools, type ToolUseContext } from '../../Tool.js'
import { BASH_TOOL_NAME } from '@claude-code/builtin-tools/tools/BashTool/toolName.js'
import type { AssistantMessage, Message } from '../../types/message.js'
import {
  createAbortController,
  createChildAbortController,
  isRemoteCancelAbortReason,
} from '../../utils/abortController.js'
import {
  isSingleShotPrintSession,
  getMainThreadAgentHooks,
  getRegisteredHooks,
  getSessionId,
} from '../../bootstrap/state.js'
import { getPermissionConfirm } from '../../dialog/permissionConfirmRegistry.js'
import {
  getHooksConfigFromSnapshot,
  shouldDisableAllHooksIncludingManaged,
} from '../../utils/hooks/hooksConfigSnapshot.js'
import { hasMatchingFunctionHook } from '../../utils/plugins/functionHooksModules.js'
import { isUserPromptWaiting } from '../../utils/sessionHost.js'
import { getCwd } from '../../utils/cwd.js'
import { ToolPermissionPromptsUp } from '../../utils/toolState.js'
import { escapeXml } from '../../utils/xml.js'
import { isToolBridgeEvent, runToolUse } from './toolExecution.js'
import type { ToolBridgeEvent } from './toolExecution.js'
import { registerForegroundToolCall } from '../../utils/foregroundToolCalls.js'
import { createToolBatchSpan, endToolBatchSpan } from '../langfuse/index.js'
import type { LangfuseSpan } from '../langfuse/index.js'
import { logEvent } from '../analytics/index.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '../analytics/growthbook.js'
import { areBackgroundTasksDisabled } from '../../utils/sessionBackgroundGates.js'
import {
  persistToolResult,
  processPreMappedToolResultBlock,
} from '../../utils/toolResultStorage.js'
import { plural } from '../../utils/stringUtils.js'

/** densable `lOt` = `fwt - 2000` (notification cap 1e5). */
const DETACH_OVERSIZE_CHARS = 98_000
import { sanitizeToolNameForAnalytics } from '../analytics/metadata.js'
import { logForDebugging } from '../../utils/debug.js'
import {
  detachedToolCallEnded,
  detachedToolCallLetGo,
  detachedToolCallResultQueued,
  detachedToolCallSetText,
  detachedToolCallSettled,
  detachedToolCallStarted,
  detachedToolCallWasLetGo,
  getDetachedToolCallSnapshot,
  isDetachBackgrounding,
} from '../../utils/detachedToolCallStore.js'
import { AbortError } from '../../utils/errors.js'
import {
  enqueueDetachedToolCallResult,
  stillRunningDetachText,
} from '../../utils/detachedToolCallNotify.js'

const RUN_TOOL_USE_HANDLES_DETACH_SYMBOL = Symbol.for(
  'claude.runToolUseHandlesDetach',
)

function executorCanDetachFallback(
  tool: { name: string; aliases?: string[]; backgrounding?: string },
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
    if (shouldDisableAllHooksIncludingManaged()) return true
    if (
      hasMatchingFunctionHook('PostToolUse', { tool_name: tool.name }) ||
      hasMatchingFunctionHook('PostToolUseFailure', { tool_name: tool.name }) ||
      hasMatchingFunctionHook('PostToolBatch') ||
      hasMatchingFunctionHook('tool.call', { tool: tool.name })
    ) {
      return false
    }
    if (toolUseContext.options.settingsHooksOff === true) return true
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
    const names = [tool.name, ...(tool.aliases ?? [])]
    const matchesTool = (pattern: string | undefined): boolean => {
      if (!pattern || pattern === '*') return true
      if (names.includes(pattern)) return true
      try {
        const re = new RegExp(`^(${pattern})$`)
        return names.some(n => re.test(n))
      } catch {
        return false
      }
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
        if (matchers.some(m => m.hooks.length > 0 && matchesTool(m.matcher))) {
          return false
        }
      }
    }
    for (const src of sources) {
      const matchers = src?.PostToolBatch
      if (Array.isArray(matchers) && matchers.some(m => m.hooks.length > 0)) {
        return false
      }
    }
    return true
  } catch {
    return false
  }
}

function executorPermissionPromptOpen(
  toolUseContext: ToolUseContext,
  toolUseId: string,
): boolean {
  if ((toolUseContext.toolState?.get(ToolPermissionPromptsUp).count ?? 0) > 0) {
    return true
  }
  if (getPermissionConfirm(toolUseId) !== undefined) return true
  if (toolUseContext.session !== undefined) {
    try {
      if (isUserPromptWaiting(toolUseContext.session)) return true
    } catch {
      // Synthetic session objects in unit tests may omit SessionHost state.
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

/** densable `fie` — detach ceiling before the background call is stopped. */
const DETACH_CEILING_MS = 300_000

/**
 * densable detach ceiling settle. `runToolUse` abort yields CANCEL_MESSAGE
 * and returns (does not throw), so the drain success arm must force this
 * — do not rely on the rejection arm.
 */
function isDetachedCeilingHit(
  ceilingHit: boolean,
  abortReason: unknown,
): boolean {
  return ceilingHit || abortReason === 'detached-ceiling'
}

function detachedCeilingResultText(): string {
  return `The call did not finish within ${DETACH_CEILING_MS / 60000} minutes and was stopped.`
}

function detachedResultText(messages: Message[]): {
  text: string
  failed: boolean
} {
  let failed = false
  const parts: string[] = []
  let nonText = 0
  for (const m of messages) {
    if (m.type !== 'user' || m.message === undefined) continue
    const c = m.message.content
    if (typeof c === 'string') {
      parts.push(c)
      continue
    }
    if (!Array.isArray(c)) continue
    for (const b of c) {
      if (!b || typeof b !== 'object') continue
      if (b.type === 'tool_result') {
        if (b.is_error === true) failed = true
        const inner = (b as { content?: unknown }).content
        if (typeof inner === 'string') parts.push(inner)
        else if (Array.isArray(inner)) {
          for (const x of inner) {
            if (x && typeof x === 'object' && 'text' in x) {
              parts.push(String((x as { text?: unknown }).text ?? ''))
            } else {
              nonText++
            }
          }
        }
      } else if (b.type === 'text' && 'text' in b) {
        parts.push(String((b as { text?: unknown }).text ?? ''))
      }
    }
  }
  if (nonText > 0) {
    parts.push(
      `[${nonText} non-text ${plural(nonText, 'block')} of the result could not be carried in a notification]`,
    )
  }
  return { text: parts.join('\n'), failed }
}

/** densable `eyo` — mapToolResult content → notification text. */
function eyo(content: unknown): string {
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

type MessageUpdate = {
  message?: Message
  newContext?: ToolUseContext
} & Partial<ToolBridgeEvent>

type ToolStatus = 'queued' | 'executing' | 'completed' | 'yielded'

type ContextLayer = NonNullable<ToolUseContext['permissionLayers']>[number]

/**
 * Official 325 `YIe` (#1894) — append tool-emitted `contextLayers` (including
 * `working_directory`) onto `ToolUseContext.permissionLayers` and mirror model
 * / max_thinking_tokens updates onto `options`.
 */
export function applyContextLayersToToolUseContext(
  context: ToolUseContext,
  layers: readonly ContextLayer[],
): ToolUseContext {
  if (layers.length === 0) return context
  const nextLayers = context.permissionLayers
    ? [...context.permissionLayers, ...layers]
    : [...layers]
  let mainLoopModel: string | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (
      layer &&
      layer.kind === 'model' &&
      typeof layer.mainLoopModel === 'string'
    ) {
      mainLoopModel = layer.mainLoopModel
      break
    }
  }
  let thinkingConfig: ToolUseContext['options']['thinkingConfig'] | undefined
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i]
    if (layer && layer.kind === 'max_thinking_tokens') {
      const tokens = layer.maxThinkingTokens
      if (typeof tokens === 'number') {
        thinkingConfig =
          tokens === 0
            ? { type: 'disabled' }
            : { type: 'enabled', budgetTokens: tokens }
      }
      break
    }
  }
  return {
    ...context,
    permissionLayers: nextLayers,
    ...(mainLoopModel !== undefined || thinkingConfig !== undefined
      ? {
          options: {
            ...context.options,
            ...(mainLoopModel !== undefined ? { mainLoopModel } : {}),
            ...(thinkingConfig !== undefined ? { thinkingConfig } : {}),
          },
        }
      : {}),
  }
}

type TrackedTool = {
  id: string
  block: ToolUseBlock
  assistantMessage: AssistantMessage
  status: ToolStatus
  isConcurrencySafe: boolean
  promise?: Promise<void>
  results?: Message[]
  // Progress messages are stored separately and yielded immediately
  pendingProgress: Message[]
  // densable pendingBridgeEvents — jR control events (set_expanded_view)
  pendingBridgeEvents: ToolBridgeEvent[]
  contextModifiers?: Array<(context: ToolUseContext) => ToolUseContext>
  contextModifiersApplied?: boolean
  contextLayers?: ContextLayer[]
  contextLayersApplied?: boolean
}

export type ExclusiveCallQueuedBehindEntry = {
  isQueued: () => boolean
  mayYetBeQueued: () => boolean
  holdLogged: boolean
}

export const exclusiveCallQueuedBehind = new Map<
  string,
  ExclusiveCallQueuedBehindEntry
>()

/**
 * Executes tools as they stream in with concurrency control.
 * - Concurrent-safe tools can execute in parallel with other concurrent-safe tools
 * - Non-concurrent tools must execute alone (exclusive access)
 * - Results are buffered and emitted in the order tools were received
 */
export class StreamingToolExecutor {
  private tools: TrackedTool[] = []
  private toolUseContext: ToolUseContext
  private hasErrored = false
  private erroredToolDescription = ''
  private siblingAbortController: AbortController
  private discarded = false
  private responseOpen = true
  private progressAvailableResolve?: () => void
  private drainableResolve?: () => void
  private drainGeneration = 0
  private turnSpan: LangfuseSpan | null = null
  private appliedConcurrentContextModifiers = false

  constructor(
    private readonly toolDefinitions: Tools,
    private readonly canUseTool: CanUseToolFn,
    toolUseContext: ToolUseContext,
  ) {
    this.toolUseContext = toolUseContext
    this.siblingAbortController = createChildAbortController(
      toolUseContext.abortController,
    )
  }

  /**
   * Discards all pending and in-progress tools. Called when streaming fallback
   * occurs and results from the failed attempt should be abandoned.
   * Queued tools won't start, and in-progress tools will receive synthetic errors.
   *
   * Releases all internal references (tools array, abort controller, context)
   * so that the discarded executor and its buffered results can be garbage-collected.
   * Without this, repeated API retries in NO_FLICKER mode accumulate leaked
   * TrackedTool objects (each holding assistantMessage, results, pendingProgress).
   */
  discard(): void {
    this.discarded = true
    this.wakeWaiters()
    // Abort running tool subprocesses (Bash spawns, etc.) so they don't
    // continue producing results after the executor is replaced.
    this.siblingAbortController.abort('streaming_fallback')
    // Release references to allow GC of tool blocks, messages, and promises.
    this.tools.length = 0
    this.progressAvailableResolve = undefined
    if (this.turnSpan) {
      endToolBatchSpan(this.turnSpan)
      this.turnSpan = null
    }
  }

  /**
   * Add a tool to the execution queue. Will start executing immediately if conditions allow.
   */
  addTool(block: ToolUseBlock, assistantMessage: AssistantMessage): void {
    // Create turn span on first tool — will be ended in getRemainingResults
    if (this.tools.length === 0 && this.turnSpan === null) {
      this.turnSpan = createToolBatchSpan(
        this.toolUseContext.langfuseTrace ?? null,
        { toolNames: [block.name], batchIndex: 0 },
      )
      if (this.turnSpan) {
        this.toolUseContext = {
          ...this.toolUseContext,
          langfuseBatchSpan: this.turnSpan,
        }
      }
    }
    const toolDefinition = findToolByName(this.toolDefinitions, block.name)
    if (!toolDefinition) {
      this.tools.push({
        id: block.id,
        block,
        assistantMessage,
        status: 'completed',
        isConcurrencySafe: true,
        pendingProgress: [],
        pendingBridgeEvents: [],
        results: [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                content: `<tool_use_error>Error: No such tool available: ${block.name}</tool_use_error>`,
                is_error: true,
                tool_use_id: block.id,
              },
            ],
            toolUseResult: `Error: No such tool available: ${block.name}`,
            sourceToolAssistantUUID: assistantMessage.uuid,
          }),
        ],
      })
      this.wakeWaiters()
      return
    }

    const parsedInput = toolDefinition.inputSchema.safeParse(block.input)
    const isConcurrencySafe = parsedInput?.success
      ? (() => {
          try {
            return Boolean(toolDefinition.isConcurrencySafe(parsedInput.data))
          } catch {
            return false
          }
        })()
      : false
    this.tools.push({
      id: block.id,
      block,
      assistantMessage,
      status: 'queued',
      isConcurrencySafe,
      pendingProgress: [],
      pendingBridgeEvents: [],
    })

    void this.processQueue()
  }

  private wakeWaiters(): void {
    this.drainGeneration++
    this.progressAvailableResolve?.()
    this.progressAvailableResolve = undefined
    this.drainableResolve?.()
    this.drainableResolve = undefined
  }

  waitForDrainable(generation: number): Promise<number> {
    if (this.drainGeneration > generation) {
      return Promise.resolve(this.drainGeneration)
    }
    return new Promise(resolve => {
      this.drainableResolve = () => resolve(this.drainGeneration)
    })
  }

  /**
   * Check if a tool can execute based on current concurrency state
   */
  private canExecuteTool(isConcurrencySafe: boolean): boolean {
    const executingTools = this.tools.filter(t => t.status === 'executing')
    return (
      executingTools.length === 0 ||
      (isConcurrencySafe && executingTools.every(t => t.isConcurrencySafe))
    )
  }

  /**
   * Process the queue, starting tools when concurrency conditions allow
   */
  private async processQueue(): Promise<void> {
    for (const tool of this.tools) {
      if (tool.status !== 'queued') continue

      if (this.canExecuteTool(tool.isConcurrencySafe)) {
        this.applyFinishedConcurrentContextModifiers()
        await this.executeTool(tool)
      } else {
        // Can't execute this tool yet, and since we need to maintain order for non-concurrent tools, stop here
        if (!tool.isConcurrencySafe) break
      }
    }
  }

  private createSyntheticErrorMessage(
    toolUseId: string,
    reason:
      | 'sibling_error'
      | 'user_interrupted'
      | 'streaming_fallback'
      | 'conversation_ended',
    assistantMessage: AssistantMessage,
    wasRunning = false,
  ): Message {
    // densable 2.1.214: sibling tools cancelled by EndConversation abort
    // content = Cancelled…; toolUseResult = "Conversation ended by model"
    if (reason === 'conversation_ended') {
      const msg = 'Cancelled: Claude ended the conversation'
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: `<tool_use_error>${msg}</tool_use_error>`,
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Conversation ended by model',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    // For user interruptions (ESC to reject), use REJECT_MESSAGE so the UI shows
    // "User rejected edit" instead of "Error editing file"
    if (reason === 'user_interrupted') {
      const rejectMessage =
        wasRunning &&
        isRemoteCancelAbortReason(
          this.toolUseContext.abortController.signal.reason,
        )
          ? STOPPED_WHILE_RUNNING_REJECT_MESSAGE
          : REJECT_MESSAGE
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content: withMemoryCorrectionHint(rejectMessage),
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'User rejected tool use',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    if (reason === 'streaming_fallback') {
      return createUserMessage({
        content: [
          {
            type: 'tool_result',
            content:
              '<tool_use_error>Error: Streaming fallback - tool execution discarded</tool_use_error>',
            is_error: true,
            tool_use_id: toolUseId,
          },
        ],
        toolUseResult: 'Streaming fallback - tool execution discarded',
        sourceToolAssistantUUID: assistantMessage.uuid,
      })
    }
    const desc = this.erroredToolDescription
    const msg = desc
      ? `Cancelled: parallel tool call ${desc} errored`
      : 'Cancelled: parallel tool call errored'
    return createUserMessage({
      content: [
        {
          type: 'tool_result',
          content: `<tool_use_error>${msg}</tool_use_error>`,
          is_error: true,
          tool_use_id: toolUseId,
        },
      ],
      toolUseResult: msg,
      sourceToolAssistantUUID: assistantMessage.uuid,
    })
  }

  /**
   * Determine why a tool should be cancelled.
   */
  private getAbortReason(
    tool: TrackedTool,
  ):
    | 'sibling_error'
    | 'user_interrupted'
    | 'streaming_fallback'
    | 'conversation_ended'
    | 'remote_cancel'
    | null {
    if (this.discarded) {
      return 'streaming_fallback'
    }
    if (this.hasErrored) {
      return 'sibling_error'
    }
    if (this.toolUseContext.abortController.signal.aborted) {
      const reason = this.toolUseContext.abortController.signal.reason
      // densable 2.1.214: EndConversation aborts with "end_conversation".
      // The EndConversation tool itself is not cancelled (null); siblings
      // get conversation_ended synthetic tool_result.
      if (reason === 'end_conversation') {
        return tool.block.name === 'EndConversation'
          ? null
          : 'conversation_ended'
      }
      // 'interrupt' means the user typed a new message while tools were
      // running. Only cancel tools whose interruptBehavior is 'cancel';
      // 'block' tools shouldn't reach here (abort isn't fired).
      if (reason === 'interrupt') {
        return this.getToolInterruptBehavior(tool) === 'cancel'
          ? 'user_interrupted'
          : null
      }
      // densable 2.1.236 #27: print/SDK SIGTERM is nC("remote-cancel") —
      // kill trees + exit 143, no Interrupted / REJECT synthetic denials.
      if (isRemoteCancelAbortReason(reason)) {
        return 'remote_cancel'
      }
      return 'user_interrupted'
    }
    return null
  }

  private getToolInterruptBehavior(tool: TrackedTool): 'cancel' | 'block' {
    const definition = findToolByName(this.toolDefinitions, tool.block.name)
    if (!definition?.interruptBehavior) return 'block'
    try {
      return definition.interruptBehavior()
    } catch {
      return 'block'
    }
  }

  private getToolDescription(tool: TrackedTool): string {
    const input = tool.block.input as Record<string, unknown> | undefined
    const summary = input?.command ?? input?.file_path ?? input?.pattern ?? ''
    if (typeof summary === 'string' && summary.length > 0) {
      const truncated =
        summary.length > 40 ? summary.slice(0, 40) + '\u2026' : summary
      return `${tool.block.name}(${truncated})`
    }
    return tool.block.name
  }

  /**
   * Official buildSameTurnToolUses — prior tool_use blocks from the same
   * assistant turn that were queued before `tool`. Used by auto-mode sibling
   * context so the classifier sees concurrent tools in this turn.
   * Returns synthetic assistant messages with only those tool_use blocks.
   */
  private buildSameTurnToolUses(tool: TrackedTool): Message[] | undefined {
    try {
      const byAssistant = new Map<AssistantMessage, ToolUseBlock[]>()
      for (const t of this.tools) {
        if (t === tool) break
        const list = byAssistant.get(t.assistantMessage) ?? []
        list.push(t.block)
        byAssistant.set(t.assistantMessage, list)
      }
      if (byAssistant.size === 0) return undefined
      return [...byAssistant.entries()].map(([assistant, blocks]) => ({
        ...assistant,
        message: {
          ...assistant.message,
          content: blocks,
        },
      }))
    } catch (error) {
      // densable 2.1.218 #10: M("tengu_auto_mode_sibling_context_error", {...Rx(t)})
      // Local LogEventMetadata is numeric/boolean only — emit presence marker.
      logEvent('tengu_auto_mode_sibling_context_error', {
        is_error: true,
        is_error_instance: error instanceof Error,
      })
      return undefined
    }
  }

  private updateInterruptibleState(): void {
    const executing = this.tools.filter(t => t.status === 'executing')
    this.toolUseContext.setHasInterruptibleToolInProgress?.(
      executing.length > 0 &&
        executing.every(t => this.getToolInterruptBehavior(t) === 'cancel'),
    )
  }

  /**
   * Execute a tool and collect its results
   */
  private async executeTool(tool: TrackedTool): Promise<void> {
    tool.status = 'executing'
    this.toolUseContext.setInProgressToolUseIDs(prev =>
      new Set(prev).add(tool.id),
    )
    this.updateInterruptibleState()

    const messages: Message[] = []
    const contextModifiers: Array<(context: ToolUseContext) => ToolUseContext> =
      []
    const contextLayers: ContextLayer[] = []
    const cwdBeforeExclusive = !tool.isConcurrencySafe ? getCwd() : undefined

    const collectResults = async () => {
      // If already aborted (by error or user), generate synthetic error block instead of running the tool
      const initialAbortReason = this.getAbortReason(tool)
      if (initialAbortReason === 'remote_cancel') {
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.wakeWaiters()
        this.updateInterruptibleState()
        return
      }
      if (initialAbortReason) {
        messages.push(
          this.createSyntheticErrorMessage(
            tool.id,
            initialAbortReason,
            tool.assistantMessage,
            false,
          ),
        )
        tool.results = messages
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.wakeWaiters()
        this.updateInterruptibleState()
        return
      }

      // Per-tool child controller. Lets siblingAbortController kill running
      // subprocesses (Bash spawns listen to this signal) when a Bash error
      // cascades. Permission-dialog rejection also aborts this controller
      // (PermissionContext.ts cancelAndAbort) — that abort must bubble up to
      // the query controller so the query loop's post-tool abort check ends
      // the turn. Without bubble-up, ExitPlanMode "clear context + auto"
      // sends REJECT_MESSAGE to the model instead of aborting (#21056 regression).
      const exclusiveEntry: ExclusiveCallQueuedBehindEntry = {
        isQueued: () =>
          !this.discarded &&
          this.tools
            .slice(this.tools.indexOf(tool) + 1)
            .some(t => t.status === 'queued' && !t.isConcurrencySafe),
        mayYetBeQueued: () => !this.discarded && this.responseOpen,
        holdLogged: false,
      }
      exclusiveCallQueuedBehind.set(tool.id, exclusiveEntry)
      using _releaseExclusiveHold = {
        [Symbol.dispose]: () => {
          if (exclusiveCallQueuedBehind.get(tool.id) === exclusiveEntry) {
            exclusiveCallQueuedBehind.delete(tool.id)
          }
        },
      }
      const session = this.toolUseContext.session
      const runnerHandlesDetach = Boolean(
        (runToolUse as unknown as Record<symbol, unknown>)[
          RUN_TOOL_USE_HANDLES_DETACH_SYMBOL
        ],
      )
      const toolAbortController = createAbortController()
      let detached = false
      const isDetachedOrLetGo = () =>
        detached || detachedToolCallWasLetGo(tool.id, session)
      const queryLinked = createChildAbortController(
        this.siblingAbortController,
      )
      queryLinked.signal.addEventListener(
        'abort',
        () => {
          if (!isDetachedOrLetGo()) {
            toolAbortController.abort(queryLinked.signal.reason)
          }
        },
        { once: true },
      )
      toolAbortController.signal.addEventListener(
        'abort',
        () => {
          if (
            toolAbortController.signal.reason !== 'sibling_error' &&
            !isDetachedOrLetGo() &&
            !this.toolUseContext.abortController.signal.aborted &&
            !this.discarded
          ) {
            this.toolUseContext.abortController.abort(
              toolAbortController.signal.reason,
            )
          }
        },
        { once: true },
      )

      let signalDetachEarly: (() => void) | undefined
      const detachEarly = new Promise<void>(resolve => {
        signalDetachEarly = resolve
      })

      const detachableTool = findToolByName(
        this.toolUseContext.options.tools,
        tool.block.name,
      )
      // densable FDe + dOt: real runToolUse wraps post-permission tool.call in
      // dOt directly; keep fallback active when tests mock runToolUse.
      const canDetach =
        !runnerHandlesDetach &&
        detachableTool !== undefined &&
        executorCanDetachFallback(detachableTool, this.toolUseContext)
      const unregisterForeground = canDetach
        ? registerForegroundToolCall(session!, {
            toolUseId: tool.id,
            backgroundNow: () => {
              if (
                detached ||
                this.discarded ||
                toolAbortController.signal.aborted ||
                this.toolUseContext.abortController.signal.aborted ||
                areBackgroundTasksDisabled() ||
                executorPermissionPromptOpen(this.toolUseContext, tool.id)
              ) {
                return false
              }
              detached = true
              // densable V.letGo(r) then ye() — started() is after the race.
              detachedToolCallLetGo(tool.id, session)
              signalDetachEarly?.()
              return true
            },
          })
        : () => {}

      const generator = runToolUse(
        tool.block,
        tool.assistantMessage,
        this.canUseTool,
        {
          ...this.toolUseContext,
          abortController: toolAbortController,
          // Official sameTurnToolUses: prior tools in this streaming turn.
          sameTurnToolUses: this.buildSameTurnToolUses(tool),
        },
      )

      // Track if this specific tool has produced an error result.
      // This prevents the tool from receiving a duplicate "sibling error"
      // message when it is the one that caused the error.
      let thisToolErrored = false

      const drainGenerator = async () => {
        try {
          for await (const update of generator) {
            // densable jR: control events (set_expanded_view) skip the message path
            if (isToolBridgeEvent(update)) {
              tool.pendingBridgeEvents.push(update)
              this.wakeWaiters()
              continue
            }
            // Check if we were aborted by a sibling tool error or user interruption.
            // Only add the synthetic error if THIS tool didn't produce the error.
            // densable send-now: detached tools ignore the query abort (do not cancel).
            const abortReason = isDetachedOrLetGo()
              ? null
              : this.getAbortReason(tool)
            if (abortReason === 'remote_cancel' && !thisToolErrored) {
              break
            }
            if (
              abortReason &&
              abortReason !== 'remote_cancel' &&
              !thisToolErrored
            ) {
              messages.push(
                this.createSyntheticErrorMessage(
                  tool.id,
                  abortReason,
                  tool.assistantMessage,
                  true,
                ),
              )
              break
            }

            const isErrorResult =
              update.message.type === 'user' &&
              Array.isArray(update.message.message!.content) &&
              update.message.message!.content.some(
                _ => _.type === 'tool_result' && _.is_error === true,
              )

            if (isErrorResult) {
              thisToolErrored = true
              // Only Bash errors cancel siblings. Bash commands often have implicit
              // dependency chains (e.g. mkdir fails → subsequent commands pointless).
              // Read/WebFetch/etc are independent — one failure shouldn't nuke the rest.
              if (tool.block.name === BASH_TOOL_NAME) {
                this.hasErrored = true
                this.erroredToolDescription = this.getToolDescription(tool)
                this.siblingAbortController.abort('sibling_error')
              }
            }

            if (update.message) {
              // Progress messages go to pendingProgress for immediate yielding
              if (update.message.type === 'progress') {
                tool.pendingProgress.push(update.message)
                const data = update.message.data
                if (
                  data !== null &&
                  typeof data === 'object' &&
                  'type' in data &&
                  data.type === 'tool_heartbeat'
                ) {
                  this.wakeWaiters()
                } else if (this.progressAvailableResolve) {
                  this.progressAvailableResolve()
                  this.progressAvailableResolve = undefined
                }
              } else {
                messages.push(update.message)
              }
            }
            if (update.contextModifier) {
              contextModifiers.push(update.contextModifier.modifyContext)
            }
            const updateLayers = (
              update as {
                contextLayers?: { toolUseID: string; layers: ContextLayer[] }
              }
            ).contextLayers
            if (updateLayers && updateLayers.layers.length > 0) {
              contextLayers.push(...updateLayers.layers)
            }
          }
        } finally {
          unregisterForeground()
        }
      }

      const drain = drainGenerator()
      let race: 'settled' | 'detach'
      try {
        race = await Promise.race([
          drain.then(
            () => 'settled' as const,
            () => 'settled' as const,
          ),
          detachEarly.then(() => 'detach' as const),
        ])
      } finally {
        unregisterForeground()
      }
      const def = findToolByName(
        this.toolUseContext.options.tools,
        tool.block.name,
      )
      // gold: settled / query-abort wins over detach — yield the real result.
      if (
        race === 'settled' ||
        this.discarded ||
        this.toolUseContext.abortController.signal.aborted
      ) {
        try {
          await drain
        } finally {
          if (!runnerHandlesDetach) detachedToolCallEnded(tool.id, session)
        }
      } else if (detached && def?.backgrounding === 'detach') {
        const isOnScreen =
          this.toolUseContext.options.isNonInteractiveSession !== true
        logEvent('tengu_tool_call_detached', {
          toolName: sanitizeToolNameForAnalytics(def.name),
        })
        logForDebugging(
          `[detach] ${def.name} ${tool.id} moved to the background to deliver a message`,
        )
        detachedToolCallStarted(
          tool.id,
          {
            tool: def,
            input: tool.block.input,
            detachedAt: Date.now(),
          },
          reason => toolAbortController.abort(reason),
          session,
        )
        const fpt = stillRunningDetachText(def.name, isOnScreen)
        tool.results = [
          createUserMessage({
            content: [
              {
                type: 'tool_result',
                tool_use_id: tool.id,
                content: fpt,
              },
            ],
            toolUseResult: { detachedToolCall: true },
            sourceToolAssistantUUID: tool.assistantMessage.uuid,
          }),
        ]
        tool.contextModifiers = contextModifiers
        tool.status = 'completed'
        this.wakeWaiters()
        this.updateInterruptibleState()
        let ceilingHit = false
        const ceiling = setTimeout(() => {
          ceilingHit = true
          toolAbortController.abort('detached-ceiling')
        }, DETACH_CEILING_MS)
        ceiling.unref?.()
        const stillHeard = () =>
          getDetachedToolCallSnapshot(session).has(tool.id)
        void drain
          .finally(() => clearTimeout(ceiling))
          .then(val => {
            if (toolAbortController.signal.aborted) {
              throw new AbortError()
            }
            return val
          })
          .then(
            async () => {
              // densable Zho: mapToolResult → eyo(content) → size > lOt → persist.
              const rendered = detachedResultText(messages)
              let text = rendered.text
              let failed = rendered.failed
              const resultMessage = messages.find(
                m =>
                  m.type === 'user' &&
                  Array.isArray(m.message?.content) &&
                  m.message.content.some(
                    block =>
                      block.type === 'tool_result' &&
                      block.tool_use_id === tool.id,
                  ),
              )
              const data =
                resultMessage?.type === 'user'
                  ? resultMessage.toolUseResult
                  : undefined
              if (!failed) {
                if (
                  !detachedToolCallSettled(
                    tool.id,
                    { status: 'completed', data },
                    session,
                  )
                ) {
                  return
                }
              }
              let notifyFailed = failed
              try {
                if (!failed && data !== undefined) {
                  const mapped = def.mapToolResultToToolResultBlockParam(
                    data as never,
                    tool.id,
                  )
                  const block = await processPreMappedToolResultBlock(
                    mapped,
                    def.name,
                    def.maxResultSizeChars ?? Number.POSITIVE_INFINITY,
                  )
                  if (!stillHeard()) return
                  text = eyo(block?.content)
                  if (block?.is_error === true) {
                    failed = true
                    notifyFailed = true
                  }
                } else {
                  const concat = detachedResultText(messages)
                  text = concat.text
                  failed = concat.failed
                  notifyFailed = failed
                }
                if (
                  !notifyFailed &&
                  escapeXml(text).length > DETACH_OVERSIZE_CHARS
                ) {
                  const saved = await persistToolResult(text, tool.id)
                  if (!stillHeard()) return
                  if ('error' in saved) {
                    notifyFailed = true
                    text =
                      'The call completed, but its result is too large to carry in a notification and could not be saved to a file.'
                  } else {
                    text = `The result is ${saved.originalSize} characters, too large to carry in a notification, so none of it is quoted here. ${saved.truncatedAtBytes === undefined ? 'All of it' : `Its first ${saved.truncatedAtBytes} bytes`} was saved to ${saved.filepath}. Read that file to see it.`
                  }
                }
              } catch {
                if (!stillHeard()) return
                notifyFailed = true
                text =
                  'The call completed but its result could not be rendered.'
              }
              if (!stillHeard()) return
              if (failed) {
                if (
                  !detachedToolCallSettled(
                    tool.id,
                    { status: 'failed', text, data },
                    session,
                  )
                ) {
                  return
                }
              } else if (!notifyFailed) {
                detachedToolCallSetText(tool.id, text, session)
              }
              const status = notifyFailed ? 'failed' : 'completed'
              enqueueDetachedToolCallResult({
                toolName: def.name,
                toolUseId: tool.id,
                status,
                text,
                isOnScreen,
              })
              detachedToolCallResultQueued(tool.id, session)
            },
            (err: unknown) => {
              const ceilingAbort = isDetachedCeilingHit(
                ceilingHit,
                toolAbortController.signal.reason,
              )
              const userCancel =
                !ceilingAbort &&
                (toolAbortController.signal.reason === 'user-cancel' ||
                  this.toolUseContext.abortController.signal.reason ===
                    'user-cancel')
              const text = ceilingAbort
                ? detachedCeilingResultText()
                : userCancel
                  ? 'The user stopped this call before it finished.'
                  : err instanceof Error
                    ? err.message
                    : String(err)
              const status = userCancel ? 'stopped' : 'failed'
              if (
                !detachedToolCallSettled(
                  tool.id,
                  {
                    status,
                    text,
                  },
                  session,
                )
              ) {
                return
              }
              enqueueDetachedToolCallResult({
                toolName: def.name,
                toolUseId: tool.id,
                status,
                text,
                isOnScreen,
                passive: userCancel,
              })
              detachedToolCallResultQueued(tool.id, session)
            },
          )
          .finally(() => detachedToolCallEnded(tool.id, session))
        return
      } else {
        try {
          await drain
        } finally {
          if (!runnerHandlesDetach) detachedToolCallEnded(tool.id, session)
        }
      }
      if (cwdBeforeExclusive !== undefined) {
        const cwdAfterExclusive = getCwd()
        if (
          cwdAfterExclusive !== cwdBeforeExclusive &&
          !contextLayers.some(l => l.kind === 'working_directory')
        ) {
          contextLayers.push({
            kind: 'working_directory',
            directory: cwdAfterExclusive,
          })
        }
      }
      tool.results = messages
      tool.contextModifiers = contextModifiers
      tool.contextLayers = contextLayers
      tool.status = 'completed'
      this.wakeWaiters()
      this.updateInterruptibleState()

      // Exclusive calls apply immediately; concurrent calls merge in queue
      // order after the entire run settles (densable ds.applyEndedRunLayers).
      if (!tool.isConcurrencySafe) {
        if (contextModifiers.length > 0) {
          for (const modifier of contextModifiers) {
            this.toolUseContext = modifier(this.toolUseContext)
          }
          tool.contextModifiersApplied = true
          this.appliedConcurrentContextModifiers = true
        }
        if (contextLayers.length > 0) {
          this.toolUseContext = applyContextLayersToToolUseContext(
            this.toolUseContext,
            contextLayers,
          )
          tool.contextLayersApplied = true
          this.appliedConcurrentContextModifiers = true
        }
      }
    }

    const promise = collectResults()
    tool.promise = promise

    // Process more queue when done
    void promise.finally(() => {
      void this.processQueue()
    })
  }

  /**
   * Get any completed results that haven't been yielded yet (non-blocking)
   * Maintains order where necessary
   * Also yields any pending progress messages immediately
   */
  *getCompletedResults(): Generator<MessageUpdate, void> {
    if (this.discarded) {
      return
    }

    for (const tool of this.tools) {
      while (tool.pendingBridgeEvents.length > 0) {
        yield tool.pendingBridgeEvents.shift()!
      }
      // Always yield pending progress messages immediately, regardless of tool status
      while (tool.pendingProgress.length > 0) {
        const progressMessage = tool.pendingProgress.shift()!
        yield { message: progressMessage, newContext: this.toolUseContext }
      }

      if (tool.status === 'yielded') {
        continue
      }

      if (tool.status === 'completed' && tool.results) {
        tool.status = 'yielded'

        for (const message of tool.results) {
          yield { message, newContext: this.toolUseContext }
        }

        markToolUseAsComplete(this.toolUseContext, tool.id)
      } else if (tool.status === 'executing' && !tool.isConcurrencySafe) {
        break
      }
    }
  }

  /**
   * Check if any tool has pending progress messages
   */
  private hasPendingProgress(): boolean {
    return this.tools.some(
      t => t.pendingProgress.length > 0 || t.pendingBridgeEvents.length > 0,
    )
  }

  /**
   * Wait for remaining tools and yield their results as they complete
   * Also yields progress messages as they become available
   */
  async *getRemainingResults(): AsyncGenerator<MessageUpdate, void> {
    this.responseOpen = false
    if (this.discarded) {
      return
    }

    while (this.hasUnfinishedTools()) {
      await this.processQueue()

      for (const result of this.getCompletedResults()) {
        yield result
      }

      // If we still have executing tools but nothing completed, wait for any to complete
      // OR for progress to become available
      if (
        this.hasExecutingTools() &&
        !this.hasCompletedResults() &&
        !this.hasPendingProgress()
      ) {
        const executingPromises = this.tools
          .filter(t => t.status === 'executing' && t.promise)
          .map(t => t.promise!)

        // Also wait for progress to become available
        const progressPromise = new Promise<void>(resolve => {
          this.progressAvailableResolve = resolve
        })

        if (executingPromises.length > 0) {
          await Promise.race([...executingPromises, progressPromise])
        }
      }
    }

    for (const result of this.getCompletedResults()) {
      yield result
    }

    this.applyFinishedConcurrentContextModifiers()
    if (this.appliedConcurrentContextModifiers) {
      yield { newContext: this.toolUseContext }
    }

    endToolBatchSpan(this.turnSpan)
    this.turnSpan = null
  }

  private applyFinishedConcurrentContextModifiers(): void {
    if (this.hasExecutingTools()) return
    for (const tool of this.tools) {
      if (
        tool.isConcurrencySafe &&
        !tool.contextModifiersApplied &&
        tool.contextModifiers &&
        tool.contextModifiers.length > 0
      ) {
        for (const modifier of tool.contextModifiers) {
          this.toolUseContext = modifier(this.toolUseContext)
        }
        tool.contextModifiersApplied = true
        this.appliedConcurrentContextModifiers = true
      }
      if (
        tool.isConcurrencySafe &&
        !tool.contextLayersApplied &&
        tool.contextLayers &&
        tool.contextLayers.length > 0
      ) {
        this.toolUseContext = applyContextLayersToToolUseContext(
          this.toolUseContext,
          tool.contextLayers,
        )
        tool.contextLayersApplied = true
        this.appliedConcurrentContextModifiers = true
      }
    }
  }

  /**
   * Check if there are any completed results ready to yield
   */
  private hasCompletedResults(): boolean {
    return this.tools.some(t => t.status === 'completed')
  }

  /**
   * Check if there are any tools still executing
   */
  private hasExecutingTools(): boolean {
    return this.tools.some(t => t.status === 'executing')
  }

  /**
   * Check if there are any unfinished tools
   */
  private hasUnfinishedTools(): boolean {
    return this.tools.some(t => t.status !== 'yielded')
  }

  /**
   * Get the current tool use context (may have been modified by context modifiers)
   */
  getUpdatedContext(): ToolUseContext {
    return this.toolUseContext
  }
}

/** densable sa — drain tools even when the model's next stream event stalls. */
export async function* mergeToolDrainEvents<T>(
  stream: AsyncIterable<T> | Iterable<T>,
  getExecutor: () =>
    | Pick<StreamingToolExecutor, 'waitForDrainable'>
    | undefined,
): AsyncGenerator<T | { type: 'tool_drain_tick' }> {
  const iterator =
    Symbol.asyncIterator in stream
      ? stream[Symbol.asyncIterator]()
      : stream[Symbol.iterator]()
  let pending:
    | Promise<{ kind: 'stream'; result: IteratorResult<T> }>
    | undefined
  let executor = getExecutor()
  let generation = 0
  try {
    while (true) {
      pending ??= Promise.resolve(iterator.next()).then(result => ({
        kind: 'stream' as const,
        result,
      }))
      const current = getExecutor()
      if (current !== executor) {
        executor = current
        generation = 0
      }
      const next = current
        ? await Promise.race([
            pending,
            current.waitForDrainable(generation).then(value => ({
              kind: 'drain' as const,
              generation: value,
            })),
          ])
        : await pending
      if (next.kind === 'drain') {
        generation = next.generation
        yield { type: 'tool_drain_tick' }
        continue
      }
      pending = undefined
      if (next.result.done) return
      yield next.result.value
    }
  } finally {
    Promise.resolve(iterator.return?.()).catch(() => {})
  }
}

function markToolUseAsComplete(
  toolUseContext: ToolUseContext,
  toolUseID: string,
) {
  toolUseContext.setInProgressToolUseIDs(prev => {
    const next = new Set(prev)
    next.delete(toolUseID)
    return next
  })
}
