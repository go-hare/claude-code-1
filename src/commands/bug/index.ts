import type { Command } from '../../commands.js'

const bug = {
  type: 'local-jsx',
  name: 'bug',
  description: 'Report a bug or share your conversation',
  argumentHint: '[report]',
  // densable 2.1.232 #35: open mid-turn while Claude is responding
  immediate: true,
  isEnabled: () => {
    const { getFeedbackCommandAvailability } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('../../utils/feedbackDrafts/gates.js') as typeof import('../../utils/feedbackDrafts/gates.js')
    return getFeedbackCommandAvailability().kind === 'post'
  },
  load: () => import('./bug.js'),
} satisfies Command

export default bug
