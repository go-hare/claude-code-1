import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { existsSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import * as realEnvUtils from '../../envUtils.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { clearLeaderTeamName } from '../../tasks.js'
import { initializeSessionTeam } from '../sessionTeam.js'
import { cleanupSessionTeams, getTeamFilePath } from '../teamHelpers.js'

const envUtilsSnap = snapshotModuleExports(realEnvUtils)

mock.module('src/utils/swarm/backends/registry.js', () => {
  const executor = {
    type: 'in-process' as const,
    setContext() {},
    async isAvailable() {
      return true
    },
    async spawn(config: { name: string; teamName: string; color?: string }) {
      return {
        success: true,
        agentId: `${config.name}@${config.teamName}`,
        taskId: `task-${config.name}`,
        backendType: 'in-process',
        color: config.color,
        isSplitPane: false,
      }
    },
    async sendMessage() {},
    async terminate() {
      return true
    },
    async kill() {
      return true
    },
    async isActive() {
      return true
    },
  }

  return {
    getTeammateExecutor: async () => executor,
    getInProcessBackend: () => executor,
    detectAndGetBackend: async () => ({
      backend: { type: 'in-process' },
      isNative: false,
      needsIt2Setup: false,
    }),
    isInProcessEnabled: () => true,
    markInProcessFallback: () => {},
    resetBackendDetection: () => {},
    getCachedBackend: () => null,
    getCachedDetectionResult: () => null,
    getResolvedTeammateMode: () => 'in-process',
    ensureBackendsRegistered: async () => {},
    registerTmuxBackend: () => {},
    registerITermBackend: () => {},
    registerWindowsTerminalBackend: () => {},
    getBackendByType: () => ({
      type: 'tmux',
      killPane: async () => true,
    }),
  }
})

let tempHome: string
let previousConfigDir: string | undefined
let previousAnthropicApiKey: string | undefined
let state: any

function setState(updater: (prev: any) => any): void {
  state = updater(state)
}

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY
  tempHome = join(
    tmpdir(),
    `agent-teams-lifecycle-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.CLAUDE_CONFIG_DIR = tempHome
  // Prior suites pin getClaudeConfigHomeDir to a fixed path via mock.module;
  // re-bind a live env-respecting implementation for this suite.
  mock.module('src/utils/envUtils.js', () => ({
    ...envUtilsSnap,
    getClaudeConfigHomeDir: () =>
      (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')).normalize(
        'NFC',
      ),
    getTeamsDir: () =>
      join(
        (process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude')).normalize(
          'NFC',
        ),
        'teams',
      ),
  }))
  getClaudeConfigHomeDir.cache?.clear?.()
  process.env.ANTHROPIC_API_KEY = 'test-key'
  state = {
    teamContext: undefined,
    tasks: {},
    inbox: { messages: [] },
    toolPermissionContext: {
      mode: 'default',
      alwaysAllowRules: {},
      alwaysDenyRules: {},
      additionalWorkingDirectories: new Map(),
    },
    mainLoopModel: null,
    mainLoopModelForSession: null,
    agentNameRegistry: new Map(),
    mcp: { tools: [] },
  }
})

afterEach(async () => {
  await cleanupSessionTeams()
  clearLeaderTeamName()
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  getClaudeConfigHomeDir.cache?.clear?.()
  if (previousAnthropicApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey
  }
  rmSync(tempHome, { recursive: true, force: true })
})

afterAll(() => {
  mock.module('src/utils/envUtils.js', () => ({ ...envUtilsSnap }))
})

describe('Agent Teams lifecycle', () => {
  test('retired TeamCreate and TeamDelete tools are never exposed in base tools', async () => {
    const previousTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    try {
      const { getAllBaseTools } = await import('../../../tools.js')
      const names = new Set(getAllBaseTools().map(t => t.name))
      expect(names.has('TeamCreate')).toBe(false)
      expect(names.has('TeamDelete')).toBe(false)
    } finally {
      if (previousTeams === undefined) {
        delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
      } else {
        process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = previousTeams
      }
    }
  })

  test('runs initializeSessionTeam -> spawn -> TaskUpdate -> SendMessage -> cleanupSessionTeams', async () => {
    const previousTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    try {
      const { spawnTeammate } = await import(
        '@claude-code/builtin-tools/tools/shared/spawnMultiAgent.js'
      )
      const { TaskCreateTool } = await import(
        '@claude-code/builtin-tools/tools/TaskCreateTool/TaskCreateTool.js'
      )
      const { TaskUpdateTool } = await import(
        '@claude-code/builtin-tools/tools/TaskUpdateTool/TaskUpdateTool.js'
      )
      const { SendMessageTool } = await import(
        '@claude-code/builtin-tools/tools/SendMessageTool/SendMessageTool.js'
      )

      const initialized = await initializeSessionTeam({
        existingTeamName: 'alpha',
      })
      state.teamContext = initialized.teamContext
      expect(initialized.teamContext.teamName).toBe('alpha')
      expect(existsSync(getTeamFilePath('alpha'))).toBe(true)

      const context = {
        getAppState: () => state,
        setAppState: setState,
        options: {
          agentDefinitions: { activeAgents: [] },
        },
        abortController: new AbortController(),
      } as any

      const spawned = await spawnTeammate(
        {
          name: 'worker',
          prompt: 'handle assigned tasks',
          team_name: 'alpha',
        },
        context,
      )
      expect(spawned.data.agent_id).toBe('worker@alpha')

      const task = await TaskCreateTool.call(
        { subject: 'Check lifecycle', description: 'Verify team task flow' },
        context,
        undefined as never,
        undefined as never,
      )
      await TaskUpdateTool.call(
        { taskId: task.data.task.id, owner: 'worker' },
        context,
        undefined as never,
        undefined as never,
      )

      const message = await SendMessageTool.call(
        {
          to: 'worker',
          summary: 'Status request',
          message: 'Please report status.',
        },
        context,
        async () => ({ behavior: 'allow' as const }),
        undefined as any,
      )
      expect(message.data.success).toBe(true)

      await cleanupSessionTeams()
      expect(existsSync(getTeamFilePath('alpha'))).toBe(false)
    } finally {
      if (previousTeams === undefined) {
        delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
      } else {
        process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = previousTeams
      }
    }
  })
})
