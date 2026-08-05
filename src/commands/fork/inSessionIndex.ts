import type { Command } from '../../commands.js'
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js'

/**
 * densable 2.1.212 `gwd` — agent-view OFF `/fork` (in-session xZr worker).
 * Registered instead of session-copy `/fork` + `/subtask` when agent view
 * is disabled (or IS_DEMO).
 */
const inSessionFork = {
  type: 'local-jsx',
  name: 'fork',
  description: 'Spawn a background agent that inherits the full conversation',
  argumentHint: '<directive>',
  isEnabled: () => !isCoordinatorMode(),
  load: () => import('./inSessionFork.js'),
} satisfies Command

export default inSessionFork
