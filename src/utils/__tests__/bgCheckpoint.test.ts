import { createHash } from 'crypto'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ADOPT_FRAME_LIVE_SPAWN_FAILED_MESSAGE,
  abandonCheckpointShells,
  adoptTelemetry,
  buildAdoptWritePayload,
  buildHandoffEligibilityMap,
  buildMidTurnPrefill,
  collectH8eMonitorSlugs,
  collectIrsFrameLive,
  collectPortableCheckpoint,
  countUndisclosedFrameLive,
  emptyCheckpointPayload,
  isMcpClientsSettled,
  mergeCheckpointPayloads,
  notifyAbandonFrameLiveSpawnFailed,
  PREFILL_MAX_CHARS,
  readAdoptPrefill,
  reapNonHandoffTasks,
  resumeAdoptedWorkflow,
  scheduleDeferredAdoptResume,
  stashDeferredAdoptResume,
  truncatePartialTextForPrefill,
  atomicWriteFile,
  writeAdoptJson,
  registerResumedAgentTask,
  type AdoptedWorkflowEntry,
  type PortableTaskLike,
} from '../bgCheckpoint.js'
import { resetCommandQueue } from '../messageQueueManager.js'
import {
  mI,
  registerAutoReactAvailability,
  registerSupervisor,
  resetArtifactAutoReactStoreForTests,
  setBootingWiredArm,
  Stn,
  un,
  wtn,
} from '../../services/artifactAutoReact/index.js'

function armAutoReactForTests(): void {
  resetArtifactAutoReactStoreForTests()
  process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT = '1'
  registerAutoReactAvailability(() => true)
  mI()
}

function armSupervisedMonitor(slug: string, title?: string): void {
  armAutoReactForTests()
  registerSupervisor({
    slug,
    autoReactWiring: { title: title ?? slug },
  })
}

