import { afterEach, describe, expect, mock, test } from 'bun:test'

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
  sendControlRequest,
}))

const listAllLiveSessions = mock(
  async () => [] as Array<Record<string, unknown>>,
)
mock.module('../../utils/udsClient.js', () => ({
  listAllLiveSessions,
}))

const {
  probeJobAlive,
  findResumeSessionConflict,
  xyrPreflightBeforeRespawn,
  killJobYiaFallback,
} = await import('../xyrRespawn.js')

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
    const err = await xyrPreflightBeforeRespawn({
      short: 'abc',
      resumeSessionId: 'sess-1',
      hasMessages: false,
    })
    expect(err).toBe('Session abc is already running')
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
    const err = await xyrPreflightBeforeRespawn({
      short: 'abc',
      resumeSessionId: 'sess-1',
      hasMessages: false,
      force: true,
    })
    expect(err).toBeNull()
    expect(killCalled).toBe(true)
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
    const err = await xyrPreflightBeforeRespawn({
      short: 'mine',
      resumeSessionId: 'sess-1',
      hasMessages: true,
    })
    expect(err).toContain('already open in another running Claude session')
  })

  test('Yia fallback returns anyMatch false when empty', async () => {
    listAllLiveSessions.mockImplementation(async () => [])
    const y = await killJobYiaFallback('abc')
    expect(y).toEqual({ confirmed: true, anyMatch: false })
  })
})
