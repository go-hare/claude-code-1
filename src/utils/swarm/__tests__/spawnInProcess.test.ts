import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { getDefaultAppState } from '../../../state/AppStateStore'
import { createTask, getTask, listTasks } from '../../tasks'
import { readMailbox, writeToMailbox } from '../../teammateMailbox'
import {
  killInProcessTeammateByAgentId,
  spawnInProcessTeammate,
} from '../spawnInProcess'

mock.module('@claude-code/builtin-tools/tools/AgentTool/runAgent.js', () => ({
  async *runAgent() {},
}))

let tempHome: string
let previousConfigDir: string | undefined
let previousAnthropicApiKey: string | undefined

beforeEach(() => {
  previousConfigDir = process.env.CLAUDE_CONFIG_DIR
  previousAnthropicApiKey = process.env.ANTHROPIC_API_KEY
  tempHome = join(
    tmpdir(),
    `spawn-in-process-${Date.now()}-${Math.random().toString(16).slice(2)}`,
  )
  process.env.CLAUDE_CONFIG_DIR = tempHome
  process.env.ANTHROPIC_API_KEY = 'test-key'
})

afterEach(() => {
  if (previousConfigDir === undefined) {
    delete process.env.CLAUDE_CONFIG_DIR
  } else {
    process.env.CLAUDE_CONFIG_DIR = previousConfigDir
  }
  if (previousAnthropicApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY
  } else {
    process.env.ANTHROPIC_API_KEY = previousAnthropicApiKey
  }
  rmSync(tempHome, { recursive: true, force: true })
})

describe('killInProcessTeammateByAgentId', () => {
  test('registers a real in-process teammate task and mailbox', async () => {
    let state = getDefaultAppState() as any
    const result = await spawnInProcessTeammate(
      {
        name: 'worker',
        teamName: 'alpha',
        prompt: 'smoke test task',
        color: 'blue',
        planModeRequired: false,
      },
      {
        setAppState(updater) {
          state = updater(state)
        },
        toolUseId: 'toolu_smoke',
      },
    )

    expect(result.success).toBe(true)
    expect(result.agentId).toBe('worker@alpha')
    expect(result.taskId).toBeString()
    expect(state.tasks[result.taskId!].type).toBe('in_process_teammate')
    expect(state.tasks[result.taskId!].identity.agentId).toBe('worker@alpha')
    expect(state.tasks[result.taskId!].messages).toEqual([])

    await writeToMailbox(
      'worker',
      {
        from: 'team-lead',
        text: 'mailbox smoke',
        timestamp: new Date(0).toISOString(),
      },
      'alpha',
    )
    const messages = await readMailbox('worker', 'alpha')

    expect(messages).toHaveLength(1)
    expect(messages[0]!.text).toBe('mailbox smoke')
    expect(messages[0]!.read).toBe(false)
  })

  test('aborts the running teammate and removes it from team context by agent id', () => {
    const abortController = new AbortController()
    let state: any = {
      teamContext: {
        teamName: 'alpha',
        teammates: {
          'worker@alpha': {
            name: 'worker',
          },
        },
      },
      tasks: {
        teammate_task_1: {
          id: 'teammate_task_1',
          type: 'in_process_teammate',
          status: 'running',
          identity: {
            agentId: 'worker@alpha',
            agentName: 'worker',
            teamName: 'alpha',
            planModeRequired: false,
            parentSessionId: 'session',
          },
          abortController,
          pendingUserMessages: [],
          onIdleCallbacks: [],
          messages: [],
        },
      },
    }

    const killed = killInProcessTeammateByAgentId('worker@alpha', updater => {
      state = updater(state)
    })

    expect(killed).toBe(true)
    expect(abortController.signal.aborted).toBe(true)
    expect(state.tasks.teammate_task_1.status).toBe('killed')
    expect(state.teamContext.teammates['worker@alpha']).toBeUndefined()
  })

  test('in-process teammate claims tasks from team task list, not parent session id', async () => {
    const { runInProcessTeammate } = await import('../inProcessRunner')
    let state = getDefaultAppState() as any

    await createTask('alpha', {
      subject: 'Team task',
      description: 'Claim from team list',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    })
    await createTask('parent-session', {
      subject: 'Wrong parent task',
      description: 'Should remain unclaimed',
      status: 'pending',
      blocks: [],
      blockedBy: [],
    })

    const spawn = await spawnInProcessTeammate(
      {
        name: 'worker',
        teamName: 'alpha',
        prompt: 'Find work',
        color: 'blue',
        planModeRequired: false,
      },
      {
        setAppState(updater) {
          state = updater(state)
        },
        toolUseId: 'toolu_task_claim',
      },
    )

    const lifecycleAbortController = new AbortController()
    setTimeout(() => lifecycleAbortController.abort(), 20)

    await runInProcessTeammate({
      identity: {
        agentId: 'worker@alpha',
        agentName: 'worker',
        teamName: 'alpha',
        planModeRequired: false,
        parentSessionId: 'parent-session',
      },
      taskId: spawn.taskId!,
      prompt: 'Find work',
      systemPrompt: 'test teammate system prompt',
      systemPromptMode: 'replace',
      teammateContext: spawn.teammateContext!,
      toolUseContext: {
        getAppState: () => state,
        setAppState(updater: (prev: any) => any) {
          state = updater(state)
        },
        options: {
          tools: [],
          mainLoopModel: 'test-model',
          mcpClients: [],
        },
        readFileState: new Map(),
        messages: [],
      } as any,
      abortController: lifecycleAbortController,
    })

    const [teamTask] = await listTasks('alpha')
    const parentTask = await getTask('parent-session', '1')

    expect(teamTask?.owner).toBe('worker')
    expect(teamTask?.status).toBe('in_progress')
    expect(parentTask?.owner).toBeUndefined()

    // Sanity check getTaskListId() also resolves to team name inside teammate context.
    const { getTaskListId } = await import('../../tasks')
    const { runWithTeammateContext } = await import('../../teammateContext')
    const resolved = runWithTeammateContext(spawn.teammateContext!, () =>
      getTaskListId(),
    )
    expect(resolved).toBe('alpha')
  })
})
