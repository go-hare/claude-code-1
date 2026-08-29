/**
 * /goal — Set a completion condition; Claude keeps working until it's met.
 *
 * Registers a session-scoped prompt-type Stop hook. The query engine evaluates
 * the condition via execPromptHook after each turn. If the condition is not met,
 * the hook blocks and the query loop continues automatically.
 */

import type {
  Command,
  LocalCommandResult,
  LocalJSXCommandContext,
} from '../types/command.js'
import { getSessionId } from '../bootstrap/state.js'
import { getSessionTrustAccepted } from '../bootstrap/state.js'
import {
  addSessionHook,
  getSessionHooks,
  removeSessionHook,
} from '../utils/hooks/sessionHooks.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from '../utils/hooks/hooksConfigSnapshot.js'
import { tokenCountWithEstimation } from '../utils/tokens.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import { createUserMessage } from '../utils/messages.js'
import type { HookCommand } from '../schemas/hooks.js'
import type { AppState } from '../state/AppState.js'
import { consumeQueuedGoalOrigin } from '../services/goal/queuedGoalOrigin.js'

const MAX_GOAL_CONDITION_LENGTH = 4000

const CLEAR_KEYWORDS = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

const GOAL_SYSTEM_MESSAGE = (condition: string) =>
  `A session-scoped Stop hook is now active with condition: "${condition}". ` +
  `Briefly acknowledge the goal, then immediately start (or continue) working toward it \u2014 ` +
  `treat the condition itself as your directive and do not pause to ask the user what to do. ` +
  `The hook will block stopping until the condition holds. It auto-clears once the condition ` +
  `is met \u2014 do not tell the user to run \`/goal clear\` after success; that's only for ` +
  `clearing a goal early.`

/**
 * Find existing goal Stop hooks for a session.
 */
function findGoalHooks(
  appState: AppState,
  sessionId: string,
): HookCommand | undefined {
  const hooks = getSessionHooks(appState, sessionId, 'Stop')
  const stopMatchers = hooks.get('Stop')
  if (!stopMatchers) return undefined
  for (const matcher of stopMatchers) {
    for (const hook of matcher.hooks) {
      if (hook.type === 'prompt') return hook
    }
  }
  return undefined
}

/**
 * Remove all goal Stop hooks for a session.
 */
function removeGoalHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  appState: AppState,
  sessionId: string,
): void {
  const hook = findGoalHooks(appState, sessionId)
  if (hook) {
    removeSessionHook(setAppState, sessionId, 'Stop', hook)
  }
}

/**
 * Check if hooks are available (trust + not disabled).
 */
function checkGates(): { message: string; code: string } | null {
  if (
    shouldDisableAllHooksIncludingManaged() ||
    shouldAllowManagedHooksOnly()
  ) {
    return {
      message:
        "/goal can't run while hooks are disabled (disableAllHooks or allowManagedHooksOnly is set in settings or by policy).",
      code: 'hooks_gate',
    }
  }
  if (!getSessionTrustAccepted()) {
    return {
      message:
        '/goal is only available in trusted workspaces. Restart, accept the trust dialog, and try again.',
      code: 'trust_gate',
    }
  }
  return null
}

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set a goal — keep working until the condition is met',
  argumentHint: '[<condition> | clear]',
  immediate: true,
  supportsNonInteractive: true,
  load: () =>
    Promise.resolve({
      async call(
        args: string,
        context: LocalJSXCommandContext,
      ): Promise<LocalCommandResult> {
        const input = args.trim()
        const sessionId = context.agentId ?? getSessionId()

        // No args: show current status
        if (!input) {
          const appState = context.getAppState()
          const activeGoal = appState.activeGoal
          if (!activeGoal) {
            return {
              type: 'text',
              value: 'No goal set. Usage: `/goal <condition>`',
            }
          }
          const elapsed =
            activeGoal.iterations === 0
              ? 'not yet evaluated'
              : `${activeGoal.iterations} turn${activeGoal.iterations === 1 ? '' : 's'}`
          return {
            type: 'text',
            value: `Goal active: ${activeGoal.condition} (${elapsed})`,
          }
        }

        // Clear command
        if (CLEAR_KEYWORDS.has(input.toLowerCase())) {
          const appState = context.getAppState()
          const activeGoal = appState.activeGoal
          if (!activeGoal) {
            return { type: 'text', value: 'No goal set' }
          }
          const condition = activeGoal.condition
          // densable 1:1 — cancel idle check-in timer on every activeGoal teardown.
          const { cancelPendingGoalIdleCheckin } = await import(
            '../services/goal/goalIdleCheckin.js'
          )
          cancelPendingGoalIdleCheckin()
          removeGoalHooks(context.setAppState, appState, sessionId)
          context.setAppState(prev =>
            prev.activeGoal === undefined
              ? prev
              : { ...prev, activeGoal: undefined },
          )
          // Append sentinel attachment
          context.setMessages(prev => [
            ...prev,
            createAttachmentMessage({
              type: 'goal_status',
              met: true,
              sentinel: true,
              condition,
            }),
          ])
          return { type: 'text', value: `Goal cleared: ${condition}` }
        }

        // densable SZr: n = r ?? smw(e,t) before wro()
        const origin = consumeQueuedGoalOrigin(input, context)

        // Gate checks
        const gate = checkGates()
        if (gate) {
          return { type: 'text', value: gate.message }
        }

        // Validate length
        if (input.length > MAX_GOAL_CONDITION_LENGTH) {
          return {
            type: 'text',
            value: `Goal condition is limited to ${MAX_GOAL_CONDITION_LENGTH} characters (got ${input.length})`,
          }
        }

        // Remove any existing goal hook
        const appState = context.getAppState()
        removeGoalHooks(context.setAppState, appState, sessionId)

        // Register prompt-type Stop hook
        const hookCommand: HookCommand = {
          type: 'prompt',
          prompt: input,
        }
        addSessionHook(context.setAppState, sessionId, 'Stop', '', hookCommand)

        // Set activeGoal in AppState
        const tokensAtStart = tokenCountWithEstimation(context.messages)
        context.setAppState(prev => ({
          ...prev,
          activeGoal: {
            condition: input,
            setAt: Date.now(),
            iterations: 0,
            tokensAtStart,
            origin,
          },
        }))

        // Append sentinel attachment (hidden from UI)
        context.setMessages(prev => [
          ...prev,
          createAttachmentMessage({
            type: 'goal_status',
            met: false,
            sentinel: true,
            condition: input,
          }),
        ])

        // Inject meta message instructing the model to work toward the goal
        context.setMessages(prev => [
          ...prev,
          createUserMessage({
            content: GOAL_SYSTEM_MESSAGE(input),
            isMeta: true,
          }),
        ])

        return {
          type: 'text',
          value: `Goal set: ${input}`,
        }
      },
    }),
} satisfies Command

export default goal