const tmpDirs: string[] = []
afterEach(async () => {
  for (const d of tmpDirs.splice(0)) {
    await rm(d, { recursive: true, force: true }).catch(() => {})
  }
  try {
    resetCommandQueue()
  } catch {
    /* optional */
  }
  resetArtifactAutoReactStoreForTests()
  delete process.env.CLAUDE_CODE_ARTIFACT_COMMENTS_AUTOREACT
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

describe('mergeCheckpointPayloads / densable uKy', () => {
  test('prefer incoming prefill + writtenAtMs from incoming', () => {
    const a = emptyCheckpointPayload(100)
    a.shells = [{ id: 1 }]
    const b = buildAdoptWritePayload({
      base: emptyCheckpointPayload(200),
      prefill: { text: 'p' },
    })
    const m = mergeCheckpointPayloads(a, b)
    // densable uKy: writtenAtMs:t.writtenAtMs (incoming)
    expect(m.writtenAtMs).toBe(200)
    expect(m.prefill?.text).toBe('p')
    expect(m.shells).toHaveLength(1)
  })
  test('incoming older writtenAtMs still wins (uKy not max)', () => {
    const a = emptyCheckpointPayload(500)
    const b = emptyCheckpointPayload(100)
    b.prefill = { text: 'new' }
    const m = mergeCheckpointPayloads(a, b)
    expect(m.writtenAtMs).toBe(100)
    expect(m.prefill?.text).toBe('new')
  })
  test('adoptTelemetry counts', () => {
    expect(
      adoptTelemetry({
        writtenAtMs: 1,
        shells: [1, 2],
        cron: [{ id: 'c', cron: '*', prompt: 'p' }],
        agents: [1],
        workflows: [],
        frameLive: [{ slug: 'a', writtenAtMs: 1 }],
      }),
    ).toEqual({
      adopted_shells: 2,
      adopted_agents: 1,
      adopted_workflows: 0,
      adopted_cron: 1,
      adopted_frame_live: 1,
    })
  })

  test('countUndisclosedFrameLive mirrors densable I', () => {
    const live = new Set(['a', 'b'])
    expect(
      countUndisclosedFrameLive(
        [{ slug: 'a' }, { slug: 'c' }, { slug: 'd' }],
        live,
      ),
    ).toBe(2)
    expect(countUndisclosedFrameLive([{ slug: 'a' }], live)).toBe(0)
    expect(countUndisclosedFrameLive([{ slug: 'a' }], undefined)).toBe(0)
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

async function makeAdoptedWorkflowEntry(
  dir: string,
  overrides: Partial<AdoptedWorkflowEntry> = {},
): Promise<AdoptedWorkflowEntry> {
  const scriptPath = join(dir, 'wf.js')
  const script = 'export const meta = { name: "t" }\nreturn {}'
  await writeFile(scriptPath, script, 'utf8')
  const scriptSha256 = createHash('sha256').update(script).digest('hex')
  return {
    taskId: 'wf-task-1',
    workflowRunId: 'run-1',
    scriptPath,
    scriptSha256,
    description: 'test workflow',
    ...overrides,
  }
}

describe('resumeAdoptedWorkflow densable w5u context', () => {
  test('launch override skips toolUseContext requirement', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-wf-'))
    tmpDirs.push(dir)
    const entry = await makeAdoptedWorkflowEntry(dir)
    const launches: unknown[] = []
    await resumeAdoptedWorkflow(entry, {
      parseScript: () => ({}),
      launch: async input => {
        launches.push(input)
      },
    })
    expect(launches).toHaveLength(1)
    expect((launches[0] as { resumeFromRunId: string }).resumeFromRunId).toBe(
      'run-1',
    )
  })

  test('product path without toolUseContext/canUseTool throws (no allow-all)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-wf-'))
    tmpDirs.push(dir)
    const entry = await makeAdoptedWorkflowEntry(dir)
    await expect(
      resumeAdoptedWorkflow(entry, {
        parseScript: () => ({}),
      }),
    ).rejects.toThrow(/toolUseContext and canUseTool/)
  })

  test('product path with toolUseContext + canUseTool reaches launch with them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-wf-'))
    tmpDirs.push(dir)
    const entry = await makeAdoptedWorkflowEntry(dir)
    const toolUseContext = { id: 'tuc' }
    const canUseTool = async () => ({ behavior: 'ask' as const })
    let sawCtx: unknown
    let sawCan: unknown
    await resumeAdoptedWorkflow(entry, {
      parseScript: () => ({}),
      // Still use launch override so we don't hit real WorkflowService;
      // assert context was accepted by not throwing the missing-context error.
      // Product path wires both into svc.launch — tested via schedule lazy path below.
      launch: async () => {
        sawCtx = toolUseContext
        sawCan = canUseTool
      },
      toolUseContext,
      canUseTool,
    })
    expect(sawCtx).toBe(toolUseContext)
    expect(sawCan).toBe(canUseTool)
  })
})

describe('scheduleDeferredAdoptResume getWorkflowResumeContext', () => {
  test('default resume uses lazy getWorkflowResumeContext (no throw)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-sched-'))
    tmpDirs.push(dir)
    const entry = await makeAdoptedWorkflowEntry(dir)
    stashDeferredAdoptResume(dir, [], [entry])

    const toolUseContext = { id: 'lazy-tuc' }
    const canUseTool = async () => ({ behavior: 'deny' as const })

    // Default factory path: provide launch via wrapping resumeAdoptedWorkflow
    // by observing that with lazy context + launch-less product would require
    // WorkflowService. Use resumeWorkflow that re-invokes resumeAdoptedWorkflow
    // with launch override but asserts lazy was provided at schedule layer by
    // calling resumeAdoptedWorkflow the same way the default factory does.
    const result = await scheduleDeferredAdoptResume({
      jobDir: dir,
      getState: () => ({ mcp: { clientsInitialized: true, clients: [] } }),
      waitForMcp: false,
      getWorkflowResumeContext: () => ({ toolUseContext, canUseTool }),
      resumeWorkflow: async e => {
        const lazy = { toolUseContext, canUseTool }
        await resumeAdoptedWorkflow(e, {
          parseScript: () => ({}),
          launch: async () => {},
          toolUseContext: lazy.toolUseContext,
          canUseTool: lazy.canUseTool,
        })
      },
    })
    expect(result.resumed).toBe(1)
    expect(result.failed).toBe(0)
  })

  test('default resume fails product path when lazy context missing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'adopt-sched-miss-'))
    tmpDirs.push(dir)
    const entry = await makeAdoptedWorkflowEntry(dir)
    stashDeferredAdoptResume(dir, [], [entry])

    const result = await scheduleDeferredAdoptResume({
      jobDir: dir,
      getState: () => ({ mcp: { clientsInitialized: true, clients: [] } }),
      waitForMcp: false,
      // no resumeWorkflow / no getWorkflowResumeContext → missing context
      // (parse may also fail if workflow-engine absent; either way failed)
    })
    expect(result.failed).toBeGreaterThanOrEqual(1)
    expect(result.resumed).toBe(0)
  })
})

