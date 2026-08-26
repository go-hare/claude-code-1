import { rename } from 'fs/promises'
import { getSessionId } from '../../bootstrap/state.js'
import type { AppState } from '../../state/AppStateStore.js'
import { formatAgentId } from '../agentId.js'
import { getCwd } from '../cwd.js'
import { logForDebugging } from '../debug.js'
import { errorMessage } from '../errors.js'
import { logError } from '../log.js'
import { ensureTasksDir, getTasksDir, setLeaderTeamName } from '../tasks.js'
import { TEAM_LEAD_NAME } from './constants.js'
import { assignTeammateColor } from './teammateLayoutManager.js'
import {
  getTeamFilePath,
  readTeamFileAsync,
  registerTeamForSessionCleanup,
  writeTeamFileAsync,
  type TeamFile,
} from './teamHelpers.js'

const SESSION_TEAM_PREFIX = 'session'

let inheritedTeamName: string | null | undefined

/**
 * densable V2y / sessionTeamName — `session-${sessionId.slice(0, 8)}`.
 */
export function sessionTeamName(sessionId: string): string {
  return `${SESSION_TEAM_PREFIX}-${sessionId.slice(0, 8)}`
}

/**
 * densable PQA — first call consumes CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
 * into the process latch (official inheritedTeamName host).
 */
function consumeInheritedTeamName(): string | null {
  if (inheritedTeamName === undefined) {
    const fromEnv = process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME || null
    delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
    inheritedTeamName = fromEnv
  }
  return inheritedTeamName ?? null
}

/** densable DQA / _resetInheritedTeamNameForTesting */
export function _resetInheritedTeamNameForTesting(): void {
  inheritedTeamName = undefined
}

export type InitializeSessionTeamResult = {
  teamContext: NonNullable<AppState['teamContext']>
  teammateColors: {
    assignments: Map<string, ReturnType<typeof assignTeammateColor>>
    index: number
  }
}

/**
 * densable MQA / initializeSessionTeam — one implicit team per session
 * when agent swarms are enabled. Team name is session-derived unless
 * `existingTeamName` or CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME is set.
 */
export async function initializeSessionTeam(opts?: {
  existingTeamName?: string
}): Promise<InitializeSessionTeamResult> {
  const existing = opts?.existingTeamName || consumeInheritedTeamName()
  const teamName = existing ?? sessionTeamName(getSessionId())
  const leadAgentId = formatAgentId(TEAM_LEAD_NAME, teamName)
  const teamFilePath = getTeamFilePath(teamName)
  const existingFile = existing ? await readTeamFileAsync(teamName) : null

  if (!existingFile) {
    const teamFile: TeamFile = {
      name: teamName,
      createdAt: Date.now(),
      leadAgentId,
      leadSessionId: getSessionId(),
      members: [
        {
          agentId: leadAgentId,
          name: TEAM_LEAD_NAME,
          agentType: TEAM_LEAD_NAME,
          joinedAt: Date.now(),
          tmuxPaneId: 'leader',
          cwd: getCwd(),
          subscriptions: [],
          backendType: 'in-process',
        },
      ],
    }
    await writeTeamFileAsync(teamName, teamFile).catch(error => {
      logForDebugging(
        `[TeammateTool] Failed to write team file for ${teamName}: ${errorMessage(error)}`,
        { level: 'error' },
      )
      logError(error)
    })
  }

  setLeaderTeamName(teamName)
  const sessionId = getSessionId()
  if (teamName !== sessionId) {
    await rename(getTasksDir(sessionId), getTasksDir(teamName)).catch(() => {})
  }
  await ensureTasksDir(teamName)
  registerTeamForSessionCleanup(teamName)

  const color = assignTeammateColor(leadAgentId)
  return {
    teamContext: {
      teamName,
      teamFilePath,
      leadAgentId,
      teammates: {
        [leadAgentId]: {
          name: TEAM_LEAD_NAME,
          agentType: TEAM_LEAD_NAME,
          color,
          tmuxSessionName: 'in-process',
          tmuxPaneId: 'leader',
          cwd: getCwd(),
          spawnedAt: Date.now(),
        },
      },
    },
    teammateColors: {
      assignments: new Map([[leadAgentId, color]]),
      index: 1,
    },
  }
}
