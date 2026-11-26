import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `TYs` / `xuo` — hidden `/__remote-workflow` deterministic
 * entry point for server-launched remote (CCR) sessions.
 */
const remoteWorkflow = {
  type: 'local',
  name: '__remote-workflow',
  description:
    'Run the workflow script delivered in this session environment (server-launched sessions only)',
  isHidden: true,
  disableModelInvocation: true,
  supportsNonInteractive: true,
  load: () => import('./remote-workflow.js'),
} satisfies Command

export default remoteWorkflow
