/**
 * useGoalLoop — React hook that monitors turn completion and auto-continues
 * when an active goal condition is not yet met.
 */

import { useCallback, useRef } from 'react'
import { enqueue } from '../utils/messageQueueManager.js'
import { evaluateGoalCondition } from '../commands/goalEvaluator.js'
import {
  clearActiveGoal,
  getActiveGoal,
  incrementGoalIteration,
} from '../commands/goalState.js'
import { logForDebugging } from '../utils/debug.js'
import type { Message } from '../types/message.js'

/**
 * Returns a callback to be called after each turn completes.
 * If a goal is active, evaluates the condition and enqueues a continuation
 * turn if the goal is not yet met.
 */
export function useGoalLoop(): {
  onGoalTurnComplete: (messages: Message[]) => void
} {
  const evaluatingRef = useRef(false)

  const onGoalTurnComplete = useCallback((messages: Message[]) => {
    const goal = getActiveGoal()
    if (!goal || evaluatingRef.current) return

    evaluatingRef.current = true

    void (async () => {
      try {
        logForDebugging(`[goal] evaluating condition: ${goal.condition}`)
        const result = await evaluateGoalCondition(goal.condition, messages)

        incrementGoalIteration(result.reason)

        if (result.ok) {
          clearActiveGoal()
          logForDebugging(`[goal] condition met: ${result.reason}`)
          enqueue({
            value: `Goal achieved: "${goal.condition}"\nReason: ${result.reason}\nReport the goal completion to the user.`,
            mode: 'prompt',
          })
        } else {
          logForDebugging(`[goal] condition not met: ${result.reason}`)
          enqueue({
            value: `Continue working toward the goal: "${goal.condition}"\nLast check: ${result.reason}\nMake progress on the next step.`,
            mode: 'prompt',
          })
        }
      } catch (e) {
        logForDebugging(`[goal] evaluation error: ${e}`)
      } finally {
        evaluatingRef.current = false
      }
    })()
  }, [])

  return { onGoalTurnComplete }
}
