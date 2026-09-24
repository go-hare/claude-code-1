import type { Command } from '../../commands.js'

const feedback = {
  type: 'local-jsx',
  name: 'feedback',
  description: 'Send feedback to Anthropic or report a bug',
  argumentHint: '[report]',
  // densable 2.1.232 #35: open mid-turn while Claude is responding
  immediate: true,
  // densable leftover `jr`/`Ns` always load; disable is wur→Tie→TG default /feedback.
  load: () => import('./feedback.js'),
} satisfies Command

export default feedback
