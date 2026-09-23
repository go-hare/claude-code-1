import type { Command } from '../../commands.js'

const radio = {
  type: 'local',
  name: 'radio',
  description: 'Listen to Claude FM lo-fi radio',
  supportsNonInteractive: false,
  load: () => import('./radio.js'),
} satisfies Command

export default radio
