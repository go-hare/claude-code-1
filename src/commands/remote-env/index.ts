import type { Command } from '../../commands.js'
import { isRemotePolicyAllowed } from '../../services/policyLimits/index.js'
import { isClaudeAISubscriber } from '../../utils/auth.js'

export default {
  type: 'local-jsx',
  name: 'remote-env',
  description: 'Configure the default remote environment for teleport sessions',
  isEnabled: () =>
    isClaudeAISubscriber() && isRemotePolicyAllowed('allow_remote_sessions'),
  get isHidden() {
    return (
      !isClaudeAISubscriber() || !isRemotePolicyAllowed('allow_remote_sessions')
    )
  },
  load: () => import('./remote-env.js'),
} satisfies Command
