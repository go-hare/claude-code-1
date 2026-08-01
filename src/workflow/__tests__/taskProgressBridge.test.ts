import { afterEach, describe, expect, test } from 'bun:test'
import type { ProgressEvent } from '@claude-code/workflow-engine'
import { createProgressBus } from '../progress/bus.js'
import { createProgressStoreFromBus } from '../progress/store.js'
import {
  installWorkflowTaskProgressBridge,
  mapProgressEventToSdk,
  WORKFLOW_TASK_PROGRESS_FLUSH_MS,
} from '../taskProgressBridge.js'
import type { SdkWorkflowProgress } from '../../types/tools.js'

describe('mapProgressEventToSdk', () => {
  test('run_started seeds phaseIndex from meta.phases (B03)', () => {
    const buf = { phaseIndex: new Map<string, number>(), nextPhaseIndex: 0 }
    expect(
      mapProgressEventToSdk(
        {
          type: 'run_started',
          runId: 'r1',
          workflowName: 'wf',
          meta: {
            name: 'wf',
            description: 'd',
            phases: [{ title: 'Review' }, { title: 'Verify' }],
          },
        },
        buf,
      ),
    ).toBeNull()
    expect(buf.phaseIndex.get('Review')).toBe(0)
    expect(buf.phaseIndex.get('Verify')).toBe(1)
    expect(buf.nextPhaseIndex).toBe(2)
    // later phase_started reuses reserved index
    expect(
      mapProgressEventToSdk(
        { type: 'phase_started', runId: 'r1', phase: 'Verify' },
        buf,
      ),
    ).toMatchObject({ type: 'workflow_phase', index: 1, title: 'Verify' })
  })

  test('maps phase/agent/log and skips lifecycle', () => {
    const buf = { phaseIndex: new Map<string, number>(), nextPhaseIndex: 0 }
    expect(
      mapProgressEventToSdk(
        {
          type: 'run_started',
          runId: 'r1',
          workflowName: 'wf',
          meta: null,
        },
        buf,
      ),
    ).toBeNull()
    expect(
      mapProgressEventToSdk(
        { type: 'phase_started', runId: 'r1', phase: 'Review' },
        buf,
      ),
    ).toMatchObject({
      type: 'workflow_phase',
      index: 0,
      title: 'Review',
      state: 'start',
    })
    expect(
      mapProgressEventToSdk(
        {
          type: 'agent_started',
          runId: 'r1',
          agentId: 1,
          label: 'review:bugs',
          phase: 'Review',
          model: 'sonnet',
          agentType: 'Explore',
          isolation: 'worktree',
          promptPreview: 'find bugs',
        },
        buf,
      ),
    ).toMatchObject({
      type: 'workflow_agent',
      index: 1,
      label: 'review:bugs',
      phaseIndex: 0,
      phaseTitle: 'Review',
      state: 'start',
      model: 'sonnet',
      agentType: 'Explore',
      isolation: 'worktree',
      promptPreview: 'find bugs',
    })
    expect(
      mapProgressEventToSdk(
        {
          type: 'agent_progress',
          runId: 'r1',
          agentId: 1,
          label: 'review:bugs',
          phase: 'Review',
          tokenCount: 12,
          toolCount: 2,
          lastToolName: 'Grep',
        },
        buf,
      ),
    ).toMatchObject({
      type: 'workflow_agent',
      index: 1,
      tokens: 12,
      toolCalls: 2,
      state: 'start',
      lastToolName: 'Grep',
    })
    expect(
      mapProgressEventToSdk(
        {
          type: 'agent_done',
          runId: 'r1',
          agentId: 1,
          label: 'review:bugs',
          phase: 'Review',
          cached: true,
          result: {
            kind: 'ok',
            output: 'all good',
            usage: { outputTokens: 3 },
            tokenCount: 20,
            toolCount: 2,
            model: 'sonnet',
          },
        },
        buf,
      ),
    ).toMatchObject({
      type: 'workflow_agent',
      state: 'done',
      tokens: 20,
      toolCalls: 2,
      model: 'sonnet',
      cached: true,
      resultPreview: 'all good',
    })
    expect(
      mapProgressEventToSdk({ type: 'log', runId: 'r1', message: 'hi' }, buf),
    ).toMatchObject({ type: 'workflow_log', message: 'hi' })
  })
})