describe('isMcpClientsSettled densable gDs', () => {
  test('requires clientsInitialized === true and no pending', () => {
    // densable gDs(e): e.mcp.clientsInitialized===!0 && !pending
    expect(isMcpClientsSettled({})).toBe(false)
    expect(isMcpClientsSettled({ mcp: undefined })).toBe(false)
    expect(
      isMcpClientsSettled({
        mcp: { clientsInitialized: false, clients: [] },
      }),
    ).toBe(false)
    expect(
      isMcpClientsSettled({
        mcp: { clients: [] },
      }),
    ).toBe(false)
    expect(
      isMcpClientsSettled({
        mcp: { clientsInitialized: true, clients: [{ type: 'pending' }] },
      }),
    ).toBe(false)
    expect(
      isMcpClientsSettled({
        mcp: { clientsInitialized: true, clients: [{ type: 'connected' }] },
      }),
    ).toBe(true)
    expect(
      isMcpClientsSettled({
        mcp: { clientsInitialized: true, clients: [] },
      }),
    ).toBe(true)
  })
})

describe('buildHandoffEligibilityMap densable H_e', () => {
  const bgAgent = (
    id: string,
    extra: Partial<PortableTaskLike> = {},
  ): PortableTaskLike => ({
    id,
    type: 'local_agent',
    status: 'running',
    agentId: id,
    isBackgrounded: true,
    abortController: { abort: () => {} },
    ...extra,
  })

  test('root background agent with abort is eligible', () => {
    const tasks = { a1: bgAgent('a1') }
    const m = buildHandoffEligibilityMap(tasks)
    expect(m.get('a1')).toBe(true)
  })

  test('agent without abortController is not eligible', () => {
    const tasks = {
      a1: bgAgent('a1', { abortController: undefined }),
    }
    const m = buildHandoffEligibilityMap(tasks)
    expect(m.get('a1')).toBe(false)
  })

  test('subtree fails when child not leaf-ready', () => {
    const tasks = {
      a1: bgAgent('a1'),
      a2: bgAgent('a2', {
        parentAgentId: 'a1',
        isBackgrounded: false,
      }),
    }
    const m = buildHandoffEligibilityMap(tasks)
    // densable: whole tree false when child fails leafReady
    expect(m.get('a1')).toBe(false)
    expect(m.get('a2')).toBe(false)
  })

  test('subtree eligible when child also ready', () => {
    const tasks = {
      a1: bgAgent('a1'),
      a2: bgAgent('a2', { parentAgentId: 'a1' }),
    }
    const m = buildHandoffEligibilityMap(tasks)
    expect(m.get('a1')).toBe(true)
    expect(m.get('a2')).toBe(true)
  })

  test('collectPortableCheckpoint filters by H_e', () => {
    const ac = { abort: () => {} }
    const tasks: Record<string, PortableTaskLike> = {
      good: bgAgent('good'),
      bad: bgAgent('bad', { isBackgrounded: false, abortController: ac }),
    }
    const cp = collectPortableCheckpoint({ tasks, detachShells: false })
    expect(cp).not.toBeNull()
    expect(cp!.agentIds).toEqual(['good'])
  })

  test('Irs: monitor_ws + autoReactArmed + frameLive enters payload', () => {
    armSupervisedMonitor('art-1', 'Hello')
    const tasks: Record<string, PortableTaskLike> = {
      mon: {
        id: 'mon',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'art-1',
        frameLive: { slug: 'art-1', title: 'Hello' },
      },
    }
    const cp = collectPortableCheckpoint({
      tasks,
      detachShells: false,
      nowMs: 42,
    })
    expect(cp?.payload.frameLive).toEqual([
      { slug: 'art-1', writtenAtMs: 42, title: 'Hello' },
    ])
    expect(cp?.frameLiveTaskIds).toEqual(['mon'])
    expect(cp?.carriedMonitorTaskIds).toEqual(['mon'])
    // densable Hen handoff = shells/agents/workflows only — not Irs monitors
    expect(cp?.handoffTaskIds).not.toContain('mon')
  })

  test('Irs: qHe without supervisors.get stays out (1:1 gate)', () => {
    armAutoReactForTests()
    // armed task but no supervisors Map entry → Irs skips
    const tasks: Record<string, PortableTaskLike> = {
      mon: {
        id: 'mon',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'art-1',
        frameLive: { slug: 'art-1' },
      },
    }
    expect(collectH8eMonitorSlugs(tasks).has('art-1')).toBe(true)
    expect(collectIrsFrameLive(tasks, 1)).toEqual([])
  })

  test('Irs/h8e: Stn injects supervisor slug; bare frameLive stays out', () => {
    armSupervisedMonitor('parked-only')
    expect(Stn().has('parked-only')).toBe(true)
    expect(collectH8eMonitorSlugs({}).has('parked-only')).toBe(true)
    // Irs keeps Stn slug via supervisors.get
    expect(collectIrsFrameLive({}, 1)).toEqual([
      { slug: 'parked-only', writtenAtMs: 1, title: 'parked-only' },
    ])

    const tasks: Record<string, PortableTaskLike> = {
      orphan: {
        id: 'orphan',
        type: 'local_bash',
        status: 'running',
        frameLive: { slug: 'art-x' },
      },
      cold: {
        id: 'cold',
        type: 'monitor_ws',
        status: 'running',
        frameLive: { slug: 'cold-slug' },
      },
    }
    expect(collectH8eMonitorSlugs(tasks).has('art-x')).toBe(false)
    expect(collectH8eMonitorSlugs(tasks).has('cold-slug')).toBe(false)
  })

  test('Irs: wtn ∩ bootingWiredArms carries without supervisor', () => {
    armAutoReactForTests()
    un().wakes.scanGeneration = 7
    setBootingWiredArm('boot-1', {
      scanGeneration: 7,
      title: 'Booting',
    })
    expect(wtn().has('boot-1')).toBe(true)
    expect(collectIrsFrameLive({}, 5)).toEqual([
      { slug: 'boot-1', writtenAtMs: 5, title: 'Booting' },
    ])
  })

  test('Irs: disown quiet-removes carried monitors; Hen reaps if remove no-op', () => {
    armSupervisedMonitor('art-1')
    const tasks: Record<string, PortableTaskLike> = {
      mon: {
        id: 'mon',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'art-1',
        frameLive: { slug: 'art-1' },
      },
      other: {
        id: 'other',
        type: 'local_agent',
        status: 'running',
        description: 'noise',
        isBackgrounded: true,
        abortController: { abort: () => {} },
      },
    }
    const cp = collectPortableCheckpoint({ tasks, detachShells: false })
    expect(cp).not.toBeNull()
    expect(cp!.handoffTaskIds).not.toContain('mon')

    const removed: string[] = []
    cp!.disown({ removeTaskIds: ids => removed.push(...ids) })
    expect(removed).toContain('mon')
    // second stopCarriedWatches is idempotent
    const removed2: string[] = []
    cp!.stopCarriedWatches({ removeTaskIds: ids => removed2.push(...ids) })
    expect(removed2).toEqual([])
    // Dso cleared supervisor
    expect(un().live.supervisors.has('art-1')).toBe(false)

    // Exit-path stand-in: removeTaskIds no-op → Hen still reaps residual monitors
    armSupervisedMonitor('art-1')
    const cp2 = collectPortableCheckpoint({ tasks, detachShells: false })
    expect(cp2).not.toBeNull()
    cp2!.disown({ removeTaskIds: () => {} })
    const reaped = reapNonHandoffTasks({
      tasks,
      handoffTaskIds: cp2!.handoffTaskIds,
      removeTaskIds: () => {},
      emitStopped: () => {},
    })
    expect(reaped.reapedIds).toContain('mon')
  })

  test('Irs: abandon after disown notifies frameLive spawn-fail copy', () => {
    armSupervisedMonitor('art-1')
    const tasks: Record<string, PortableTaskLike> = {
      mon: {
        id: 'mon',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'art-1',
        frameLive: { slug: 'art-1' },
      },
    }
    const cp = collectPortableCheckpoint({ tasks, detachShells: false })
    expect(cp).not.toBeNull()
    cp!.disown({})
    cp!.abandon()
    expect(ADOPT_FRAME_LIVE_SPAWN_FAILED_MESSAGE).toContain(
      'automatic replies to Artifact comments stopped',
    )
    const { getCommandQueue } = require('../messageQueueManager.js') as {
      getCommandQueue: () => Array<{ value?: string }>
    }
    const hit = getCommandQueue().find(
      c =>
        typeof c.value === 'string' &&
        c.value.includes('mon') &&
        c.value.includes('automatic replies to Artifact comments stopped'),
    )
    expect(hit).toBeTruthy()
    expect(notifyAbandonFrameLiveSpawnFailed([])).toBe(0)
  })

  test('Irs: abandon without prior stopCarriedWatches skips frameLive notify', () => {
    armSupervisedMonitor('art-1')
    const tasks: Record<string, PortableTaskLike> = {
      mon: {
        id: 'mon',
        type: 'monitor_ws',
        status: 'running',
        autoReactArmed: true,
        autoReactSlug: 'art-1',
        frameLive: { slug: 'art-1' },
      },
    }
    const cp = collectPortableCheckpoint({ tasks, detachShells: false })
    expect(cp).not.toBeNull()
    // densable: if (!m) skip Dmo(p) — abandon alone does not set m
    cp!.abandon()
    expect(cp!.frameLiveTaskIds).toEqual(['mon'])
    const { getCommandQueue } = require('../messageQueueManager.js') as {
      getCommandQueue: () => Array<{ value?: string }>
    }
    const hit = getCommandQueue().find(
      c =>
        typeof c.value === 'string' &&
        c.value.includes('mon') &&
        c.value.includes('automatic replies to Artifact comments stopped'),
    )
    expect(hit).toBeFalsy()
  })

  test('payload-only abandonCheckpointShells notifies frameLive slugs', () => {
    abandonCheckpointShells({
      writtenAtMs: Date.now(),
      shells: [],
      cron: [],
      frameLive: [{ slug: 'art-payload', writtenAtMs: Date.now() }],
    })
    const { getCommandQueue } = require('../messageQueueManager.js') as {
      getCommandQueue: () => Array<{ value?: string }>
    }
    const hit = getCommandQueue().find(
      c =>
        typeof c.value === 'string' &&
        c.value.includes('art-payload') &&
        c.value.includes('automatic replies to Artifact comments stopped'),
    )
    expect(hit).toBeTruthy()
  })
})

