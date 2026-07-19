import type { LocalCommandCall } from '../../types/command.js'
import {
  clearGoal,
  completeGoal,
  continueGoalFromMaxTurns,
  formatGoalElapsed,
  formatGoalStatusLabel,
  getGoal,
  incrementGoalTurns,
  MAX_GOAL_TURNS,
  pauseGoal,
  resumeGoal,
  setGoal,
} from '../../services/goal/goalState.js'
import {
  persistCurrentGoal,
  persistGoalClear,
} from '../../services/goal/goalStorage.js'
import { removeByFilter } from '../../utils/messageQueueManager.js'

const MAX_OBJECTIVE_CHARS = 4000

function drainGoalContinuationQueue(): void {
  removeByFilter(
    cmd =>
      cmd.origin === 'goal-continuation' || cmd.origin === 'goal-budget-limit',
  )
}

function formatGoalStatus(): string {
  const goal = getGoal()
  if (!goal) {
    return 'No active goal. Set one with `/goal <objective>`.'
  }
  const tokens =
    goal.tokenBudget !== null
      ? `${goal.tokensUsed} / ${goal.tokenBudget}`
      : `${goal.tokensUsed}`
  const lines = [
    `Goal: ${goal.objective}`,
    `Status: ${formatGoalStatusLabel(goal.status)}`,
    `Time: ${formatGoalElapsed(goal)}`,
    `Tokens: ${tokens}`,
    `Continuation turns: ${goal.turnsExecuted}`,
  ]
  if (goal.status === 'max_turns') {
    lines.push(
      `Hint: Max continuation turns reached (${MAX_GOAL_TURNS}). Run \`/goal continue\` to reset and continue.`,
    )
  }
  return lines.join('\n')
}

/**
 * densable m1y / g1y — non-interactive `/goal` without replace dialog.
 * Replaces existing goals immediately (no JSX confirm).
 */
export const call: LocalCommandCall = async args => {
  const trimmed = args?.trim() || ''

  if (!trimmed || trimmed.toLowerCase() === 'status') {
    return { type: 'text', value: formatGoalStatus() }
  }

  const lower = trimmed.toLowerCase()

  if (lower === 'clear') {
    const cleared = clearGoal()
    if (cleared) {
      persistGoalClear()
      drainGoalContinuationQueue()
    }
    return {
      type: 'text',
      value: cleared ? 'Goal cleared.' : 'No active goal to clear.',
    }
  }

  if (lower === 'pause') {
    const g = pauseGoal()
    if (g) {
      persistCurrentGoal()
      drainGoalContinuationQueue()
    }
    return {
      type: 'text',
      value: g ? 'Goal paused.' : 'No active goal to pause.',
    }
  }

  if (lower === 'resume') {
    const current = getGoal()
    if (current?.status === 'max_turns') {
      return {
        type: 'text',
        value: `Goal reached max continuation turns (${MAX_GOAL_TURNS}). Run \`/goal continue\` to reset turn counter and continue.`,
      }
    }
    const g = resumeGoal()
    if (g) persistCurrentGoal()
    return {
      type: 'text',
      value: g ? 'Goal resumed.' : 'No paused goal to resume.',
    }
  }

  if (lower === 'continue') {
    const g = continueGoalFromMaxTurns()
    if (g) persistCurrentGoal()
    return {
      type: 'text',
      value: g
        ? `Goal continuation counter reset (0/${MAX_GOAL_TURNS}). Continuing...`
        : 'Current goal is not in max-turns state.',
    }
  }

  if (lower === 'complete') {
    const g = completeGoal()
    if (g) {
      persistCurrentGoal()
      drainGoalContinuationQueue()
    }
    return {
      type: 'text',
      value: g ? 'Goal marked complete.' : 'No active goal to complete.',
    }
  }

  if (trimmed.length > MAX_OBJECTIVE_CHARS) {
    return {
      type: 'text',
      value: `Goal objective is too long (${trimmed.length} chars; limit ${MAX_OBJECTIVE_CHARS}). Save the detailed instructions to a file and reference it from a shorter objective.`,
    }
  }

  // densable NI: replace without dialog
  if (getGoal()) drainGoalContinuationQueue()
  setGoal(trimmed)
  incrementGoalTurns()
  persistCurrentGoal()
  return { type: 'text', value: 'Goal set.' }
}
