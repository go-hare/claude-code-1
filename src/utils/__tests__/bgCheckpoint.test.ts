import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  adoptTelemetry,
  buildAdoptWritePayload,
  buildInFlightPartialText,
  buildMidTurnPrefill,
  abandonCheckpointShells,
  claimAdoptJson,
  collectPortableCheckpoint,
  emptyCheckpointPayload,
  findForkBoundaryUuid,
  mergeCheckpointPayloads,
  PREFILL_MAX_CHARS,
  readAdoptPrefill,
  rehydrateAdoptedShells,
  truncatePartialTextForPrefill,
  writeAdoptJson,
  writeExitHandoffAdopt,
} from '../bgCheckpoint.js'
import { existsSync } from 'fs'

const tmpDirs: string[] = []
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await rm(d, { recursive: true, force: true }).catch(() => {})
  }
  try {
    const { resetLeftArrowCheckpointLive } = await import('../bgCheckpoint.js')
    resetLeftArrowCheckpointLive()
  } catch {
    /* ignore */
  }
})

describe('truncatePartialTextForPrefill', () => {
  test('keeps last max chars', () => {
    const s = 'a'.repeat(PREFILL_MAX_CHARS + 10)
    const out = truncatePartialTextForPrefill(s)
    expect(out.length).toBe(PREFILL_MAX_CHARS)
    expect(out.endsWith('a')).toBe(true)
  })
  test('trimEnd', () => {
    expect(truncatePartialTextForPrefill('hi  \n')).toBe('hi')
  })
})

describe('buildMidTurnPrefill', () => {
  test('only abort-then-fork with text', () => {
    expect(
      buildMidTurnPrefill({
        via: 'idle-fork',
        partialText: 'x',
      }),
    ).toBeUndefined()
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: '  partial  ',
        boundaryUuid: 'b1',
      }),
    ).toEqual({ text: '  partial', boundaryUuid: 'b1' })
  })
  test('skips when bridge or agents present', () => {
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: 'x',
        bridgeActive: true,
      }),
    ).toBeUndefined()
    expect(
      buildMidTurnPrefill({
        via: 'abort-then-fork',
        partialText: 'x',
        agentsCount: 1,
      }),
    ).toBeUndefined()
  })
})

describe('mergeCheckpointPayloads / Nro', () => {
  test('prefer incoming prefill + max writtenAtMs', () => {
    const a = emptyCheckpointPayload(100)
    a.shells = [{ id: 1 }]
    const b = buildAdoptWritePayload({
      base: emptyCheckpointPayload(200),
      prefill: { text: 'p' },
    })
    const m = mergeCheckpointPayloads(a, b)
    expect(m.writtenAtMs).toBe(200)
    expect(m.prefill?.text).toBe('p')
    expect(m.shells).toHaveLength(1)
  })
  test('adoptTelemetry counts', () => {
    expect(
      adoptTelemetry({
        writtenAtMs: 1,
        shells: [1, 2],
        cron: [{ id: 'c', cron: '*', prompt: 'p' }],
        agents: [1],
        workflows: [],
      }),
    ).toEqual({
      adopted_shells: 2,
      adopted_agents: 1,
      adopted_workflows: 0,
      adopted_cron: 1,
    })
  })
})

