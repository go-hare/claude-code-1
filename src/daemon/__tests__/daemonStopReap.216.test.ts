/**
 * densable 2.1.216 — client wUs/AUs bg reap (daemon stop)
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { access, mkdir, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  clientBgReapAll,
  formatUnverifiedKeptNote,
  verifyAndKillWorkerPid,
} from '../clientBgReap.js'
import { getPtyDir, getRosterPath } from '../bgWorker.js'
import type { BgJobState } from '../jobState.js'
import { readBgJobState, writeBgJobState } from '../jobState.js'

function fixtureJob(
  partial: Partial<BgJobState> & { sessionId: string; cwd: string },
): BgJobState {
  const now = new Date().toISOString()
  return {
    state: 'working',
    detail: 'busy',
    tempo: 'active',
    intent: 'test',
    template: 'bg',
    createdAt: now,
    updatedAt: now,
    firstTerminalAt: null,
    output: null,
    children: null,
    respawnFlags: [],
    backend: 'daemon',
    ...partial,
  }
}

describe('formatUnverifiedKeptNote (densable u)', () => {
  test('singular and plural', () => {
    expect(formatUnverifiedKeptNote(1)).toBe(
      'note: 1 background session could not be verified as still ours and was left running (records kept). Re-run `claude daemon stop` to retry.',
    )
    expect(formatUnverifiedKeptNote(3)).toBe(
      'note: 3 background sessions could not be verified as still ours and were left running (records kept). Re-run `claude daemon stop` to retry.',
    )
  })
})

describe('verifyAndKillWorkerPid (densable AUs)', () => {
  test('missing procStart is foreign (no kill of live pid)', async () => {
    const verdict = await verifyAndKillWorkerPid(process.pid, undefined)
    expect(verdict).toBe('foreign')
    process.kill(process.pid, 0)
  })

  test('procStart mismatch is foreign', async () => {
    const verdict = await verifyAndKillWorkerPid(
      process.pid,
      'definitely-not-this-process-start-token',
    )
    expect(verdict).toBe('foreign')
  })

  test('dead pid with no killable group returns gone or killed', async () => {
    const verdict = await verifyAndKillWorkerPid(2_147_483_646, 'x')
    expect(verdict === 'gone' || verdict === 'killed').toBe(true)
  })
})

describe('clientBgReapAll (densable wUs)', () => {
  let configHome: string
  let prevClaude: string | undefined

  beforeEach(async () => {
    configHome = await mkdtemp(join(tmpdir(), 'wus-reap-'))
    prevClaude = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = configHome
    await mkdir(join(configHome, 'daemon', 'bg', 'pty'), {
      recursive: true,
      mode: 0o700,
    })
    await mkdir(join(configHome, 'daemon', 'bg', 'spare'), {
      recursive: true,
      mode: 0o700,
    })
    await mkdir(join(configHome, 'jobs'), { recursive: true, mode: 0o700 })
  })

  afterEach(async () => {
    if (prevClaude === undefined) delete process.env.CLAUDE_CONFIG_DIR
    else process.env.CLAUDE_CONFIG_DIR = prevClaude
    await rm(configHome, { recursive: true, force: true })
  })

  test('empty roster and empty dirs → reaped 0 kept 0', async () => {
    const r = await clientBgReapAll()
    expect(r).toEqual({ reaped: 0, kept: 0 })
  })

  test('orphan sidecar without base sock is unlinked', async () => {
    if (process.platform === 'win32') return
    const ptyDir = getPtyDir()
    await mkdir(ptyDir, { recursive: true })
    const orphan = join(ptyDir, 'dead.sock.err')
    await writeFile(orphan, 'x')
    await clientBgReapAll()
    let gone = false
    try {
      await access(orphan)
    } catch {
      gone = true
    }
    expect(gone).toBe(true)
  })

  test('foreign live pid (no procStart) is not killed; job marked stopped', async () => {
    const short = 'fgn1'
    writeBgJobState(
      short,
      fixtureJob({ sessionId: 's1', cwd: configHome, daemonShort: short }),
    )

    await mkdir(join(configHome, 'daemon'), { recursive: true })
    await writeFile(
      getRosterPath(),
      JSON.stringify({
        proto: 1,
        supervisorPid: 1,
        updatedAt: Date.now(),
        workers: {
          [short]: {
            pid: process.pid,
            // no procStart → AUs foreign
            sessionId: 's1',
            rendezvousSock: '',
            startedAt: Date.now(),
            attempt: 1,
            cwd: configHome,
            dispatch: {
              short,
              sessionId: 's1',
              intent: 'test',
              cwd: configHome,
              respawnFlags: [],
              source: 'test',
              createdAt: Date.now(),
              launch: { mode: 'prompt' },
            },
          },
        },
      }),
    )

    const r = await clientBgReapAll()
    expect(r.kept).toBe(0)
    process.kill(process.pid, 0)
    expect(readBgJobState(short)?.state).toBe('stopped')
  })

  test('supervisorKilledAll marks working job stopped even without kill', async () => {
    const short = 'sup1'
    writeBgJobState(
      short,
      fixtureJob({ sessionId: 's2', cwd: configHome, daemonShort: short }),
    )
    await mkdir(join(configHome, 'daemon'), { recursive: true })
    await writeFile(
      getRosterPath(),
      JSON.stringify({
        proto: 1,
        supervisorPid: 1,
        updatedAt: Date.now(),
        workers: {
          [short]: {
            pid: 0,
            sessionId: 's2',
            rendezvousSock: '',
            startedAt: Date.now(),
            attempt: 1,
            cwd: configHome,
            dispatch: {
              short,
              sessionId: 's2',
              intent: 'test',
              cwd: configHome,
              respawnFlags: [],
              source: 'test',
              createdAt: Date.now(),
              launch: { mode: 'prompt' },
            },
          },
        },
      }),
    )
    await clientBgReapAll({ supervisorKilledAll: true })
    expect(readBgJobState(short)?.state).toBe('stopped')
  })
})
