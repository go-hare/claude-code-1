import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateUniqueTeammateName, spawnTeammate } from '../spawnMultiAgent'

let tempHome: string
let previousConfigDir: string | undefined
let spawnCalls: unknown[] = []
let killCalls: string[] = []
let terminateCalls: string[] = []

mock.module('src/utils/swarm/backends/registry.js', () => {
  const executor = {
    type: 'in-process' as const,
    setContext() {},
    async isAvailable() {
      return true
    },
    async spawn(config: unknown) {
      spawnCalls.push(config)
      return {
        success: true,
        agentId: 'worker@alpha',
        taskId: 'task-worker',
        backendType: 'in-process',
        color: 'blue',
      }
    },
    async sendMessage() {},
    async terminate(agentId: string) {
      terminateCalls.push(agentId)
      return true
    },
    async kill(agentId: string) {
      killCalls.push(agentId)
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

function writeTeamConfig(teamName: string): string {
  const teamDir = join(tempHome, 'teams', teamName)
  mkdirSync(teamDir, { recursive: true })
  const configPath = join(teamDir, 'config.json')
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        name: teamName,
        createdAt: Date.now(),
        leadAgentId: `team-lead@${teamName}`,
        members: [
          {
            agentId: `team-lead@${teamName}`,
            name: 'team-lead',
            joinedAt: Date.now(),
            tmuxPaneId: '',
            cwd: tempHome,
            subscriptions: [],
          },
        ],
      },
      null,
      2,
    ),
  )
  return configPath
}

function createContext(overrides: Record<string, unknown> = {}) {
  let state = {
    teamContext: {
      teamName: 'alpha',
      leadAgentId: 'team-lead@alpha',
      teammates: {
        'team-lead@alpha': {
          name: 'team-lead',
          tmuxSessionName: '',
          tmuxPaneId: '',
          cwd: tempHome,
          spawnedAt: Date.now(),
        },
      },
    },
    tasks: {
      'task-worker': {
        id: 'task-worker',
        type: 'in_process_teammate',
        identity: {
          agentId: 'worker@alpha',
        },
      },
    },
    mainLoopModel: null,
    options: {},
  } as any

  return {
    context: {
      getAppState: () => state,
      setAppState: (updater: (prev: typeof state) => typeof state) => {
        state = updater(state)
      },
      options: {
        agentDefinitions: {
          activeAgents: [],
        },
      },
      ...overrides,
    },
    getState: () => state,
  }
}

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  tempHome = join(
    tmpdir(),
    `spawn-multi-agent-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.CLAUDE_CONFIG_DIR = tempHome
  spawnCalls = []
  killCalls = []
  terminateCalls = []
})

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('generateUniqueTeammateName densable pzg', () => {
  test('refuses reserved main recipient name', async () => {
    await expect(generateUniqueTeammateName('main', undefined)).rejects.toThrow(
      '"main" is a reserved recipient name (SendMessage routes it to the main conversation) — choose another teammate name.',
    )
  })

  test('refuses main after @→- sanitization (densable YZi+D6)', async () => {
    // YZi replaces @ with -; "m@in" stays non-main, but "mai@n" → "mai-n".
    // Exact reserved is only after sanitize equals "main".
    await expect(
      generateUniqueTeammateName('main', 'any-team'),
    ).rejects.toThrow(/reserved recipient name/)
  })

  test('uniquifies against existing team members', async () => {
    writeTeamConfig('alpha')
    // team-lead already exists in writeTeamConfig
    const teamDir = join(tempHome, 'teams', 'alpha')
    const configPath = join(teamDir, 'config.json')
    const raw = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      members: Array<Record<string, unknown>>
    }
    raw.members.push({
      agentId: 'worker@alpha',
      name: 'worker',
      joinedAt: Date.now(),
      tmuxPaneId: '',
      cwd: tempHome,
      subscriptions: [],
    })
    writeFileSync(configPath, JSON.stringify(raw, null, 2))

    expect(await generateUniqueTeammateName('worker', 'alpha')).toBe('worker-2')
    expect(await generateUniqueTeammateName('fresh', 'alpha')).toBe('fresh')
  })

  test('sanitizes @ in non-reserved names', async () => {
    expect(await generateUniqueTeammateName('dev@ops', undefined)).toBe(
      'dev-ops',
    )
  })
})

describe('spawnTeammate', () => {
  test('fails before spawn side effects when the team file is missing', async () => {
    let setAppStateCalled = false
    const context = {
      getAppState: () => ({
        teamContext: undefined,
      }),
      setAppState: () => {
        setAppStateCalled = true
      },
      options: {
        agentDefinitions: {
          activeAgents: [],
        },
      },
    }

    await expect(
      spawnTeammate(
        {
          name: 'worker',
          prompt: 'do work',
          team_name: 'missing-team',
        },
        context as any,
      ),
    ).rejects.toThrow('Team "missing-team" does not exist')
    expect(setAppStateCalled).toBe(false)
  })

  test('passes custom agent definitions to the teammate executor', async () => {
    writeTeamConfig('alpha')
    const customAgent = {
      agentType: 'reviewer',
      whenToUse: 'Reviews code',
      getSystemPrompt: () => 'You are the injected reviewer.',
      source: 'flagSettings' as const,
      tools: ['Read', 'Grep'],
      model: 'gpt-5.4',
    }
    const { context } = createContext({
      options: {
        agentDefinitions: {
          activeAgents: [customAgent],
        },
      },
    })

    await spawnTeammate(
      {
        name: 'worker',
        prompt: 'review this change',
        team_name: 'alpha',
        agent_type: 'reviewer',
      },
      context as any,
    )

    expect(spawnCalls[0]).toMatchObject({
      agentType: 'reviewer',
      agentDefinition: customAgent,
    })
  })

  test('refuses spawn when name is reserved main', async () => {
    writeTeamConfig('alpha')
    const { context } = createContext()
    await expect(
      spawnTeammate(
        {
          name: 'main',
          prompt: 'should not spawn',
          team_name: 'alpha',
        },
        context as any,
      ),
    ).rejects.toThrow(/reserved recipient name/)
    expect(spawnCalls).toHaveLength(0)
  })

  test('rolls back spawned teammate when team file persistence fails', async () => {
    const configPath = writeTeamConfig('alpha')
    const { context, getState } = createContext()
    chmodSync(configPath, 0o444)

    try {
      await expect(
        spawnTeammate(
          {
            name: 'worker',
            prompt: 'do work',
            team_name: 'alpha',
          },
          context as any,
        ),
      ).rejects.toThrow()
    } finally {
      chmodSync(configPath, 0o644)
    }

    expect(killCalls).toEqual(['worker@alpha'])
    expect(terminateCalls).toEqual([])
    expect(getState().teamContext?.teammates?.['worker@alpha']).toBeUndefined()
    expect(getState().tasks['task-worker']).toBeUndefined()
    const persisted = JSON.parse(readFileSync(configPath, 'utf-8')) as {
      members: Array<{ agentId: string }>
    }
    expect(
      persisted.members.some(member => member.agentId === 'worker@alpha'),
    ).toBe(false)
  })
})
