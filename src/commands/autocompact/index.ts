import type { Command } from '../../commands.js'

/**
 * densable p4f — interactive local-jsx /autocompact (immediate:!0).
 * Non-interactive twin (uxi) is omitted: local-jsx call handles args text path.
 */
const autocompact = {
  type: 'local-jsx',
  name: 'autocompact',
  description: 'Set how full the context gets before auto-summarizing',
  argumentHint: '[auto|<tokens>]',
  immediate: true,
  isEnabled: () => true,
  isHidden: false,
  userFacingName() {
    return 'autocompact'
  },
  load: () => import('./autocompact.js'),
} satisfies Command

export default autocompact