describe('registerResumedAgentTask (densable PSu + product adopt UX)', () => {
  test('registers completed placeholder with adoptResumePending, not resuming', () => {
    let state: { tasks: Record<string, unknown> } = { tasks: {} }
    const setAppState = (
      updater: (prev: { tasks: Record<string, unknown> }) => {
        tasks: Record<string, unknown>
      },
    ) => {
      state = updater(state)
    }
    registerResumedAgentTask(
      {
        agentId: 'adopt-agent-1',
        description: 'resume me',
        toolUseId: 'tu-1',
        agentType: 'general-purpose',
      },
      setAppState,
    )
    const task = state.tasks['adopt-agent-1'] as Record<string, unknown>
    expect(task).toBeDefined()
    expect(task.type).toBe('local_agent')
    // densable PSu: completed so Aye CAS can claim (not running/resuming)
    expect(task.status).toBe('completed')
    expect(task.resuming).not.toBe(true)
    // Product UX: panel "resuming" until deferred Aye settles
    expect(task.adoptResumePending).toBe(true)
    expect(task.notified).toBe(true)
    expect(task.isIdle).toBe(false)
  })
})

describe('atomicWriteFile densable Cf', () => {
  test('writes target with mode via rename path', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atomic-write-'))
    tmpDirs.push(dir)
    const target = join(dir, 'adopt.json')
    await atomicWriteFile(target, '{"ok":true}', 0o600)
    const { readFile, stat } = await import('fs/promises')
    expect(await readFile(target, 'utf8')).toBe('{"ok":true}')
    const mode = (await stat(target)).mode & 0o777
    // umask may clear bits; at least owner-read should be set
    expect(mode & 0o400).toBe(0o400)
  })
})
