/**
 * densable 2.1.243 #55 / #56 — work-bridge env remint after poll 404.
 * Official `It` / `gn` / `Li` / `pn` / `tr` / `u` / `ar` / `yt`.
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import { debugMock } from '../../../tests/mocks/debug.js'
import { logMock } from '../../../tests/mocks/log.js'

mock.module('src/utils/debug.ts', debugMock)
mock.module('src/utils/log.ts', logMock)
mock.module('src/services/analytics/index.ts', () => ({
  logEvent: () => {},
  logEventAsync: async () => {},
}))
mock.module('src/utils/diagLogs.ts', () => ({
  logForDiagnosticsNoPII: () => {},
}))

import { BridgeFatalError } from '../bridgeApi.js'
import {
  drainPendingRequeues,
  formatExpiredReconnectMessage,
  formatOfflineCleanupMessages,
  isClientReject,
  isEnvironmentGone,
  MAX_ENV_REREGISTER_ATTEMPTS,
  MAX_PENDING_REQUEUE_ATTEMPTS,
  reconnectAfterReregister,
  reregisterEnvironment,
  retryAfterMs,
} from '../envReregister.js'
import type { BridgeApiClient, BridgeConfig } from '../types.js'

function stubConfig(): BridgeConfig {
  return {
    dir: '/tmp',
    machineName: 'test',
    branch: 'main',
    gitRepoUrl: null,
    maxSessions: 1,
    spawnMode: 'single-session',
    verbose: false,
    sandbox: false,
    bridgeId: 'bridge-1',
    workerType: 'claude_code',
    environmentId: 'env-1',
    apiBaseUrl: 'https://example.test',
    sessionIngressUrl: 'https://example.test',
  }
}

function stubApi(overrides: Partial<BridgeApiClient> = {}): BridgeApiClient {
  return {
    registerBridgeEnvironment: async () => ({
      environment_id: 'env-1',
      environment_secret: 'secret-2',
    }),
    pollForWork: async () => null,
    acknowledgeWork: async () => {},
    stopWork: async () => {},
    deregisterEnvironment: async () => {},
    sendPermissionResponseEvent: async () => {},
    archiveSession: async () => {},
    reconnectSession: async () => {},
    heartbeatWork: async () => ({ lease_extended: true, state: 'active' }),
    ...overrides,
  }
}

describe('densable 2.1.243 #55 env remint', () => {
  test('Pt / er constants 1:1', () => {
    expect(MAX_ENV_REREGISTER_ATTEMPTS).toBe(3)
    expect(MAX_PENDING_REQUEUE_ATTEMPTS).toBe(5)
  })

  test('It: 404/410 BridgeFatalError and environment-not-found text', () => {
    expect(isEnvironmentGone(new BridgeFatalError('gone', 404))).toBe(true)
    expect(isEnvironmentGone(new BridgeFatalError('gone', 410))).toBe(true)
    expect(isEnvironmentGone(new BridgeFatalError('denied', 403))).toBe(false)
    expect(isEnvironmentGone(new Error('Environment abc not found'))).toBe(true)
    expect(isEnvironmentGone(new Error('session not found'))).toBe(false)
  })

  test('gn: every BridgeFatalError is rejected, including 403', () => {
    expect(isClientReject(new BridgeFatalError('denied', 403))).toBe(true)
    expect(isClientReject(new BridgeFatalError('gone', 404))).toBe(true)
    expect(isClientReject({ status: 400 })).toBe(true)
    expect(isClientReject({ status: 408 })).toBe(false)
    expect(isClientReject({ status: 429 })).toBe(false)
    expect(isClientReject({ status: 500 })).toBe(false)
    expect(isClientReject(new Error('network'))).toBe(false)
  })

  test('Li reads retryAfterMs only when it is a number', () => {
    expect(retryAfterMs({ retryAfterMs: 1500 })).toBe(1500)
    expect(retryAfterMs({ retryAfterMs: '1500' })).toBeUndefined()
    expect(retryAfterMs(new Error('no'))).toBeUndefined()
  })

  test('ar appends reconnect suffix and normalizes trailing punct', () => {
    expect(formatExpiredReconnectMessage('Session expired')).toBe(
      'Session expired. Re-run `claude remote-control` to reconnect.',
    )
    expect(formatExpiredReconnectMessage('Session expired!')).toBe(
      'Session expired. Re-run `claude remote-control` to reconnect.',
    )
    expect(formatExpiredReconnectMessage('Session expired.  ')).toBe(
      'Session expired. Re-run `claude remote-control` to reconnect.',
    )
  })

  test('yt copy: crashed sessions + kept worktrees', () => {
    expect(
      formatOfflineCleanupMessages({
        crashedSessionCount: 0,
        keptWorktreePaths: [],
      }),
    ).toEqual([
      "This environment was cleaned up while the machine was offline and can't be resumed.",
      'Run `claude remote-control` to start a fresh environment.',
    ])
    expect(
      formatOfflineCleanupMessages({
        crashedSessionCount: 2,
        keptWorktreePaths: ['/tmp/a', '/tmp/b'],
      }),
    ).toEqual([
      "2 sessions ended while this machine was offline — the environment was cleaned up on the server and can't be resumed.",
      'Your work is safe — worktrees kept: /tmp/a, /tmp/b',
      'Run `claude remote-control` to start a fresh environment.',
    ])
  })

  test('pn remints in place and requeues transient reconnects', async () => {
    const reconnect = mock(async (_env: string, sessionId: string) => {
      if (sessionId === 's-retry') {
        throw Object.assign(new Error('try later'), { retryAfterMs: 2000 })
      }
    })
    const api = stubApi({ reconnectSession: reconnect })
    const active = new Map<string, unknown>([
      ['s-ok', {}],
      ['s-retry', {}],
    ])
    const result = await reregisterEnvironment({
      api,
      config: stubConfig(),
      environmentId: 'env-1',
      activeSessions: active,
      attempt: 1,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({
      outcome: 'reregistered',
      environmentSecret: 'secret-2',
      pendingRequeues: ['s-retry'],
    })
    expect(reconnect).toHaveBeenCalledTimes(2)
  })

  test('pn replaced environment_id is fatal and deletes the new env', async () => {
    const deregister = mock(async () => {})
    const api = stubApi({
      registerBridgeEnvironment: async () => ({
        environment_id: 'env-NEW',
        environment_secret: 'secret-x',
      }),
      deregisterEnvironment: deregister,
    })
    const result = await reregisterEnvironment({
      api,
      config: stubConfig(),
      environmentId: 'env-1',
      activeSessions: new Map(),
      attempt: 2,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ outcome: 'fatal' })
    expect(deregister).toHaveBeenCalledWith('env-NEW')
  })

  test('pn 403 register is fatal (register_rejected), not retried', async () => {
    const result = await reregisterEnvironment({
      api: stubApi({
        registerBridgeEnvironment: async () => {
          throw new BridgeFatalError('Access denied (403)', 403)
        },
      }),
      config: stubConfig(),
      environmentId: 'env-1',
      activeSessions: new Map(),
      attempt: 1,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ outcome: 'fatal' })
  })

  test('pn transient register returns retryAfterMs', async () => {
    const result = await reregisterEnvironment({
      api: stubApi({
        registerBridgeEnvironment: async () => {
          throw Object.assign(new Error('busy'), { retryAfterMs: 4000 })
        },
      }),
      config: stubConfig(),
      environmentId: 'env-1',
      activeSessions: new Map(),
      attempt: 1,
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ outcome: 'transient', retryAfterMs: 4000 })
  })

  test('tr: 403 BridgeFatalError is done (no spin) — #56', async () => {
    expect(
      await reconnectAfterReregister(
        stubApi({
          reconnectSession: async () => {
            throw new BridgeFatalError('Access denied (403)', 403)
          },
        }),
        'env-1',
        's1',
        new AbortController().signal,
      ),
    ).toBe('done')
    expect(
      await reconnectAfterReregister(
        stubApi({
          reconnectSession: async () => {
            throw new Error('network blip')
          },
        }),
        'env-1',
        's1',
        new AbortController().signal,
      ),
    ).toBe('retry')
  })

  test('u drops a session after er attempts', async () => {
    const pending = new Map<string, number>([['s1', 4]])
    const active = new Map<string, unknown>([['s1', {}]])
    await drainPendingRequeues({
      pendingRequeues: pending,
      activeSessions: active,
      api: stubApi({
        reconnectSession: async () => {
          throw new Error('still down')
        },
      }),
      environmentId: 'env-1',
      signal: new AbortController().signal,
    })
    expect(pending.size).toBe(0)
  })

  test('poll loop wires 404-only remint + crash-idle skip', () => {
    const src = readFileSync(join(import.meta.dir, '../bridgeMain.ts'), 'utf8')
    expect(src).toContain('err.status === 404')
    expect(src).toContain('sessionCrashed && activeSessions.size === 0')
    expect(src).toContain('MAX_ENV_REREGISTER_ATTEMPTS')
    expect(src).toContain('reregisterEnvironment')
    expect(src).toContain('drainPendingRequeues')
    expect(src).toContain('formatExpiredReconnectMessage')
    expect(src).toContain('formatOfflineCleanupMessages')
    expect(src).toContain("'gave_up'")
  })
})