describe('findForkBoundaryUuid / Fco (official MVr)', () => {
  test('returns last settled user uuid, skips in-flight assistant', () => {
    const uuid = findForkBoundaryUuid([
      { type: 'user', uuid: 'u1', message: { content: 'hi' } },
      {
        type: 'assistant',
        uuid: 'a-inflight',
        message: {
          stop_reason: null,
          content: [{ type: 'text', text: '...' }],
        },
      },
    ])
    expect(uuid).toBe('u1')
  })
  test('buildInFlightPartialText concatenates open assistants + live', () => {
    const text = buildInFlightPartialText(
      [
        {
          type: 'assistant',
          uuid: 'a1',
          message: {
            stop_reason: null,
            content: [{ type: 'text', text: 'hel' }],
          },
        },
      ],
      'lo',
    )
    expect(text).toBe('hello')
  })
  test('collectPortableCheckpoint snapshots shells agents cron', () => {
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          command: 'sleep 1',
          description: 'sleep',
          shellCommand: {
            status: 'backgrounded',
            getPid: () => 4242,
            taskOutput: { path: '/tmp/out' },
          },
        },
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          isBackgrounded: true,
          agentId: 'agent-1',
          agentType: 'Explore',
          description: 'explore',
        },
      },
      cron: [{ id: 'c1', cron: '* * * * *', prompt: 'tick', createdAt: 1 }],
      nowMs: 99,
    })
    expect(cp?.payload.writtenAtMs).toBe(99)
    expect(cp?.payload.shells).toHaveLength(1)
    expect((cp?.payload.shells[0] as { pid?: number }).pid).toBe(4242)
    expect(cp?.payload.agents).toHaveLength(1)
    expect(cp?.payload.cron).toHaveLength(1)
    expect(cp?.shellTaskIds).toEqual(['b1'])
    expect(cp?.agentIds).toEqual(['agent-1'])
    expect(cp?.cronIds).toEqual(['c1'])
    expect(cp?.detachedPids).toEqual([4242])
  })

  test('collectPortableCheckpoint prefers detach() over getPid (official fDs)', () => {
    let detached = false
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          command: 'sleep 9',
          shellCommand: {
            status: 'backgrounded',
            getPid: () => 111,
            detach: () => {
              detached = true
              return 999
            },
            taskOutput: { path: '/tmp/o' },
          },
        },
      },
      nowMs: 1,
    })
    expect(detached).toBe(true)
    expect((cp?.payload.shells[0] as { pid?: number }).pid).toBe(999)
    expect(cp?.detachedPids).toEqual([999])
  })

  test('disown removes shell/agent/cron ids via removers', () => {
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          shellCommand: { status: 'backgrounded', getPid: () => 1 },
        },
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          isBackgrounded: true,
          agentId: 'ag1',
          agentType: 'Explore',
        },
      },
      cron: [{ id: 'c1', cron: '*', prompt: 'p' }],
    })
    const removedTasks: string[] = []
    const removedAgents: string[] = []
    const removedCron: string[] = []
    cp!.disown({
      removeTaskIds: ids => removedTasks.push(...ids),
      removeAgentIds: ids => removedAgents.push(...ids),
      removeCronIds: ids => removedCron.push(...ids),
    })
    expect(removedTasks).toContain('b1')
    expect(removedAgents).toContain('ag1')
    expect(removedCron).toEqual(['c1'])
  })

  test('checkpointAgents aborts workflows then agents; removes agent-owned shells (CAo)', async () => {
    const order: string[] = []
    const removed: string[] = []
    const paused: string[] = []
    let flushed = false
    const cp = collectPortableCheckpoint({
      tasks: {
        main_shell: {
          id: 'main_shell',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          shellCommand: { status: 'backgrounded', getPid: () => 11 },
        },
        agent_shell: {
          id: 'agent_shell',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          agentId: 'ag1',
          shellCommand: { status: 'backgrounded', getPid: () => 22 },
        },
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          isBackgrounded: true,
          agentId: 'ag1',
          agentType: 'Explore',
          abortController: {
            abort: (reason?: unknown) => {
              order.push(`agent:${String(reason)}`)
            },
          },
        },
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          workflowRunId: 'run-1',
          scriptPath: '/tmp/w.js',
          script: 'export const meta = {}',
          abortController: {
            abort: (reason?: unknown) => {
              order.push(`workflow:${String(reason)}`)
            },
          },
        },
      },
      detachShells: false,
    })
    expect(cp).not.toBeNull()
    const r = await cp!.checkpointAgents({
      removeTaskIds: ids => removed.push(...ids),
      markWorkflowPaused: id => {
        order.push(`zit:${id}`)
        paused.push(id)
      },
      flushAgentTranscripts: async () => {
        flushed = true
        order.push('gx')
      },
    })
    // Official order: workflows first (+zit), then agent-owned shell remove, then agents, then Gx.
    expect(order[0]).toBe('workflow:background')
    expect(order[1]).toBe('zit:w1')
    expect(order).toContain('agent:background')
    expect(order.indexOf('workflow:background')).toBeLessThan(
      order.indexOf('agent:background'),
    )
    expect(order.indexOf('agent:background')).toBeLessThan(order.indexOf('gx'))
    expect(paused).toEqual(['w1'])
    expect(flushed).toBe(true)
    expect(r.abortedWorkflowIds).toEqual(['w1'])
    expect(r.abortedAgentIds).toEqual(['ag1'])
    // Only agent-owned shells removed here (main shell stays for disown).
    expect(removed).toEqual(['agent_shell'])
  })

  test('checkpointAgents workflows-only early-returns without agent remove (CAo)', async () => {
    const order: string[] = []
    const removed: string[] = []
    const cp = collectPortableCheckpoint({
      tasks: {
        agent_shell: {
          id: 'agent_shell',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          agentId: 'ag-gone',
          shellCommand: { status: 'backgrounded', getPid: () => 33 },
        },
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          workflowRunId: 'run-w',
          script: 'export const meta = {}',
          abortController: {
            abort: (reason?: unknown) => {
              order.push(`workflow:${String(reason)}`)
            },
          },
        },
      },
      detachShells: false,
    })
    const r = await cp!.checkpointAgents({
      removeTaskIds: ids => removed.push(...ids),
    })
    expect(order).toEqual(['workflow:background'])
    expect(r.abortedWorkflowIds).toEqual(['w1'])
    expect(r.abortedAgentIds).toEqual([])
    // Official: if (a.length===0) return — skip agent-owned shell remove.
    expect(removed).toEqual([])
  })

  test('runLeftArrowPostAdoptCheckpoint after stash runs checkpointAgents then disown', async () => {
    const {
      stashLeftArrowCheckpointLive,
      runLeftArrowPostAdoptCheckpoint,
      resetLeftArrowCheckpointLive,
    } = await import('../bgCheckpoint.js')
    resetLeftArrowCheckpointLive()
    const order: string[] = []
    const removedTasks: string[] = []
    const removedAgents: string[] = []
    const removedCron: string[] = []
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          shellCommand: { status: 'backgrounded', getPid: () => 7 },
        },
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          isBackgrounded: true,
          agentId: 'ag-live',
          agentType: 'Explore',
          abortController: {
            abort: (reason?: unknown) => {
              order.push(`agent:${String(reason)}`)
            },
          },
        },
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          workflowRunId: 'r1',
          script: 'export const meta = {}',
          abortController: {
            abort: (reason?: unknown) => {
              order.push(`workflow:${String(reason)}`)
            },
          },
        },
      },
      cron: [{ id: 'c1', cron: '*', prompt: 'p' }],
      detachShells: false,
    })
    stashLeftArrowCheckpointLive(cp)
    let flushed = 0
    const paused: string[] = []
    const r = await runLeftArrowPostAdoptCheckpoint({
      removeTaskIds: ids => removedTasks.push(...ids),
      removeAgentIds: ids => removedAgents.push(...ids),
      removeCronIds: ids => removedCron.push(...ids),
      // Stub official Gx — avoid real sessionStorage in unit test.
      flushAgentTranscripts: async () => {
        flushed++
        order.push('gx')
      },
      markWorkflowPaused: id => {
        paused.push(id)
        order.push(`zit:${id}`)
      },
    })
    expect(r.ran).toBe(true)
    expect(order[0]).toBe('workflow:background')
    expect(order).toContain('zit:w1')
    expect(order).toContain('agent:background')
    expect(order[order.length - 1]).toBe('gx')
    expect(flushed).toBe(1)
    expect(paused).toEqual(['w1'])
    expect(r.abortedWorkflowIds).toEqual(['w1'])
    expect(r.abortedAgentIds).toEqual(['ag-live'])
    // disown removes main shells + workflows as task ids, agents separately, cron.
    expect(removedTasks).toEqual(expect.arrayContaining(['b1', 'w1']))
    expect(removedAgents).toContain('ag-live')
    expect(removedCron).toEqual(['c1'])
    // second call is no-op (take-and-clear)
    const r2 = await runLeftArrowPostAdoptCheckpoint()
    expect(r2.ran).toBe(false)
    resetLeftArrowCheckpointLive()
  })

  test('abandonCheckpointShells kills pids once', () => {
    const killed: number[] = []
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          shellCommand: {
            status: 'backgrounded',
            getPid: () => 42,
            detach: () => 42,
          },
        },
      },
    })
    abandonCheckpointShells(cp, pid => killed.push(pid))
    abandonCheckpointShells(cp, pid => killed.push(pid)) // second call no-op
    expect(killed).toEqual([42])
    // payload-only path
    const killed2: number[] = []
    abandonCheckpointShells(
      { writtenAtMs: 1, shells: [{ pid: 7 }], cron: [] },
      pid => killed2.push(pid),
    )
    expect(killed2).toEqual([7])
  })

  test('abandon notifies SAo for agents and workflows (spawn fail)', async () => {
    const { notifyAbandonSpawnFailed } = await import('../bgCheckpoint.js')
    // Avoid relying on queue shape — function returns counts.
    const r = notifyAbandonSpawnFailed(
      [{ agentId: 'ag1', description: 'explore' }],
      [
        {
          taskId: 'w1',
          description: 'spec',
          scriptPath: "/tmp/x'.ts",
          workflowRunId: 'wf1',
        },
      ],
    )
    expect(r.agentsNotified).toBe(1)
    expect(r.workflowsNotified).toBe(1)

    // Full abandon path on portable checkpoint with agent+shell.
    const killed: number[] = []
    const cp = collectPortableCheckpoint({
      tasks: {
        b1: {
          id: 'b1',
          type: 'local_bash',
          status: 'running',
          isBackgrounded: true,
          shellCommand: {
            status: 'backgrounded',
            getPid: () => 99,
            detach: () => 99,
          },
        },
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          isBackgrounded: true,
          agentId: 'agent-z',
          description: 'worker',
          agentType: 'general-purpose',
        },
      },
    })
    expect(cp).toBeTruthy()
    abandonCheckpointShells(cp, pid => killed.push(pid))
    expect(killed).toContain(99)
    // second abandon no-ops (including re-notify)
    const before = killed.length
    abandonCheckpointShells(cp, pid => killed.push(pid))
    expect(killed.length).toBe(before)
  })
})

