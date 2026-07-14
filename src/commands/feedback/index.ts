import type { Command } from '../../commands.js'
import { isPolicyAllowed } from '../../services/policyLimits/index.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'

const feedback = {
  aliases: ['bug'],
  type: 'local-jsx',
  name: 'feedback',
  description: `Submit feedback about Claude Code`,
  argumentHint: '[report]',
  isEnabled: () => {
    // Official USE_* densables — feedback disabled on 3P cloud providers.
    let useBedrock = isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK)
    let useVertex = isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX)
    let useFoundry = isEnvTruthy(process.env.CLAUDE_CODE_USE_FOUNDRY)
    try {
      const {
        isUseBedrockEnvEnabled,
        isUseVertexEnvEnabled,
        isUseFoundryEnvEnabled,
      } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('../../utils/residualFinalEnvGates.js') as typeof import('../../utils/residualFinalEnvGates.js')
      useBedrock = isUseBedrockEnvEnabled()
      useVertex = isUseVertexEnvEnabled()
      useFoundry = isUseFoundryEnvEnabled()
    } catch {
      // keep raw env fallback
    }
    return !(
      useBedrock ||
      useVertex ||
      useFoundry ||
      isEnvTruthy(process.env.DISABLE_FEEDBACK_COMMAND) ||
      isEnvTruthy(process.env.DISABLE_BUG_COMMAND) ||
      isEssentialTrafficOnly() ||
      process.env.USER_TYPE === 'ant' ||
      !isPolicyAllowed('allow_product_feedback')
    )
  },
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
