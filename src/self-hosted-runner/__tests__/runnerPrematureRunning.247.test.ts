/**
 * densable 2.1.247 #21 — do not report worker_status running before Claude Code starts.
 * Official: updateSessionWorkerState(..., void 0) after registerWorker.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createSelfHostedRunnerApi } from '../runnerApi.js'

describe('runner premature running 247 #21', () => {
  const handler = readFileSync(
    join(import.meta.dir, '../sessionHandler.ts'),
    'utf8',
  )
  const apiSrc = readFileSync(join(import.meta.dir, '../runnerApi.ts'), 'utf8')

  test('register-time updateSessionWorkerState passes undefined status', () => {
    expect(handler).toContain('api.updateSessionWorkerState(')
    expect(handler).toContain('undefined,')
    expect(handler).not.toMatch(
      /updateSessionWorkerState\(\s*apiBaseUrl,\s*sessionId,\s*sessionToken,\s*epoch,\s*'running'/,
    )
  })

  test('API omits worker_status when status is undefined', async () => {
    expect(apiSrc).toContain('workerStatus === undefined')
    expect(apiSrc).toContain('{ worker_epoch: workerEpoch }')

    const put = mock(async (_url: string, body: unknown) => {
      expect(body).toEqual({ worker_epoch: 7 })
      expect(body).not.toHaveProperty('worker_status')
      return { status: 200, data: {}, headers: {} }
    })
    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test',
      poolSecret: 's',
      http: {
        post: mock(async () => ({ status: 200, data: {}, headers: {} })),
        get: mock(async () => ({ status: 200, data: {}, headers: {} })),
        put,
      } as never,
    })
    await api.updateSessionWorkerState(
      'https://api.example.test',
      'sess_1',
      'tok',
      7,
    )
    expect(put).toHaveBeenCalled()
  })

  test('API still sends worker_status when provided', async () => {
    const put = mock(async (_url: string, body: unknown) => {
      expect(body).toEqual({
        worker_epoch: 3,
        worker_status: 'running',
      })
      return { status: 200, data: {}, headers: {} }
    })
    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test',
      poolSecret: 's',
      http: {
        post: mock(async () => ({ status: 200, data: {}, headers: {} })),
        get: mock(async () => ({ status: 200, data: {}, headers: {} })),
        put,
      } as never,
    })
    await api.updateSessionWorkerState(
      'https://api.example.test',
      'sess_1',
      'tok',
      3,
      'running',
    )
    expect(put).toHaveBeenCalled()
  })
})
