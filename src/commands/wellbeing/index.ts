import type { Command } from '../../commands.js'

/**
 * Official 2.1.331 `DYs` / `lLt` — `/wellbeing` slash command.
 * Compile-time disabled in external 2.1.331 (`isEnabled: () => false`).
 */
const wellbeing = {
  type: 'local-jsx',
  name: 'wellbeing',
  aliases: ['breaks', 'break-reminder', 'downtime'],
  description: 'Configure optional break reminders and quiet-hours nudges',
  isEnabled: () => false,
  immediate: true,
  requires: { ink: true },
  load: () => import('./wellbeing.js'),
} satisfies Command

export default wellbeing
