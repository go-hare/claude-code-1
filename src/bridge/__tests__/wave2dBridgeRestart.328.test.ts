import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  BRIDGE_POINTER_BASE_TTL_MS,
  createBridgePointerWriteQueue,
  environmentRevivedAtAfter,
  getFreshActiveSessionIds,
  isPersistedStampFresh,
  PERSISTED_SESSION_RESUME_WINDOW_MS,
} from '../bridgePointer.js'
import {
  buildShutdownActiveSessionsSnapshot,
  requeueCarriedSessionsOnStart,
} from '../bridgeMain.js'
import {
  computeResumedTurnMaxAgeMs,
  RESUMED_TURN_BOUND_MAX_AGE_MS,
  RESUMED_TURN_NOT_BEFORE_CAP_MS,
} from '../sessionRunner.js'
import type { BridgeConfig, SessionSpawnOpts } from '../types.js'
import { BridgeFatalError } from '../bridgeApi.js'

describe('Wave 2D Bridge #1613 restart continuity & P2-#15 alignment', () => {
  test('#1613: bridgePointer environmentRevivedAtAfter & fresh activeSessionIds', () => {
    const now = 1_700_000_000_000
    // Age > 4h stamps nowMs
    expect(
      environmentRevivedAtAfter(
        {
          sessionId: 's1',
          environmentId: 'env_1',
          source: 'standalone',
          ageMs: BRIDGE_POINTER_BASE_TTL_MS + 1000,
        },
        now,
      ),
    ).toBe(now)

    // Age <= 4h preserves existing environmentRevivedAt
    expect(
      environmentRevivedAtAfter(
        {
          sessionId: 's1',
          environmentId: 'env_1',
          source: 'standalone',
          ageMs: 30_000,
          environmentRevivedAt: now - 500_000,
        },
        now,
      ),
    ).toBe(now - 500_000)

    expect(
      isPersistedStampFresh(
        now - 60_000,
        now,
        PERSISTED_SESSION_RESUME_WINDOW_MS,
      ),
    ).toBe(true)
    expect(
      isPersistedStampFresh(
        now - PERSISTED_SESSION_RESUME_WINDOW_MS - 1,
        now,
        PERSISTED_SESSION_RESUME_WINDOW_MS,
      ),
    ).toBe(false)

    const fresh = getFreshActiveSessionIds(
      {
        sessionId: 's1',
        environmentId: 'env_1',
        source: 'standalone',
        activeSessionIds: ['cse_1', 'cse_2'],
        activeSessionIdsPersistedAt: now - 10_000,
      },
      now,
    )
    expect(fresh.sessionIds).toEqual(['cse_1', 'cse_2'])
    expect(fresh.persistedAt).toBe(now - 10_000)

    const stale = getFreshActiveSessionIds(
      {
        sessionId: 's1',
        environmentId: 'env_1',
        source: 'standalone',
        activeSessionIds: ['cse_1'],
        activeSessionIdsPersistedAt:
          now - PERSISTED_SESSION_RESUME_WINDOW_MS - 1000,
      },
      now,
    )
    expect(stale.sessionIds).toEqual([])
  })

  test('#1613: createBridgePointerWriteQueue serializes concurrent writes', async () => {
    const enqueue = createBridgePointerWriteQueue()
    const order: number[] = []
    await Promise.all([
      enqueue(async () => {
        await new Promise(r => setTimeout(r, 20))
        order.push(1)
      }),
      enqueue(async () => {
        order.push(2)
      }),
    ])
    expect(order).toEqual([1, 2])
  })

  test('#1613: computeResumedTurnMaxAgeMs respects workerEpoch, boundResumedTurn, and resumedTurnNotBefore', () => {
    const now = 1_700_000_000_000
    expect(
      computeResumedTurnMaxAgeMs(
        {
          workerEpoch: 1,
          boundResumedTurn: true,
          resumedTurnNotBefore: now - 5000,
        },
        now,
      ),
    ).toBeUndefined()

    expect(
      computeResumedTurnMaxAgeMs(
        { workerEpoch: 2, boundResumedTurn: true },
        now,
      ),
    ).toBe(String(RESUMED_TURN_BOUND_MAX_AGE_MS))

    // Min of bound (1h) and elapsed since revival (45s) => 45_000
    expect(
      computeResumedTurnMaxAgeMs(
        {
          workerEpoch: 2,
          boundResumedTurn: true,
          resumedTurnNotBefore: now - 45_000,
        },
        now,
      ),
    ).toBe('45000')

    // Capped at 6h (Ue) when unbound
    expect(
      computeResumedTurnMaxAgeMs(
        {
          workerEpoch: 2,
          boundResumedTurn: false,
          resumedTurnNotBefore: now - 99_000_000,
        },
        now,
      ),
    ).toBe(String(RESUMED_TURN_NOT_BEFORE_CAP_MS))
  })

  test('#1613: requeueCarriedSessionsOnStart re-queues on env reuse and handles transient retries + env mismatch', async () => {
    const calls: string[] = []
    const res = await requeueCarriedSessionsOnStart({
      api: {
        reconnectSession: async (_envId, sid) => {
          calls.push(sid)
          if (sid === 'cse_transient') throw new Error('network timeout')
          if (sid === 'cse_gone') throw new BridgeFatalError('not found', 404)
        },
      },
      environmentId: 'env_1',
      reusedEnvironment: true,
      carriedSessionIds: ['cse_ok', 'cse_transient', 'cse_gone'],
      log: () => {},
    })
    expect(calls).toEqual(['cse_ok', 'cse_transient', 'cse_gone'])
    expect(res.carriedSessionIds).toEqual([
      'cse_ok',
      'cse_transient',
      'cse_gone',
    ])
    expect(res.retryLater).toEqual(['cse_transient'])
    expect(res.initialSessionRequeues).toEqual(['cse_transient'])

    const declined = await requeueCarriedSessionsOnStart({
      api: { reconnectSession: async () => {} },
      environmentId: 'env_new',
      reusedEnvironment: false,
      carriedSessionIds: ['cse_ok'],
      log: () => {},
    })
    expect(declined.carriedSessionIds).toEqual([])
    expect(declined.initialSessionRequeues).toEqual([])
  })

  test('#1613: buildShutdownActiveSessionsSnapshot orders busy -> fresh requeues -> idle', () => {
    const now = 1_700_000_000_000
    const snap = buildShutdownActiveSessionsSnapshot({
      activeSessionIds: ['cse_idle', 'cse_busy'],
      busySessionIds: new Set(['cse_busy']),
      pendingInitialRequeues: ['cse_pending', 'cse_idle'],
      initialRequeuesPersistedAt: now - 30_000,
      nowMs: now,
    })
    expect(snap.activeSessionIds).toEqual([
      'cse_busy',
      'cse_pending',
      'cse_idle',
    ])
    expect(snap.activeSessionIdsPersistedAt).toBe(now - 30_000)
  })

  test('P2-#15: bridgeMain.ts does not read fabricated CLAUDE_BRIDGE_FORK_FROM_TITLE env var', () => {
    const src = readFileSync(join(import.meta.dir, '../bridgeMain.ts'), 'utf8')
    expect(src).not.toContain('CLAUDE_BRIDGE_FORK_FROM_TITLE')
  })

  test('Wave 3D: BridgeConfig and SessionSpawnOpts directly expose restart continuity fields', () => {
    const cfg: BridgeConfig = {
      dir: '/tmp',
      machineName: 'box',
      branch: 'main',
      gitRepoUrl: null,
      maxSessions: 2,
      spawnMode: 'same-dir',
      verbose: false,
      sandbox: false,
      bridgeId: 'b1',
      workerType: 'claude_code',
      environmentId: 'e1',
      apiBaseUrl: 'https://api.example',
      sessionIngressUrl: 'wss://ingress.example',
      environmentRevivedAt: 1_700_000_000_000,
      carriedSessionIds: ['cse_1'],
      initialSessionRequeues: ['cse_2'],
      initialSessionRequeuesPersistedAt: 1_700_000_000_000,
      boundedResumeSessionIds: ['cse_3'],
      enqueuePointerWrite: fn => fn(),
    }
    const spawnOpts: SessionSpawnOpts = {
      sessionId: 'cse_1',
      sdkUrl: 'wss://ingress.example/s/cse_1',
      accessToken: 'tok',
      boundResumedTurn: true,
      resumedTurnNotBefore: 1_700_000_000_000,
    }
    expect(cfg.carriedSessionIds).toEqual(['cse_1'])
    expect(cfg.initialSessionRequeues).toEqual(['cse_2'])
    expect(spawnOpts.boundResumedTurn).toBe(true)
    expect(spawnOpts.resumedTurnNotBefore).toBe(1_700_000_000_000)
  })
})
