/**
 * densable 2.1.218 multi-env "New Remote Control server" + trust gate entry.
 * /remote-control-add-server · aliases: rc-add, rcs-add
 */
import { feature } from 'bun:bundle'
import { isBridgeEnabled } from '../../bridge/bridgeEnabled.js'
import type { Command } from '../../commands.js'

function isEnabled(): boolean {
  if (!feature('BRIDGE_MODE')) {
    return false
  }
  return isBridgeEnabled()
}

const remoteControlAddServer = {
  type: 'local-jsx',
  name: 'remote-control-add-server',
  aliases: ['rc-add', 'rcs-add'],
  description:
    'Add a directory as a multi-env Remote Control server (trust gate + config)',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('./remoteControlAddServer.js'),
} satisfies Command

export default remoteControlAddServer