describe('installWorkflowTaskProgressBridge', () => {
  const timers: Array<ReturnType<typeof setTimeout>> = []

  afterEach(() => {
    for (const t of timers) clearTimeout(t)
    timers.length = 0
  })

  test('throttles bus events into one task_progress with workflow_progress deltas', async () => {
    const bus = createProgressBus()
    const store = createProgressStoreFromBus(bus)
    const emits: Array<{
      taskId: string
      workflowProgress?: SdkWorkflowProgress[]
      totalTokens: number
      toolUses: number
      description: string
    }> = []
    // AppState task for densable tm8 upsert path
    const { registerLocalWorkflowTask } = await import(
      '../../tasks/LocalWorkflowTask/LocalWorkflowTask.js'
    )
    let appState: { tasks: Record<string, any> } = { tasks: {} }
    const setAppState = (f: (p: typeof appState) => typeof appState) => {
      appState = f(appState)
    }
    const taskId = registerLocalWorkflowTask(setAppState as any, {
      description: 'Dynamic workflow',
      workflowName: 'wf',
      workflowFile: 'wf.js',
      toolUseId: 'tu-1',
    })

    const bridge = installWorkflowTaskProgressBridge({
      bus,
      store,
      flushMs: 5,
      getBinding: runId =>
        runId === 'r1'
          ? {
              taskId,
              toolUseId: 'tu-1',
              description: 'Dynamic workflow',
              summary: 'Dynamic workflow',
              startTime: Date.now() - 1000,
              setAppState: setAppState as any,
            }
          : undefined,
      emit: params => {
        emits.push({
          taskId: params.taskId,
          workflowProgress: params.workflowProgress,
          totalTokens: params.totalTokens,
          toolUses: params.toolUses,
          description: params.description,
        })
      },
    })

    const events: ProgressEvent[] = [
      {
        type: 'run_started',
        runId: 'r1',
        workflowName: 'wf',
        meta: { name: 'wf', description: 'd', phases: [{ title: 'Review' }] },
      },
      { type: 'phase_started', runId: 'r1', phase: 'Review' },
      {
        type: 'agent_started',
        runId: 'r1',
        agentId: 1,
        label: 'a1',
        phase: 'Review',
      },
      {
        type: 'agent_progress',
        runId: 'r1',
        agentId: 1,
        label: 'a1',
        phase: 'Review',
        tokenCount: 5,
        toolCount: 1,
      },
      {
        type: 'agent_progress',
        runId: 'r1',
        agentId: 1,
        label: 'a1',
        phase: 'Review',
        tokenCount: 9,
        toolCount: 2,
      },
      { type: 'log', runId: 'r1', message: 'noise' },
    ]
    for (const e of events) bus.emit(e)

    // Before flush: no emit yet
    expect(emits.length).toBe(0)
    await new Promise<void>(r => {
      const t = setTimeout(r, 20)
      timers.push(t)
    })

    expect(emits.length).toBe(1)
    const frame = emits[0]!
    expect(frame.taskId).toBe(taskId)
    expect(frame.totalTokens).toBe(9)
    expect(frame.toolUses).toBe(2)
    // densable strips workflow_log from jrH payload
    expect(frame.workflowProgress?.some(p => p.type === 'workflow_log')).toBe(
      false,
    )
    expect(frame.workflowProgress?.some(p => p.type === 'workflow_phase')).toBe(
      true,
    )
    expect(
      frame.workflowProgress?.filter(p => p.type === 'workflow_agent').length,
    ).toBeGreaterThanOrEqual(2)
    expect(frame.description).toMatch(/Review:\s*a1|a1/)
    // task state got logs + progress (tm8)
    const task = appState.tasks[taskId]
    expect(task.totalTokens).toBe(9)
    expect(
      task.workflowProgress.some((p: any) => p.type === 'workflow_log'),
    ).toBe(true)
    expect(task.progressVersion).toBeGreaterThan(0)

    bridge.dispose()
  })

  test('forceFlush emits immediately and run_done flushes final batch', async () => {
    const bus = createProgressBus()
    const store = createProgressStoreFromBus(bus)
    const emits: number[] = []
    const bridge = installWorkflowTaskProgressBridge({
      bus,
      store,
      flushMs: 10_000,
      getBinding: () => ({
        taskId: 'w1',
        description: 'wf',
        startTime: Date.now(),
      }),
      emit: () => {
        emits.push(Date.now())
      },
    })

    bus.emit({
      type: 'agent_started',
      runId: 'r2',
      agentId: 0,
      label: 'x',
    })
    expect(emits.length).toBe(0)
    bridge.forceFlush('r2')
    expect(emits.length).toBe(1)

    bus.emit({
      type: 'agent_done',
      runId: 'r2',
      agentId: 0,
      label: 'x',
      result: {
        kind: 'ok',
        output: 'ok',
        usage: { outputTokens: 1 },
        tokenCount: 1,
        toolCount: 0,
      },
    })
    bus.emit({
      type: 'run_done',
      runId: 'r2',
      status: 'completed',
    })
    // run_done force-flushes without waiting for the long timer
    expect(emits.length).toBe(2)

    bridge.dispose()
  })

  test('default flush interval matches densable 16ms constant', () => {
    expect(WORKFLOW_TASK_PROGRESS_FLUSH_MS).toBe(16)
  })
})