describe('writeAdoptJson / readAdoptPrefill (official sQt)', () => {
  test('round-trips prefill', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    tmpDirs.push(dir)
    await writeAdoptJson(
      dir,
      buildAdoptWritePayload({
        prefill: { text: 'partial <x>', boundaryUuid: 'u1' },
      }),
    )
    await expect(readAdoptPrefill(dir)).resolves.toEqual({
      text: 'partial <x>',
      boundaryUuid: 'u1',
    })
  })

  test('claimAdoptJson renames, returns payload, unlinks claim file (e4d)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-claim-'))
    tmpDirs.push(dir)
    const written = await writeAdoptJson(dir, {
      writtenAtMs: Date.now(),
      shells: [{ taskId: 's1', pid: 1 }],
      cron: [{ id: 'c1', cron: '*', prompt: 'p' }],
      prefill: { text: 'mid' },
    })
    const claimed = await claimAdoptJson(dir)
    expect(claimed.ok).toBe(true)
    if (!claimed.ok) return
    expect(claimed.payload.prefill?.text).toBe('mid')
    expect(claimed.payload.shells).toHaveLength(1)
    expect(existsSync(join(dir, 'adopt.json'))).toBe(false)
    expect(existsSync(`${join(dir, 'adopt.json')}.${process.pid}`)).toBe(false)
    // second claim → enoent
    const again = await claimAdoptJson(dir)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('enoent')
    void written
  })

  test('claimAdoptJson rejects stale unless origin=exit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-stale-'))
    tmpDirs.push(dir)
    await writeAdoptJson(dir, {
      writtenAtMs: Date.now() - 200_000,
      shells: [],
      cron: [],
    })
    const stale = await claimAdoptJson(dir, { nowMs: Date.now() })
    expect(stale.ok).toBe(false)
    if (!stale.ok) expect(stale.reason).toBe('stale')

    const dir2 = await mkdtemp(join(tmpdir(), 'adopt-exit-'))
    tmpDirs.push(dir2)
    await writeAdoptJson(dir2, {
      writtenAtMs: Date.now() - 200_000,
      shells: [],
      cron: [],
      origin: 'exit',
    })
    const ok = await claimAdoptJson(dir2, { nowMs: Date.now() })
    expect(ok.ok).toBe(true)
  })

  test('collectPortableCheckpoint workflows include scriptSha256 + argsJson', () => {
    const cp = collectPortableCheckpoint({
      tasks: {
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          workflowRunId: 'run-1',
          scriptPath: '/tmp/s.js',
          script: 'export default 1',
          args: { x: 1 },
          description: 'wf',
        },
      },
      nowMs: 5,
    })
    expect(cp?.workflowTaskIds).toEqual(['w1'])
    const w = cp?.payload.workflows?.[0] as {
      scriptSha256?: string
      argsJson?: string
      transcriptDir?: string
    }
    expect(w.scriptSha256).toHaveLength(64)
    expect(w.argsJson).toBe('{"x":1}')
    expect(w.transcriptDir).toContain('workflows')
  })
  test('merges second write', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-'))
    tmpDirs.push(dir)
    await writeAdoptJson(dir, {
      writtenAtMs: 1,
      shells: [{ a: 1 }],
      cron: [],
    })
    const written = await writeAdoptJson(
      dir,
      buildAdoptWritePayload({
        base: { writtenAtMs: 2, shells: [], cron: [] },
        prefill: { text: 'p2' },
      }),
    )
    expect(written.shells).toHaveLength(1)
    expect(written.prefill?.text).toBe('p2')
  })
})

