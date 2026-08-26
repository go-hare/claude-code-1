/**
 * densable 2.1.239 leftover — implicit session team (MQA / V2y / PQA).
 * Not a changelog item. Do not invent storageV5 or AppState.teammateColors.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getSessionCreatedTeams,
  resetStateForTests,
  setCwdState,
  setOriginalCwd,
  setProjectRoot,
  switchSession,
} from '../../../bootstrap/state.js'
import { asSessionId } from '../../../types/ids.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { getTaskListId, clearLeaderTeamName } from '../../tasks.js'
import {
  cleanupTempDir,
  createTempDir,
} from '../../../../tests/mocks/file-system.js'
import { TEAM_LEAD_NAME } from '../constants.js'
import { formatAgentId } from '../../agentId.js'
import { getTeamFilePath } from '../teamHelpers.js'
import { clearTeammateColors } from '../teammateLayoutManager.js'
import {
  _resetInheritedTeamNameForTesting,
  initializeSessionTeam,
  sessionTeamName,
} from '../sessionTeam.js'

const testCwd = 'D:\\workspace\\repo'

let configHomeDir = ''
let previousClaudeConfigDir: string | undefined
let previousInherited: string | undefined

function setTestSession(sessionId: string): void {
  switchSession(asSessionId(sessionId))
}

function readTeamFile(teamName: string): {
  name: string
  description?: string
  leadAgentId: string
  members: Array<{ name: string; backendType?: string; tmuxPaneId?: string }>
} {
  return JSON.parse(
    readFileSync(getTeamFilePath(teamName), 'utf-8'),
  ) as ReturnType<typeof readTeamFile>
}

describe('densable 2.1.239 initializeSessionTeam', () => {
  beforeEach(async () => {
    resetStateForTests()
    clearLeaderTeamName()
    clearTeammateColors()
    _resetInheritedTeamNameForTesting()
    setOriginalCwd(testCwd)
    setProjectRoot(testCwd)
    setCwdState(testCwd)
    setTestSession('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')

    previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
    previousInherited = process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
    delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
    configHomeDir = await createTempDir('session-team-')
    process.env.CLAUDE_CONFIG_DIR = configHomeDir
    getClaudeConfigHomeDir.cache?.clear?.()
  })

  afterEach(async () => {
    resetStateForTests()
    clearLeaderTeamName()
    clearTeammateColors()
    _resetInheritedTeamNameForTesting()
    if (previousClaudeConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir
    }
    if (previousInherited === undefined) {
      delete process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME
    } else {
      process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = previousInherited
    }
    getClaudeConfigHomeDir.cache?.clear?.()
    if (configHomeDir) {
      await cleanupTempDir(configHomeDir)
    }
  })

  test('sessionTeamName is session- plus first 8 session id chars', () => {
    expect(sessionTeamName('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')).toBe(
      'session-aaaaaaaa',
    )
  })

  test('writes lead-only team file and seeds context', async () => {
    const result = await initializeSessionTeam()
    expect(result.teamContext.teamName).toBe('session-aaaaaaaa')
    expect(result.teamContext.leadAgentId).toBe(
      formatAgentId(TEAM_LEAD_NAME, 'session-aaaaaaaa'),
    )
    expect(result.teamContext.teamFilePath).toBe(
      getTeamFilePath('session-aaaaaaaa'),
    )
    expect(result.teammateColors.index).toBe(1)
    expect(getTaskListId()).toBe('session-aaaaaaaa')
    expect([...getSessionCreatedTeams()]).toContain('session-aaaaaaaa')

    const file = readTeamFile('session-aaaaaaaa')
    expect(file.name).toBe('session-aaaaaaaa')
    expect(file.description).toBeUndefined()
    expect(file.members).toHaveLength(1)
    expect(file.members[0]).toMatchObject({
      name: TEAM_LEAD_NAME,
      backendType: 'in-process',
      tmuxPaneId: 'leader',
    })
  })

  test('existingTeamName + existing file skips rewrite', async () => {
    const teamName = 'assistant-keep'
    mkdirSync(join(configHomeDir, 'teams', teamName), { recursive: true })
    writeFileSync(
      getTeamFilePath(teamName),
      JSON.stringify({
        name: teamName,
        description: 'keep-me',
        createdAt: 1,
        leadAgentId: formatAgentId(TEAM_LEAD_NAME, teamName),
        members: [],
      }),
    )

    const result = await initializeSessionTeam({
      existingTeamName: teamName,
    })
    expect(result.teamContext.teamName).toBe(teamName)
    expect(readTeamFile(teamName).description).toBe('keep-me')
  })

  test('no existing name overwrites a same-named file (official 1:1)', async () => {
    const teamName = 'session-aaaaaaaa'
    mkdirSync(join(configHomeDir, 'teams', teamName), { recursive: true })
    writeFileSync(
      getTeamFilePath(teamName),
      JSON.stringify({
        name: teamName,
        description: 'should-be-replaced',
        createdAt: 1,
        leadAgentId: formatAgentId(TEAM_LEAD_NAME, teamName),
        members: [],
      }),
    )

    await initializeSessionTeam()
    expect(readTeamFile(teamName).description).toBeUndefined()
    expect(readTeamFile(teamName).members).toHaveLength(1)
  })

  test('consumes CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME once', async () => {
    process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = 'inherited-team'
    const first = await initializeSessionTeam()
    expect(first.teamContext.teamName).toBe('inherited-team')
    expect(process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME).toBeUndefined()

    process.env.CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME = 'second-should-not-win'
    const second = await initializeSessionTeam()
    expect(second.teamContext.teamName).toBe('inherited-team')
  })
})
