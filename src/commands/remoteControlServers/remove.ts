/**
 * densable jpn / daemon_rc_remove product surface.
 */
import {
  listRemoteControlServers,
  removeRemoteControlServer,
} from '../../bridge/remoteControlServers.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async args => {
  const dir = args?.trim()
  if (!dir) {
    const list = listRemoteControlServers()
    if (list.length === 0) {
      return {
        type: 'text',
        value:
          'Usage: /remote-control-remove <dir>\nNo Remote Control servers configured.',
      }
    }
    const hint = list.map(e => `  ${e.dir}`).join('\n')
    return {
      type: 'text',
      value: `Usage: /remote-control-remove <dir>\nConfigured:\n${hint}`,
    }
  }
  const removed = removeRemoteControlServer(dir)
  if (!removed) {
    // try basename / suffix match for UX
    const list = listRemoteControlServers()
    const match = list.find(
      e => e.dir === dir || e.dir.endsWith(dir) || e.name === dir,
    )
    if (match) {
      const ok = removeRemoteControlServer(match.dir)
      if (ok) {
        return {
          type: 'text',
          value: `Removed Remote Control server: ${match.dir}`,
        }
      }
    }
    return {
      type: 'text',
      value: `No Remote Control server found for ${JSON.stringify(dir)}.`,
    }
  }
  return {
    type: 'text',
    value: `Removed Remote Control server: ${dir}`,
  }
}
