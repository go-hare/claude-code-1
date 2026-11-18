import { feature } from 'bun:bundle'
import chalk from 'chalk'
import { markPostCompaction } from 'src/bootstrap/state.js'
import { getSystemPrompt } from '../../constants/prompts.js'
import { getSystemContext, getUserContext } from '../../context.js'
import { getShortcutDisplay } from '../../keybindings/shortcutFormat.js'
import { notifyCompaction } from '../../services/api/promptCacheBreakDetection.js'
import {
  CompactionBlockedByHookError,
  type CompactionResult,
  compactConversation,
  ERROR_MESSAGE_INCOMPLETE_RESPONSE,
  ERROR_MESSAGE_NOT_ENOUGH_MESSAGES,
  ERROR_MESSAGE_USER_ABORT,
  mergeHookInstructions,
  throwIfCompactBlockedByHook,
} from '../../services/compact/compact.js'
import { suppressCompactWarning } from '../../services/compact/compactWarningState.js'
import { microcompactMessages } from '../../services/compact/microCompact.js'
import { runPostCompactCleanup } from '../../services/compact/postCompactCleanup.js'
import { trySessionMemoryCompaction } from '../../services/compact/sessionMemoryCompact.js'
import { setLastSummarizedMessageId } from '../../services/SessionMemory/sessionMemoryUtils.js'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import type { ToolUseContext } from '../../Tool.js'
import type { LocalCommandCall } from '../../types/command.js'
import type { Message } from '../../types/message.js'
import type { AppState } from '../../state/AppState.js'
import { hasExactErrorMessage } from '../../utils/errors.js'
import { formatTokens } from '../../utils/format.js'
import { executePreCompactHooks } from '../../utils/hooks.js'
import { logError } from '../../utils/log.js'
import { getMessagesAfterCompactBoundary } from '../../utils/messages.js'
import { getUpgradeMessage } from '../../utils/model/contextWindowUpgradeCheck.js'
import {
  buildEffectiveSystemPrompt,
  type SystemPrompt,
} from '../../utils/systemPrompt.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const reactiveCompact = feature('REACTIVE_COMPACT')
  ? (require('../../services/compact/reactiveCompact.js') as typeof import('../../services/compact/reactiveCompact.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

export const call: LocalCommandCall = async (args, context) => {
  const { abortController } = context
  let { messages } = context

  // densable 2.1.289 `b` @201670700: check endedByModel before PreCompact hooks,
  // session-memory compaction, or reactive compaction.
  if (context.getAppState().endedByModel) {
    const { END_CONVERSATION_SESSION_ENDED_MESSAGE } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js') as typeof import('@claude-code/builtin-tools/tools/EndConversationTool/prompt.js')
    throw new Error(END_CONVERSATION_SESSION_ENDED_MESSAGE)
  }

  // REPL keeps snipped messages for UI scrollback — project so the compact
  // model doesn't summarize content that was intentionally removed.
  messages = getMessagesAfterCompactBoundary(messages)

  if (messages.length === 0) {
    throw new Error('No messages to compact')
  }

  const customInstructions = args.trim()

  let delegatedFinallyCleanup = false
  try {
    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })
    context.setSDKStatus?.('compacting')
    try {
      const preHookResult = await executePreCompactHooks(
        { trigger: 'manual', customInstructions: customInstructions || null },
        context.abortController.signal,
        undefined,
        context,
      )
      throwIfCompactBlockedByHook(preHookResult, context)
      const effectiveInstructions = mergeHookInstructions(
        customInstructions,
        preHookResult.newCustomInstructions,
      )

      // Try session memory compaction only after PreCompact hooks succeed and
      // when neither the user nor PreCompact supplied custom instructions.
      if (!effectiveInstructions) {
        const sessionMemoryResult = await trySessionMemoryCompaction(
          messages,
          context.agentId,
          undefined,
          context.getAppState(),
        )
        if (sessionMemoryResult) {
          getUserContext.cache.clear?.()
          runPostCompactCleanup()
          // Reset cache read baseline so the post-compact drop isn't flagged
          // as a break. compactConversation does this internally; SM-compact doesn't.
          if (feature('PROMPT_CACHE_BREAK_DETECTION')) {
            notifyCompaction(
              context.options.querySource ?? 'compact',
              context.agentId,
            )
          }
          markPostCompaction()
          // Suppress warning immediately after successful compaction
          suppressCompactWarning()

          return {
            type: 'compact',
            compactionResult: sessionMemoryResult,
            ...buildDisplayText(context, preHookResult.userDisplayMessage, {
              pre: sessionMemoryResult.preCompactTokenCount,
              post: sessionMemoryResult.truePostCompactTokenCount,
            }),
          }
        }
      }

      // Reactive-only mode: route /compact through the reactive path.
      // Checked after session-memory (that path is cheap and orthogonal).
      if (reactiveCompact?.isReactiveOnlyMode()) {
        delegatedFinallyCleanup = true
        return await compactViaReactive(
          messages,
          context,
          customInstructions,
          reactiveCompact,
          preHookResult,
        )
      }

      // Fall back to traditional compaction
      // Run microcompact first to reduce tokens before summarization
      const microcompactResult = await microcompactMessages(messages, context)
      const messagesForCompact = microcompactResult.messages
      const cacheSharingParams = await getCacheSharingParams(
        context,
        messagesForCompact,
      )

      delegatedFinallyCleanup = true
      const result = await compactConversation(
        messagesForCompact,
        context,
        cacheSharingParams,
        false,
        customInstructions,
        false,
        undefined,
        false,
        preHookResult,
      )

      // Reset lastSummarizedMessageId since legacy compaction replaces all messages
      // and the old message UUID will no longer exist in the new messages array
      setLastSummarizedMessageId(undefined)

      // Suppress the "Context left until auto-compact" warning after successful compaction
      suppressCompactWarning()

      getUserContext.cache.clear?.()
      runPostCompactCleanup()

      return {
        type: 'compact',
        compactionResult: result,
        ...buildDisplayText(context, result.userDisplayMessage, {
          pre: result.preCompactTokenCount,
          post: result.truePostCompactTokenCount,
        }),
      }
    } finally {
      if (!delegatedFinallyCleanup) {
        context.setStreamMode?.('requesting')
        context.setResponseLength?.(() => 0)
        context.onCompactProgress?.({ type: 'compact_end' })
        context.setSDKStatus?.(null)
      }
    }
  } catch (error) {
    if (abortController.signal.aborted) {
      throw new Error('Compaction canceled.')
    } else if (error instanceof CompactionBlockedByHookError) {
      return { type: 'text', value: error.message, level: 'error' }
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)) {
      return { type: 'text', value: ERROR_MESSAGE_NOT_ENOUGH_MESSAGES }
    } else if (hasExactErrorMessage(error, ERROR_MESSAGE_INCOMPLETE_RESPONSE)) {
      return {
        type: 'text',
        value: ERROR_MESSAGE_INCOMPLETE_RESPONSE,
        level: 'error',
      }
    } else {
      logError(error)
      throw new Error(`Error during compaction: ${error}`)
    }
  }
}

