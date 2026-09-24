import type { Command } from '../../commands.js'

const bug = {
  type: 'local-jsx',
  name: 'bug',
  description: 'Report a bug or share your conversation',
  argumentHint: '[report]',
  // densable 2.1.232 #35: open mid-turn while Claude is responding
  immediate: true,
  // densable leftover `n` is always the call. Disable is wur→Tie→TG, which
  // names /bug (or /share) — do not hide the command or the refusal is lost.
  load: () => import('./bug.js'),
} satisfies Command

export default bug