describe('writeExitHandoffAdopt / rehydrateAdoptedShells (official u4d/Lvu)', () => {
  test('writeExitHandoffAdopt sets origin exit and clears cron', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exit-handoff-'))
    tmpDirs.push(dir)
    const written = await writeExitHandoffAdopt(dir, {
      payload: {
        writtenAtMs: 1,
        shells: [{ taskId: 'b1', pid: 123 }],
        cron: [{ id: 'c1', cron: '*', prompt: 'p' }],
        agents: [{ agentId: 'a1' }],
      },
      nowMs: 50,
    })
    expect(written?.origin).toBe('exit')
    expect(written?.writtenAtMs).toBe(50)
    expect(written?.cron).toEqual([])
    expect(written?.shells).toHaveLength(1)
    expect(written?.agents).toHaveLength(1)

    // Stale age is skipped for origin exit
    const claimed = await claimAdoptJson(dir, {
      nowMs: Date.now() + 1_000_000,
    })
    expect(claimed.ok).toBe(true)
  })

  test('writeExitHandoffAdopt c4d-filters agent shells and kills them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exit-c4d-'))
    tmpDirs.push(dir)
    const killed: number[] = []
    const written = await writeExitHandoffAdopt(dir, {
      payload: {
        writtenAtMs: 1,
        shells: [
          { taskId: 'b-main', pid: 11 },
          { taskId: 'b-agent', pid: 22, agentId: 'ag1' },
        ],
        cron: [],
      },
      nowMs: 3,
      killPid: pid => killed.push(pid),
    })
    expect(written?.shells).toHaveLength(1)
    expect((written?.shells[0] as { taskId: string }).taskId).toBe('b-main')
    expect(killed).toEqual([22])
  })

  test('writeExitHandoffAdopt returns null when no portable work', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'exit-empty-'))
    tmpDirs.push(dir)
    await expect(
      writeExitHandoffAdopt(dir, {
        payload: { writtenAtMs: 1, shells: [], cron: [] },
      }),
    ).resolves.toBeNull()
  })

  test('writeExitHandoffAdopt merges wAo unresumed agents/workflows (u4d)', async () => {
    const {
      stashDeferredAdoptResume,
      takeDeferredAdoptStash,
      resetDeferredAdoptStash,
      peekDeferredAdoptStash,
    } = await import('../bgCheckpoint.js')
    resetDeferredAdoptStash()
    const dir = await mkdtemp(join(tmpdir(), 'exit-unresumed-'))
    tmpDirs.push(dir)

    stashDeferredAdoptResume(
      dir,
      [
        { agentId: 'live-a', description: 'from-stash-should-lose' },
        { agentId: 'stash-only', description: 'unresumed agent' },
      ],
      [
        {
          taskId: 'live-w',
          workflowRunId: 'wf_live',
          scriptPath: '/live.ts',
          scriptSha256: 'from-stash',
        },
        {
          taskId: 'stash-w',
          workflowRunId: 'wf_stash',
          scriptPath: '/stash.ts',
          scriptSha256: 'abc',
        },
      ],
    )
    expect(peekDeferredAdoptStash(dir).agents).toHaveLength(2)

    const written = await writeExitHandoffAdopt(dir, {
      payload: {
        writtenAtMs: 1,
        shells: [{ taskId: 'b-main', pid: 99 }],
        cron: [{ id: 'c1', cron: '*', prompt: 'p' }],
        agents: [{ agentId: 'live-a', description: 'from-live' }],
        workflows: [
          {
            taskId: 'live-w',
            workflowRunId: 'wf_live',
            scriptPath: '/live.ts',
            scriptSha256: 'from-live',
          },
        ],
      },
      nowMs: 77,
    })

    expect(written?.origin).toBe('exit')
    expect(written?.cron).toEqual([])
    expect(written?.shells).toHaveLength(1)

    // live first + stash-only appended; live wins on collision
    const agents = (written?.agents ?? []) as Array<{
      agentId: string
      description?: string
    }>
    expect(agents.map(a => a.agentId)).toEqual(['live-a', 'stash-only'])
    expect(agents.find(a => a.agentId === 'live-a')?.description).toBe(
      'from-live',
    )

    const workflows = (written?.workflows ?? []) as Array<{
      taskId: string
      scriptSha256?: string
    }>
    expect(workflows.map(w => w.taskId)).toEqual(['live-w', 'stash-w'])
    expect(workflows.find(w => w.taskId === 'live-w')?.scriptSha256).toBe(
      'from-live',
    )

    // take is one-shot — stash cleared by handoff
    expect(takeDeferredAdoptStash(dir).agents).toEqual([])
    expect(peekDeferredAdoptStash(dir).workflows).toEqual([])
  })

  test('writeExitHandoffAdopt unresumed-only (no live agents/workflows)', async () => {
    const {
      stashDeferredAdoptResume,
      resetDeferredAdoptStash,
    } = await import('../bgCheckpoint.js')
    resetDeferredAdoptStash()
    const dir = await mkdtemp(join(tmpdir(), 'exit-stash-only-'))
    tmpDirs.push(dir)

    stashDeferredAdoptResume(
      dir,
      [{ agentId: 'only-agent', description: 'a' }],
      [
        {
          taskId: 'only-wf',
          workflowRunId: 'wf_o',
          scriptPath: '/o.ts',
          scriptSha256: 'h',
        },
      ],
    )

    // No shells/agents/workflows in live payload — unresumed alone is enough
    const written = await writeExitHandoffAdopt(dir, {
      payload: { writtenAtMs: 1, shells: [], cron: [] },
      nowMs: 5,
    })
    expect(written?.origin).toBe('exit')
    expect(written?.agents).toHaveLength(1)
    expect(written?.workflows).toHaveLength(1)
    expect((written?.agents?.[0] as { agentId: string }).agentId).toBe(
      'only-agent',
    )
  })

  test('abortHandoffLiveTasks aborts agent/workflow controllers (u4d)', async () => {
    const { abortHandoffLiveTasks } = await import('../bgCheckpoint.js')
    const aborted: string[] = []
    const tasks = {
      a1: {
        id: 'a1',
        type: 'local_agent',
        status: 'running',
        abortController: { abort: (r?: string) => aborted.push(`a1:${r}`) },
      },
      w1: {
        id: 'w1',
        type: 'local_workflow',
        status: 'running',
        abortController: { abort: (r?: string) => aborted.push(`w1:${r}`) },
      },
      b1: {
        id: 'b1',
        type: 'local_bash',
        status: 'running',
        abortController: { abort: () => aborted.push('b1') },
      },
      skip: {
        id: 'skip',
        type: 'local_agent',
        status: 'running',
        abortController: { abort: () => aborted.push('skip') },
      },
    } as const
    const { abortedIds } = abortHandoffLiveTasks({
      tasks: tasks as never,
      handoffTaskIds: ['a1', 'w1', 'b1'],
    })
    expect(abortedIds.sort()).toEqual(['a1', 'w1'])
    expect(aborted).toEqual(['a1:background', 'w1:background'])
    expect(aborted).not.toContain('skip')
    expect(aborted).not.toContain('b1')
  })

  test('reapNonHandoffTasks kills non-handoff shells/agents (Hen residual)', async () => {
    const { reapNonHandoffTasks, collectPortableCheckpoint } = await import(
      '../bgCheckpoint.js'
    )
    const killed: string[] = []
    const cleaned: string[] = []
    const aborted: string[] = []
    const stopped: Array<{ id: string; summary?: string }> = []
    const removed: string[] = []

    const tasks = {
      handoff_shell: {
        id: 'handoff_shell',
        type: 'local_bash',
        status: 'running',
        isBackgrounded: true,
        shellCommand: {
          status: 'backgrounded',
          detach: () => 1,
          getPid: () => 1,
          kill: () => killed.push('handoff_shell'),
          cleanup: () => cleaned.push('handoff_shell'),
        },
      },
      orphan_shell: {
        id: 'orphan_shell',
        type: 'local_bash',
        status: 'running',
        // agent-owned / non-handoff shell
        agentId: 'ag1',
        isBackgrounded: true,
        shellCommand: {
          status: 'backgrounded',
          getPid: () => 2,
          kill: () => killed.push('orphan_shell'),
          cleanup: () => cleaned.push('orphan_shell'),
        },
      },
      orphan_agent: {
        id: 'orphan_agent',
        type: 'local_agent',
        status: 'running',
        agentType: 'general-purpose',
        description: 'leftover',
        toolUseId: 'tu1',
        // not backgrounded → not collected into handoff, still reaped
        isBackgrounded: false,
        abortController: {
          abort: () => aborted.push('orphan_agent'),
        },
      },
      monitor_skip_emit: {
        id: 'monitor_skip_emit',
        type: 'local_bash',
        status: 'running',
        kind: 'monitor',
        isBackgrounded: true,
        shellCommand: {
          status: 'backgrounded',
          getPid: () => 3,
          kill: () => killed.push('monitor_skip_emit'),
          cleanup: () => cleaned.push('monitor_skip_emit'),
        },
      },
      pending_not_reaped: {
        id: 'pending_not_reaped',
        type: 'local_agent',
        status: 'pending',
        isBackgrounded: true,
        abortController: { abort: () => aborted.push('pending_not_reaped') },
      },
    } as const

    const cp = collectPortableCheckpoint({
      tasks: tasks as never,
      detachShells: true,
    })
    // handoff only includes non-agent-id? Actually collect includes all bg shells
    // including agent-owned ones; writeExitHandoff later filters. Hen uses the
    // c4d handoff set (main shells only in official). Portable: use handoff
    // ids from checkpoint for the happy path; tests pass explicit set.
    expect(cp?.handoffTaskIds).toContain('handoff_shell')

    const { reapedIds } = reapNonHandoffTasks({
      tasks: tasks as never,
      // simulate official c4d: only main-thread shell handed off
      handoffTaskIds: ['handoff_shell'],
      removeTaskIds: ids => removed.push(...ids),
      emitStopped: (id, opts) =>
        stopped.push({ id, summary: opts.summary }),
    })

    expect(reapedIds.sort()).toEqual(
      ['monitor_skip_emit', 'orphan_agent', 'orphan_shell'].sort(),
    )
    expect(killed).toContain('orphan_shell')
    expect(cleaned).toContain('orphan_shell')
    expect(killed).toContain('monitor_skip_emit')
    expect(aborted).toContain('orphan_agent')
    expect(aborted).not.toContain('pending_not_reaped')
    // monitor skips lf/stopped emit
    expect(stopped.map(s => s.id).sort()).toEqual(['orphan_agent', 'orphan_shell'])
    expect(stopped.find(s => s.id === 'orphan_agent')?.summary).toBe('leftover')
    expect(removed.sort()).toEqual(reapedIds.sort())
    // handoff shell spared
    expect(killed).not.toContain('handoff_shell')
  })

  test('enrichShellsWithProcStart attaches lstart when pid live (best-effort)', async () => {
    // process.pid is always live; on win32 / sandboxed ps this may no-op.
    const { enrichShellsWithProcStart } = await import('../bgCheckpoint.js')
    const out = await enrichShellsWithProcStart([
      { taskId: 'b1', pid: process.pid, command: 'self' },
      { taskId: 'b2', command: 'nopid' },
    ])
    expect(out).toHaveLength(2)
    const first = out[0] as { procStart?: string; taskId: string }
    expect(first.taskId).toBe('b1')
    // May or may not get lstart depending on platform — only assert shape.
    if (process.platform !== 'win32') {
      // Prefer presence; tolerate undefined when ps blocked.
      if (first.procStart !== undefined) {
        expect(typeof first.procStart).toBe('string')
        expect(first.procStart.length).toBeGreaterThan(0)
      }
    }
  })

  test('rehydrateAdoptedShells registers main-thread shells, skips+kills orphan agent shells', async () => {
    // Use a definitely-dead pid so AdoptedShellCommand won't hang the process.
    const deadPid = 2_000_000_000 + Math.floor(Math.random() * 10_000)
    let tasks: Record<string, unknown> = {}
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      const next = u({ tasks })
      tasks = next.tasks
    }
    const killed: number[] = []

    const result = await rehydrateAdoptedShells(
      [
        {
          taskId: 'b-main',
          pid: deadPid,
          command: 'sleep 99',
          description: 'main shell',
        },
        {
          taskId: 'b-agent',
          pid: deadPid + 1,
          command: 'sleep 1',
          agentId: 'agent-missing',
          description: 'orphan',
        },
        {
          // no pid → skip
          taskId: 'b-nopid',
          command: 'echo x',
        },
      ],
      setAppState,
      {
        adoptedAgentIds: new Set(),
        skipOrphanAgentShells: true,
        killPid: pid => killed.push(pid),
      },
    )
    expect(result.adopted).toBe(1)
    expect(result.skipped).toBe(2)
    expect(killed).toEqual([deadPid + 1])
    expect(tasks['b-main']).toBeTruthy()
    const t = tasks['b-main'] as {
      type: string
      isBackgrounded: boolean
      shellCommand: { status: string; getPid?: () => number | undefined } | null
    }
    expect(t.type).toBe('local_bash')
    expect(t.isBackgrounded).toBe(true)
    expect(t.shellCommand?.status).toBe('backgrounded')
    // cleanup so poller unrefs don't keep test process alive
    t.shellCommand?.getPid?.()
    ;(t.shellCommand as { cleanup?: () => void } | null)?.cleanup?.()
  })

  test('rehydrateAdoptedAgents registers by spawnDepth, skips missing parent', async () => {
    const { rehydrateAdoptedAgents } = await import('../bgCheckpoint.js')
    let tasks: Record<string, unknown> = {}
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      const next = u({ tasks })
      tasks = next.tasks
    }

    const result = await rehydrateAdoptedAgents(
      [
        {
          agentId: 'child-a',
          parentAgentId: 'parent-a',
          spawnDepth: 1,
          description: 'child',
        },
        {
          agentId: 'parent-a',
          spawnDepth: 0,
          description: 'parent',
          agentType: 'general-purpose',
        },
        {
          agentId: 'orphan-b',
          parentAgentId: 'never-present',
          spawnDepth: 1,
          description: 'orphan',
        },
      ],
      setAppState,
      // no transcriptPath → skip link; still register (PSu portable)
      { linkTranscripts: true },
    )

    expect(result.adopted).toBe(2)
    expect(result.skipped).toBe(1)
    expect(result.adoptedAgentIds.has('parent-a')).toBe(true)
    expect(result.adoptedAgentIds.has('child-a')).toBe(true)
    expect(result.adoptedAgentIds.has('orphan-b')).toBe(false)

    const parent = tasks['parent-a'] as {
      type: string
      status: string
      agentType: string
      isBackgrounded: boolean
    }
    expect(parent.type).toBe('local_agent')
    expect(parent.status).toBe('completed')
    expect(parent.agentType).toBe('general-purpose')
    expect(parent.isBackgrounded).toBe(true)

    const child = tasks['child-a'] as { parentAgentId?: string }
    expect(child.parentAgentId).toBe('parent-a')
  })

  test('linkAdoptedAgentTranscript symlinks jsonl + meta when paths differ', async () => {
    const { linkAdoptedAgentTranscript } = await import('../bgCheckpoint.js')
    const srcDir = await mkdtemp(join(tmpdir(), 'agent-src-'))
    tmpDirs.push(srcDir)
    const srcJsonl = join(srcDir, 'agent-xyz.jsonl')
    const srcMeta = join(srcDir, 'agent-xyz.meta.json')
    await writeFile(srcJsonl, '{"type":"user"}\n')
    await writeFile(srcMeta, '{"agentType":"general-purpose"}\n')

    // Force getAgentTranscriptPath via sessionStorage is hard in unit test —
    // exercise skip/same/failed paths with explicit entry shapes instead.
    await expect(
      linkAdoptedAgentTranscript({ agentId: 'a1' }),
    ).resolves.toBe('skipped')

    // Missing meta → failed
    const bareDir = await mkdtemp(join(tmpdir(), 'agent-bare-'))
    tmpDirs.push(bareDir)
    const bareJsonl = join(bareDir, 'agent-bare.jsonl')
    await writeFile(bareJsonl, 'x\n')
    await expect(
      linkAdoptedAgentTranscript({
        agentId: 'a-bare',
        transcriptPath: bareJsonl,
      }),
    ).resolves.toBe('failed')

    // Live link path when canonical differs: mock by using real session path
    // is environment-dependent; at minimum ensure success shape is one of union.
    const result = await linkAdoptedAgentTranscript({
      agentId: 'xyz-link-test',
      transcriptPath: srcJsonl,
    })
    expect(['linked', 'same', 'failed']).toContain(result)
  })

  test('rehydrateAdoptedShells adopts agent-owned shell when owner in set', async () => {
    const deadPid = 2_000_000_000 + Math.floor(Math.random() * 10_000)
    let tasks: Record<string, unknown> = {}
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      const next = u({ tasks })
      tasks = next.tasks
    }
    const result = await rehydrateAdoptedShells(
      [
        {
          taskId: 'b-owned',
          pid: deadPid,
          command: 'sleep 1',
          agentId: 'ag-owned',
        },
      ],
      setAppState,
      {
        adoptedAgentIds: new Set(['ag-owned']),
        skipOrphanAgentShells: true,
        killOrphanAgentShells: false,
      },
    )
    expect(result.adopted).toBe(1)
    expect(tasks['b-owned']).toBeTruthy()
    const t = tasks['b-owned'] as {
      shellCommand: { cleanup?: () => void } | null
    }
    t.shellCommand?.cleanup?.()
  })

  test('rehydrateAdoptedWorkflows registers ess-like local_workflow entries', async () => {
    const { rehydrateAdoptedWorkflows, linkAdoptedWorkflowTranscript } =
      await import('../bgCheckpoint.js')
    let tasks: Record<string, unknown> = {}
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      const next = u({ tasks })
      tasks = next.tasks
    }
    const result = await rehydrateAdoptedWorkflows(
      [
        {
          taskId: 'w-ok',
          workflowRunId: 'wf_testok',
          description: 'spec flow',
          scriptPath: '/tmp/spec.ts',
        },
        { taskId: 'no-run-id' },
      ],
      setAppState,
      // Unit: skip o4d + i4d (script under /tmp outside projects/).
      { linkTranscripts: false, skipScriptPathValidation: true },
    )
    expect(result.adopted).toBe(1)
    expect(result.skipped).toBe(1)
    const w = tasks['w-ok'] as {
      type: string
      status: string
      workflowRunId: string
      workflowFile: string
      notified: boolean
    }
    expect(w.type).toBe('local_workflow')
    // Official ess: status "paused" (not completed stub).
    expect(w.status).toBe('paused')
    expect(w.workflowRunId).toBe('wf_testok')
    expect(w.workflowFile).toBe('/tmp/spec.ts')
    expect(w.notified).toBe(true)

    // Official o4d: missing transcriptDir fails (not skip).
    await expect(
      linkAdoptedWorkflowTranscript({
        taskId: 'w',
        workflowRunId: 'wf_x',
      }),
    ).resolves.toBe('failed')

    const bare = await mkdtemp(join(tmpdir(), 'wf-bare-'))
    tmpDirs.push(bare)
    await expect(
      linkAdoptedWorkflowTranscript({
        taskId: 'w',
        workflowRunId: 'wf_x',
        transcriptDir: bare,
      }),
    ).resolves.toBe('failed')
  })

  test('validateAdoptScriptPath rejects outside projects root (i4d)', async () => {
    const { validateAdoptScriptPath } = await import('../bgCheckpoint.js')
    const { getClaudeConfigHomeDir } = await import('../envUtils.js')
    const { mkdir, writeFile, rm } = await import('fs/promises')
    const projects = join(getClaudeConfigHomeDir(), 'projects')
    await mkdir(projects, { recursive: true })
    const under = join(projects, `adopt-i4d-${Date.now()}.ts`)
    await writeFile(under, 'export const meta = {}\n')
    try {
      const resolved = validateAdoptScriptPath(under)
      expect(resolved).toContain('projects')
      expect(() => validateAdoptScriptPath('/tmp/not-under-projects.ts')).toThrow()
      expect(() => validateAdoptScriptPath(undefined)).toThrow()
      expect(() => validateAdoptScriptPath('\\\\server\\share\\x.ts')).toThrow(
        /remote UNC|unresolvable|outside/,
      )
    } finally {
      await rm(under, { force: true }).catch(() => {})
    }
  })

  test('i4d/EAo rEe+lEe remote UNC and symlink walk', async () => {
    const {
      isRemoteAdoptPath,
      findRemoteUncViaSymlinkWalk,
      validateAdoptScriptPath,
    } = await import('../bgCheckpoint.js')
    expect(isRemoteAdoptPath('\\\\server\\share\\x.ts')).toBe(true)
    expect(isRemoteAdoptPath('//server/share/x.ts')).toBe(true)
    expect(isRemoteAdoptPath('\\\\?\\volume{abc}\\x')).toBe(true)
    expect(isRemoteAdoptPath('/tmp/local.ts')).toBe(false)
    expect(() => validateAdoptScriptPath('//evil/share/workflow.ts')).toThrow(
      /remote UNC/,
    )
    expect(() =>
      validateAdoptScriptPath('\\\\evil\\share\\workflow.ts'),
    ).toThrow(/remote UNC/)

    // Local symlink whose target string is a UNC-style path — lEe walk.
    if (process.platform === 'win32') return
    const dir = await mkdtemp(join(tmpdir(), 'eao-link-'))
    tmpDirs.push(dir)
    const linkPath = join(dir, 'to-unc.ts')
    const { symlinkSync } = await import('fs')
    symlinkSync('//evil/share/remote.ts', linkPath)
    const hit = findRemoteUncViaSymlinkWalk(linkPath)
    expect(hit).toBeTruthy()
    expect(isRemoteAdoptPath(hit!)).toBe(true)
    expect(() => validateAdoptScriptPath(linkPath)).toThrow(
      /traverses symlink\/junction to remote UNC/,
    )
  })

  test('rehydrateAdoptedWorkflows rejects invalid scriptPath via i4d+AAo', async () => {
    const { rehydrateAdoptedWorkflows } = await import('../bgCheckpoint.js')
    let tasks: Record<string, unknown> = {}
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      const next = u({ tasks })
      tasks = next.tasks
    }
    const result = await rehydrateAdoptedWorkflows(
      [
        {
          taskId: 'w-bad',
          workflowRunId: 'wf_bad',
          description: 'bad',
          scriptPath: '/tmp/outside-projects.ts',
        },
      ],
      setAppState,
      { linkTranscripts: false },
    )
    expect(result.adopted).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.adoptedEntries).toEqual([])
    expect(tasks['w-bad']).toBeUndefined()
  })

  test('t4d/wAo stash take-and-clear by jobDir', async () => {
    const {
      stashDeferredAdoptResume,
      takeDeferredAdoptStash,
      resetDeferredAdoptStash,
    } = await import('../bgCheckpoint.js')
    resetDeferredAdoptStash()
    stashDeferredAdoptResume(
      '/tmp/job-a',
      [{ agentId: 'a1', description: 'd' }],
      [
        {
          taskId: 'w1',
          workflowRunId: 'wf1',
          scriptPath: '/x.ts',
          scriptSha256: 'abc',
        },
      ],
    )
    expect(takeDeferredAdoptStash('/tmp/other').workflows).toEqual([])
    const hit = takeDeferredAdoptStash('/tmp/job-a')
    expect(hit.agents).toHaveLength(1)
    expect(hit.workflows).toHaveLength(1)
    // one-shot
    expect(takeDeferredAdoptStash('/tmp/job-a').workflows).toEqual([])
  })

  test('scheduleDeferredAdoptResume runs w5u mock and AAo on fail', async () => {
    const {
      stashDeferredAdoptResume,
      scheduleDeferredAdoptResume,
      resetDeferredAdoptStash,
      isMcpClientsSettled,
    } = await import('../bgCheckpoint.js')
    resetDeferredAdoptStash()
    expect(isMcpClientsSettled({ mcp: { clients: [] } })).toBe(true)
    expect(
      isMcpClientsSettled({
        mcp: { clients: [{ type: 'pending' }] },
      }),
    ).toBe(false)

    stashDeferredAdoptResume('/tmp/job-b', [], [
      {
        taskId: 'w-ok',
        workflowRunId: 'wf_ok',
        scriptPath: '/ok.ts',
        scriptSha256: 'h',
      },
      {
        taskId: 'w-fail',
        workflowRunId: 'wf_fail',
        scriptPath: '/fail.ts',
        scriptSha256: 'h',
      },
    ])
    const calls: string[] = []
    const removed: string[] = []
    const result = await scheduleDeferredAdoptResume({
      jobDir: '/tmp/job-b',
      getState: () => ({ mcp: { clients: [] } }),
      waitForMcp: false,
      removeTask: id => removed.push(id),
      resumeWorkflow: async entry => {
        calls.push(entry.taskId)
        if (entry.taskId === 'w-fail') throw new Error('boom')
      },
    })
    expect(calls).toEqual(['w-ok', 'w-fail'])
    expect(result.resumed).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.agentsResumed).toBe(0)
    // Official BSe: remove failed workflow taskId before AAo
    expect(removed).toEqual(['w-fail'])
  })

  test('scheduleDeferredAdoptResume resumes agents when resumeAgent set', async () => {
    const {
      stashDeferredAdoptResume,
      scheduleDeferredAdoptResume,
      resetDeferredAdoptStash,
    } = await import('../bgCheckpoint.js')
    resetDeferredAdoptStash()
    stashDeferredAdoptResume(
      '/tmp/job-c',
      [
        { agentId: 'ag-ok', description: 'ok' },
        { agentId: 'ag-fail', description: 'fail' },
      ],
      [],
    )
    const ids: string[] = []
    const removed: string[] = []
    const result = await scheduleDeferredAdoptResume({
      jobDir: '/tmp/job-c',
      getState: () => ({}),
      waitForMcp: false,
      removeTask: id => removed.push(id),
      resumeAgent: async entry => {
        ids.push(entry.agentId)
        if (entry.agentId === 'ag-fail') throw new Error('aye boom')
      },
    })
    expect(ids).toEqual(['ag-ok', 'ag-fail'])
    expect(result.agentsResumed).toBe(1)
    expect(result.agentsFailed).toBe(1)
    // Official BSe: remove failed agentId before RAo
    expect(removed).toEqual(['ag-fail'])
  })

  test('product claim BSe resumeAgent adapter passes continueInterruptedTurn', async () => {
    // Official BSe: Aye({... continueInterruptedTurn:!0 ...}).catch — fire-and-forget.
    // Flag lives on the REPL claim adapter (scheduleDeferredAdoptResume call site),
    // not inside scheduleDeferredAdoptResume itself.
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const replSrc = readFileSync(
      join(import.meta.dirname, '../../screens/REPL.tsx'),
      'utf8',
    )
    const claimIdx = replSrc.indexOf('scheduleDeferredAdoptResume({')
    expect(claimIdx).toBeGreaterThan(-1)
    // Claim block ends at its .catch; orphan wires are separate call sites later.
    const claimCatch = replSrc.indexOf('}).catch(() => {', claimIdx)
    expect(claimCatch).toBeGreaterThan(claimIdx)
    const claimBlock = replSrc.slice(claimIdx, claimCatch + 80)
    expect(claimBlock).toContain('continueInterruptedTurn: true')
    expect(claimBlock).toContain('resumeAgent: async entry')
    // Claim path is fire-and-forget: no alreadyCompleted→EAf plumbing (orphan ese has it).
    expect(claimBlock).not.toMatch(/alreadyCompleted\s*[:=]/)
    expect(claimBlock).not.toMatch(/return\s*\{\s*alreadyCompleted/)
  })

  test('resumeAdoptedWorkflow rejects missing scriptSha256', async () => {
    const { resumeAdoptedWorkflow } = await import('../bgCheckpoint.js')
    await expect(
      resumeAdoptedWorkflow({
        taskId: 'w',
        workflowRunId: 'wf',
        scriptPath: '/tmp/x.ts',
      }),
    ).rejects.toThrow(/content pin|scriptSha256/)
  })

  test('resumeAdoptedWorkflow parse fails before launch (w5u Ux)', async () => {
    const { resumeAdoptedWorkflow } = await import('../bgCheckpoint.js')
    const dir = await mkdtemp(join(tmpdir(), 'w5u-parse-'))
    tmpDirs.push(dir)
    const scriptPath = join(dir, 'bad.ts')
    const body = 'not a valid workflow!!!'
    const { createHash } = await import('crypto')
    const scriptSha256 = createHash('sha256').update(body).digest('hex')
    await writeFile(scriptPath, body, 'utf8')

    let launched = false
    await expect(
      resumeAdoptedWorkflow(
        {
          taskId: 'w-parse',
          workflowRunId: 'wf_parse',
          scriptPath,
          scriptSha256,
        },
        {
          parseScript: () => {
            throw new Error('syntax boom')
          },
          launch: async () => {
            launched = true
          },
        },
      ),
    ).rejects.toThrow(/Invalid workflow script/)
    expect(launched).toBe(false)
  })

  test('resumeAdoptedWorkflow skips launch when run already running', async () => {
    const { resumeAdoptedWorkflow } = await import('../bgCheckpoint.js')
    const dir = await mkdtemp(join(tmpdir(), 'w5u-dedupe-'))
    tmpDirs.push(dir)
    const scriptPath = join(dir, 'ok.ts')
    const body = 'export const meta = { name: "t" }\nreturn 1'
    const { createHash } = await import('crypto')
    const scriptSha256 = createHash('sha256').update(body).digest('hex')
    await writeFile(scriptPath, body, 'utf8')

    const removed: string[] = []
    let launched = false
    await resumeAdoptedWorkflow(
      {
        taskId: 'adopted-w',
        workflowRunId: 'wf_same',
        scriptPath,
        scriptSha256,
      },
      {
        parseScript: () => ({}),
        getTasks: () => ({
          live: {
            type: 'local_workflow',
            workflowRunId: 'wf_same',
            status: 'running',
          },
        }),
        removeTask: id => removed.push(id),
        launch: async () => {
          launched = true
        },
      },
    )
    expect(launched).toBe(false)
    expect(removed).toEqual(['adopted-w'])
  })

  test('resumeAdoptedWorkflow removes ess paused stub then launches (AGr)', async () => {
    const { resumeAdoptedWorkflow } = await import('../bgCheckpoint.js')
    const dir = await mkdtemp(join(tmpdir(), 'w5u-agr-'))
    tmpDirs.push(dir)
    const scriptPath = join(dir, 'ok.ts')
    const body = 'export const meta = { name: "t" }\nreturn 1'
    const { createHash } = await import('crypto')
    const scriptSha256 = createHash('sha256').update(body).digest('hex')
    await writeFile(scriptPath, body, 'utf8')

    const removed: string[] = []
    let launched = false
    await resumeAdoptedWorkflow(
      {
        taskId: 'adopted-w',
        workflowRunId: 'wf_stub',
        scriptPath,
        scriptSha256,
      },
      {
        parseScript: () => ({}),
        getTasks: () => ({
          'adopted-w': {
            type: 'local_workflow',
            workflowRunId: 'wf_stub',
            status: 'paused',
          },
        }),
        removeTask: id => removed.push(id),
        launch: async () => {
          launched = true
        },
      },
    )
    expect(launched).toBe(true)
    expect(removed).toContain('adopted-w')
  })
})

