/**
 * `claude agents` — Agent view entry point.
 * Lists all background sessions in a full-screen interactive dashboard.
 */

import {
  listLiveSessions,
  handleBgStart,
  attachHandler,
  killHandler,
} from './bg.js'
import type { SessionEntry } from './bg/engine.js'

export interface AgentViewAction {
  type: 'attach' | 'create' | 'kill' | 'done'
  sessionId?: string
  prompt?: string
}

export async function agentsMain(args: string[]): Promise<void> {
  // --json flag: output session list as JSON and exit
  if (args.includes('--json')) {
    const sessions = await listLiveSessions()
    process.stdout.write(JSON.stringify(sessions, null, 2) + '\n')
    return
  }

  // Interactive dashboard
  const { renderAgentView } = await import('../screens/AgentView.js')
  await renderAgentView()
}
