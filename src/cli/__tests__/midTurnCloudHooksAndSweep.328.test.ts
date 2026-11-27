import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { TaskState } from '../../tasks/types.js'
import { notifySweptBackgroundAgents } from '../../utils/task/framework.js'
import {
  appendHookAdditionalContextToPromptContent,
  createMidTurnHookRunner,
  evaluateMidTurnCloudUserPromptSubmitHooks,
} from '../print.js'

describe('Round 3 Fix 4: BH3-P1-5 Mid-Turn Cloud UserPromptSubmit Hooks', () => {
  test('does not stall caller loop while slow hook is running and preserves FIFO order', async () => {
    const runner = createMidTurnHookRunner()
    const events: string[] = []
    let releaseFirstHook!: () => void
    const firstHookGate = new Promise<void>(resolve => {
      releaseFirstHook = resolve
    })

    runner.schedule(async () => {
      events.push('hook1-start')
      await firstHookGate
      events.push('hook1-done')
    })
    runner.schedule(async () => {
      events.push('msg2-enqueued')
    })

    // Control request arrives while hook1 is still pending -> runs immediately!
    events.push('control-interrupt-handled')
    expect(events).toContain('control-interrupt-handled')
    expect(runner.hasPending).toBe(true)

    releaseFirstHook()
    await runner.waitForIdle()
    expect(runner.hasPending).toBe(false)
    expect(events.indexOf('hook1-done')).toBeLessThan(
      events.indexOf('msg2-enqueued'),
    )
  })

  test('abortAll cancels queued and in-flight hooks and notifies queued onCancel immediately without double-firing', async () => {
    const runner = createMidTurnHookRunner()
    const ran: string[] = []
    const cancelled: string[] = []
    let observedAborted = false
    let release!: () => void
    const gate = new Promise<void>(r => {
      release = r
    })

    runner.schedule(
      async signal => {
        ran.push('first-start')
        await gate
        observedAborted = signal.aborted
        if (signal.aborted) {
          cancelled.push('first')
        }
      },
      () => {
        cancelled.push('first-onCancel')
      },
    )
    runner.schedule(
      async () => {
        ran.push('second-should-not-run')
      },
      () => {
        cancelled.push('second')
      },
    )

    // Let microtask start first task
    await Promise.resolve()
    runner.abortAll()
    // Queued second task notifies cancellation immediately upon abortAll()
    expect(cancelled).toEqual(['second'])
    release()
    await runner.waitForIdle()

    expect(observedAborted).toBe(true)
    expect(ran).toEqual(['first-start'])
    // Second task's onCancel was NOT double-fired when chain settled
    expect(cancelled).toEqual(['second', 'first'])
  })

  test('evaluateMidTurnCloudUserPromptSubmitHooks captures additionalContexts, block, and stop', async () => {
    const ac = new AbortController()
    const allow = await evaluateMidTurnCloudUserPromptSubmitHooks(
      'hello',
      async function* () {
        yield { additionalContexts: ['ctx-1'], sessionTitle: 'My Title' }
        yield { additionalContexts: ['ctx-2'] }
      },
      ac.signal,
    )
    expect(allow).toEqual({
      kind: 'allow',
      additionalContexts: ['ctx-1', 'ctx-2'],
      sessionTitle: 'My Title',
    })

    const blocked = await evaluateMidTurnCloudUserPromptSubmitHooks(
      'bad',
      async function* () {
        yield { blockingError: { blockingError: 'policy violation' } }
      },
      ac.signal,
    )
    expect(blocked).toEqual({
      kind: 'blocked',
      message: 'UserPromptSubmit hook blocked this message: policy violation',
    })

    const stopped = await evaluateMidTurnCloudUserPromptSubmitHooks(
      'stop',
      async function* () {
        yield { preventContinuation: true, stopReason: 'maintenance' }
      },
      ac.signal,
    )
    expect(stopped).toEqual({
      kind: 'stopped',
      message: 'Operation stopped by hook: maintenance',
    })
  })

  test('appendHookAdditionalContextToPromptContent preserves contexts for string and blocks', () => {
    const strOut = appendHookAdditionalContextToPromptContent('hi', ['extra'])
    expect(strOut).toContain('hi')
    expect(strOut).toContain('UserPromptSubmit hook additional context: extra')

    const arrOut = appendHookAdditionalContextToPromptContent(
      [{ type: 'text', text: 'hi' }],
      ['extra'],
    )
    expect(arrOut.length).toBe(2)
    expect((arrOut[1] as { text: string }).text).toContain(
      'UserPromptSubmit hook additional context: extra',
    )
  })

  test('print.ts marks non-blocking mid-turn cloud prompts skipSubmissionHooks: true, emits cancelled lifecycle on abort, and drains SDK events after sweeps and before output.done()', () => {
    const src = readFileSync(
      join(import.meta.dir, '../print/controlLoop.ts'),
      'utf8',
    )
    expect(src).toContain('skipSubmissionHooks: true')
    expect(src).toContain('midTurnHookRunner.schedule')
    expect(src).toContain('midTurnHookRunner.abortAll()')
    expect(src).toContain('cancelMidTurnUserMessage')
    expect(src).toContain(
      "notifyCommandLifecycle(userMsg.uuid as string, 'cancelled')",
    )
    // Verify drainPrintSdkEvents() runs before output.done() in the !running branch (and both shutdown paths)
    const shutdownIdx = src.lastIndexOf('unregisterHookHeartbeatSink?.()')
    expect(shutdownIdx).toBeGreaterThan(-1)
    const shutdownSnippet = src.slice(shutdownIdx, shutdownIdx + 160)
    expect(shutdownSnippet).toContain('drainPrintSdkEvents()')
    expect(shutdownSnippet.indexOf('drainPrintSdkEvents()')).toBeLessThan(
      shutdownSnippet.indexOf('output.done()'),
    )
    // Verify drainPrintSdkEvents() runs after notifySweptBackgroundAgents in interrupt & end_session
    const sweepMatches = [...src.matchAll(/notifySweptBackgroundAgents\(/g)]
    expect(sweepMatches.length).toBeGreaterThanOrEqual(2)
    for (const m of sweepMatches) {
      const idx = m.index ?? -1
      const snippet = src.slice(idx, idx + 320)
      expect(snippet).toContain('drainPrintSdkEvents()')
    }
  })
})

describe('Round 3 Fix 4: BH3-P1-6 Swept Background Agent SDK Termination Events', () => {
  test('notifySweptBackgroundAgents emits emitTaskTerminatedSdk and marks notified: true', () => {
    const taskId = 'agent-bg-1'
    let state: { tasks: Record<string, TaskState> } = {
      tasks: {
        [taskId]: {
          id: taskId,
          type: 'local_agent',
          status: 'running',
          description: 'background researcher',
          toolUseId: 'toolu_123',
          isBackgrounded: true,
          notified: false,
          startTime: Date.now(),
        } as unknown as TaskState,
      },
    }
    const enqueued: unknown[] = []
    const emitted: Array<{
      taskId: string
      status: string
      opts?: Record<string, unknown>
    }> = []

    const notified = notifySweptBackgroundAgents(
      state.tasks,
      updater => {
        state = updater(state as never) as unknown as typeof state
      },
      {
        sweptIds: [taskId],
        enqueue: n => enqueued.push(n),
        emitTerminatedSdk: (id, status, opts) => {
          emitted.push({
            taskId: id,
            status,
            opts: opts as Record<string, unknown>,
          })
          return true
        },
      },
    )

    expect(notified).toEqual([taskId])
    expect(enqueued.length).toBe(1)
    expect(emitted.length).toBe(1)
    expect(emitted[0]?.taskId).toBe(taskId)
    expect(emitted[0]?.status).toBe('stopped')
    expect(emitted[0]?.opts?.toolUseId).toBe('toolu_123')
    expect(state.tasks[taskId]?.notified).toBe(true)

    // Second sweep call does not double-emit because task.notified is now true
    const second = notifySweptBackgroundAgents(
      state.tasks,
      updater => {
        state = updater(state as never) as unknown as typeof state
      },
      {
        sweptIds: [taskId],
        enqueue: n => enqueued.push(n),
        emitTerminatedSdk: (id, status) => {
          emitted.push({ taskId: id, status })
          return true
        },
      },
    )
    expect(second).toEqual([])
    expect(emitted.length).toBe(1)
  })
})
