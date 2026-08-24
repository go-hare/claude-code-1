import type { Command } from '../../commands.js'

const permissions = {
  type: 'local-jsx',
  name: 'permissions',
  aliases: ['allowed-tools'],
  // densable 2.1.234 DWS: description + immediate:!0
  // immediate keeps /permissions open mid-turn and protects it from bash
  // setToolJSX(null) via localJSXCommandRef (finish ≠ dismiss).
  description: 'Manage allow and deny tool permission rules',
  immediate: true,
  load: () => import('./permissions.js'),
} satisfies Command

export default permissions
