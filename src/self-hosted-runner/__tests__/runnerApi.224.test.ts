/**
 * densable 2.1.224 #1 — self-hosted-runner LUi API client.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertRunnerApiOk,
  assertSafeId,
  classifyRunnerError,
  createSelfHostedRunnerApi,
  extractRunnerApiErrorDetail,
  isRetryableRunnerError,
  resolveRunnerVersion,
  runnerAuthHeaders,
  sessionAuthHeaders,
} from '../runnerApi.js'

const src = readFileSync(join(import.meta.dir, '../runnerApi.ts'), 'utf8')

describe('densable 2.1.224 #1 runnerApi pure helpers', () => {
  test('resolveRunnerVersion strips v / pre-release (aHt)', () => {
    expect(resolveRunnerVersion('v2.1.224')).toBe('2.1.224')
    expect(resolveRunnerVersion('2.1.224-beta+build')).toBe('2.1.224')
  })

  test('assertSafeId (ere)', () => {
    expect(assertSafeId('runner_1', 'runner_id')).toBe('runner_1')
    expect(() => assertSafeId('bad/id', 'runner_id')).toThrow('unsafe')
  })

  test('extractRunnerApiErrorDetail (G3)', () => {
    expect(extractRunnerApiErrorDetail({ message: 'm' })).toBe('m')
    expect(extractRunnerApiErrorDetail({ error: { message: 'inner' } })).toBe(
      'inner',
    )
    expect(extractRunnerApiErrorDetail(null)).toBeUndefined()
  })

  test('assertRunnerApiOk (Oae) status mapping', () => {
    assertRunnerApiOk(200, {}, 'Op')
    try {
      assertRunnerApiOk(401, { message: 'nope' }, 'Op')
      expect.unreachable()
    } catch (e) {
      const err = e as Error & { isAuthFailure?: boolean; httpStatus?: number }
      expect(err.message).toContain('Authentication failed (401)')
      expect(err.isAuthFailure).toBe(true)
      expect(err.httpStatus).toBe(401)
    }
    try {
      assertRunnerApiOk(409, { error: { type: 'session_not_active' } }, 'Op')
      expect.unreachable()
    } catch (e) {
      const err = e as Error & { isSessionNotActive?: boolean }
      expect(err.message).toContain('Session not active')
      expect(err.isSessionNotActive).toBe(true)
    }
  })

  test('classify + retryable', () => {
    expect(classifyRunnerError({ code: 'ETIMEDOUT' })).toBe('timeout')
    expect(classifyRunnerError({ httpStatus: 503 })).toBe('5xx')
    expect(classifyRunnerError({ httpStatus: 429 })).toBe('429')
    expect(isRetryableRunnerError({ httpStatus: 500 })).toBe(true)
    expect(isRetryableRunnerError({ name: 'AbortError' })).toBe(false)
  })

  test('runnerAuthHeaders include x-self-hosted-runner-version', () => {
    const h = runnerAuthHeaders('tok', '2.1.224')
    expect(h.Authorization).toBe('Bearer tok')
    expect(h['x-self-hosted-runner-version']).toBe('2.1.224')
    expect(h['anthropic-version']).toBe('2023-06-01')
  })

  test('sessionAuthHeaders (pGr) omit x-self-hosted-runner-version', () => {
    // densable pGr: Bearer + Content-Type + anthropic-version only
    const h = sessionAuthHeaders('sess-tok')
    expect(h.Authorization).toBe('Bearer sess-tok')
    expect(h['anthropic-version']).toBe('2023-06-01')
    expect(h['x-self-hosted-runner-version']).toBeUndefined()
  })
})

describe('densable 2.1.224 #1 runnerApi createSelfHostedRunnerApi (LUi)', () => {
  test('registerRunner + pollWork paths', async () => {
    const calls: Array<{ method: string; url: string; body: unknown }> = []
    const http = {
      post: mock(async (url: string, body?: unknown, _cfg?: unknown) => {
        calls.push({ method: 'POST', url, body })
        if (url.endsWith('/runners/register')) {
          return { status: 200, data: { runner_id: 'r1' }, headers: {} }
        }
        if (url.includes('/poll')) {
          return {
            status: 200,
            data: { assignment_ids: ['a1'], session_assignments: [] },
            headers: {},
          }
        }
        return { status: 200, data: {}, headers: {} }
      }),
      get: mock(async () => ({ status: 200, data: {}, headers: {} })),
      put: mock(async () => ({ status: 200, data: {}, headers: {} })),
    }

    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test/',
      poolSecret: 'pool-secret',
      runnerVersion: '2.1.224',
      http: http as never,
    })

    const reg = await api.registerRunner('runner', 'acct')
    expect(reg.runner_id).toBe('r1')
    expect(calls[0]!.url).toBe(
      'https://api.example.test/v1/code/runners/self-hosted/runners/register',
    )
    expect(calls[0]!.body).toEqual({
      runner_version: '2.1.224',
      client_label: 'runner',
      lock_to_account_id: 'acct',
    })

    const work = await api.pollWork('rtok', 'r1', 1)
    expect(work.assignment_ids).toEqual(['a1'])
    expect(calls[1]!.url).toContain('/runners/r1/poll')
    expect(calls[1]!.body).toEqual({ available_capacity: 1 })
  })

  test('issueSessionToken requires session_token field', async () => {
    const http = {
      post: mock(async () => ({
        status: 200,
        data: {},
        headers: {},
      })),
      get: mock(async () => ({ status: 200, data: {}, headers: {} })),
      put: mock(async () => ({ status: 200, data: {}, headers: {} })),
    }
    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test',
      poolSecret: 's',
      http: http as never,
    })
    await expect(api.issueSessionToken('t', 'sess_1')).rejects.toThrow(
      'missing session_token',
    )
  })
})

describe('densable 2.1.224 #1 runnerApi source gold', () => {
  test('paths match densable SEA', () => {
    expect(src).toContain('/v1/code/runners/self-hosted/runners/register')
    expect(src).toContain('/v1/code/runners/self-hosted/spawn-hints/poll')
    expect(src).toContain('/v1/code/runners/self-hosted/spawn-hints/nack')
    expect(src).toContain('/v1/code/runners/self-hosted/deregister')
    expect(src).toContain('/v1/code/auth/refresh')
    expect(src).toContain('x-self-hosted-runner-version')
    expect(src).toContain('export function createSelfHostedRunnerApi')
  })
})
