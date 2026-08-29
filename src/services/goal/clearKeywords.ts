/**
 * densable nmw / bZr — /goal clear keywords.
 * ProposeGoal refuses these; /goal consumes them as clear.
 */

export const GOAL_CLEAR_KEYWORDS = new Set([
  'clear',
  'stop',
  'off',
  'reset',
  'none',
  'cancel',
])

export function isGoalClearKeyword(condition: string): boolean {
  return GOAL_CLEAR_KEYWORDS.has(condition.toLowerCase())
}
