import { feature } from 'bun:bundle'
import type { Command } from '../../commands.js'
import { isHarborKiteEnabled } from '../../utils/teleport/cloudPeerAccess.js'

/**
 * Official 2.1.328 (#677): local `/list-agents` command (`aliases: ['peers']`).
 * Shows subagents, teammates, and other Claude sessions to the user alone;
 * Claude lists sessions itself via `ListAgents` when needed.
 */
const listAgents = {
  type: 'local',
  name: 'list-agents',
  aliases: ['peers'],
  description:
    'List subagents, teammates, and other Claude sessions you can message',
  supportsNonInteractive: true,
  isEnabled: () => (feature('UDS_INBOX') ? isHarborKiteEnabled() : false),
  load: () => import('./list-agents.js'),
} satisfies Command

export default listAgents
