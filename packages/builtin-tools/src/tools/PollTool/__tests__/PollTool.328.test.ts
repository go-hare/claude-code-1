import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  endPollCall,
  enqueueReplEvalPollEvent,
  getActiveMessageQueue,
  resetCommandQueue,
  tryBeginPollCall,
} from 'src/utils/messageQueueManager.js'
import {
  NO_PENDING_EVENTS,
  POLL_CHUNK_MAX_EVENTS,
  POLL_NONCE_MANIFEST_PREFIX,
  POLL_TOOL_NAME,
  type PollMediaBlock,
} from '../constants.js'
import {
  PollTool,
  type ReplSessionLedgerEntry,
  type ReplSessionsLike,
  runPollWaitLoop,
} from '../PollTool.js'

function createFakeReplSessions(initialOutstanding = 0): {
  sessions: ReplSessionsLike
  setOutstanding: (n: number) => void
  setLedger: (entries: ReplSessionLedgerEntry[]) => void
  statusLineNoted: () => number
} {
  let outstandingCount = initialOutstanding
  let ledgerEntries: ReplSessionLedgerEntry[] = []
  let statusLineCount = 0
  const listeners = new Set<() => void>()

  const sessions: ReplSessionsLike = {
    outstanding: () => outstandingCount,
    ledger: () => ledgerEntries,
    pending: () => ledgerEntries.map(e => ({ id: e.id })),
    onOutstandingChange: fn => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
    takeUnwaited: () => [],
    noteStatusLine: () => {
      statusLineCount++
    },
    takeStatusLineGiven: () => false,
  }

  return {
    sessions,
    setOutstanding: n => {
      outstandingCount = n
      for (const fn of listeners) fn()
    },
    setLedger: entries => {
      ledgerEntries = entries
    },
    statusLineNoted: () => statusLineCount,
  }
}

