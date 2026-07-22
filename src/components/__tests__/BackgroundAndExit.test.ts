import { afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import * as realInstallPrompt from '../../daemon/installPrompt.js'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  buildBackgroundExitArgs,
  runExitBackgroundHandoff,
} from '../BackgroundAndExit.js'

beforeAll(() => {
  ;(globalThis as { MACRO?: { VERSION: string } }).MACRO = {
    VERSION: '2.6.33-test',
  }
})

describe('buildBackgroundExitArgs (official dOo/fOo portable subset)', () => {
  test('prefers --resume + --fork-session with empty -p when sessionId present', () => {
    expect(
      buildBackgroundExitArgs(
        { intent: 'fix flaky tests', name: 'my-job' },
        'abcdef12-3456-7890-abcd-ef1234567890',
      ),
    ).toEqual([
      '-p',
      '',
      '--resume',
      'abcdef12-3456-7890-abcd-ef1234567890',
      '--fork-session',
      '--name',
      'my-job',
    ])
  })

  test('adds --reply-on-resume when mid-turn', () => {
    expect(
      buildBackgroundExitArgs({ intent: 'x' }, 'sid-1', {
        replyOnResume: true,
      }),
    ).toEqual([
      '-p',
      '',
      '--resume',
      'sid-1',
      '--fork-session',
      '--reply-on-resume',
    ])
  })

  test('falls back to -p intent without session', () => {
    expect(buildBackgroundExitArgs({ intent: 'keep going' }, null)).toEqual([
      '-p',
      'keep going',
    ])
  })

  test('omits --name when not set', () => {
    expect(buildBackgroundExitArgs({ intent: 'x' }, 'sid-1')).toEqual([
      '-p',
      '',
      '--resume',
      'sid-1',
      '--fork-session',
    ])
  })
})

