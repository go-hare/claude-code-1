import type { Command } from '../../commands.js'

const exit = {
  type: 'local-jsx',
  name: 'exit',
  aliases: ['quit'],
  description: 'Exit the REPL',
  immediate: true,
  // official tip SEA: fleetHostCall:async({exit:e})=>e()
  fleetHostCall: async ({ exit: hostExit }) => {
    hostExit()
  },
  load: () => import('./exit.js'),
} satisfies Command

export default exit
