import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'
import { BridgeFatalError } from '../bridgeApi.js'
import { computeSecretRenewalAtMs } from '../bridgeMain.js'
import {
  handleServerControlRequest,
  SIDE_QUESTION_TIMEOUT_ERROR,
  SIDE_QUESTION_TIMEOUT_MS,
} from '../bridgeMessaging.js'
import { reregisterEnvironment } from '../envReregister.js'
import type { BridgeApiClient, BridgeConfig } from '../types.js'

const bridgeMainSrc = readFileSync(
  join(import.meta.dir, '../bridgeMain.ts'),
  'utf8',
)

describe('2.1.299-300 bridge alignments', () => {
  test('#730: handleServerControlRequest handles side_question and times out with 11-minute default / deadline override', async () => {
    expect(SIDE_QUESTION_TIMEOUT_MS).toBe(660_000)

    const written: unknown[] = []
    let aborted = false

    handleServerControlRequest(
      {
        type: 'control_request',
        request_id: 'sq-1',
        request: {
          subtype: 'side_question',
          question: 'what is this?',
        } as never,
      },
      {
        transport: {
          write: async (frame: unknown) => {
            written.push(frame)
          },
        } as never,
        sessionId: 'sess-1',
        sideQuestionDeadlineMs: 25,
        onSideQuestion: (_input, ctx) =>
          new Promise(_resolve => {
            ctx.signal.addEventListener('abort', () => {
              aborted = true
            })
          }),
      },
    )

    await new Promise(r => setTimeout(r, 80))
    expect(aborted).toBe(true)
    expect(written.length).toBe(1)
    expect(written[0]).toMatchObject({
      type: 'control_response',
      session_id: 'sess-1',
      response: {
        subtype: 'error',
        request_id: 'sq-1',
        error: SIDE_QUESTION_TIMEOUT_ERROR,
      },
    })
  })

  test('#786: computeSecretRenewalAtMs & proactive reregisterEnvironment return expiresIn and 401 status', async () => {
    expect(computeSecretRenewalAtMs(1800, 1000)).toBeUndefined()
    const renewAt = computeSecretRenewalAtMs(7200, 1_000_000, () => 0)
    expect(renewAt).toBe(1_000_000 + 7_200_000 - 900_000)

    const config = {
      dir: '/tmp',
      machineName: 'm',
      branch: 'main',
      gitRepoUrl: null,
      maxSessions: 1,
      spawnMode: 'same-dir',
      sandbox: false,
      bridgeId: 'b',
      environmentId: 'env-1',
    } as unknown as BridgeConfig

    const okApi = {
      registerBridgeEnvironment: async () => ({
        environment_id: 'env-1',
        environment_secret: 'sec-2',
        environment_secret_expires_in: 7200,
      }),
    } as unknown as BridgeApiClient

    const okRes = await reregisterEnvironment({
      api: okApi,
      config,
      environmentId: 'env-1',
      activeSessions: new Map(),
      attempt: 1,
      trigger: 'proactive',
      signal: new AbortController().signal,
    })
    expect(okRes).toEqual({
      outcome: 'reregistered',
      environmentSecret: 'sec-2',
      environmentSecretExpiresIn: 7200,
      pendingRequeues: [],
    })

    const err401Api = {
      registerBridgeEnvironment: async () => {
        throw new BridgeFatalError('unauthorized', 401)
      },
    } as unknown as BridgeApiClient

    const errRes = await reregisterEnvironment({
      api: err401Api,
      config,
      environmentId: 'env-1',
      activeSessions: new Map(),
      attempt: 1,
      trigger: 'proactive',
      signal: new AbortController().signal,
    })
    expect(errRes).toEqual({
      outcome: 'fatal',
      reason: 'register_rejected',
      status: 401,
      message: 'unauthorized',
    })

    expect(bridgeMainSrc).toContain(
      'Could not renew the Remote Control credential yet. The current one still works; trying again in about',
    )
    expect(bridgeMainSrc).toContain('Run \\`claude /login\\` to sign in again.')
  })

  test('#793: bridgeMain tracks per-session heartbeat timestamps', () => {
    expect(bridgeMainSrc).toContain('sessionLastHeartbeatWall')
    expect(bridgeMainSrc).toContain('onlySessionIds?: ReadonlySet<string>')
  })
})
