import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realUdsClient from '../../utils/udsClient.js'
import * as realControlSocket from '../controlSocket.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const udsClientSnap = snapshotModuleExports(realUdsClient)
const controlSocketSnap = snapshotModuleExports(realControlSocket)

type CtrlResp = {
  ok: boolean
  op?: string
  alive?: boolean
  present?: boolean
  code?: string
  error?: string
}

// Mock control socket + uds before importing module under test.
const sendControlRequest = mock(
  async (_req: { op: string; short?: string }): Promise<CtrlResp> => {
    return { ok: true, op: 'has', alive: false, present: false }
  },
)
mock.module('../controlSocket.js', () => ({
  ...controlSocketSnap,
  sendControlRequest,
}))

const listAllLiveSessions = mock(
  async () => [] as Array<Record<string, unknown>>,
)
// mock.module is process-global. A one-export stub drops isPeerAlive /
// sendUdsControl / sendToUdsSocket and kills sibling 239 lock files at
// ESM link time. Spread the real snapshot; only override listAllLiveSessions.
mock.module('../../utils/udsClient.js', () => ({
  ...udsClientSnap,
  listAllLiveSessions,
}))

const {
  probeJobAlive,
  findResumeSessionConflict,
  xyrPreflightBeforeRespawn,
  killJobYiaFallback,
} = await import('../xyrRespawn.js')

afterAll(() => {
  mock.module('../../utils/udsClient.js', () => ({ ...udsClientSnap }))
  mock.module('../controlSocket.js', () => ({ ...controlSocketSnap }))
})

