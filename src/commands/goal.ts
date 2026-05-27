/**
 * /goal — Set a completion condition; Claude keeps working until it's met.
 */

import type { Command, LocalCommandResult } from '../types/command.js'
import {
  clearActiveGoal,
  getActiveGoal,
  isGoalClearCommand,
  setActiveGoal,
  validateGoalCondition,
} from './goalState.js'

const goal = {
  type: 'local',
  name: 'goal',
  description: 'Set a goal — keep working until the condition is met',
  argumentHint: '[<condition> | clear]',
  immediate: true,
  supportsNonInteractive: true,
  load: () =>
    Promise.resolve({
      async call(args: string): Promise<LocalCommandResult> {
        const input = args.trim()

        // No args: show current status
        if (!input) {
          const current = getActiveGoal()
          if (!current) {
            return {
              type: 'text',
              value: 'No goal set. Usage: `/goal <condition>`',
            }
          }
          const elapsed =
            current.iterations === 0
              ? 'not yet evaluated'
              : `${current.iterations} turn${current.iterations === 1 ? '' : 's'}`
          const reason = current.lastReason
            ? `\nLast check: ${current.lastReason}`
            : ''
          return {
            type: 'text',
            value: `Goal active: ${current.condition} (${elapsed})${reason}`,
          }
        }

        // Clear command
        if (isGoalClearCommand(input)) {
          const cleared = clearActiveGoal()
          return {
            type: 'text',
            value:
              cleared === null ? 'No goal set' : `Goal cleared: ${cleared}`,
          }
        }

        // Validate
        const error = validateGoalCondition(input)
        if (error) {
          return { type: 'text', value: error }
        }

        // Set the goal and trigger a query
        setActiveGoal(input)
        return {
          type: 'text',
          value: `Goal set: ${input}\nClaude will keep working until this condition is met.`,
        }
      },
    }),
} satisfies Command

export default goal