async function compactViaReactive(
  messages: Message[],
  context: ToolUseContext,
  customInstructions: string,
  reactive: NonNullable<typeof reactiveCompact>,
  preHookResult?: Awaited<ReturnType<typeof executePreCompactHooks>>,
): Promise<{
  type: 'compact'
  compactionResult: CompactionResult
  displayText: string
}> {
  if (!preHookResult) {
    context.onCompactProgress?.({
      type: 'hooks_start',
      hookType: 'pre_compact',
    })
    context.setSDKStatus?.('compacting')
  }

  try {
    const [hookResult, cacheSafeParams] = preHookResult
      ? [preHookResult, await getCacheSharingParams(context, messages)]
      : await Promise.all([
          executePreCompactHooks(
            {
              trigger: 'manual',
              customInstructions: customInstructions || null,
            },
            context.abortController.signal,
            undefined,
            context,
          ),
          getCacheSharingParams(context, messages),
        ])
    if (!preHookResult) {
      throwIfCompactBlockedByHook(hookResult, context)
    }
    const mergedInstructions = mergeHookInstructions(
      customInstructions,
      hookResult.newCustomInstructions,
    )

    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_start' })

    const outcome = await reactive.reactiveCompactOnPromptTooLong(
      messages,
      cacheSafeParams,
      { customInstructions: mergedInstructions, trigger: 'manual' },
    )

    if (!outcome.ok) {
      // The outer catch in `call` translates these: aborted → "Compaction
      // canceled." (via abortController.signal.aborted check), NOT_ENOUGH →
      // re-thrown as-is, everything else → "Error during compaction: …".
      switch (outcome.reason) {
        case 'too_few_groups':
          throw new Error(ERROR_MESSAGE_NOT_ENOUGH_MESSAGES)
        case 'aborted':
          throw new Error(ERROR_MESSAGE_USER_ABORT)
        case 'exhausted':
        case 'error':
        case 'media_unstrippable':
          throw new Error(ERROR_MESSAGE_INCOMPLETE_RESPONSE)
      }
    }

    // Mirrors the post-success cleanup in tryReactiveCompact, minus
    // resetMicrocompactState — processSlashCommand calls that for all
    // type:'compact' results.
    setLastSummarizedMessageId(undefined)
    runPostCompactCleanup()
    suppressCompactWarning()
    getUserContext.cache.clear?.()

    // reactiveCompactOnPromptTooLong runs PostCompact hooks but not PreCompact
    // — both callers (here and tryReactiveCompact) run PreCompact outside so
    // they can merge its userDisplayMessage with PostCompact's here. This
    // caller additionally runs it concurrently with getCacheSharingParams.
    const combinedMessage =
      [hookResult.userDisplayMessage, outcome.result!.userDisplayMessage]
        .filter(Boolean)
        .join('\n') || undefined

    return {
      type: 'compact',
      compactionResult: {
        ...outcome.result!,
        userDisplayMessage: combinedMessage,
      },
      ...buildDisplayText(context, combinedMessage, {
        pre: outcome.result!.preCompactTokenCount,
        post: outcome.result!.truePostCompactTokenCount,
      }),
    }
  } finally {
    context.setStreamMode?.('requesting')
    context.setResponseLength?.(() => 0)
    context.onCompactProgress?.({ type: 'compact_end' })
    context.setSDKStatus?.(null)
  }
}