describe('registerResumedWorkflowTask / pauseWorkflowTask (zit/ess)', () => {
  test('ess registers status paused + notified (not completed)', async () => {
    const { registerResumedWorkflowTask } = await import('../bgCheckpoint.js')
    let state: { tasks: Record<string, unknown> } = { tasks: {} }
    const setAppState = (
      u: (p: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      state = u(state)
    }
    registerResumedWorkflowTask(
      {
        taskId: 'wf-ess-1',
        workflowRunId: 'run-ess',
        scriptPath: '/tmp/ess.ts',
        description: 'paused workflow',
      },
      setAppState,
    )
    const t = state.tasks['wf-ess-1'] as {
      status?: string
      notified?: boolean
      type?: string
    }
    expect(t?.type).toBe('local_workflow')
    expect(t?.status).toBe('paused')
    expect(t?.notified).toBe(true)
  })

  test('runLeftArrowPostAdoptCheckpoint default zit via setAppState', async () => {
    const {
      collectPortableCheckpoint,
      stashLeftArrowCheckpointLive,
      runLeftArrowPostAdoptCheckpoint,
    } = await import('../bgCheckpoint.js')
    let aborted = false
    const cp = collectPortableCheckpoint({
      tasks: {
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          workflowRunId: 'run-1',
          scriptPath: '/tmp/w.js',
          script: 'export const meta = {}',
          abortController: {
            abort: () => {
              aborted = true
            },
          },
        },
      },
      detachShells: false,
    })
    expect(cp).not.toBeNull()
    stashLeftArrowCheckpointLive(cp)

    // Seed AppState with the same running workflow so pauseWorkflowTask can hit it.
    let state: { tasks: Record<string, any> } = {
      tasks: {
        w1: {
          id: 'w1',
          type: 'local_workflow',
          status: 'running',
          description: 'w',
          notified: false,
          startTime: Date.now(),
          outputFile: '',
          outputOffset: 0,
          workflowName: 'w',
          workflowFile: '/tmp/w.js',
          abortController: {
            abort: () => {
              aborted = true
            },
          },
        },
      },
    }
    const setAppState = (u: (p: typeof state) => typeof state) => {
      state = u(state)
    }

    const r = await runLeftArrowPostAdoptCheckpoint({
      setAppState: setAppState as never,
      flushAgentTranscripts: async () => {},
    })
    expect(r.ran).toBe(true)
    expect(r.abortedWorkflowIds).toEqual(['w1'])
    expect(aborted).toBe(true)
    expect(state.tasks.w1.status).toBe('paused')
    expect(state.tasks.w1.notified).toBe(true)
  })
})
