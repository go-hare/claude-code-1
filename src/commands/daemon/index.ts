import type { Command } from '../../commands.js'
import { feature } from 'bun:bundle'

const daemon = {
  type: 'local-jsx',
  name: 'daemon',
  // densable SEA ~235628613: "Manage background services and routines"
  description: 'Manage background services and routines',
  // bare /daemon → DaemonHub; subcommands keep CLI surface
  argumentHint: '[hub|status|start|install|uninstall|stop|bg|attach|logs|kill]',
  immediate: true,
  isEnabled: () => {
    if (feature('DAEMON')) return true
    if (feature('BG_SESSIONS')) return true
    return false
  },
  load: () => import('./daemon.js'),
} satisfies Command

export default daemon
