/**
 * Goal state management — module-level singleton.
 * Tracks the active goal condition and iteration count.
 */

export interface ActiveGoal {
  condition: string
  setAt: number
  iterations: number
  lastReason: string | null
}

let activeGoal: ActiveGoal | null = null

export function getActiveGoal(): ActiveGoal | null {
  return activeGoal
}

export function setActiveGoal(condition: string): void {
  activeGoal = {
    condition,
    setAt: Date.now(),
    iterations: 0,
    lastReason: null,
  }
}

export function clearActiveGoal(): string | null {
  if (!activeGoal) return null
  const condition = activeGoal.condition
  activeGoal = null
  return condition
}

export function incrementGoalIteration(reason: string): void {
  if (activeGoal) {
    activeGoal.iterations++
    activeGoal.lastReason = reason
  }
}

const MAX_GOAL_CONDITION_LENGTH = 500

export function validateGoalCondition(condition: string): string | null {
  if (condition.length > MAX_GOAL_CONDITION_LENGTH) {
    return `Goal condition is limited to ${MAX_GOAL_CONDITION_LENGTH} characters (got ${condition.length})`
  }
  return null
}

export function isGoalClearCommand(input: string): boolean {
  const lower = input.toLowerCase().trim()
  return lower === 'clear' || lower === 'stop' || lower === 'off'
}
