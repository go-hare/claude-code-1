import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `RYs` / `Ouo` — `/pro-trial-expired` hidden dialog shown
 * when a Pro plan Claude Code trial has ended.
 */
const proTrialExpired = {
  type: 'local-jsx',
  name: 'pro-trial-expired',
  description: 'Options shown when the Pro plan Claude Code trial has ended',
  isHidden: true,
  load: () => import('./pro-trial-expired.js'),
} satisfies Command

export default proTrialExpired
