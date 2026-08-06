import type { Command } from '../../commands.js'

const btw = {
  type: 'local-jsx',
  name: 'btw',
  description:
    'Ask a quick side question without interrupting the main conversation',
  immediate: true,
  // densable Abs: argumentHint:"[question]" (optional — bare /btw reopens last)
  argumentHint: '[question]',
  load: () => import('./btw.js'),
} satisfies Command

export default btw
