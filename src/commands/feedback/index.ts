import type { Command } from '../../commands.js'

const feedback = {
  type: 'local-jsx',
  name: 'feedback',
  description: 'Send feedback to Anthropic or report a bug',
  argumentHint: '[report]',
  // densable 2.1.232 #35: open mid-turn while Claude is responding
  immediate: true,
  isEnabled: () => {
    // Lazy: gates.ts → settings/http/providers would cycle commands.ts.
    const { getFeedbackCommandAvailability } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/feedbackDrafts/gates.js') as typeof import('../../utils/feedbackDrafts/gates.js')
    return getFeedbackCommandAvailability().kind === 'post'
  },
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
