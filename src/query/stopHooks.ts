import { feature } from 'bun:bundle'
import { getShortcutDisplay } from '../keybindings/shortcutFormat.js'
import { isExtractModeActive } from '../memdir/paths.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../services/analytics/index.js'
import type { ToolUseContext } from '../Tool.js'
import type { HookProgress } from '../types/hooks.js'
import type {
  AssistantMessage,
  Message,
  RequestStartEvent,
  StopHookInfo,
  StreamEvent,
  TombstoneMessage,
  ToolUseSummaryMessage,
} from '../types/message.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { logForDebugging } from '../utils/debug.js'
import { errorMessage } from '../utils/errors.js'
import type { REPLHookContext } from '../utils/hooks/postSamplingHooks.js'
import {
  executeStopHooks,
  executeTaskCompletedHooks,
  executeTeammateIdleHooks,
  getStopHookMessage,
  getTaskCompletedHookMessage,
  getTeammateIdleHookMessage,
} from '../utils/hooks.js'
import {
  createStopHookSummaryMessage,
  createSystemMessage,
  createUserInterruptionMessage,
  createUserMessage,
} from '../utils/messages.js'
import type { SystemPrompt } from '../utils/systemPromptType.js'
import { getTaskListId, listTasks } from '../utils/tasks.js'
import { getAgentName, getTeamName, isTeammate } from '../utils/teammate.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const jobClassifierModule = feature('TEMPLATES')
  ? (require('../jobs/classifier.js') as typeof import('../jobs/classifier.js'))
  : null

/* eslint-enable @typescript-eslint/no-require-imports */

import type { QuerySource } from '../constants/querySource.js'
import { executeAutoDream } from '../services/autoDream/autoDream.js'
import { executePromptSuggestion } from '../services/PromptSuggestion/promptSuggestion.js'
import { isBareMode, isEnvDefinedFalsy } from '../utils/envUtils.js'
import {
  createCacheSafeParams,
  saveCacheSafeParams,
} from '../utils/forkedAgent.js'
import type { TaskState } from '../tasks/types.js'

const BLOCKING_TASK_TYPES = new Set([
  'local_agent',
  'remote_agent',
  'in_process_teammate',
  'local_workflow',
])

function isTerminalStatus(status: string): boolean {
  return status === 'completed' || status === 'failed' || status === 'killed'
}

function hasActiveBackgroundWork(tasks: Record<string, TaskState>): boolean {
  for (const task of Object.values(tasks)) {
    if (
      BLOCKING_TASK_TYPES.has(task.type) &&
      !isTerminalStatus(task.status) &&
      !(
        task.type === 'in_process_teammate' &&
        'isIdle' in task &&
        (task as Record<string, unknown>).isIdle
      )
    ) {
      return true
    }
    if (task.type === 'local_bash' && !isTerminalStatus(task.status)) {
      return true
    }
  }
  return false
}

type StopHookResult = {
  blockingErrors: Message[]
  preventContinuation: boolean
}

export async function* handleStopHooks(
  messagesForQuery: Message[],
  assistantMessages: AssistantMessage[],
  systemPrompt: SystemPrompt,
  userContext: { [k: string]: string },
  systemContext: { [k: string]: string },
  toolUseContext: ToolUseContext,
  querySource: QuerySource,
  stopHookActive?: boolean,
): AsyncGenerator<
  | StreamEvent
  | RequestStartEvent
  | Message
  | TombstoneMessage
  | ToolUseSummaryMessage,
  StopHookResult
