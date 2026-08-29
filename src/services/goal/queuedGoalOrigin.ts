/**
 * densable 2.1.239 ebl / smw — ProposeGoal stamps origin; /goal SZr consumes it.
 *
 * Restore (ueu) does not consume this field.
 */

import type { AppState } from '../../state/AppStateStore.js'

export type QueuedGoalOriginKind = 'proposal_direct' | 'proposal_approved'

type SetAppState = (updater: (prev: AppState) => AppState) => void

/** densable ebl */
export function setQueuedGoalOrigin(
  setAppState: SetAppState,
  condition: string,
  origin: QueuedGoalOriginKind,
): void {
  setAppState(prev => ({
    ...prev,
    queuedGoalOrigin: { condition, origin },
  }))
}

/** densable smw — mismatch / absent → `"user"`; match consumes the latch. */
export function consumeQueuedGoalOrigin(
  condition: string,
  context: {
    getAppState: () => AppState
    setAppState: SetAppState
  },
): string {
  const queued = context.getAppState().queuedGoalOrigin
  if (queued === undefined || queued.condition !== condition) {
    return 'user'
  }
  context.setAppState(prev => ({ ...prev, queuedGoalOrigin: undefined }))
  return queued.origin
}
