import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../../../../tests/mocks/settings.js'

const logEventMock = mock(() => {})
const realAnalytics = await import('src/services/analytics/index.js')
const analyticsSnap = snapshotModuleExports(realAnalytics)
mock.module('src/services/analytics/index.js', () => ({
  ...analyticsSnap,
  logEvent: logEventMock,
}))

const realGrowthbook = await import('src/services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: () => true,
}))

const realModel = await import('src/utils/model/model.js')
const modelSnap = snapshotModuleExports(realModel)
mock.module('src/utils/model/model.js', () => ({
  ...modelSnap,
  getMainLoopModel: () => 'claude-opus-4-8',
}))

const realBootstrap = await import('src/bootstrap/state.js')
const bootstrapSnap = snapshotModuleExports(realBootstrap)
mock.module('src/bootstrap/state.js', () => ({
  ...bootstrapSnap,
  getSessionId: () => '00000000-0000-4000-8000-000000000001',
}))

const markMock = mock(async () => {})
const realSessionStorage = await import('src/utils/sessionStorage.js')
const sessionStorageSnap = snapshotModuleExports(realSessionStorage)
mock.module('src/utils/sessionStorage.js', () => ({
  ...sessionStorageSnap,
  markSessionEndedByModel: markMock,
}))

const gracefulMock = mock(async () => {})
const realGraceful = await import('src/utils/gracefulShutdown.js')
const gracefulSnap = snapshotModuleExports(realGraceful)
mock.module('src/utils/gracefulShutdown.js', () => ({
  ...gracefulSnap,
  gracefulShutdown: gracefulMock,
}))

afterAll(() => {
  mock.module('src/services/analytics/index.js', () => ({ ...analyticsSnap }))
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
  mock.module('src/utils/model/model.js', () => ({ ...modelSnap }))
  mock.module('src/bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('src/utils/sessionStorage.js', () => ({ ...sessionStorageSnap }))
  mock.module('src/utils/gracefulShutdown.js', () => ({ ...gracefulSnap }))
})

// Dynamic import AFTER mocks — static import can TDZ against mock.module order.
const { EndConversationTool } = await import('../EndConversationTool.js')
const {
  END_CONVERSATION_FORK_REFLECTION_PROMPT,
  END_CONVERSATION_TOOL_RESULT,
  getEndConversationReflectionPrompt,
} = await import('../prompt.js')

function makeContext(opts: {
  agentId?: string
  isNonInteractiveSession?: boolean
  messages?: unknown[]
  endedByModel?: boolean
}) {
  const abortController = new AbortController()
  let endedByModel = opts.endedByModel ?? false
  return {
    abortController,
    agentId: opts.agentId,
    messages: opts.messages ?? [],
    options: {
      isNonInteractiveSession: opts.isNonInteractiveSession ?? false,
    },
    setAppState: (
      f: (prev: { endedByModel: boolean }) => { endedByModel: boolean },
    ) => {
      const next = f({ endedByModel })
      endedByModel = next.endedByModel
    },
    getEndedByModel: () => endedByModel,
  }
}

describe('EndConversationTool.call phases', () => {
  beforeEach(() => {
    logEventMock.mockClear()
    markMock.mockClear()
    gracefulMock.mockClear()
    process.env.CLAUDE_CODE_ENTRYPOINT = 'cli'
  })

  test('fork path returns reflection no-op', async () => {
    const ctx = makeContext({ agentId: 'agent-1' })
    const result = await EndConversationTool.call({}, ctx as any)
    expect(result.data.ended).toBe(false)
    expect(result.data.message).toBe(END_CONVERSATION_FORK_REFLECTION_PROMPT)
    expect(markMock).not.toHaveBeenCalled()
    expect(ctx.abortController.signal.aborted).toBe(false)
  })

  test('first main-thread call reflects', async () => {
    const ctx = makeContext({ messages: [] })
    const result = await EndConversationTool.call({}, ctx as any)
    expect(result.data.ended).toBe(false)
    expect(result.data.message).toBe(getEndConversationReflectionPrompt())
    expect(markMock).not.toHaveBeenCalled()
  })

  test('second call ends interactive session', async () => {
    const prior = {
      type: 'assistant',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_ec',
            name: 'EndConversation',
            input: {},
          },
        ],
      },
    }
    const toolResult = {
      type: 'user',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_ec',
            content: 'reflect',
          },
        ],
      },
    }
    const ctx = makeContext({ messages: [prior, toolResult] })
    const result = await EndConversationTool.call({}, ctx as any)
    expect(result.data.ended).toBe(true)
    expect(result.data.message).toBe(END_CONVERSATION_TOOL_RESULT)
    expect(markMock).toHaveBeenCalled()
    expect(ctx.abortController.signal.aborted).toBe(true)
    expect(ctx.abortController.signal.reason).toBe('end_conversation')
    expect(ctx.getEndedByModel()).toBe(true)
    expect(gracefulMock).not.toHaveBeenCalled()
  })

  test('second call non-interactive gracefulShutdown', async () => {
    const prior = {
      type: 'assistant',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        content: [
          {
            type: 'tool_use',
            id: 'tu_ec',
            name: 'EndConversation',
            input: {},
          },
        ],
      },
    }
    const toolResult = {
      type: 'user',
      uuid: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tu_ec',
            content: 'reflect',
          },
        ],
      },
    }
    const ctx = makeContext({
      isNonInteractiveSession: true,
      messages: [prior, toolResult],
    })
    const result = await EndConversationTool.call({}, ctx as any)
    expect(result.data.ended).toBe(true)
    expect(gracefulMock).toHaveBeenCalled()
    expect(ctx.getEndedByModel()).toBe(false)
  })
})