describe('xyrRespawn densable hLp/D9e/Zxe', () => {
  afterEach(() => {
    sendControlRequest.mockReset()
    listAllLiveSessions.mockReset()
    sendControlRequest.mockImplementation(
      async (_req: { op: string }): Promise<CtrlResp> => {
        if (_req.op === 'has') {
          return { ok: true, op: 'has', alive: false, present: false }
        }
        return { ok: true }
      },
    )
    listAllLiveSessions.mockImplementation(async () => [])
  })

  test('hLp probeJobAlive maps has response', async () => {
    sendControlRequest.mockImplementation(async () => ({
      ok: true,
      op: 'has',
      alive: true,
      present: true,
    }))
    const p = await probeJobAlive('abc')
    expect(p).toEqual({ alive: true, present: true, daemonUp: true })
  })

  test('hLp falls back when ENOCONN', async () => {
    sendControlRequest.mockImplementation(async () => {
      throw new Error('ENOCONN')
    })
    const p = await probeJobAlive('abc')
    expect(p).toEqual({ alive: false, present: false, daemonUp: false })
  })

  test('xyrPreflight refuses already running without force', async () => {
    sendControlRequest.mockImplementation(async () => ({
      ok: true,
      op: 'has',
      alive: true,
      present: true,
    }))
    const res = await xyrPreflightBeforeRespawn({
      short: 'abc',
      resumeSessionId: 'sess-1',
      hasMessages: false,
    })
    expect(res.error).toBe('Session abc is already running')
    expect(res.rotated).toBe(false)
  })

  test('xyrPreflight force skips already-running refuse', async () => {
    let killCalled = false
    let hasN = 0
    sendControlRequest.mockImplementation(
      async (req: { op: string }): Promise<CtrlResp> => {
        if (req.op === 'has') {
          hasN++
          // first has in preflight: alive; subsequent present polls: false
          if (hasN === 1) {
            return { ok: true, op: 'has', alive: true, present: true }
          }
          return { ok: true, op: 'has', alive: false, present: false }
        }
        if (req.op === 'kill') {
          killCalled = true
          return { ok: true }
        }
        return { ok: true }
      },
    )
    const res = await xyrPreflightBeforeRespawn({
      short: 'abc',
      resumeSessionId: 'sess-1',
      hasMessages: false,
      force: true,
    })
    expect(res.error).toBeNull()
    expect(res.resumeSessionId).toBe('sess-1')
    expect(killCalled).toBe(true)
  })

  test('Zxe findResumeSessionConflict prefers interactive over bg', async () => {
    listAllLiveSessions.mockImplementation(async () => [
      {
        sessionId: 'sess-1',
        pid: process.pid + 1,
        kind: 'bg',
        jobId: 'bg-job',
      },
      {
        sessionId: 'sess-1',
        pid: process.pid + 2,
        kind: 'interactive',
        jobId: 'tty-job',
      },
    ])
    const c = await findResumeSessionConflict('sess-1')
    expect(c).toEqual({ kind: 'interactive', jobId: 'tty-job' })
  })

  test('Zxe findResumeSessionConflict finds other non-interactive', async () => {
    listAllLiveSessions.mockImplementation(async () => [
      {
        sessionId: 'sess-1',
        pid: process.pid + 1,
        kind: 'bg',
        jobId: 'other',
      },
    ])
    const c = await findResumeSessionConflict('sess-1')
    expect(c).toEqual({ kind: 'bg', jobId: 'other' })
  })

  test('xyrPreflight Zxe interactive conflict uses v$e', async () => {
    sendControlRequest.mockImplementation(async () => ({
      ok: true,
      op: 'has',
      alive: false,
      present: false,
    }))
    listAllLiveSessions.mockImplementation(async () => [
      {
        sessionId: 'sess-1',
        pid: process.pid + 1,
        kind: 'interactive',
        jobId: 'other',
      },
    ])
    const res = await xyrPreflightBeforeRespawn({
      short: 'mine',
      resumeSessionId: 'sess-1',
      hasMessages: true,
    })
    expect(res.error).toBe(
      "Can't open \u2014 this session is running in another terminal",
    )
  })

  test('xyrPreflight Zxe conflict when hasMessages', async () => {
    sendControlRequest.mockImplementation(async () => ({
      ok: true,
      op: 'has',
      alive: false,
      present: false,
    }))
    listAllLiveSessions.mockImplementation(async () => [
      {
        sessionId: 'sess-1',
        pid: process.pid + 1,
        kind: 'bg',
        jobId: 'other',
      },
    ])
    const res = await xyrPreflightBeforeRespawn({
      short: 'mine',
      resumeSessionId: 'sess-1',
      hasMessages: true,
    })
    expect(res.error).toContain(
      'already open in another running Claude session',
    )
  })

  test('Yia fallback returns anyMatch false when empty', async () => {
    listAllLiveSessions.mockImplementation(async () => [])
    const y = await killJobYiaFallback('abc')
    expect(y).toEqual({ confirmed: true, anyMatch: false })
  })

  test('246: present && !alive without force does not kill', async () => {
    let killCalled = false
    sendControlRequest.mockImplementation(
      async (req: { op: string }): Promise<CtrlResp> => {
        if (req.op === 'has') {
          return { ok: true, op: 'has', alive: false, present: true }
        }
        if (req.op === 'kill') {
          killCalled = true
          return { ok: true }
        }
        return { ok: true }
      },
    )
    const res = await xyrPreflightBeforeRespawn({
      short: 'abc',
      resumeSessionId: 'sess-1',
      hasMessages: false,
    })
    expect(res.error).toBeNull()
    expect(res.resumeSessionId).toBe('sess-1')
    expect(killCalled).toBe(false)
  })

  test('BH3-P0-4: returns rotated resumeSessionId when jobState.sessionIdTaken is true and updates jobState', async () => {
    const { mkdtempSync, readFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const prevCfg = process.env.CLAUDE_CONFIG_DIR
    const dir = mkdtempSync(join(tmpdir(), 'bh3-p0-4-'))
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const { readBgJobState, writeBgJobState } = await import('../jobState.js')
      writeBgJobState('rot12345', {
        state: 'stopped',
        detail: '',
        tempo: 'idle',
        output: null,
        children: null,
        template: 'bg',
        respawnFlags: [],
        intent: 'work',
        sessionId: 'stolen-sess-id',
        resumeSessionId: 'stolen-sess-id',
        sessionIdTaken: true,
        cwd: dir,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        firstTerminalAt: new Date().toISOString(),
      })
      listAllLiveSessions.mockImplementation(async () => [
        {
          sessionId: 'stolen-sess-id',
          pid: process.pid + 1,
          kind: 'interactive',
          jobId: 'other-job',
        },
      ])

      const res = await xyrPreflightBeforeRespawn({
        short: 'rot12345',
        resumeSessionId: 'stolen-sess-id',
        hasMessages: true,
      })
      expect(res.error).toBeNull()
      expect(res.rotated).toBe(true)
      expect(res.resumeSessionId).not.toBe('stolen-sess-id')

      const updated = readBgJobState('rot12345')
      expect(updated?.sessionId).toBe(res.resumeSessionId)
      expect(updated?.resumeSessionId).toBe(res.resumeSessionId)
      expect(updated?.sessionIdTaken).toBeUndefined()

      // Verify AgentView propagates rotated effectiveResumeId & effectiveSessionId
      const agentViewSrc = readFileSync(
        join(import.meta.dir, '../../screens/AgentView.tsx'),
        'utf8',
      )
      expect(agentViewSrc).toContain(
        'const effectiveResumeId = preflight.resumeSessionId',
      )
      expect(agentViewSrc).toContain(
        'const effectiveSessionId = preflight.rotated ? effectiveResumeId : job.state.sessionId',
      )
    } finally {
      if (prevCfg === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prevCfg
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
