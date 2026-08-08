/**
 * densable 2.1.218 multi-env RC server list/detail/remove (OWs + B8a + jpn).
 * /remote-control-servers · aliases: rc-list, rcs-list  (interactive manage)
 * /remote-control-remove · aliases: rc-remove, rcs-remove (text path keep)
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

export const remoteControlServersList = {
  type: 'local-jsx',
  name: 'remote-control-servers',
  aliases: ['rc-list', 'rcs-list'],
  description:
    'Manage multi-env Remote Control servers (list / Restart / Remove / Back)',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  immediate: true,
  load: () => import('./manage.js'),
} satisfies Command

export const remoteControlServersRemove = {
  type: 'local',
  name: 'remote-control-remove',
  aliases: ['rc-remove', 'rcs-remove'],
  description:
    'Remove a multi-env Remote Control server by directory (jpn / daemon_rc_remove)',
  argumentHint: '<dir>',
  isEnabled,
  get isHidden() {
    return !isEnabled()
  },
  supportsNonInteractive: true,
  load: () => import('./remove.js'),
} satisfies Command

export default remoteControlServersList
