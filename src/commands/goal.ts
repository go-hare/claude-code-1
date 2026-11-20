/**
 * /goal — Set a completion condition; Claude keeps working until it's met.
 *
 * Registers a session-scoped prompt-type Stop hook. The query engine evaluates
 * the condition via execPromptHook after each turn. If the condition is not met,
 * the hook blocks and the query loop continues automatically.
 *
 * densable 2.1.289: this module is the local/headless twin (`u` / `goalNonInteractive`).
 * Interactive empty `/goal` is the local-jsx Dialog in `src/commands/goal/goal.tsx`.
 */

import type {
  Command,
  LocalCommandResult,
  LocalJSXCommandContext,
} from '../types/command.js'
import {
  getSessionId,
  getSessionTrustAccepted,
  getTotalOutputTokens,
} from '../bootstrap/state.js'
import {
  addSessionHook,
  getSessionHooks,
  removeSessionHook,
} from '../utils/hooks/sessionHooks.js'
import {
  shouldAllowManagedHooksOnly,
  shouldDisableAllHooksIncludingManaged,
} from '../utils/hooks/hooksConfigSnapshot.js'
import { createAttachmentMessage } from '../utils/attachments.js'
import type { HookCommand } from '../schemas/hooks.js'
import type { AppState } from '../state/AppState.js'
import { consumeQueuedGoalOrigin } from '../services/goal/queuedGoalOrigin.js'
import {
  logEvent,
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from '../services/analytics/index.js'
import { firstLineOf, plural } from '../utils/stringUtils.js'

export const MAX_GOAL_CONDITION_LENGTH = 4000

const CLEAR_KEYWORDS = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

/** densable Xbn */
export const GOAL_SYSTEM_MESSAGE = (condition: string) =>
  `A session-scoped Stop hook is now active with condition: "${condition}". ` +
  `Briefly acknowledge the goal, then immediately start (or continue) working toward it — ` +
  `treat the condition itself as your directive and do not pause to ask the user what to do. ` +
  `The hook will block stopping until the condition holds. It auto-clears once the condition ` +
  `is met — do not tell the user to run \`/goal clear\` after success; that's only for ` +
  `clearing a goal early.`

/** densable wJe */
export function isGoalClearKeyword(input: string): boolean {
  return CLEAR_KEYWORDS.has(input.toLowerCase())
}

export function logGoalTooLong(): void {
  logEvent('tengu_feature_sad', {
    feature_name:
      'goal_set' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    error_code:
      'too_long' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Official 2.1.328 (#607): Track `/goal`-registered Stop hook instances by
 * object identity so `/goal` never removes a skill's Stop hook or ends early
 * on another Stop hook's result when both share the same prompt wording.
 */
const goalOwnedStopHooks = new WeakSet<object>()

export function markGoalStopHook(hook: HookCommand): HookCommand {
  goalOwnedStopHooks.add(hook)
  return hook
}

export function isGoalOwnedStopHook(hook: unknown): hook is {
  type: 'prompt'
  prompt: string
} {
  return (
    typeof hook === 'object' &&
    hook !== null &&
    goalOwnedStopHooks.has(hook) &&
    (hook as { type?: unknown }).type === 'prompt' &&
    typeof (hook as { prompt?: unknown }).prompt === 'string'
  )
}

/**
 * densable SIe + 2.1.328 (#607) — goal Stop hooks are `/goal`-owned prompt
 * hooks on matcher "" with no skillRoot. Skill and other prompt hooks stay
 * untouched even if they have the same wording.
 */
function listGoalStopHooks(
  appState: AppState,
  sessionId: string,
): HookCommand[] {
  const hooks = getSessionHooks(appState, sessionId, 'Stop')
  const stopMatchers = hooks.get('Stop') ?? []
  const found: HookCommand[] = []
  for (const matcher of stopMatchers) {
    if (matcher.matcher !== '' || matcher.skillRoot !== undefined) continue
    for (const hook of matcher.hooks) {
      if (isGoalOwnedStopHook(hook)) found.push(hook)
    }
  }
  return found
}

function removeGoalStopHooks(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  appState: AppState,
  sessionId: string,
): HookCommand[] {
  const hooks = listGoalStopHooks(appState, sessionId)
  for (const hook of hooks) {
    removeSessionHook(setAppState, sessionId, 'Stop', hook, {
      skillRoot: undefined,
      matchByIdentity: true,
    })
  }
  return hooks
}

function logGoalCleared(
  goal: NonNullable<AppState['activeGoal']>,
  reason: 'user_clear' | 'superseded',
): void {
  logEvent('tengu_goal_cleared', {
    reason:
      reason as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    iterations: goal.iterations,
    durationMs: Date.now() - goal.setAt,
    origin: (goal.origin ??
      'user') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
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
        "/goal can't run while hooks are restricted (disableAllHooks or allowManagedHooksOnly is set in settings or by policy).",
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

/**
 * Official 2.1.326 #54: Monotonic mutation epoch + goal-identity helpers so
 * an in-flight Stop hook evaluation running while background work is in
 * progress cannot overwrite a concurrent `/goal clear` or new `/goal`.
 */
let goalMutationEpoch = 0

export function getGoalMutationEpoch(): number {
  return goalMutationEpoch
}

export function bumpGoalMutationEpoch(): number {
  goalMutationEpoch += 1
  return goalMutationEpoch
}

export function isSameActiveGoal(
  live: AppState['activeGoal'],
  snapshot: AppState['activeGoal'],
): boolean {
  if (live === undefined || snapshot === undefined) {
    return live === snapshot
  }
  return live.setAt === snapshot.setAt && live.condition === snapshot.condition
}

export function applyGoalStateUpdateIfUnchanged(
  setAppState: (updater: (prev: AppState) => AppState) => void,
  snapshot: NonNullable<AppState['activeGoal']>,
  nextGoal: AppState['activeGoal'],
  snapshotEpoch?: number,
): boolean {
  if (snapshotEpoch !== undefined && snapshotEpoch !== goalMutationEpoch) {
    return false
  }
  let applied = false
  setAppState(prev => {
    if (!isSameActiveGoal(prev.activeGoal, snapshot)) {
      return prev
    }
    applied = true
    return { ...prev, activeGoal: nextGoal }
  })
  return applied
}

/**
 * densable vJe / Official `YQt` (#54) — tear down the Stop hook + activeGoal.
 * Clears whenever EITHER `activeGoal` OR Stop prompt hooks exist, and bumps
 * `goalMutationEpoch` so concurrent Stop hooks cannot restore the cleared goal.
 */
export async function applyGoalClear(
  context: LocalJSXCommandContext,
): Promise<string | null> {
  // densable q() — main session id, not the caller agentId.
  const sessionId = getSessionId()
  const appState = context.getAppState()
  const hooks = listGoalStopHooks(appState, sessionId)
  const activeGoal = appState.activeGoal
  const firstHookPrompt =
    hooks.length > 0 && 'prompt' in hooks[0]! ? hooks[0]!.prompt : undefined
  const condition = activeGoal?.condition ?? firstHookPrompt
  if (condition === undefined) return null
  bumpGoalMutationEpoch()
  for (const hook of hooks) {
    removeSessionHook(context.setAppState, sessionId, 'Stop', hook, {
      skillRoot: undefined,
      matchByIdentity: true,
    })
  }
  if (activeGoal !== undefined) logGoalCleared(activeGoal, 'user_clear')
  context.setAppState(prev =>
    prev.activeGoal === undefined ? prev : { ...prev, activeGoal: undefined },
  )
  context.setMessages(prev => [
    ...prev,
    createAttachmentMessage({
      type: 'goal_status',
      met: true,
      sentinel: true,
      condition,
    }),
  ])
  logEvent('tengu_stop_hook_removed', {
    via: 'goal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return condition
}

/**
 * densable EJe — register the Stop hook + activeGoal. Returns a gate message
 * or null on success.
 */
export async function applyGoalSet(
  input: string,
  context: LocalJSXCommandContext,
): Promise<string | null> {
  const sessionId = getSessionId()
  const origin = consumeQueuedGoalOrigin(input, context)
  const gate = checkGates()
  if (gate) {
    return gate.message
  }
  bumpGoalMutationEpoch()
  const appState = context.getAppState()
  if (appState.activeGoal !== undefined) {
    logGoalCleared(appState.activeGoal, 'superseded')
  }
  removeGoalStopHooks(context.setAppState, appState, sessionId)
  const hookCommand: HookCommand = markGoalStopHook({
    type: 'prompt',
    prompt: input,
  })
  addSessionHook(context.setAppState, sessionId, 'Stop', '', hookCommand)
  const tokensAtStart = getTotalOutputTokens()
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
  context.setMessages(prev => [
    ...prev,
    createAttachmentMessage({
      type: 'goal_status',
      met: false,
      sentinel: true,
      condition: input,
    }),
  ])
  logEvent('tengu_stop_hook_added', {
    promptLength: input.length,
    via: 'goal' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    origin:
      origin as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
  return null
}

function formatActiveStatus(
  activeGoal: NonNullable<AppState['activeGoal']>,
): string {
  const elapsed =
    activeGoal.iterations === 0
      ? 'not yet evaluated'
      : `${activeGoal.iterations} ${plural(activeGoal.iterations, 'turn')}`
  const lastCheck = activeGoal.lastReason
    ? `\nLast check: ${firstLineOf(activeGoal.lastReason.trim())}`
    : ''
  return `Goal active: ${activeGoal.condition} (${elapsed})${lastCheck}`
}

/** densable `u` — local/headless `/goal` call. */
export async function call(
  args: string,
  context: LocalJSXCommandContext,
): Promise<LocalCommandResult> {
  const input = args.trim()

  if (!input) {
    const activeGoal = context.getAppState().activeGoal
    if (!activeGoal) {
      return {
        type: 'text',
        value: 'No goal set. Usage: `/goal <condition>`',
      }
    }
    return {
      type: 'text',
      value: formatActiveStatus(activeGoal),
    }
  }

  if (isGoalClearKeyword(input)) {
    const condition = await applyGoalClear(context)
    return {
      type: 'text',
      value: condition === null ? 'No goal set' : `Goal cleared: ${condition}`,
    }
  }

  if (input.length > MAX_GOAL_CONDITION_LENGTH) {
    logGoalTooLong()
    return {
      type: 'text',
      value: `Goal condition is limited to ${MAX_GOAL_CONDITION_LENGTH} characters (got ${input.length})`,
    }
  }

  const gate = await applyGoalSet(input, context)
  if (gate) {
    return { type: 'text', value: gate }
  }

  return {
    type: 'query',
    value: `Goal set: ${input}`,
    prompt: GOAL_SYSTEM_MESSAGE(input),
  }
}

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set a goal — keep working until the condition is met',
  argumentHint: '[<condition> | clear]',
  supportsNonInteractive: true,
  load: () => Promise.resolve({ call }),
} satisfies Command

export default goal
