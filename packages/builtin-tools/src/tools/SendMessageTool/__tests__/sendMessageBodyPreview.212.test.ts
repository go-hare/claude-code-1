/**
 * densable 2.1.212 #38 — SendMessage bodies not duplicated into tool results /
 * replayed history: routing.content + backfill content are Bs(…, 50) previews.
 *
 * Does not mock teammate.js / teammateMailbox (process-global mock.module risk).
 * Covers pure backfill + local_agent queue path + truncate contract used by
 * handleMessage routing.content.
 */
import { describe, expect, mock, test } from 'bun:test'
import type { AppState } from 'src/state/AppState.js'
import { asAgentId } from 'src/types/ids.js'
import { truncate } from 'src/utils/format.js'
import { SendMessageTool } from '../SendMessageTool.js'

mock.module('src/utils/sessionStorage.js', () => ({
  readAgentMetadata: async () => null,
}))

type TaskSlice = {
  type: 'local_agent'
  status: 'running'
  agentId: string
  agentType: string
  pendingMessages: Array<{ text: string; isMeta?: boolean; origin?: unknown }>
  isBackgrounded?: boolean
}

function makeLocalAgentContext(agentId: string) {
  let tasks: Record<string, TaskSlice> = {
    [agentId]: {
      type: 'local_agent',
      status: 'running',
      agentId,
      agentType: 'general-purpose',
      pendingMessages: [],
      isBackgrounded: true,
    },
  }
  const setAppState = (f: (prev: AppState) => AppState) => {
    const prev = {
      tasks,
      agentNameRegistry: new Map(),
    } as unknown as AppState
    const next = f(prev)
    tasks = { ...(next.tasks as Record<string, TaskSlice>) }
  }
  return {
    context: {
      getAppState: () =>
        ({
          tasks,
          agentNameRegistry: new Map(),
        }) as unknown as AppState,
      setAppState,
      setAppStateForTasks: setAppState,
    } as never,
    getTasks: () => tasks,
  }
}

const allow = (async () => ({
  behavior: 'allow' as const,
  updatedInput: {},
})) as never

const parentMessage = {
  type: 'assistant',
  uuid: '00000000-0000-4000-8000-000000000099',
  message: { role: 'assistant', content: [] },
} as never

describe('densable #38 SendMessage body preview (Bs 50)', () => {
  test('truncate(…, 50) matches densable Bs width used on routing', () => {
    const long = 'z'.repeat(100)
    const preview = truncate(long, 50)
    expect(preview.length).toBeLessThanOrEqual(51)
    expect(preview.endsWith('…')).toBe(true)
    expect(preview).not.toBe(long)
    expect(preview).not.toContain('z'.repeat(60))
  })

  test('backfillObservableInput truncates content to 50 (densable Bs)', () => {
    const long = 'x'.repeat(80)
    const input: Record<string, unknown> = {
      to: 'alice',
      message: long,
      summary: 'hi',
    }
    SendMessageTool.backfillObservableInput!(input)
    expect(input.type).toBe('message')
    expect(typeof input.content).toBe('string')
    expect((input.content as string).length).toBeLessThanOrEqual(51)
    expect(input.content).not.toBe(long)
    expect(input.content).toBe(truncate(long, 50))
  })

  test('backfill truncates structured reason/feedback', () => {
    const long = 'y'.repeat(80)
    const input: Record<string, unknown> = {
      to: 'alice',
      message: {
        type: 'shutdown_response',
        request_id: 'r1',
        approve: false,
        reason: long,
      },
    }
    SendMessageTool.backfillObservableInput!(input)
    expect(input.content).toBe(truncate(long, 50))
  })

  test('broadcast backfill truncates content', () => {
    const long = 'w'.repeat(80)
    const input: Record<string, unknown> = {
      to: '*',
      message: long,
      summary: 'all',
    }
    SendMessageTool.backfillObservableInput!(input)
    expect(input.type).toBe('broadcast')
    expect(input.content).toBe(truncate(long, 50))
  })

  test('local_agent queue: tool_result omits full body; pending keeps it', async () => {
    const agentId = asAgentId('a81c8d8229cca26eb')
    const long =
      'abcdefghijklmnopqrstuvwxyz0123456789 ABCDEFGHIJKLMNOPQRSTUVWXYZ more body after the preview window'
    const { context, getTasks } = makeLocalAgentContext(agentId)

    const result = await SendMessageTool.call!(
      {
        to: agentId,
        summary: 'status',
        message: long,
      },
      context,
      allow,
      parentMessage,
    )

    expect(result.data.success).toBe(true)
    expect(result.data.message).not.toContain(
      'more body after the preview window',
    )

    const pending = getTasks()[agentId]!.pendingMessages
    expect(pending.length).toBe(1)
    expect(pending[0]!.text).toContain(long)

    const block = SendMessageTool.mapToolResultToToolResultBlockParam!(
      result.data,
      'tu-1',
    )
    const text =
      typeof block.content === 'string'
        ? block.content
        : Array.isArray(block.content)
          ? (block.content as Array<{ type: string; text?: string }>)
              .map(b => b.text ?? '')
              .join('')
          : ''
    expect(text).not.toContain('more body after the preview window')
  })
})
