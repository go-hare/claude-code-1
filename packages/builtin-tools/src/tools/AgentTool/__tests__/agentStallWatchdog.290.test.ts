import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getAsyncAgentStallTimeoutMs,
  runAsyncAgentLifecycle,
} from '../agentToolUtils.js'

const prevStallTimeout = process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS

afterEach(() => {
  if (prevStallTimeout === undefined) {
    delete process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS
  } else {
    process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS = prevStallTimeout
  }
})

describe('v2.1.290 #87: Agent stall watchdog timeout', () => {
  test('respects CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS override', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS: '45000',
      }),
    ).toBe(45_000)
  })

  test('returns 600s fallback when CLAUDE_ENABLE_STREAM_WATCHDOG is disabled', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_ENABLE_STREAM_WATCHDOG: '0',
      }),
    ).toBe(600_000)
  })

  test('adds 300s grace to stream idle timeout when watchdog is enabled', () => {
    expect(
      getAsyncAgentStallTimeoutMs({
        CLAUDE_STREAM_IDLE_TIMEOUT_MS: '120000',
      }),
    ).toBe(420_000)
    expect(getAsyncAgentStallTimeoutMs({})).toBe(390_000)
  })

  test('P1-#37: runAsyncAgentLifecycle threads onQueryProgress to reset stall watchdog and onStreamTokenEstimate to update task progress', async () => {
    process.env.CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS = '60'
    const taskId = 'agent-stall-progress-test'
    let state: Record<string, unknown> = {
      tasks: {
        [taskId]: {
          id: taskId,
          type: 'local_agent',
          status: 'running',
          description: 'streaming worker',
          startTime: Date.now(),
          outputFile: '/tmp/stall-test.out',
          outputOffset: 0,
          notified: false,
          agentId: taskId,
          agentType: 'general-purpose',
          prompt: 'stream long response',
          selectedAgent: { agentType: 'general-purpose' },
          isBackgrounded: true,
          abortController: new AbortController(),
          messages: [],
        },
      },
    }
    const setAppState = (updater: (prev: typeof state) => typeof state) => {
      state = updater(state)
    }
    const abortController = new AbortController()
    let sawTokenUpdates = 0

    const settled = await runAsyncAgentLifecycle({
      taskId,
      abortController,
      makeStream: async function* (
        _onCacheSafeParams,
        onQueryProgress,
        onStreamTokenEstimate,
      ) {
        expect(typeof onQueryProgress).toBe('function')
        expect(typeof onStreamTokenEstimate).toBe('function')
        onStreamTokenEstimate?.({ type: 'response_start' })
        // Emit progress heartbeats every 25ms for 125ms (> 60ms stall timeout!)
        // Without onQueryProgress bumping armStallWatchdog(), this would abort!
        for (let i = 0; i < 5; i++) {
          await new Promise(r => setTimeout(r, 25))
          onQueryProgress?.()
          onStreamTokenEstimate?.({
            type: 'tokens',
            estimatedTokensDelta: 40,
          })
          const t = (
            state.tasks as Record<
              string,
              { progress?: { tokenCount?: number } }
            >
          )[taskId]
          if ((t?.progress?.tokenCount ?? 0) > 0) {
            sawTokenUpdates++
          }
        }
        yield {
          type: 'assistant',
          uuid: 'u-final',
          message: {
            id: 'msg-final',
            role: 'assistant',
            content: [{ type: 'text', text: 'streamed-ok' }],
            usage: {
              input_tokens: 10,
              output_tokens: 20,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        } as never
      },
      metadata: {
        prompt: 'stream long response',
        resolvedAgentModel: 'claude-sonnet-4-6',
        isBuiltInAgent: true,
        startTime: Date.now(),
        agentType: 'general-purpose',
        isAsync: true,
      },
      description: 'streaming worker',
      toolUseContext: {
        getAppState: () => state,
        setAppState,
        options: { tools: [] },
      } as never,
      rootSetAppState: setAppState as never,
      agentIdForCleanup: taskId,
      enableSummarization: false,
      getWorktreeResult: async () => ({}),
    })

    expect(abortController.signal.aborted).toBe(false)
    expect(settled?.finalText).toBe('streamed-ok')
    expect(sawTokenUpdates).toBeGreaterThan(0)
  })

  test('P1-#36: runAgent and forkedAgent isolate every finally cleanup stage and call endSubagentRepl / shell reap / queue drain', () => {
    const runAgentSrc = readFileSync(
      join(import.meta.dir, '../runAgent.ts'),
      'utf8',
    )
    expect(runAgentSrc).toContain('const cleanupStages:')
    expect(runAgentSrc).toContain('endSubagentRepl(agentId)')
    expect(runAgentSrc).toContain('clearAgentPermissionWaitsForAgent(agentId)')
    expect(runAgentSrc).toContain('for (const stage of cleanupStages)')
    expect(runAgentSrc).toContain('await stage.run()')

    const forkedSrc = readFileSync(
      join(import.meta.dir, '../../../../../../src/utils/forkedAgent.ts'),
      'utf8',
    )
    expect(forkedSrc).toContain('endSubagentRepl(cleanupAgentId)')
    expect(forkedSrc).toContain('killShellTasksForAgent(')
    expect(forkedSrc).toContain('dequeueAllMatching')
  })
})
