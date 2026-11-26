import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `EYs` / `Puo` — hidden `/workflow-launch-exec` command for
 * executing server-launched workflow handoffs (`workflow_launch` events).
 */
const workflowLaunchExec = {
  type: 'local',
  name: 'workflow-launch-exec',
  description:
    'Execute a server-launched workflow handoff (workflow_launch event sessions only)',
  isHidden: true,
  disableModelInvocation: true,
  supportsNonInteractive: true,
  load: () => import('./workflow-launch-exec.js'),
} satisfies Command

export default workflowLaunchExec
