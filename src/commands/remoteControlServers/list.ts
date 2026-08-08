/**
 * densable OWs list surface for multi-env Remote Control servers.
 */
import {
  listRemoteControlServers,
  type RemoteControlServerEntry,
} from '../../bridge/remoteControlServers.js'
import type { LocalCommandCall } from '../../types/command.js'

function formatEntry(e: RemoteControlServerEntry, i: number): string {
  const name = e.name?.trim() || '(unnamed)'
  const mode = e.spawnMode ?? 'same-dir'
  return `${i + 1}. ${name}\n   dir: ${e.dir}\n   spawn: ${mode}`
}

export const call: LocalCommandCall = async args => {
  const list = listRemoteControlServers()
  if (list.length === 0) {
    return {
      type: 'text',
      value:
        'No Remote Control servers configured.\nUse /remote-control-add-server (rc-add) to add one.',
    }
  }
  const filter = args?.trim()
  const shown = filter
    ? list.filter(
        e => e.dir.includes(filter) || (e.name?.includes(filter) ?? false),
      )
    : list
  if (shown.length === 0) {
    return {
      type: 'text',
      value: `No Remote Control servers match ${JSON.stringify(filter)}.`,
    }
  }
  const body = shown.map(formatEntry).join('\n')
  return {
    type: 'text',
    value: `Remote Control servers (${shown.length}):\n${body}`,
  }
}