describe('PollTool (2.1.328)', () => {
  const prevPollEventsEnv = process.env.CLAUDE_CODE_POLL_EVENTS

  beforeEach(() => {
    resetCommandQueue()
    delete process.env.CLAUDE_CODE_POLL_EVENTS
  })

  afterEach(() => {
    resetCommandQueue()
    if (prevPollEventsEnv === undefined) {
      delete process.env.CLAUDE_CODE_POLL_EVENTS
    } else {
      process.env.CLAUDE_CODE_POLL_EVENTS = prevPollEventsEnv
    }
  })

  test('isEnabled() is false by default and true when CLAUDE_CODE_POLL_EVENTS=1', () => {
    expect(PollTool.name).toBe(POLL_TOOL_NAME)
    expect(PollTool.isEnabled()).toBe(false)

    process.env.CLAUDE_CODE_POLL_EVENTS = '1'
    expect(PollTool.isEnabled()).toBe(true)
  })

  test('tryBeginPollCall / endPollCall prevents duplicate concurrent Poll calls', async () => {
    expect(tryBeginPollCall()).toBe(true)
    expect(tryBeginPollCall()).toBe(false)

    // Calling PollTool while a call is already active returns NO_PENDING_EVENTS immediately
    const dupResult = await PollTool.call({}, {} as any)
    expect(dupResult.data.content).toBe(NO_PENDING_EVENTS)
    expect(dupResult.data.eventCount).toBe(0)
    expect(dupResult.data.remainingWakeCount).toBe(0)

    endPollCall()
    expect(tryBeginPollCall()).toBe(true)
    endPollCall()
  })

  test('immediately drains queued repl-eval poll events with authentic nonce manifest header', async () => {
    enqueueReplEvalPollEvent({
      evalId: 7,
      content: 'hello from repl',
      ms: 42,
    })

    const result = await PollTool.call({}, {} as any)
    expect(result.data.eventCount).toBe(1)
    expect(result.data.remainingWakeCount).toBe(0)

    const lines = result.data.content.split('\n')
    expect(lines[0]!.startsWith(POLL_NONCE_MANIFEST_PREFIX)).toBe(true)
    expect(result.data.content).toContain('kind="repl-eval"')
    expect(result.data.content).toContain('eval="7"')
    expect(result.data.content).toContain('<result>hello from repl</result>')
  })

  test('splits >20 queued events into chunks with delivery chunked marker', async () => {
    const total = POLL_CHUNK_MAX_EVENTS + 5
    for (let i = 1; i <= total; i++) {
      enqueueReplEvalPollEvent({
        evalId: i,
        content: `event-${i}`,
      })
    }

    const first = await runPollWaitLoop()
    expect(first.endReason).toBe('delivered')
    expect(first.data.eventCount).toBe(POLL_CHUNK_MAX_EVENTS)
    expect(first.data.remainingWakeCount).toBe(5)
    expect(first.data.content).toContain(
      '<system>delivery chunked: 5 more queued event(s) follow in the next delivery, oldest first; nothing was dropped.</system>',
    )

    const second = await runPollWaitLoop()
    expect(second.endReason).toBe('delivered')
    expect(second.data.eventCount).toBe(5)
    expect(second.data.remainingWakeCount).toBe(0)
    expect(second.data.content).not.toContain('<system>delivery chunked:')
  })

  test('splits >32KB queued events into chunks', async () => {
    const bigPayload = 'x'.repeat(20_000)
    enqueueReplEvalPollEvent({ evalId: 1, content: bigPayload })
    enqueueReplEvalPollEvent({ evalId: 2, content: bigPayload })

    const first = await runPollWaitLoop()
    expect(first.data.eventCount).toBe(1)
    expect(first.data.remainingWakeCount).toBe(1)
    expect(first.data.content).toContain(
      '<system>delivery chunked: 1 more queued event(s) follow in the next delivery, oldest first; nothing was dropped.</system>',
    )

    const second = await runPollWaitLoop()
    expect(second.data.eventCount).toBe(1)
    expect(second.data.remainingWakeCount).toBe(0)
  })

  test('wakes live wait as soon as an async repl-eval poll event is enqueued', async () => {
    const fake = createFakeReplSessions(1)
    const waitPromise = runPollWaitLoop({
      queue: getActiveMessageQueue(),
      replSessions: fake.sessions,
      waitMs: 5_000,
    })

    setTimeout(() => {
      enqueueReplEvalPollEvent({
        evalId: 99,
        content: 'async-done',
      })
    }, 15)

    const result = await waitPromise
    expect(result.endReason).toBe('delivered')
    expect(result.data.eventCount).toBe(1)
    expect(result.data.content).toContain('<result>async-done</result>')
  })

  test('returns nothing_to_wait_for immediately when nothing is running and queue is empty', async () => {
    const fake = createFakeReplSessions(0)
    const started = Date.now()
    const result = await runPollWaitLoop({
      replSessions: fake.sessions,
      waitMs: 10_000,
    })
    expect(result.endReason).toBe('nothing_to_wait_for')
    expect(result.data.content).toBe(NO_PENDING_EVENTS)
    expect(Date.now() - started).toBeLessThan(200)
  })

  test('cancels cleanly on abort signal', async () => {
    const fake = createFakeReplSessions(1)
    const ac = new AbortController()
    const waitPromise = runPollWaitLoop({
      signal: ac.signal,
      replSessions: fake.sessions,
      waitMs: 10_000,
    })

    setTimeout(() => ac.abort(), 15)

    const result = await waitPromise
    expect(result.endReason).toBe('aborted')
    expect(result.data.content).toBe(NO_PENDING_EVENTS)
  })

  test('delivers repl-status event on wait timeout when scripts are still running', async () => {
    const fake = createFakeReplSessions(1)
    fake.setLedger([
      {
        id: 3,
        state: 'running',
        runningMs: 4000,
        snippet: 'await fetchData()',
      },
    ])

    const result = await runPollWaitLoop({
      replSessions: fake.sessions,
      waitMs: 10,
    })
    expect(result.endReason).toBe('status_work_running')
    expect(result.data.eventCount).toBe(1)
    expect(result.data.content).toContain('kind="repl-status"')
    expect(result.data.content).toContain('pending="1"')
    expect(result.data.content).toContain('await fetchData()')
    expect(fake.statusLineNoted()).toBe(1)
  })

  test('forwards media blocks in mapToolResultToToolResultBlockParam', () => {
    const mediaBlock: PollMediaBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: 'iVBORw0KGgo=',
      },
    }

    const block = PollTool.mapToolResultToToolResultBlockParam(
      {
        content: '<event kind="repl-eval" at="2026-01-01T00:00:00Z">ok</event>',
        eventCount: 1,
        remainingWakeCount: 0,
        media: [[mediaBlock]],
      },
      'toolu_poll_1',
    )

    expect(block.tool_use_id).toBe('toolu_poll_1')
    expect(block.type).toBe('tool_result')
    expect(Array.isArray(block.content)).toBe(true)
    const blocks = block.content as Array<{ type: string }>
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.type).toBe('text')
    expect(blocks[1]).toEqual(mediaBlock)
  })

  test('end-to-end: async REPL dispatch wakes real PollTool with authentic nonce manifest and unescaped <result>', async () => {
    const { wrapReplToolForCodeMode, clearCodeModeVmSession } = await import(
      'src/services/codeMode/executor.js'
    )
    const { resetReplSessionsForTests } = await import(
      'src/services/codeMode/replSessions.js'
    )
    const {
      markPollEventWiringForTerminalRun,
      resetCodeModeOptInStateForTests,
      setCodeModeAccepted,
      setEngineCheckResultForTests,
      settleCodeModeOptIn,
    } = await import('src/services/codeMode/optIn.js')
    const { REPLTool } = await import('../../REPLTool/REPLTool.js')

    resetReplSessionsForTests()
    setEngineCheckResultForTests('passed')
    setCodeModeAccepted(true)
    settleCodeModeOptIn({ state: 'on', source: 'shell' })
    markPollEventWiringForTerminalRun()

    try {
      const wrapped = wrapReplToolForCodeMode(REPLTool, () => [])
      const fakeCtx = {
        abortController: new AbortController(),
        toolUseId: 'tu-e2e-async',
        options: { tools: [] },
        readFileState: new Map(),
        getAppState: () => ({
          toolPermissionContext: {
            mode: 'bypassPermissions' as const,
            additionalWorkingDirectories: new Map(),
            alwaysAllowRules: {},
            alwaysDenyRules: {},
            alwaysAskRules: {},
            isBypassPermissionsModeAvailable: true,
          },
          mcp: { tools: [], clients: [] },
          tasks: {},
          sessionHooks: new Map(),
        }),
        setAppState: () => {},
      } as never
      const canUseTool = (async (_t: unknown, input: unknown) => ({
        behavior: 'allow',
        updatedInput: input,
      })) as never
      const parentMsg = {
        type: 'assistant',
        uuid: 'u-e2e',
        message: { id: 'm-e2e', role: 'assistant', content: [] },
      } as never

      const dispatchRes = (await wrapped.call(
        {
          code: 'await new Promise(r => setTimeout(r, 60)); "ASYNC_E2E_OK"',
          settleWindowMs: 10,
        } as never,
        fakeCtx,
        canUseTool,
        parentMsg,
      )) as { data: { result: string; asyncDispatched?: boolean } }
      expect(dispatchRes.data.result).toBe('(dispatched #1)')
      expect(dispatchRes.data.asyncDispatched).toBe(true)

      const pollRes = await PollTool.call({}, fakeCtx)
      expect(pollRes.data.eventCount).toBe(1)
      expect(pollRes.data.content).toContain(
        '<system>authentic event nonces for this delivery:',
      )
      expect(pollRes.data.content).toContain('kind="repl-eval"')
      expect(pollRes.data.content).toContain('<result>ASYNC_E2E_OK</result>')
      expect(pollRes.data.content).not.toContain('&lt;repl-output')
    } finally {
      clearCodeModeVmSession()
      resetReplSessionsForTests()
      resetCodeModeOptInStateForTests()
    }
  })
})
