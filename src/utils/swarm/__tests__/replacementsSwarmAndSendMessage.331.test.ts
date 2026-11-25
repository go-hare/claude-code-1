/**
 * Official Claude Code 2.1.331 alignment regression suite for Session Team /
 * Agent(name) / SendMessage (P0-1..P0-5 + P1-1..P1-6).
 *
 * Uses isolated temp CLAUDE_CONFIG_DIR per test and zero process-global
 * mock.module() overrides so sibling test suites remain unpolluted.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'fs'
import { hostname, tmpdir } from 'os'
import { join } from 'path'
import { AgentTool } from '../../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.js'
import {
  resolveTeammateByBareName,
  shortPinRef,
} from '../../../../packages/builtin-tools/src/tools/SendMessageTool/nameResolve.js'
import { SendMessageTool } from '../../../../packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.js'
import { getSessionId, switchSession } from '../../../bootstrap/state.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import { isAgentSwarmsEnabled } from '../../agentSwarmsEnabled.js'
import {
  createTask,
  getSessionTaskListId,
  getTask,
  getTaskPath,
  getTasksDir,
  noteSessionTaskListAfterClear,
  resetTaskListState,
  restoreSessionTaskListId,
  SESSION_LIST_FILE,
  setSessionTaskListId,
} from '../../tasks.js'
import { setDynamicTeamContext } from '../../teammate.js'
import { runWithTeammateContext } from '../../teammateContext.js'
import {
  getInboxPath,
  hasTeamLeadEntryKeyForInbox,
  readMailbox,
  recordPendingShutdownRequest,
  resetPendingShutdownRequestsForTesting,
  writeToMailbox,
} from '../../teammateMailbox.js'
import { createPaneBackendExecutor } from '../backends/PaneBackendExecutor.js'
import type { PaneBackend } from '../backends/types.js'
import {
  _resetInheritedTeamNameForTesting,
  initializeSessionTeam,
  rekeySessionTeamAtStartup,
  rekeySessionTeamInSession,
  sessionTeamName,
} from '../sessionTeam.js'
import {
  buildInheritedCliArgParts,
  getInheritedEnvVarAssignments,
} from '../spawnUtils.js'
import * as teamHelpers from '../teamHelpers.js'
import {
  _resetSpawnedTeammatePanesForTesting,
  addMemberToTeam,
  cleanupTeamDirectories,
  getTeamDir,
  getTeamFilePath,
  killOrphanedTeammatePanes,
  readTeamFile,
  readTeamFileAsync,
  recordSpawnedTeammatePane,
  removeTeamMember,
  sanitizeTeamFile,
  type TeamFile,
  unregisterTeamForSessionCleanup,
  updateTeamFile,
  writeTeamFileAsync,
} from '../teamHelpers.js'

let tempConfigDir: string
let savedConfigDir: string | undefined
let savedAgentTeamsEnv: string | undefined
let savedTaskListEnv: string | undefined
let savedInternalTaskListEnv: string | undefined
let savedSessionId: ReturnType<typeof getSessionId>

function makeTeamFile(
  name: string,
  members: TeamFile['members'] = [],
  extra?: Partial<TeamFile>,
): TeamFile {
  return {
    name,
    description: `Session team ${name}`,
    createdAt: Date.now(),
    leadAgentId: `team-lead@${name}`,
    leadSessionId: 'lead-session-id',
    members,
    ...extra,
  }
}

function makeFakePaneBackend(
  overrides: Partial<PaneBackend> = {},
): PaneBackend {
  return {
    type: 'tmux',
    displayName: 'tmux',
    supportsHideShow: true,
    async isAvailable() {
      return true
    },
    async isRunningInside() {
      return false
    },
    async createTeammatePaneInSwarmView() {
      return { paneId: '%42', isFirstTeammate: false }
    },
    async sendCommandToPane() {},
    async setPaneBorderColor() {},
    async setPaneTitle() {},
    async enablePaneBorderStatus() {},
    async rebalancePanes() {},
    async killPane() {
      return true
    },
    async hidePane() {
      return true
    },
    async showPane() {
      return true
    },
    ...overrides,
  }
}

const dummyCanUseTool = (async () => ({
  behavior: 'allow',
  updatedInput: {},
})) as unknown as Parameters<typeof SendMessageTool.call>[2]

const dummyAssistantMsg = {} as Parameters<typeof SendMessageTool.call>[3]

beforeEach(() => {
  savedConfigDir = process.env.CLAUDE_CONFIG_DIR
  savedAgentTeamsEnv = process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  savedTaskListEnv = process.env.CLAUDE_CODE_TASK_LIST_ID
  savedInternalTaskListEnv = process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID
  savedSessionId = getSessionId()

  tempConfigDir = join(
    tmpdir(),
    `swarm-331-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  mkdirSync(tempConfigDir, { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = tempConfigDir
  process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = '1'
  delete process.env.CLAUDE_CODE_TASK_LIST_ID
  delete process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID

  setDynamicTeamContext(null)
  resetPendingShutdownRequestsForTesting()
  resetTaskListState()
  _resetInheritedTeamNameForTesting()
  _resetSpawnedTeammatePanesForTesting()
})

afterEach(() => {
  setDynamicTeamContext(null)
  resetPendingShutdownRequestsForTesting()
  resetTaskListState()
  _resetInheritedTeamNameForTesting()
  _resetSpawnedTeammatePanesForTesting()
  switchSession(savedSessionId)

  if (savedConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = savedConfigDir
  }
  if (savedAgentTeamsEnv === undefined) {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  } else {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = savedAgentTeamsEnv
  }
  if (savedTaskListEnv === undefined) {
    delete process.env.CLAUDE_CODE_TASK_LIST_ID
  } else {
    process.env.CLAUDE_CODE_TASK_LIST_ID = savedTaskListEnv
  }
  if (savedInternalTaskListEnv === undefined) {
    delete process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID
  } else {
    process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID = savedInternalTaskListEnv
  }
  rmSync(tempConfigDir, { recursive: true, force: true })
})

describe('P0-1: SendMessage plain-text teammate resolution (with & without UDS_INBOX)', () => {
  test('resolveTeammateByBareName resolves context teammates, roster members, team-lead, case-insensitively, and name [ref]', () => {
    const teamName = 'session-resolve-test'
    const workerId = `worker@${teamName}`
    const workerRef = shortPinRef('teammate', workerId)
    const rosterOnlyId = `reviewer@${teamName}`
    const teamContextTeammates = { [workerId]: { name: 'worker' } }
    const teamFileMembers = [
      { agentId: workerId, name: 'worker' },
      { agentId: rosterOnlyId, name: 'reviewer' },
    ]

    expect(
      resolveTeammateByBareName({
        to: 'worker',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toEqual({
      kind: 'mailbox',
      recipientName: 'worker',
      memberAgentId: workerId,
      memberIdentitySource: 'team-context',
    })

    expect(
      resolveTeammateByBareName({
        to: 'WORKER',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      })?.recipientName,
    ).toBe('worker')

    expect(
      resolveTeammateByBareName({
        to: 'reviewer',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toEqual({
      kind: 'mailbox',
      recipientName: 'reviewer',
      memberAgentId: rosterOnlyId,
      memberIdentitySource: 'roster',
    })

    expect(
      resolveTeammateByBareName({
        to: 'team-lead',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toEqual({
      kind: 'mailbox',
      recipientName: 'team-lead',
    })

    expect(
      resolveTeammateByBareName({
        to: `worker [${workerRef}]`,
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toEqual({
      kind: 'mailbox',
      recipientName: 'worker',
      memberAgentId: workerId,
      memberIdentitySource: 'team-context',
    })

    // Unrelated ref falls through to UDS/bridge peer resolution
    expect(
      resolveTeammateByBareName({
        to: 'worker [deadbe]',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toBeNull()

    expect(
      resolveTeammateByBareName({
        to: 'nonexistent-peer',
        teamName,
        teamContextTeammates,
        teamFileMembers,
      }),
    ).toBeNull()
  })

  test('SendMessageTool delivers plain-text messages to teammates, name [ref], and team-lead', async () => {
    const teamName = 'session-p0-1-mailbox'
    const workerId = `worker@${teamName}`
    const workerRef = shortPinRef('teammate', workerId)
    await writeTeamFileAsync(
      teamName,
      makeTeamFile(teamName, [
        {
          agentId: workerId,
          name: 'worker',
          agentType: 'general-purpose',
          model: 'claude-sonnet-4-6',
          joinedAt: Date.now(),
          tmuxPaneId: 'in-process',
          cwd: process.cwd(),
          subscriptions: [],
        },
      ]),
    )

    const appState = {
      tasks: {},
      agentNameRegistry: new Map<string, string>(),
      sendMessagePins: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
      teamContext: {
        teamName,
        teamFilePath: getTeamFilePath(teamName),
        leadAgentId: `team-lead@${teamName}`,
        teammates: {
          [workerId]: {
            name: 'worker',
            agentType: 'general-purpose',
            color: 'blue',
            tmuxSessionName: '',
            tmuxPaneId: 'in-process',
            cwd: process.cwd(),
            spawnedAt: Date.now(),
          },
        },
      },
    }
    const ctx = {
      getAppState: () => appState,
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    const bareRes = await SendMessageTool.call(
      { to: 'worker', message: 'hello bare worker', summary: 'hi' },
      ctx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((bareRes.data as { success: boolean }).success).toBe(true)

    const refRes = await SendMessageTool.call(
      {
        to: `worker [${workerRef}]`,
        message: 'hello ref worker',
        summary: 'hi ref',
      },
      ctx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((refRes.data as { success: boolean }).success).toBe(true)

    const workerInbox = await readMailbox('worker', teamName)
    expect(workerInbox.map(m => m.text)).toEqual([
      'hello bare worker',
      'hello ref worker',
    ])

    // Teammate replying to team-lead
    const leadRes = await runWithTeammateContext(
      {
        agentId: workerId,
        agentName: 'worker',
        teamName,
        parentSessionId: 'lead-session-id',
        isInProcess: true,
        abortController: new AbortController(),
        color: 'blue',
        planModeRequired: false,
      },
      () =>
        SendMessageTool.call(
          { to: 'team-lead', message: 'report complete', summary: 'done' },
          ctx,
          dummyCanUseTool,
          dummyAssistantMsg,
        ),
    )
    expect((leadRes.data as { success: boolean }).success).toBe(true)
    const leadInbox = await readMailbox('team-lead', teamName)
    expect(leadInbox).toHaveLength(1)
    expect(leadInbox[0]!.text).toBe('report complete')
  })
})

describe('P0-2: cleanupTeamDirectories deletes team dir but preserves session tasks', () => {
  test('deletes ~/.claude/teams/{team} and preserves ~/.claude/tasks/{team}', async () => {
    const teamName = 'session-p0-2-preserve-tasks'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))
    const taskId = await createTask(teamName, {
      subject: 'Survive session exit',
      description: 'Must remain for --resume',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    })

    expect(existsSync(getTeamDir(teamName))).toBe(true)
    expect(existsSync(getTaskPath(teamName, taskId))).toBe(true)

    await cleanupTeamDirectories(teamName)

    expect(existsSync(getTeamDir(teamName))).toBe(false)
    expect(existsSync(getTaskPath(teamName, taskId))).toBe(true)
    const preserved = await getTask(teamName, taskId)
    expect(preserved?.subject).toBe('Survive session exit')
  })
})

describe('P0-3: teammateMailbox.isTeamDeleted scoping and sanitization', () => {
  test('allows non-session teams without config.json, drops deleted session-* teams, and sanitizes session-* names', async () => {
    // Non-session team without config.json writes cleanly (matches spawnInProcess.test.ts)
    const alphaWritten = await writeToMailbox(
      'worker',
      {
        from: 'team-lead',
        text: 'non-session ok',
        timestamp: new Date().toISOString(),
      },
      'alpha',
    )
    expect(alphaWritten).toBeDefined()
    expect(await readMailbox('worker', 'alpha')).toHaveLength(1)

    // Deleted session-* team (no config.json) is silently dropped
    const deletedTeam = 'session-deleted-999'
    const dropped = await writeToMailbox(
      'worker',
      {
        from: 'team-lead',
        text: 'should drop',
        timestamp: new Date().toISOString(),
      },
      deletedTeam,
    )
    expect(dropped).toBeUndefined()
    expect(existsSync(getInboxPath('worker', deletedTeam))).toBe(false)

    // Existing session-* team with uppercase/underscore/dot characters sanitizes to match getTeamDir
    const mixedTeam = 'session-My_Team.1'
    await writeTeamFileAsync(mixedTeam, makeTeamFile(mixedTeam))
    const mixedWritten = await writeToMailbox(
      'worker',
      {
        from: 'team-lead',
        text: 'sanitized ok',
        timestamp: new Date().toISOString(),
      },
      mixedTeam,
    )
    expect(mixedWritten).toBeDefined()
    const mixedMsgs = await readMailbox('worker', mixedTeam)
    expect(mixedMsgs).toHaveLength(1)
    expect(mixedMsgs[0]!.text).toBe('sanitized ok')
  })
})

describe('P0-4: proper-lockfile team config locking, atomic uniquification & sanitizeTeamFile', () => {
  test('concurrent addMemberToTeam updates under updateTeamFile lock lose zero members', async () => {
    const teamName = 'session-p0-4-locking'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))

    await Promise.all(
      Array.from({ length: 8 }, (_, idx) =>
        addMemberToTeam(teamName, {
          agentId: `worker-${idx}@${teamName}`,
          name: `worker-${idx}`,
          agentType: 'general-purpose',
          model: 'claude-sonnet-4-6',
          joinedAt: Date.now(),
          tmuxPaneId: 'in-process',
          cwd: process.cwd(),
          subscriptions: [],
        }),
      ),
    )

    const team = await readTeamFileAsync(teamName)
    expect(team?.members).toHaveLength(8)
    const names = new Set(team?.members.map(m => m.name))
    for (let i = 0; i < 8; i++) {
      expect(names.has(`worker-${i}`)).toBe(true)
    }

    // Rollback helper removes member cleanly under lock
    await removeTeamMember(teamName, `worker-3@${teamName}`)
    const afterRollback = await readTeamFileAsync(teamName)
    expect(afterRollback?.members).toHaveLength(7)
    expect(afterRollback?.members.some(m => m.name === 'worker-3')).toBe(false)
  })

  test('updateTeamFile returns callback result and skips write when updater returns false', async () => {
    const teamName = 'session-p0-4-skip'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))
    const noopResult = await updateTeamFile(teamName, () => false)
    expect(noopResult).toBeUndefined()
    const appliedResult = await updateTeamFile(teamName, file => {
      file.description = 'updated'
      return 'applied'
    })
    expect(appliedResult).toBe('applied')
    const existing = readTeamFile(teamName)
    expect(existing?.name).toBe(teamName)
    expect(existing?.description).toBe('updated')
  })

  test('sanitizeTeamFile rejects non-objects and filters malformed member entries', async () => {
    expect(sanitizeTeamFile(null)).toBeNull()
    expect(sanitizeTeamFile('bad')).toBeNull()
    expect(sanitizeTeamFile([1, 2, 3])).toBeNull()
    expect(sanitizeTeamFile({ name: 123 })).toBeNull()

    const sanitized = sanitizeTeamFile({
      name: 'team-x',
      createdAt: 1,
      leadAgentId: 'team-lead@team-x',
      leadSessionId: 'sid',
      members: [
        null,
        'garbage',
        { agentId: 'missing-name' },
        { name: 'missing-id' },
        {
          agentId: 'good@team-x',
          name: 'good',
          agentType: 'general-purpose',
          model: 'sonnet',
          joinedAt: 1,
          tmuxPaneId: 'in-process',
          cwd: '/tmp',
          subscriptions: [],
        },
      ],
    })
    expect(sanitized).not.toBeNull()
    expect(sanitized?.members).toHaveLength(1)
    expect(sanitized?.members[0]?.agentId).toBe('good@team-x')

    // On-disk corrupt config.json returns null safely
    const corruptTeam = 'session-p0-4-corrupt'
    mkdirSync(getTeamDir(corruptTeam), { recursive: true })
    writeFileSync(getTeamFilePath(corruptTeam), '[]', 'utf8')
    expect(readTeamFile(corruptTeam)).toBeNull()
    expect(await readTeamFileAsync(corruptTeam)).toBeNull()
  })
})

describe('P0-5: AgentTool enforces Agent(Type) deny rules, allowedAgentTypes, and existence before teammate spawn', () => {
  function makeAgentToolContext(opts: {
    teamName: string
    denyRules?: string[]
    allowedAgentTypes?: string[]
    activeAgents: Array<{
      agentType: string
      whenToUse: string
      getSystemPrompt: () => string
      source: 'built-in'
    }>
  }) {
    const basePerm = getEmptyToolPermissionContext()
    const toolPermissionContext = opts.denyRules
      ? {
          ...basePerm,
          alwaysDenyRules: {
            ...basePerm.alwaysDenyRules,
            userSettings: opts.denyRules,
          },
        }
      : basePerm

    const appState = {
      tasks: {},
      agentNameRegistry: new Map<string, string>(),
      toolPermissionContext,
      teamContext: {
        teamName: opts.teamName,
        teamFilePath: getTeamFilePath(opts.teamName),
        leadAgentId: `team-lead@${opts.teamName}`,
        teammates: {},
      },
    }

    return {
      getAppState: () => appState,
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: {
        tools: [],
        mainLoopModel: 'claude-sonnet-4-6',
        agentDefinitions: {
          activeAgents: opts.activeAgents,
          allAgents: opts.activeAgents,
          allowedAgentTypes: opts.allowedAgentTypes,
        },
      },
    } as unknown as Parameters<typeof AgentTool.call>[1]
  }

  test('rejects Agent(Type) deny rule, disallowed agent type, and nonexistent subagent_type before spawning teammate', async () => {
    const teamName = 'session-p0-5-perms'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))

    const exploreAgent = {
      agentType: 'Explore',
      whenToUse: 'explore',
      getSystemPrompt: () => 'explore',
      source: 'built-in' as const,
    }
    const gpAgent = {
      agentType: 'general-purpose',
      whenToUse: 'general',
      getSystemPrompt: () => 'gp',
      source: 'built-in' as const,
    }

    // 1) Agent(Explore) deny rule blocks named teammate spawn
    const deniedCtx = makeAgentToolContext({
      teamName,
      denyRules: ['Agent(Explore)'],
      activeAgents: [exploreAgent, gpAgent],
    })
    await expect(
      AgentTool.call(
        {
          name: 'sneaky',
          subagent_type: 'Explore',
          prompt: 'bypass check',
          description: 'bypass test',
        },
        deniedCtx,
        dummyCanUseTool as unknown as Parameters<typeof AgentTool.call>[2],
        dummyAssistantMsg as unknown as Parameters<typeof AgentTool.call>[3],
      ),
    ).rejects.toThrow(/denied by permission rule 'Agent\(Explore\)'/)
    expect((await readTeamFileAsync(teamName))?.members).toHaveLength(0)

    // 2) allowedAgentTypes blocks unlisted subagent_type before spawning teammate
    const restrictedCtx = makeAgentToolContext({
      teamName,
      allowedAgentTypes: ['Explore'],
      activeAgents: [exploreAgent, gpAgent],
    })
    await expect(
      AgentTool.call(
        {
          name: 'disallowed',
          subagent_type: 'general-purpose',
          prompt: 'not allowed',
          description: 'allowlist test',
        },
        restrictedCtx,
        dummyCanUseTool as unknown as Parameters<typeof AgentTool.call>[2],
        dummyAssistantMsg as unknown as Parameters<typeof AgentTool.call>[3],
      ),
    ).rejects.toThrow(/Agent type 'general-purpose' not found/)
    expect((await readTeamFileAsync(teamName))?.members).toHaveLength(0)

    // 3) Nonexistent subagent_type rejected before spawning teammate
    const normalCtx = makeAgentToolContext({
      teamName,
      activeAgents: [exploreAgent, gpAgent],
    })
    await expect(
      AgentTool.call(
        {
          name: 'ghost',
          subagent_type: 'DoesNotExistAgent',
          prompt: 'hi',
          description: 'missing agent test',
        },
        normalCtx,
        dummyCanUseTool as unknown as Parameters<typeof AgentTool.call>[2],
        dummyAssistantMsg as unknown as Parameters<typeof AgentTool.call>[3],
      ),
    ).rejects.toThrow(/Agent type 'DoesNotExistAgent' not found/)
    expect((await readTeamFileAsync(teamName))?.members).toHaveLength(0)
  })
})

describe('P1-1: effort threaded end-to-end for named teammates', () => {
  test('buildInheritedCliArgParts emits --effort and PaneBackendExecutor forwards explicit or frontmatter effort', async () => {
    const parts = buildInheritedCliArgParts({ effort: 'high' })
    const effortIdx = parts.indexOf('--effort')
    expect(effortIdx).toBeGreaterThanOrEqual(0)
    expect(parts[effortIdx + 1]).toBe('high')

    const teamName = 'session-p1-1-effort'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))

    let sentCommand = ''
    const executor = createPaneBackendExecutor(
      makeFakePaneBackend({
        async sendCommandToPane(_paneId, cmd) {
          sentCommand = cmd
        },
      }),
    )

    const paneCtx = {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      options: { mainLoopModel: 'claude-sonnet-4-6' },
    } as unknown as Parameters<typeof executor.setContext>[0]
    executor.setContext(paneCtx)

    const res = await executor.spawn({
      name: 'thinker',
      teamName,
      prompt: 'analyze carefully',
      cwd: process.cwd(),
      parentSessionId: 'lead-session-id',
      effort: 'max',
    })
    expect(res.success).toBe(true)
    expect(sentCommand).toContain('--effort')
    expect(sentCommand).toContain('max')

    // Falls back to agentDefinition.effort when explicit effort is omitted
    let fallbackCommand = ''
    const executor2 = createPaneBackendExecutor(
      makeFakePaneBackend({
        async createTeammatePaneInSwarmView() {
          return { paneId: '%43', isFirstTeammate: false }
        },
        async sendCommandToPane(_paneId, cmd) {
          fallbackCommand = cmd
        },
      }),
    )
    executor2.setContext(paneCtx)
    const res2 = await executor2.spawn({
      name: 'planner',
      teamName,
      prompt: 'plan it',
      cwd: process.cwd(),
      parentSessionId: 'lead-session-id',
      agentDefinition: {
        agentType: 'planner-agent',
        whenToUse: 'plan',
        getSystemPrompt: () => 'plan',
        source: 'userSettings',
        effort: 'low',
      },
    })
    expect(res2.success).toBe(true)
    expect(fallbackCommand).toContain('--effort')
    expect(fallbackCommand).toContain('low')
  })
})

describe('P1-2: session-team rekeying, leadProcess claim, CLAUDE_INTERNAL_SESSION_TASK_LIST_ID, and /clear task-list note', () => {
  test('sessionTeamName sanitizes non-UUID session IDs', () => {
    expect(sessionTeamName('custom_session.id/123')).toBe(
      'session-custom-session-id-123',
    )
  })

  test('noteSessionTaskListAfterClear writes .session-list, restoreSessionTaskListId reads it, and symlink dir is rejected', async () => {
    const prevTaskList = 'prev-session-tasks-111'
    const nextSessionId = 'next-session-222'
    setSessionTaskListId(prevTaskList)
    await noteSessionTaskListAfterClear(nextSessionId)

    const markerPath = join(
      getTasksDir(sessionTeamName(nextSessionId)),
      SESSION_LIST_FILE,
    )
    expect(existsSync(markerPath)).toBe(true)
    expect(readFileSync(markerPath, 'utf8').trim()).toBe(prevTaskList)

    resetTaskListState()
    const restored = await restoreSessionTaskListId(nextSessionId)
    expect(restored).toBe(prevTaskList)
    expect(getSessionTaskListId()).toBe(prevTaskList)

    // Symlink target directory must be ignored (lstat guard)
    const symlinkSession = 'symlink-session-333'
    const decoyDir = join(tempConfigDir, 'decoy-dir')
    mkdirSync(decoyDir, { recursive: true })
    mkdirSync(join(tempConfigDir, 'tasks'), { recursive: true })
    symlinkSync(decoyDir, getTasksDir(sessionTeamName(symlinkSession)))
    setSessionTaskListId('should-not-write')
    await noteSessionTaskListAfterClear(symlinkSession)
    expect(existsSync(join(decoyDir, SESSION_LIST_FILE))).toBe(false)
  })

  test('initializeSessionTeam consumes CLAUDE_INTERNAL_SESSION_TASK_LIST_ID', async () => {
    const sid = '11111111-1111-4111-8111-111111111111'
    switchSession(sid as ReturnType<typeof getSessionId>)
    process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID = 'inherited-list-abc'

    const init = await initializeSessionTeam()
    expect(init.teamContext.teamName).toBe(sessionTeamName(sid))
    expect(getSessionTaskListId()).toBe('inherited-list-abc')
    expect(process.env.CLAUDE_INTERNAL_SESSION_TASK_LIST_ID).toBeUndefined()
    unregisterTeamForSessionCleanup(init.teamContext.teamName)
  })

  test('rekeySessionTeamAtStartup moves startup team to resumed session and claims dead leadProcess teams while unassigning dead in-process tasks', async () => {
    const startupSid = '22222222-2222-4222-8222-222222222222'
    const resumedSid = '33333333-3333-4333-8333-333333333333'
    switchSession(startupSid as ReturnType<typeof getSessionId>)
    const startupInit = await initializeSessionTeam()
    const startupTeamName = startupInit.teamContext.teamName
    expect(existsSync(getTeamDir(startupTeamName))).toBe(true)

    // Case A: resumed session has no existing team dir -> rename startup team dir
    switchSession(resumedSid as ReturnType<typeof getSessionId>)
    const rekeyed = await rekeySessionTeamAtStartup()
    expect(rekeyed?.teamContext.teamName).toBe(sessionTeamName(resumedSid))
    expect(existsSync(getTeamDir(startupTeamName))).toBe(false)
    expect(existsSync(getTeamDir(sessionTeamName(resumedSid)))).toBe(true)
    const teamAfterRename = await readTeamFileAsync(sessionTeamName(resumedSid))
    expect(teamAfterRename?.leadSessionId).toBe(resumedSid)
    expect(teamAfterRename?.leadProcess?.pid).toBe(process.pid)
    unregisterTeamForSessionCleanup(sessionTeamName(resumedSid))

    // Case B: resumed session already has a team owned by a DEAD leadProcess
    const startupSid2 = '44444444-4444-4444-8444-444444444444'
    const deadTargetSid = '55555555-5555-4555-8555-555555555555'
    const deadTeamName = sessionTeamName(deadTargetSid)
    await writeTeamFileAsync(
      deadTeamName,
      makeTeamFile(
        deadTeamName,
        [
          {
            agentId: `dead-worker@${deadTeamName}`,
            name: 'dead-worker',
            agentType: 'general-purpose',
            model: 'sonnet',
            joinedAt: Date.now() - 60_000,
            tmuxPaneId: 'in-process',
            backendType: 'in-process',
            cwd: process.cwd(),
            subscriptions: [],
          },
        ],
        {
          leadSessionId: deadTargetSid,
          leadProcess: { pid: 999_999_999, pidSpace: hostname(), claimedAt: 1 },
        },
      ),
    )
    const orphanTaskId = await createTask(deadTeamName, {
      subject: 'Orphaned work',
      description: 'Assigned to dead in-process worker',
      status: 'in_progress',
      owner: 'dead-worker',
      blocks: [],
      blockedBy: [],
    })

    switchSession(startupSid2 as ReturnType<typeof getSessionId>)
    const startup2 = await initializeSessionTeam()
    const startup2TeamName = startup2.teamContext.teamName
    switchSession(deadTargetSid as ReturnType<typeof getSessionId>)
    const claimed = await rekeySessionTeamAtStartup()
    expect(claimed?.teamContext.teamName).toBe(deadTeamName)
    // Orphan startup team cleaned up
    expect(existsSync(getTeamDir(startup2TeamName))).toBe(false)
    // Dead in-process member removed and its task unassigned back to pending
    const claimedTeam = await readTeamFileAsync(deadTeamName)
    expect(claimedTeam?.leadProcess?.pid).toBe(process.pid)
    expect(claimedTeam?.members.some(m => m.name === 'dead-worker')).toBe(false)
    const unassignedTask = await getTask(deadTeamName, orphanTaskId)
    expect(unassignedTask?.status).toBe('pending')
    expect(unassignedTask?.owner).toBeUndefined()
    unregisterTeamForSessionCleanup(deadTeamName)

    // Case C: live leadProcess is NOT stolen
    const liveTargetSid = '77777777-7777-4777-8777-777777777777'
    const liveTeamName = sessionTeamName(liveTargetSid)
    await writeTeamFileAsync(
      liveTeamName,
      makeTeamFile(
        liveTeamName,
        [
          {
            agentId: `active-worker@${liveTeamName}`,
            name: 'active-worker',
            agentType: 'general-purpose',
            model: 'sonnet',
            joinedAt: Date.now(),
            tmuxPaneId: 'in-process',
            backendType: 'in-process',
            cwd: process.cwd(),
            subscriptions: [],
          },
        ],
        {
          leadSessionId: liveTargetSid,
          leadProcess: {
            pid: process.pid,
            pidSpace: hostname(),
            claimedAt: Date.now(),
          },
        },
      ),
    )
    const startupSid3 = '88888888-8888-4888-8888-888888888888'
    switchSession(startupSid3 as ReturnType<typeof getSessionId>)
    const startup3 = await initializeSessionTeam()
    switchSession(liveTargetSid as ReturnType<typeof getSessionId>)
    const refusedLive = await rekeySessionTeamAtStartup()
    expect(refusedLive).toBeUndefined()
    expect(
      (await readTeamFileAsync(liveTeamName))?.members.some(
        m => m.name === 'active-worker',
      ),
    ).toBe(true)
    unregisterTeamForSessionCleanup(startup3.teamContext.teamName)

    // Case D: mid-session /resume via rekeySessionTeamInSession
    const midResumeSid = '66666666-6666-4666-8666-666666666666'
    switchSession(midResumeSid as ReturnType<typeof getSessionId>)
    const midResult = await rekeySessionTeamInSession()
    expect(midResult?.teamContext.teamName).toBe(sessionTeamName(midResumeSid))
    expect(existsSync(getTeamDir(sessionTeamName(midResumeSid)))).toBe(true)
    unregisterTeamForSessionCleanup(sessionTeamName(midResumeSid))
  })
})

describe('P1-3: isAgentSwarmsEnabled() uses isEnvTruthy', () => {
  test('returns false for falsy strings and true for truthy strings', () => {
    for (const val of ['0', 'false', 'FALSE', 'no', 'off', '']) {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = val
      expect(isAgentSwarmsEnabled()).toBe(false)
    }
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
    expect(isAgentSwarmsEnabled()).toBe(false)

    for (const val of ['1', 'true', 'TRUE', 'yes', 'on']) {
      process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = val
      expect(isAgentSwarmsEnabled()).toBe(true)
    }
  })
})

describe('P1-4: pane spawn ordering, --lead-verify-key, CLAUDE_CODE_TASK_LIST_ID, and process-owned orphan cleanup', () => {
  test('writes initial prompt BEFORE sendCommandToPane, passes --lead-verify-key, and tears down pane on failed prompt write', async () => {
    const teamName = 'session-p1-4-ordering'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))

    let inboxPresentDuringSend = false
    let sentCommand = ''
    const executor = createPaneBackendExecutor(
      makeFakePaneBackend({
        async createTeammatePaneInSwarmView() {
          return { paneId: '%77', isFirstTeammate: false }
        },
        async sendCommandToPane(_paneId, command) {
          const msgs = await readMailbox('ordered-worker', teamName)
          inboxPresentDuringSend =
            msgs.length === 1 && msgs[0]!.text === 'initial task prompt'
          sentCommand = command
        },
      }),
    )

    const paneCtx = {
      getAppState: () => ({
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      options: { mainLoopModel: 'claude-sonnet-4-6' },
    } as unknown as Parameters<typeof executor.setContext>[0]
    executor.setContext(paneCtx)

    const ok = await executor.spawn({
      name: 'ordered-worker',
      teamName,
      prompt: 'initial task prompt',
      cwd: process.cwd(),
      parentSessionId: 'lead-session-id',
    })
    expect(ok.success).toBe(true)
    expect(inboxPresentDuringSend).toBe(true)

    const inboxPath = getInboxPath('ordered-worker', teamName)
    expect(hasTeamLeadEntryKeyForInbox(inboxPath)).toBe(true)
    expect(sentCommand).toMatch(/--lead-verify-key\s+\S+/)

    // When team dir is deleted so writeToMailbox returns undefined, pane is torn down and sendCommandToPane is never called
    let killedPaneId: string | undefined
    let commandCalledOnDeletedTeam = false
    const failingExecutor = createPaneBackendExecutor(
      makeFakePaneBackend({
        async createTeammatePaneInSwarmView() {
          return { paneId: '%88', isFirstTeammate: false }
        },
        async sendCommandToPane() {
          commandCalledOnDeletedTeam = true
        },
        async killPane(paneId) {
          killedPaneId = paneId
          return true
        },
      }),
    )
    failingExecutor.setContext(paneCtx)

    const failRes = await failingExecutor.spawn({
      name: 'doomed-worker',
      teamName: 'session-deleted-before-spawn',
      prompt: 'never delivered',
      cwd: process.cwd(),
      parentSessionId: 'lead-session-id',
    })
    expect(failRes.success).toBe(false)
    expect(commandCalledOnDeletedTeam).toBe(false)
    expect(killedPaneId).toBe('%88')
  })

  test('getInheritedEnvVarAssignments forwards CLAUDE_CODE_TASK_LIST_ID from env or session task list', () => {
    setSessionTaskListId('session-list-789')
    const fromSession = new Map(getInheritedEnvVarAssignments())
    expect(fromSession.get('CLAUDE_CODE_TASK_LIST_ID')).toBe('session-list-789')

    process.env.CLAUDE_CODE_TASK_LIST_ID = 'explicit-env-list-456'
    const fromEnv = new Map(getInheritedEnvVarAssignments())
    expect(fromEnv.get('CLAUDE_CODE_TASK_LIST_ID')).toBe(
      'explicit-env-list-456',
    )
  })

  test('killOrphanedTeammatePanes skips foreign panes not spawned by this process', async () => {
    const teamName = 'session-p1-4-owned-panes'
    await writeTeamFileAsync(
      teamName,
      makeTeamFile(teamName, [
        {
          agentId: `foreign@${teamName}`,
          name: 'foreign',
          agentType: 'general-purpose',
          model: 'sonnet',
          joinedAt: Date.now(),
          tmuxPaneId: '%999',
          backendType: 'tmux',
          cwd: process.cwd(),
          subscriptions: [],
        },
      ]),
    )
    // Foreign pane %999 was NOT recorded via recordSpawnedTeammatePane -> returns immediately without error
    await expect(killOrphanedTeammatePanes(teamName)).resolves.toBeUndefined()
    // Explicit empty owned set also does not kill foreign panes
    recordSpawnedTeammatePane('tmux', '%123')
    await expect(
      killOrphanedTeammatePanes(teamName, new Set<string>()),
    ).resolves.toBeUndefined()
  })
})

describe('P1-5: SendMessageTool idle wakeup, local_agent protocol guard, and in-process shutdown verification', () => {
  test('triggers retryWake on idle in-process teammate for handleMessage and handleShutdownRequest', async () => {
    const teamName = 'session-p1-5-wake'
    const workerId = `sleeper@${teamName}`
    await writeTeamFileAsync(
      teamName,
      makeTeamFile(teamName, [
        {
          agentId: workerId,
          name: 'sleeper',
          agentType: 'general-purpose',
          model: 'sonnet',
          joinedAt: Date.now(),
          tmuxPaneId: 'in-process',
          backendType: 'in-process',
          cwd: process.cwd(),
          subscriptions: [],
        },
      ]),
    )

    let wakeCalls = 0
    const appState = {
      tasks: {
        'task-sleeper': {
          id: 'task-sleeper',
          type: 'in_process_teammate',
          status: 'running',
          identity: {
            agentId: workerId,
            agentName: 'sleeper',
            teamName,
          },
          retryWake: {
            emit: () => {
              wakeCalls++
            },
          },
        },
      },
      agentNameRegistry: new Map<string, string>(),
      sendMessagePins: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
      teamContext: {
        teamName,
        teamFilePath: getTeamFilePath(teamName),
        leadAgentId: `team-lead@${teamName}`,
        teammates: {
          [workerId]: {
            name: 'sleeper',
            agentType: 'general-purpose',
            color: 'green',
            tmuxSessionName: '',
            tmuxPaneId: 'in-process',
            cwd: process.cwd(),
            spawnedAt: Date.now(),
          },
        },
      },
    }
    const ctx = {
      getAppState: () => appState,
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    const msgRes = await SendMessageTool.call(
      { to: 'sleeper', message: 'wake up now', summary: 'wake' },
      ctx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((msgRes.data as { success: boolean }).success).toBe(true)
    expect(wakeCalls).toBe(1)

    const shutRes = await SendMessageTool.call(
      {
        to: 'sleeper',
        message: { type: 'shutdown_request', reason: 'all done' },
      },
      ctx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((shutRes.data as { success: boolean }).success).toBe(true)
    expect(wakeCalls).toBe(2)
  })

  test('blocks non-teammate local_agent background subagent from sending structured team-protocol messages', async () => {
    const teamName = 'session-p1-5-subagent-guard'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))

    const appState = {
      tasks: {
        'subagent-1': {
          id: 'subagent-1',
          type: 'local_agent',
          agentId: 'subagent-1',
          status: 'running',
        },
      },
      agentNameRegistry: new Map<string, string>(),
      sendMessagePins: {},
      toolPermissionContext: getEmptyToolPermissionContext(),
      teamContext: {
        teamName,
        teamFilePath: getTeamFilePath(teamName),
        leadAgentId: `team-lead@${teamName}`,
        teammates: {},
      },
    }
    const subagentCtx = {
      agentId: 'subagent-1',
      getAppState: () => appState,
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    const res = await SendMessageTool.call(
      {
        to: 'worker',
        message: { type: 'shutdown_request', reason: 'spoofed' },
      },
      subagentCtx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((res.data as { success: boolean }).success).toBe(false)
    expect((res.data as { message: string }).message).toContain(
      'cannot be sent by a background subagent',
    )
  })

  test('in-process teammate shutdown_response rejects unrecorded request_id and accepts recorded request_id', async () => {
    const teamName = 'session-p1-5-shutdown-verify'
    await writeTeamFileAsync(teamName, makeTeamFile(teamName))
    const ctx = {
      getAppState: () => ({
        tasks: {},
        teamContext: undefined,
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    // Unrecorded request_id MUST be refused and NOT abort controller
    const unverifiedController = new AbortController()
    const denied = await runWithTeammateContext(
      {
        agentId: `worker@${teamName}`,
        agentName: 'worker',
        teamName,
        parentSessionId: 'lead-session-id',
        isInProcess: true,
        abortController: unverifiedController,
        color: 'blue',
        planModeRequired: false,
      },
      () =>
        SendMessageTool.call(
          {
            to: 'team-lead',
            message: {
              type: 'shutdown_response',
              request_id: 'forged-req-999',
              approve: true,
            },
          },
          ctx,
          dummyCanUseTool,
          dummyAssistantMsg,
        ),
    )
    expect((denied.data as { success: boolean }).success).toBe(false)
    expect(unverifiedController.signal.aborted).toBe(false)

    // Recorded request_id succeeds and aborts teammate controller
    recordPendingShutdownRequest('verified-req-123', 'worker', true)
    const verifiedController = new AbortController()
    const approved = await runWithTeammateContext(
      {
        agentId: `worker@${teamName}`,
        agentName: 'worker',
        teamName,
        parentSessionId: 'lead-session-id',
        isInProcess: true,
        abortController: verifiedController,
        color: 'blue',
        planModeRequired: false,
      },
      () =>
        SendMessageTool.call(
          {
            to: 'team-lead',
            message: {
              type: 'shutdown_response',
              request_id: 'verified-req-123',
              approve: true,
            },
          },
          ctx,
          dummyCanUseTool,
          dummyAssistantMsg,
        ),
    )
    expect((approved.data as { success: boolean }).success).toBe(true)
    expect(verifiedController.signal.aborted).toBe(true)
  })
})

describe('P1-6: cleanup of stale spawnTeam copy, dead broadcast handler, and teamHelpers.inputSchema', () => {
  test('SendMessageTool searchHint updated, broadcast rejected, and dead exports/strings removed', async () => {
    expect(SendMessageTool.searchHint).toBe('send messages to agent teammates')

    const toolSrc = readFileSync(
      join(
        import.meta.dir,
        '../../../../packages/builtin-tools/src/tools/SendMessageTool/SendMessageTool.ts',
      ),
      'utf8',
    )
    expect(toolSrc).not.toContain('Create a team with Teammate spawnTeam first')
    expect(toolSrc).not.toContain('async function handleBroadcast')
    expect('inputSchema' in teamHelpers).toBe(false)

    const ctx = {
      getAppState: () => ({
        tasks: {},
        teamContext: undefined,
        toolPermissionContext: getEmptyToolPermissionContext(),
      }),
      setAppState: () => {},
      abortController: new AbortController(),
      messages: [],
      options: { tools: [] },
    } as unknown as Parameters<typeof SendMessageTool.call>[1]

    const res = await SendMessageTool.call(
      { to: '*', message: 'broadcast attempt' },
      ctx,
      dummyCanUseTool,
      dummyAssistantMsg,
    )
    expect((res.data as { success: boolean }).success).toBe(false)
    expect((res.data as { errorClass?: string }).errorClass).toBe(
      'not_reachable',
    )
  })
})