export function buildDisplayText(
  context: ToolUseContext,
  userDisplayMessage?: string,
  tokenCounts?: { pre?: number; post?: number },
): { displayText: string; displayTextIsHintOnly: boolean } {
  const upgradeMessage = getUpgradeMessage('tip')
  const expandShortcut = getShortcutDisplay(
    'app:toggleTranscript',
    'Global',
    'ctrl+o',
  )
  const tokenLine =
    tokenCounts?.pre !== undefined && tokenCounts.post !== undefined
      ? `Context: ~${formatTokens(tokenCounts.pre)} \u2192 ~${formatTokens(tokenCounts.post)} tokens`
      : undefined
  const dimmed = [
    ...(context.options.verbose
      ? []
      : [`(${expandShortcut} to see full summary)`]),
    ...(tokenLine ? [tokenLine] : []),
    ...(userDisplayMessage ? [userDisplayMessage] : []),
    ...(upgradeMessage ? [upgradeMessage] : []),
  ]
  return {
    displayText: chalk.dim('Compacted ' + dimmed.join('\n')),
    // v2.1.314 (#1395): SEA !e && !m — true when only the ctrl+o / token hint is shown
    displayTextIsHintOnly: !userDisplayMessage && !upgradeMessage,
  }
}

/** densable 2.1.247 Ce — appState.agent → activeAgents definition. */
export function resolveMainThreadAgentDefinition(
  appState: Pick<AppState, 'agent' | 'agentDefinitions'>,
): AgentDefinition | undefined {
  return appState.agent
    ? appState.agentDefinitions.activeAgents.find(
        agent => agent.agentType === appState.agent,
      )
    : undefined
}

export async function getCacheSharingParams(
  context: ToolUseContext,
  forkContextMessages: Message[],
): Promise<{
  systemPrompt: SystemPrompt
  userContext: { [k: string]: string }
  systemContext: { [k: string]: string }
  toolUseContext: ToolUseContext
  forkContextMessages: Message[]
}> {
  const appState = context.getAppState()
  const defaultSysPrompt = await getSystemPrompt(
    context.options.tools,
    context.options.mainLoopModel,
    Array.from(
      appState.toolPermissionContext.additionalWorkingDirectories.keys(),
    ),
    context.options.mcpClients,
  )
  const systemPrompt = buildEffectiveSystemPrompt({
    mainThreadAgentDefinition: resolveMainThreadAgentDefinition(appState),
    toolUseContext: context,
    customSystemPrompt: context.options.customSystemPrompt,
    defaultSystemPrompt: defaultSysPrompt,
    appendSystemPrompt: context.options.appendSystemPrompt,
  })
  const [userContext, systemContext] = await Promise.all([
    getUserContext(),
    getSystemContext(),
  ])
  return {
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext: context,
    forkContextMessages,
  }
}
