import type { Command } from '../../commands.js'
import { isCoordinatorMode } from '../../coordinator/coordinatorMode.js'

/**
 * densable 2.1.212 `/subtask` — in-session full-context fork worker
 * (what `/fork` did before 2.1.212).
 */
const subtask = {
  type: 'local-jsx',
  name: 'subtask',
  description:
    'Send a subagent off with your full context; its result comes back here',
  argumentHint: '<task>',
  isEnabled: () => !isCoordinatorMode(),
  load: () => import('./subtask.js'),
} satisfies Command

export default subtask