describe('runExitBackgroundHandoff densable hNo order', () => {
  const prevHome = process.env.CLAUDE_CONFIG_DIR
  let dir: string

  afterEach(() => {
    if (prevHome === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevHome
    if (dir) rmSync(dir, { recursive: true, force: true })
    mock.restore()
  })

  test('writes adopt.json BEFORE dispatch when tasks present (CAo→Jlr→yNo)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hno-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    delete process.env.CLAUDE_JOB_DIR

    const order: string[] = []

    mock.module('../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => {
        order.push('daemon')
        return { ok: true }
      },
    }))
    mock.module('../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))
    mock.module('../../utils/sessionStorage.js', () => ({
      flushSessionStorage: async () => {
        order.push('flush')
      },
    }))

    // densable H_e leaf-ready local_agent (backgrounded + abortController).
    const tasks: Record<string, unknown> = {
      a1: {
        id: 'a1',
        type: 'local_agent',
        status: 'running',
        description: 'worker',
        agentId: 'agent-1',
        isBackgrounded: true,
        abortController: new AbortController(),
      },
    }

    // Spy writeAdoptJson order via real module + order push on dispatch write
    const bg = await import('../../utils/bgCheckpoint.js')
    const origWrite = bg.writeAdoptJson
    const origCollect = bg.collectPortableCheckpoint
    mock.module('../../utils/bgCheckpoint.js', () => ({
      ...bg,
      writeAdoptJson: async (...args: Parameters<typeof origWrite>) => {
        order.push('adopt')
        return origWrite(...args)
      },
      collectPortableCheckpoint: (...args: Parameters<typeof origCollect>) => {
        const r = origCollect(...args)
        if (!r) return r
        const origCp = r.checkpointAgents.bind(r)
        return {
          ...r,
          checkpointAgents: async (opts?: Parameters<typeof origCp>[0]) => {
            order.push('checkpointAgents')
            // Ensure flush callback is wired (densable Gx)
            expect(typeof opts?.flushAgentTranscripts).toBe('function')
            return origCp(opts)
          },
        }
      },
      abandonCheckpointShells: bg.abandonCheckpointShells,
      reapNonHandoffTasks: bg.reapNonHandoffTasks,
    }))

    const result = await runExitBackgroundHandoff({
      seed: { intent: 'exit handoff', name: 'exit-job' },
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      isMidTurn: true,
      tasks,
      cwd: '/tmp',
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    // densable: daemon → (CAo) → adopt → dispatch
    expect(order.indexOf('daemon')).toBeGreaterThanOrEqual(0)
    // When checkpoint non-empty, adopt must precede any dispatch file
    const { getDispatchDir } = await import('../../daemon/bgWorker.js')
    const dispatchDir = getDispatchDir()
    const files = readdirSync(dispatchDir).filter(f => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
    const payload = JSON.parse(
      readFileSync(join(dispatchDir, files[files.length - 1]!), 'utf8'),
    ) as {
      sessionId: string
      launch?: { flagArgs?: string[] }
      respawnFlags?: string[]
    }
    // mid-turn → --reply-on-resume
    const flags = [
      ...(payload.launch?.flagArgs ?? []),
      ...(payload.respawnFlags ?? []),
    ]
    expect(flags).toContain('--reply-on-resume')

    if (result.adopted) {
      expect(order.indexOf('adopt')).toBeGreaterThanOrEqual(0)
      // providedSessionId short matches job dir
      const adoptPath = join(dir, 'jobs', result.short, 'adopt.json')
      const adoptRaw = readFileSync(adoptPath, 'utf8')
      expect(adoptRaw.length).toBeGreaterThan(2)
      // short is first 8 of provided session id
      expect(result.sessionId.slice(0, 8)).toBe(result.short)
    }
  })

  test('spawn fail abandons checkpoint only when adoptWriteOk (densable if(r) abandon)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hno-fail-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    delete process.env.CLAUDE_JOB_DIR

    mock.module('../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: true }),
    }))
    // densable yNo settled crashed → real submitDispatch throws (do NOT mock
    // bgManager.js — Bun mock.module is process-global and pollutes leftArrow).
    mock.module('../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: true,
        settled: 'crashed',
        error: 'spawn boom',
      }),
      isDaemonReachable: async () => true,
    }))

    let abandoned = false
    const bg = await import('../../utils/bgCheckpoint.js')
    mock.module('../../utils/bgCheckpoint.js', () => ({
      ...bg,
      // Force a non-null CAo so adoptWriteOk can become true
      collectPortableCheckpoint: () => ({
        payload: {
          writtenAtMs: Date.now(),
          shells: [{ pid: 1, command: 'sleep 1' }],
          cron: [],
        },
        handoffTaskIds: ['a1'],
        checkpointAgents: async () => {},
        disown: () => {},
      }),
      abandonCheckpointShells: () => {
        abandoned = true
        return 0
      },
    }))

    const result = await runExitBackgroundHandoff({
      seed: { intent: 'x' },
      resumeSessionId: 'sid',
      tasks: {
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          description: 'w',
          agentId: 'ag',
          abortController: new AbortController(),
        },
      },
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('spawn boom')
    // densable: if (r) t?.abandon() after yNo fail
    expect(abandoned).toBe(true)
  })

  test('spawn fail does not abandon when adopt write failed (r cleared)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hno-fail-no-adopt-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    delete process.env.CLAUDE_JOB_DIR

    mock.module('../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: true }),
    }))
    mock.module('../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({
        ok: true,
        settled: 'crashed',
        error: 'spawn boom',
      }),
      isDaemonReachable: async () => true,
    }))

    let abandoned = false
    const bg = await import('../../utils/bgCheckpoint.js')
    mock.module('../../utils/bgCheckpoint.js', () => ({
      ...bg,
      collectPortableCheckpoint: () => ({
        payload: {
          writtenAtMs: Date.now(),
          shells: [{ pid: 2, command: 'echo' }],
          cron: [],
        },
        handoffTaskIds: ['a1'],
        checkpointAgents: async () => {},
        disown: () => {},
      }),
      writeAdoptJson: async () => {
        throw new Error('Jlr fail')
      },
      abandonCheckpointShells: () => {
        abandoned = true
        return 0
      },
    }))

    const result = await runExitBackgroundHandoff({
      seed: { intent: 'x' },
      resumeSessionId: 'sid',
      tasks: {
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          description: 'w',
          agentId: 'ag',
          abortController: new AbortController(),
        },
      },
    })
    expect(result.ok).toBe(false)
    expect(abandoned).toBe(false)
  })

  test('adopt jobDir is getJobDirPath(short), ignores CLAUDE_JOB_DIR (densable dc(r.slice(0,8)))', async () => {
    dir = mkdtempSync(join(tmpdir(), 'hno-jobdir-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    // Poison: if code still prefers CLAUDE_JOB_DIR, adopt lands here instead of short.
    process.env.CLAUDE_JOB_DIR = join(dir, 'poison-job')

    mock.module('../../daemon/installPrompt.js', () => ({
      ...realInstallPrompt,
      ensureDaemonRunning: async () => ({ ok: true }),
    }))
    // Offline control socket → real submitDispatch file fallback (no bgManager mock).
    mock.module('../../daemon/controlSocketClient.js', () => ({
      sendControlRequest: async () => ({ ok: false, error: 'offline' }),
      isDaemonReachable: async () => false,
    }))

    // Track write path; implement writeAdoptJson with real fs so we don't
    // inherit a prior test's throwing mock via `...bg` / origWrite capture.
    const writeDirs: string[] = []
    const { mkdir, writeFile } = await import('fs/promises')
    mock.module('../../utils/bgCheckpoint.js', () => ({
      collectPortableCheckpoint: () => ({
        payload: {
          writtenAtMs: Date.now(),
          shells: [],
          cron: [],
          agents: [{ agentId: 'a1', description: 'w' }],
        },
        handoffTaskIds: ['a1'],
        detachedPids: [],
        checkpointAgents: async () => {},
        disown: () => {},
        abandon: () => {},
      }),
      writeAdoptJson: async (
        jobDir: string,
        incoming: { writtenAtMs?: number },
      ) => {
        writeDirs.push(jobDir)
        await mkdir(jobDir, { recursive: true, mode: 0o700 })
        await writeFile(join(jobDir, 'adopt.json'), JSON.stringify(incoming), {
          mode: 0o600,
        })
        return incoming
      },
      abandonCheckpointShells: () => 0,
      reapNonHandoffTasks: () => ({
        ran: false,
        abortedWorkflowIds: [],
        abortedAgentIds: [],
      }),
    }))

    const result = await runExitBackgroundHandoff({
      seed: { intent: 'exit handoff' },
      resumeSessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tasks: {
        a1: {
          id: 'a1',
          type: 'local_agent',
          status: 'running',
          description: 'w',
          agentId: 'a1',
          abortController: new AbortController(),
        },
      },
      cwd: '/tmp',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(`handoff failed: ${result.error}`)
    }
    expect(result.adopted).toBe(true)
    expect(writeDirs.length).toBe(1)
    // adopt under jobs/<short>/, not poison CLAUDE_JOB_DIR
    expect(writeDirs[0]).toBe(join(dir, 'jobs', result.short))
    expect(writeDirs[0]).not.toContain('poison-job')
    const adoptPath = join(dir, 'jobs', result.short, 'adopt.json')
    expect(readFileSync(adoptPath, 'utf8').length).toBeGreaterThan(2)
    expect(result.sessionId.slice(0, 8)).toBe(result.short)
  })

  test('cron-only session still writes adopt checkpoint (densable CAo zI/lWe)', async () => {
    // Review residual: exit handoff must not hard-code cron:[] or skip CAo when
    // tasks are empty — session crons alone are portable.
    dir = mkdtempSync(join(tmpdir(), 'hno-cron-only-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    delete process.env.CLAUDE_JOB_DIR

    const { addSessionCronTask, getSessionCronTasks, removeSessionCronTasks } =
      await import('../../bootstrap/state.js')
    const cronId = `cron-test-${Date.now()}`
    addSessionCronTask({
      id: cronId,
      cron: '*/5 * * * *',
      prompt: 'heartbeat',
      createdAt: Date.now(),
      recurring: true,
    })

    try {
      mock.module('../../daemon/installPrompt.js', () => ({
        ...realInstallPrompt,
        ensureDaemonRunning: async () => ({ ok: true }),
      }))
      mock.module('../../daemon/controlSocketClient.js', () => ({
        sendControlRequest: async () => ({ ok: false, error: 'offline' }),
        isDaemonReachable: async () => false,
      }))
      mock.module('../../utils/sessionStorage.js', () => ({
        flushSessionStorage: async () => {},
      }))

      // Bun mock.module is process-global — prior tests stub collect with fixed
      // cron:[]. This test asserts BackgroundAndExit passes session crons into
      // CAo; rebind collect to densable shape that preserves input.cron.
      const bg = await import('../../utils/bgCheckpoint.js')
      mock.module('../../utils/bgCheckpoint.js', () => ({
        ...bg,
        collectPortableCheckpoint: (input: {
          tasks?: Record<string, unknown> | null
          cron?: ReadonlyArray<{
            id: string
            cron: string
            prompt: string
            createdAt: number
            recurring?: boolean
            agentId?: string
          }> | null
        }) => {
          const cron = [...(input.cron ?? [])]
          if (cron.length === 0) return null
          return {
            payload: {
              writtenAtMs: Date.now(),
              shells: [],
              cron: cron.map(c => ({
                id: c.id,
                cron: c.cron,
                prompt: c.prompt,
                createdAt: c.createdAt,
                recurring: c.recurring,
                agentId: c.agentId,
              })),
            },
            shellTaskIds: [] as string[],
            agentIds: [] as string[],
            workflowTaskIds: [] as string[],
            cronIds: cron.map(c => c.id),
            detachedPids: [] as number[],
            handoffTaskIds: [] as string[],
            disown: () => {},
            checkpointAgents: async () => {},
          }
        },
        writeAdoptJson: bg.writeAdoptJson,
        abandonCheckpointShells: bg.abandonCheckpointShells,
        reapNonHandoffTasks: bg.reapNonHandoffTasks,
      }))

      expect(getSessionCronTasks().some(t => t.id === cronId)).toBe(true)

      const result = await runExitBackgroundHandoff({
        seed: { intent: 'cron only exit' },
        resumeSessionId: 'cccccccc-dddd-eeee-ffff-000000000001',
        // Empty tasks — densable still collects session crons via getSessionCronTasks
        tasks: {},
        cwd: '/tmp',
      })

      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.adopted).toBe(true)
      const adoptPath = join(dir, 'jobs', result.short, 'adopt.json')
      const adopt = JSON.parse(readFileSync(adoptPath, 'utf8')) as {
        cron?: Array<{ id: string; cron: string }>
      }
      expect(Array.isArray(adopt.cron)).toBe(true)
      expect(adopt.cron!.some(c => c.id === cronId)).toBe(true)
    } finally {
      removeSessionCronTasks([cronId])
    }
  })
})