> {
  const hookStartTime = Date.now()

  const stopHookContext: REPLHookContext = {
    messages: [...messagesForQuery, ...assistantMessages],
    systemPrompt,
    userContext,
    systemContext,
    toolUseContext,
    querySource,
  }
  // Only save params for main session queries — subagents must not overwrite.
  // Outside the prompt-suggestion gate: the REPL /btw command and the
  // side_question SDK control_request both read this snapshot, and neither
  // depends on prompt suggestions being enabled.
  if (querySource === 'repl_main_thread' || querySource === 'sdk') {
    saveCacheSafeParams(createCacheSafeParams(stopHookContext))
  }

  // Template job classification: when running as a dispatched job, classify
  // state after each turn. Gate on repl_main_thread so background forks
  // (extract-memories, auto-dream) don't pollute the timeline with their own
  // assistant messages. Await the classifier so state.json is written before
  // the turn returns — otherwise `claude list` shows stale state for the gap.
  // Env key hardcoded (vs importing JOB_ENV_KEY from jobs/state) to match the
  // require()-gated jobs/ import pattern above; spawn.test.ts asserts the
  // string matches.
  if (
    feature('TEMPLATES') &&
    process.env.CLAUDE_JOB_DIR &&
    querySource.startsWith('repl_main_thread') &&
    !toolUseContext.agentId
  ) {
    // Full turn history — assistantMessages resets each queryLoop iteration,
    // so tool calls from earlier iterations (Agent spawn, then summary) need
    // messagesForQuery to be visible in the tool-call summary.
    const turnAssistantMessages = stopHookContext.messages.filter(
      (m): m is AssistantMessage => m.type === 'assistant',
    )
    const p = jobClassifierModule!
      .classifyAndWriteState(process.env.CLAUDE_JOB_DIR, turnAssistantMessages)
      .catch(err => {
        logForDebugging(`[job] classifier error: ${errorMessage(err)}`, {
          level: 'error',
        })
      })
    await Promise.race([
      p,
      // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
      new Promise<void>(r => setTimeout(r, 60_000).unref()),
    ])
  }
  // --bare / SIMPLE: skip background bookkeeping (prompt suggestion,
  // memory extraction, auto-dream). Scripted -p calls don't want auto-memory
  // or forked agents contending for resources during shutdown.
  // Poor mode: also skip prompt suggestion and memory extraction.
  const poorMode = feature('POOR')
    ? (await import('../commands/poor/poorMode.js')).isPoorModeActive()
    : false
  if (!isBareMode()) {
    // Official ENABLE_PROMPT_SUGGESTION densable pure env half.
    let promptSuggestionEnvOff = isEnvDefinedFalsy(
      process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION,
    )
    try {
      const { resolvePromptSuggestionEnvOverride } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../utils/residualFinalEnvGates.js') as typeof import('../utils/residualFinalEnvGates.js')
      promptSuggestionEnvOff = resolvePromptSuggestionEnvOverride() === false
    } catch {
      // keep raw env fallback
    }
    if (!promptSuggestionEnvOff && !poorMode) {
      void executePromptSuggestion(stopHookContext)
    }
    if (
      feature('EXTRACT_MEMORIES') &&
      !toolUseContext.agentId &&
      isExtractModeActive() &&
      !poorMode
    ) {
      // Fire-and-forget in both interactive and non-interactive. For -p/SDK,
      // print.ts drains the in-flight promise after flushing the response
      // but before gracefulShutdownSync (see drainPendingExtraction).
      void import('../services/extractMemories/extractMemories.js')
        .then(({ executeExtractMemories }) =>
          executeExtractMemories(
            stopHookContext,
            toolUseContext.appendSystemMessage as
              | ((msg: import('../types/message.js').SystemMessage) => void)
              | undefined,
          ),
        )
        .catch(() => {})
    }
    if (!toolUseContext.agentId && !poorMode) {
      void executeAutoDream(stopHookContext, toolUseContext.appendSystemMessage)
    }
  }

  // chicago MCP: auto-unhide + lock release at turn end.
  // Main thread only — the CU lock is a process-wide module-level variable,
  // so a subagent's stopHooks releasing it leaves the main thread's cleanup
  // seeing isLockHeldLocally()===false → no exit notification, and unhides
  // mid-turn. Subagents don't start CU sessions so this is a pure skip.
  if (feature('CHICAGO_MCP') && !toolUseContext.agentId) {
    try {
      const { cleanupComputerUseAfterTurn } = await import(
        '../utils/computerUse/cleanup.js'
      )
      await cleanupComputerUseAfterTurn(toolUseContext)
    } catch {
      // Failures are silent — this is dogfooding cleanup, not critical path
    }
  }

  // Official brief-mode stop-hook densable (pre-Stop): when brief is active and
  // the turn produced no SendUserMessage tool_use, inject one meta enforce
  // message so the model retries. DISABLE_BRIEF_MODE_STOP_HOOK force-off.
  const briefEnforceBlocking: Message[] = []
  try {
    const { isBriefEnabled, resolveBriefEnforceText, BRIEF_ENFORCE_SENTINEL } =
      await import('@claude-code/builtin-tools/tools/BriefTool/BriefTool.js')
    const { BRIEF_TOOL_NAME, LEGACY_BRIEF_TOOL_NAME } = await import(
      '@claude-code/builtin-tools/tools/BriefTool/prompt.js'
    )
    const { resolveBriefModeStopHookEnforce } = await import(
      '../utils/residualFinalEnvGates.js'
    )
    const { toolMatchesName } = await import('../Tool.js')
    // Official cOd densable: slice after last non-meta non-tool_result user msg.
    let lastUserIdx = -1
    for (let i = messagesForQuery.length - 1; i >= 0; i--) {
      const m = messagesForQuery[i]
      if (!m || m.type !== 'user' || m.isMeta) continue
      const content = m.message?.content
      const isToolResult =
        Array.isArray(content) &&
        content.some(
          block =>
            block &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_result',
        )
      if (isToolResult) continue
      lastUserIdx = i
      break
    }
    const sinceLastUser = messagesForQuery.slice(lastUserIdx + 1)
    const toolsIncludeBrief = toolUseContext.options.tools.some(
      t =>
        toolMatchesName(t, BRIEF_TOOL_NAME) ||
        toolMatchesName(t, LEGACY_BRIEF_TOOL_NAME),
    )
    const enforceContent = resolveBriefModeStopHookEnforce({
      querySource,
      isBriefEnabled: isBriefEnabled(),
      agentId: toolUseContext.agentId,
      toolsIncludeBrief,
      messagesSinceLastUser: sinceLastUser,
      assistantMessages,
      briefToolNames: [BRIEF_TOOL_NAME, LEGACY_BRIEF_TOOL_NAME],
      sentinel: BRIEF_ENFORCE_SENTINEL,
      enforceText: resolveBriefEnforceText(),
    })
    if (enforceContent) {
      const enforceMsg = createUserMessage({
        content: enforceContent,
        isMeta: true,
      })
      briefEnforceBlocking.push(enforceMsg)
      yield enforceMsg
    }
  } catch (err) {
    logForDebugging(`Brief mode enforcement failed: ${errorMessage(err)}`, {
      level: 'error',
    })
  }

  try {
    const blockingErrors: Message[] = [...briefEnforceBlocking]
    const appState = toolUseContext.getAppState()
    const permissionMode = appState.toolPermissionContext.mode

    // Defer goal evaluation while background work is still running.
    // Matches upstream behavior: if an active goal exists but agents/bash tasks
    // are still in-flight, remove the goal's Stop hook for this turn so it
    // doesn't fire prematurely. The hook remains registered for the next turn.
    if (appState.activeGoal) {
      const tasks = appState.tasks ?? {}
      if (hasActiveBackgroundWork(tasks)) {
        logForDebugging(
          '[goal] evaluation deferred \u2014 background work still running',
        )
        // Remove the goal hook temporarily — it will be re-evaluated next turn
        const { getSessionHooks, removeSessionHook } = await import(
          '../utils/hooks/sessionHooks.js'
        )
        const sessionId =
          toolUseContext.agentId ??
          (await import('../bootstrap/state.js')).getSessionId()
        const hooks = getSessionHooks(appState, sessionId, 'Stop')
        const stopMatchers = hooks.get('Stop')
        if (stopMatchers) {
          for (const matcher of stopMatchers) {
            for (const hook of matcher.hooks) {
              if (
                hook.type === 'prompt' &&
                hook.prompt === appState.activeGoal.condition
              ) {
                removeSessionHook(
                  toolUseContext.setAppState,
                  sessionId,
                  'Stop',
                  hook,
                )
                // Re-register on next turn by incrementing iterations
                toolUseContext.setAppState(prev => {
                  if (!prev.activeGoal) return prev
                  return {
                    ...prev,
                    activeGoal: {
                      ...prev.activeGoal,
                      iterations: prev.activeGoal.iterations + 1,
                    },
                  }
                })
                break
              }
            }
          }
        }
      }
    }

    const generator = executeStopHooks(
      permissionMode,
      toolUseContext.abortController.signal,
      undefined,
      stopHookActive ?? false,
      toolUseContext.agentId,
      toolUseContext,
      [...messagesForQuery, ...assistantMessages],
      toolUseContext.agentType,
    )

    // Consume all progress messages and get blocking errors
    let stopHookToolUseID = ''
    let hookCount = 0
    let preventedContinuation = false
    let stopReason = ''
    let hasOutput = false
    const hookErrors: string[] = []
    const hookInfos: StopHookInfo[] = []

    for await (const result of generator) {
      if (result.message) {
        yield result.message
        // Track toolUseID from progress messages and count hooks
        if (result.message.type === 'progress' && result.message.toolUseID) {
          stopHookToolUseID = result.message.toolUseID as string
          hookCount++
          // Extract hook command and prompt text from progress data
          const progressData = result.message.data as HookProgress
          if (progressData.command) {
            hookInfos.push({
              command: progressData.command,
              promptText: progressData.promptText,
            })
          }
        }
        // Track errors and output from attachments
        if (result.message.type === 'attachment') {
          const attachment = result.message.attachment!
          if (
            'hookEvent' in attachment &&
            (attachment.hookEvent === 'Stop' ||
              attachment.hookEvent === 'SubagentStop')
          ) {
            if (attachment.type === 'hook_non_blocking_error') {
              hookErrors.push(
                (attachment.stderr as string) ||
                  `Exit code ${attachment.exitCode}`,
              )
              // Non-blocking errors always have output
              hasOutput = true
            } else if (attachment.type === 'hook_error_during_execution') {
              hookErrors.push(attachment.content as string)
              hasOutput = true
            } else if (attachment.type === 'hook_success') {
              // Check if successful hook produced any stdout/stderr
              if (
                (attachment.stdout && (attachment.stdout as string).trim()) ||
                (attachment.stderr && (attachment.stderr as string).trim())
              ) {
                hasOutput = true
              }
            }
            // Extract per-hook duration for timing visibility.
            // Hooks run in parallel; match by command + first unassigned entry.
            if ('durationMs' in attachment && 'command' in attachment) {
              const info = hookInfos.find(
                i =>
                  i.command === attachment.command &&
                  i.durationMs === undefined,
              )
              if (info) {
                info.durationMs = attachment.durationMs as number
              }
            }
          }
        }
      }
      if (result.blockingError) {
        const userMessage = createUserMessage({
          content: getStopHookMessage(result.blockingError),
          isMeta: true, // Hide from UI (shown in summary message instead)
        })
        blockingErrors.push(userMessage)
        yield userMessage
        hasOutput = true
        // Add to hookErrors so it appears in the summary
        hookErrors.push(result.blockingError.blockingError)
      }
      // Check if hook wants to prevent continuation
      if (result.preventContinuation) {
        preventedContinuation = true
        stopReason = result.stopReason || 'Stop hook prevented continuation'
        // Create attachment to track the stopped continuation (for structured data)
        yield createAttachmentMessage({
          type: 'hook_stopped_continuation',
          message: stopReason,
          hookName: 'Stop',
          toolUseID: stopHookToolUseID,
          hookEvent: 'Stop',
        })
      }

      // Check if we were aborted during hook execution
      if (toolUseContext.abortController.signal.aborted) {
        logEvent('tengu_pre_stop_hooks_cancelled', {
          queryChainId: toolUseContext.queryTracking
            ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,

          queryDepth: toolUseContext.queryTracking?.depth,
        })
        // densable dye: pass gzr interruptedMessageId when applicable
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { resolveInterruptedMessageId } =
          require('../utils/abortController.js') as typeof import('../utils/abortController.js')
        yield createUserInterruptionMessage({
          toolUse: false,
          interruptedMessageId: resolveInterruptedMessageId(toolUseContext),
        })
        return { blockingErrors: [], preventContinuation: true }
      }
    }

    // Create summary system message if hooks ran
    if (hookCount > 0) {
      yield createStopHookSummaryMessage(
        hookCount,
        hookInfos,
        hookErrors,
        preventedContinuation,
        stopReason,
        hasOutput,
        'suggestion',
        stopHookToolUseID,
      )

      // Send notification about errors (shown in verbose/transcript mode via ctrl+o)
      if (hookErrors.length > 0) {
        const expandShortcut = getShortcutDisplay(
          'app:toggleTranscript',
          'Global',
          'ctrl+o',
        )
        toolUseContext.addNotification?.({
          key: 'stop-hook-error',
          text: `Stop hook error occurred \u00b7 ${expandShortcut} to see`,
          priority: 'immediate',
        })
      }
    }

    if (preventedContinuation) {
      return { blockingErrors: [], preventContinuation: true }
    }

    // Collect blocking errors from stop hooks
    if (blockingErrors.length > 0) {
      return { blockingErrors, preventContinuation: false }
    }

    // After Stop hooks pass, run TeammateIdle and TaskCompleted hooks if this is a teammate
    if (isTeammate()) {
      const teammateName = getAgentName() ?? ''
      const teamName = getTeamName() ?? ''
      const teammateBlockingErrors: Message[] = []
      let teammatePreventedContinuation = false
      let teammateStopReason: string | undefined
      // Each hook executor generates its own toolUseID — capture from progress
      // messages (same pattern as stopHookToolUseID at L142), not the Stop ID.
      let teammateHookToolUseID = ''

      // Run TaskCompleted hooks for any in-progress tasks owned by this teammate
      const taskListId = getTaskListId()
      const tasks = await listTasks(taskListId)
      const inProgressTasks = tasks.filter(
        t => t.status === 'in_progress' && t.owner === teammateName,
      )

      for (const task of inProgressTasks) {
        const taskCompletedGenerator = executeTaskCompletedHooks(
          task.id,
          task.subject,
          task.description,
          teammateName,
          teamName,
          permissionMode,
          toolUseContext.abortController.signal,
          undefined,
          toolUseContext,
        )

        for await (const result of taskCompletedGenerator) {
          if (result.message) {
            if (
              result.message.type === 'progress' &&
              result.message.toolUseID
            ) {
              teammateHookToolUseID = result.message.toolUseID as string
            }
            yield result.message
          }
          if (result.blockingError) {
            const userMessage = createUserMessage({
              content: getTaskCompletedHookMessage(result.blockingError),
              isMeta: true,
            })
            teammateBlockingErrors.push(userMessage)
            yield userMessage
          }
          // Match Stop hook behavior: allow preventContinuation/stopReason
          if (result.preventContinuation) {
            teammatePreventedContinuation = true
            teammateStopReason =
              result.stopReason || 'TaskCompleted hook prevented continuation'
            yield createAttachmentMessage({
              type: 'hook_stopped_continuation',
              message: teammateStopReason,
              hookName: 'TaskCompleted',
              toolUseID: teammateHookToolUseID,
              hookEvent: 'TaskCompleted',
            })
          }
          if (toolUseContext.abortController.signal.aborted) {
            return { blockingErrors: [], preventContinuation: true }
          }
        }
      }

      // Run TeammateIdle hooks
      const teammateIdleGenerator = executeTeammateIdleHooks(
        teammateName,
        teamName,
        permissionMode,
        toolUseContext.abortController.signal,
      )

      for await (const result of teammateIdleGenerator) {
        if (result.message) {
          if (result.message.type === 'progress' && result.message.toolUseID) {
            teammateHookToolUseID = result.message.toolUseID as string
          }
          yield result.message
        }
        if (result.blockingError) {
          const userMessage = createUserMessage({
            content: getTeammateIdleHookMessage(result.blockingError),
            isMeta: true,
          })
          teammateBlockingErrors.push(userMessage)
          yield userMessage
        }
        // Match Stop hook behavior: allow preventContinuation/stopReason
        if (result.preventContinuation) {
          teammatePreventedContinuation = true
          teammateStopReason =
            result.stopReason || 'TeammateIdle hook prevented continuation'
          yield createAttachmentMessage({
            type: 'hook_stopped_continuation',
            message: teammateStopReason,
            hookName: 'TeammateIdle',
            toolUseID: teammateHookToolUseID,
            hookEvent: 'TeammateIdle',
          })
        }
        if (toolUseContext.abortController.signal.aborted) {
          return { blockingErrors: [], preventContinuation: true }
        }
      }

      if (teammatePreventedContinuation) {
        return { blockingErrors: [], preventContinuation: true }
      }

      if (teammateBlockingErrors.length > 0) {
        return {
          blockingErrors: teammateBlockingErrors,
          preventContinuation: false,
        }
      }
    }

    return { blockingErrors: [], preventContinuation: false }
  } catch (error) {
    const durationMs = Date.now() - hookStartTime
    logEvent('tengu_stop_hook_error', {
      duration: durationMs,

      queryChainId: toolUseContext.queryTracking
        ?.chainId as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      queryDepth: toolUseContext.queryTracking?.depth,
    })
    // Yield a system message that is not visible to the model for the user
    // to debug their hook.
    yield createSystemMessage(
      `Stop hook failed: ${errorMessage(error)}`,
      'warning',
    )
    return { blockingErrors: [], preventContinuation: false }
  }
}
