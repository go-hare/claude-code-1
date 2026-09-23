import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { InProcessTeammateTaskState } from '../../../tasks/InProcessTeammateTask/types.js'
import type { LocalAgentTaskState } from '../../../tasks/LocalAgentTask/LocalAgentTask.js'
import type { TaskState } from '../../../tasks/types.js'
import type { Message } from '../../../types/message.js'
import {
  resolveViewedTask,
  viewedAgentNameForPlaceholder,
  viewedTeammateOrLocalAgent,
} from '../viewedAgent.js'

function localAgent(
  id: string,
  overrides: Partial<LocalAgentTaskState> = {},
): LocalAgentTaskState {
  return {
    id,
    type: 'local_agent',
    status: 'running',
    description: 'worker',
    startTime: 0,
    outputFile: '',
    outputOffset: 0,
    notified: false,
    isIdle: false,
    ...overrides,
  } as LocalAgentTaskState
}

function teammate(
  id: string,
  overrides: Partial<InProcessTeammateTaskState> = {},
): InProcessTeammateTaskState {
  return {
    id,
    type: 'in_process_teammate',
    status: 'running',
    description: 'teammate',
    startTime: 0,
    outputFile: '',
    outputOffset: 0,
    notified: false,
    identity: {
      agentId: 'researcher@demo',
      agentName: 'researcher',
      teamName: 'demo',
      planModeRequired: false,
      parentSessionId: 'parent',
    },
    prompt: '',
    awaitingPlanApproval: false,
    permissionMode: 'default',
    isIdle: false,
    shutdownRequested: false,
    pendingUserMessages: [],
    lastReportedToolCount: 0,
    lastReportedTokenCount: 0,
    ...overrides,
  } as InProcessTeammateTaskState
}

describe('viewed local agent placeholder (251 #51 dKe)', () => {
  test('dKe returns localAgent when viewing a local_agent', () => {
    const a1 = localAgent('a1')
    const tasks = { a1 } as Record<string, TaskState>
    expect(viewedTeammateOrLocalAgent('a1', tasks)).toEqual({
      teammate: undefined,
      localAgent: a1,
    })
    expect(viewedTeammateOrLocalAgent(undefined, tasks)).toEqual({
      teammate: undefined,
      localAgent: undefined,
    })
  })

  test('placeholder name is the registry name for a viewed local_agent', () => {
    const tasks = { a1: localAgent('a1') } as Record<string, TaskState>
    const names = new Map([['scout', 'a1']])
    expect(viewedAgentNameForPlaceholder('a1', tasks, names)).toBe('scout')
    expect(
      viewedAgentNameForPlaceholder('a1', tasks, new Map()),
    ).toBeUndefined()
  })

  test('PromptInput uses the helper for viewingAgentName', () => {
    const src = readFileSync(
      join(import.meta.dir, '../PromptInput.tsx'),
      'utf8',
    )
    expect(src).toContain('viewedAgentNameForPlaceholder(')
    expect(src).toContain('resolveViewedTask(')
    expect(src).not.toContain(
      'const viewingAgentName = viewedTeammate?.identity.agentName',
    )
  })
})

describe('Iln viewed-task envelope (251 #51)', () => {
  test('no viewing id is main: task undefined, conversationKey from main', () => {
    const msgs = [{ type: 'user' }] as Message[]
    const ids = new Set(['tu1'])
    const out = resolveViewedTask({
      viewingAgentTaskId: undefined,
      tasks: {},
      transcripts: {
        conv: { messages: msgs, inProgressToolUseIDs: ids },
      },
      mainIsBusy: true,
      mainConversationId: 'conv',
    })
    expect(out.task).toBeUndefined()
    expect(out.isMain).toBe(true)
    expect(out.isTeammate).toBe(false)
    expect(out.messages).toBe(msgs)
    expect(out.inProgressToolUseIDs).toBe(ids)
    expect(out.conversationKey).toBe('conv')
    expect(out.isLoading).toBe(true)
  })

  test('missing transcript bag uses empty messages and ids', () => {
    const args = {
      viewingAgentTaskId: undefined,
      tasks: {},
      transcripts: {},
      mainIsBusy: false,
      mainConversationId: 'conv',
    }
    const out = resolveViewedTask(args)
    const other = resolveViewedTask({
      ...args,
      viewingAgentTaskId: 'missing',
    })
    expect(out.messages).toEqual([])
    expect(out.inProgressToolUseIDs.size).toBe(0)
    expect(out.isLoading).toBe(false)
    // densable LPt / FPt — shared empties, not a fresh alloc per miss
    expect(out.messages).toBe(other.messages)
    expect(out.inProgressToolUseIDs).toBe(other.inProgressToolUseIDs)
  })

  test('unknown viewing id falls back to main', () => {
    const a1 = localAgent('a1')
    const out = resolveViewedTask({
      viewingAgentTaskId: 'missing',
      tasks: { a1 } as Record<string, TaskState>,
      transcripts: {},
      mainIsBusy: false,
      mainConversationId: 'main',
    })
    expect(out.isMain).toBe(true)
    expect(out.task).toBeUndefined()
    expect(out.conversationKey).toBe('main')
  })

  test('viewed local_agent: task, not teammate, conversationKey is id', () => {
    const a1 = localAgent('a1')
    const msgs = [{ type: 'assistant' }] as Message[]
    const out = resolveViewedTask({
      viewingAgentTaskId: 'a1',
      tasks: { a1 } as Record<string, TaskState>,
      transcripts: { a1: { messages: msgs } },
      mainIsBusy: true,
      mainConversationId: 'main',
    })
    expect(out.task).toBe(a1)
    expect(out.isMain).toBe(false)
    expect(out.isTeammate).toBe(false)
    expect(out.messages).toBe(msgs)
    expect(out.conversationKey).toBe('a1')
    expect(out.isLoading).toBe(true)
  })

  test('viewed teammate: isTeammate true, k is d not y', () => {
    const t1 = teammate('t1')
    const a1 = localAgent('a1')
    const out = resolveViewedTask({
      viewingAgentTaskId: 't1',
      tasks: { t1, a1 } as Record<string, TaskState>,
      transcripts: {},
      mainIsBusy: false,
      mainConversationId: 'main',
    })
    expect(out.task).toBe(t1)
    expect(out.isMain).toBe(false)
    expect(out.isTeammate).toBe(true)
    expect(out.conversationKey).toBe('t1')
    expect(out.messages).toEqual([])
  })

  test('isLoading is running && !isIdle on the viewed task', () => {
    const idle = localAgent('idle', { isIdle: true })
    const done = localAgent('done', { status: 'completed', isIdle: false })
    expect(
      resolveViewedTask({
        viewingAgentTaskId: 'idle',
        tasks: { idle } as Record<string, TaskState>,
        transcripts: {},
        mainIsBusy: true,
        mainConversationId: 'main',
      }).isLoading,
    ).toBe(false)
    expect(
      resolveViewedTask({
        viewingAgentTaskId: 'done',
        tasks: { done } as Record<string, TaskState>,
        transcripts: {},
        mainIsBusy: true,
        mainConversationId: 'main',
      }).isLoading,
    ).toBe(false)
  })
})
