import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import * as realEnvUtils from '../../envUtils.js'
import { getClaudeConfigHomeDir } from '../../envUtils.js'
import { snapshotModuleExports } from '../../../../tests/mocks/settings.js'
import { getTeamFilePath } from '../teamHelpers.js'

const envUtilsSnap = snapshotModuleExports(realEnvUtils)

let terminateCalls: string[] = []

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
    async terminate(agentId: string) {
      terminateCalls.push(agentId)
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
let pendingTimers: ReturnType<typeof setTimeout>[] = []

function setState(updater: (prev: any) => any): void {
  state = updater(state)
}

/** Same path TeamDelete/readTeamFile uses — not a parallel tempHome join. */
function readTeamConfig(teamName: string): any {
  return JSON.parse(readFileSync(getTeamFilePath(teamName), 'utf-8'))
}

function writeTeamConfig(teamName: string, config: unknown): void {
  const file = getTeamFilePath(teamName)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(config, null, 2))
}

function schedule(ms: number, fn: () => void): void {
  pendingTimers.push(setTimeout(fn, ms))
}

beforeEach(() => {
  terminateCalls = []
  for (const t of pendingTimers.splice(0)) clearTimeout(t)
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

afterEach(() => {
  for (const t of pendingTimers.splice(0)) clearTimeout(t)
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
  test('TeamCreate and TeamDelete are hidden when agent swarms are disabled', async () => {
    const previousTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    try {
      const { TeamCreateTool } = await import(
        '@claude-code/builtin-tools/tools/TeamCreateTool/TeamCreateTool.js'
      )
      const { TeamDeleteTool } = await import(
        '@claude-code/builtin-tools/tools/TeamDeleteTool/TeamDeleteTool.js'
      )

      expect(TeamCreateTool.isEnabled()).toBe(false)
      expect(TeamDeleteTool.isEnabled()).toBe(false)
    } finally {
      if (previousTeams === undefined) {
        delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
      } else {
        process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = previousTeams
      }
    }
  })

  test('runs TeamCreate -> spawn -> TaskUpdate -> SendMessage -> TeamDelete', async () => {
    const previousTeams = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
    try {
      const { TeamCreateTool } = await import(
        '@claude-code/builtin-tools/tools/TeamCreateTool/TeamCreateTool.js'
      )
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
      const { TeamDeleteTool } = await import(
        '@claude-code/builtin-tools/tools/TeamDeleteTool/TeamDeleteTool.js'
      )

      const context = {
        getAppState: () => state,
        setAppState: setState,
        options: {
          agentDefinitions: { activeAgents: [] },
        },
        abortController: new AbortController(),
      } as any

      const created = await TeamCreateTool.call(
        { team_name: 'alpha', description: 'test team' },
        context,
        undefined as any,
        undefined as any,
      )
      expect(created.data.team_name).toBe('alpha')

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
      )
      await TaskUpdateTool.call(
        { taskId: task.data.task.id, owner: 'worker' },
        context,
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

      const blockedDelete = await TeamDeleteTool.call(
        {},
        context,
        undefined as any,
        undefined as any,
      )
      expect(blockedDelete.data.success).toBe(false)
      expect(terminateCalls).toEqual(['worker@alpha'])

      const config = readTeamConfig('alpha')
      config.members = config.members.map((member: any) =>
        member.name === 'worker' ? { ...member, isActive: false } : member,
      )
      writeTeamConfig('alpha', config)

      const deleted = await TeamDeleteTool.call(
        {},
        context,
        undefined as any,
        undefined as any,
      )
      expect(deleted.data.success).toBe(true)
    } finally {
      if (previousTeams === undefined) {
        delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
      } else {
        process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = previousTeams
      }
    }
  })

  test('TeamDelete waits for active teammates to become inactive before cleanup', async () => {
    const { TeamDeleteTool } = await import(
      '@claude-code/builtin-tools/tools/TeamDeleteTool/TeamDeleteTool.js'
    )
    const now = Date.now()
    writeTeamConfig('alpha', {
      name: 'alpha',
      createdAt: now,
      leadAgentId: 'team-lead@alpha',
      members: [
        {
          agentId: 'team-lead@alpha',
          name: 'team-lead',
          joinedAt: now,
          tmuxPaneId: '',
          cwd: tempHome,
          subscriptions: [],
        },
        {
          agentId: 'worker@alpha',
          name: 'worker',
          joinedAt: now,
          tmuxPaneId: 'in-process',
          cwd: tempHome,
          subscriptions: [],
          backendType: 'in-process',
        },
      ],
    })
    state.teamContext = {
      teamName: 'alpha',
      teamFilePath: getTeamFilePath('alpha'),
      leadAgentId: 'team-lead@alpha',
      teammates: {
        'worker@alpha': {
          name: 'worker',
          tmuxSessionName: 'in-process',
          tmuxPaneId: 'in-process',
          cwd: tempHome,
          spawnedAt: now,
        },
      },
    }

    schedule(25, () => {
      const config = readTeamConfig('alpha')
      config.members = config.members.map((member: any) =>
        member.name === 'worker' ? { ...member, isActive: false } : member,
      )
      writeTeamConfig('alpha', config)
    })

    const result = await TeamDeleteTool.call(
      { wait_ms: 1000 },
      {
        getAppState: () => state,
        setAppState: setState,
      } as any,
      undefined as any,
      undefined as any,
    )

    expect(result.data.success).toBe(true)
  })

  test('TeamDelete terminates inactive team-file members that still have running AppState tasks', async () => {
    const { TeamDeleteTool } = await import(
      '@claude-code/builtin-tools/tools/TeamDeleteTool/TeamDeleteTool.js'
    )
    const now = Date.now()
    writeTeamConfig('alpha', {
      name: 'alpha',
      createdAt: now,
      leadAgentId: 'team-lead@alpha',
      members: [
        {
          agentId: 'team-lead@alpha',
          name: 'team-lead',
          joinedAt: now,
          tmuxPaneId: '',
          cwd: tempHome,
          subscriptions: [],
        },
        {
          agentId: 'worker@alpha',
          name: 'worker',
          joinedAt: now,
          tmuxPaneId: 'in-process',
          cwd: tempHome,
          subscriptions: [],
          backendType: 'in-process',
          isActive: false,
        },
      ],
    })
    state.teamContext = {
      teamName: 'alpha',
      teamFilePath: getTeamFilePath('alpha'),
      leadAgentId: 'team-lead@alpha',
      teammates: {
        'worker@alpha': {
          name: 'worker',
          tmuxSessionName: 'in-process',
          tmuxPaneId: 'in-process',
          cwd: tempHome,
          spawnedAt: now,
        },
      },
    }
    state.tasks = {
      teammate_task_worker: {
        id: 'teammate_task_worker',
        type: 'in_process_teammate',
        status: 'running',
        shutdownRequested: false,
        identity: {
          agentId: 'worker@alpha',
          agentName: 'worker',
          teamName: 'alpha',
        },
      },
    }

    const result = await TeamDeleteTool.call(
      {},
      {
        getAppState: () => state,
        setAppState: setState,
      } as any,
      undefined as any,
      undefined as any,
    )

    expect(result.data.success).toBe(true)
    expect(terminateCalls).toEqual(['worker@alpha'])
  })
})
