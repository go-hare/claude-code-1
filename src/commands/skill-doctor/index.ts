import type { Command } from '../../commands.js'

/**
 * densable skill-doctor — unused loaded skills + disused plugins tip surface.
 */
const skillDoctor = {
  type: 'local',
  name: 'skill-doctor',
  description: 'Show which loaded skills are unused and costing context',
  isEnabled: () => true,
  supportsNonInteractive: true,
  load: () => import('./skill-doctor.js'),
} satisfies Command

export default skillDoctor
