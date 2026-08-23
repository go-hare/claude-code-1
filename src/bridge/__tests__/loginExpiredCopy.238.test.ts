/**
 * densable 2.1.238 #25 — login-expired copy + OAi typed create + x1r wiring.
 * Skeleton E2E covers Ccb=3 onExhausted; live network remint stays out of CI.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  classifyCodeSessionCreateStatus,
  formatCodeSessionCreateFailure,
  isCreateSessionFailure,
  isGroupingRejection,
  SESSION_CREATE_MALFORMED_RESPONSE_DETAIL,
} from '../codeSessionApi.js'
import { createTokenRefreshScheduler } from '../jwtUtils.js'
import {
  CLAUDE_AI_LOGIN_EXPIRED_RESTORE_DETAIL,
  CLAUDE_AI_LOGIN_EXPIRED_THEN_REMOTE_CONTROL_DETAIL,
  CLAUDE_AI_LOGIN_REJECTED_DETAIL,
  JWT_REFRESH_NO_OAUTH_DETAIL,
  OAUTH_REAUTH_REQUIRED_DETAIL,
  OAUTH_TOKEN_UNAVAILABLE_RESTORE_DETAIL,
} from '../remintRecovery.js'

const core = readFileSync(
  join(import.meta.dir, '../remoteBridgeCore.ts'),
  'utf8',
)
const jwt = readFileSync(join(import.meta.dir, '../jwtUtils.ts'), 'utf8')

describe('densable 2.1.238 #25 login-expired copy', () => {
  test('cr/kt/Gt/yr/exhausted strings 1:1', () => {
    expect(JWT_REFRESH_NO_OAUTH_DETAIL).toBe(
      'JWT refresh failed: no OAuth token — run /login',
    )
    expect(CLAUDE_AI_LOGIN_REJECTED_DETAIL).toBe(
      'Claude.ai login was rejected — run /login, then /remote-control',
    )
    expect(CLAUDE_AI_LOGIN_EXPIRED_THEN_REMOTE_CONTROL_DETAIL).toBe(
      'Claude.ai login expired — run /login, then /remote-control',
    )
    expect(CLAUDE_AI_LOGIN_EXPIRED_RESTORE_DETAIL).toBe(
      'Claude.ai login expired — run /login to restore Remote Control',
    )
    expect(OAUTH_TOKEN_UNAVAILABLE_RESTORE_DETAIL).toBe(
      'OAuth token unavailable — run /login to restore Remote Control',
    )
  })

  test('remint Hde copy stays OAUTH_REAUTH_REQUIRED_DETAIL', () => {
    expect(OAUTH_REAUTH_REQUIRED_DETAIL).toBe(
      'OAuth token refresh failed — run /login to re-authenticate',
    )
  })
})

describe('densable 2.1.238 #25 OAi classify / FOf / mr', () => {
  test('401 → oauth_rejected object (not null)', () => {
    expect(classifyCodeSessionCreateStatus(401, {})).toEqual({
      terminal: false,
      reason: 'oauth_rejected',
    })
  })

  test('FOf grouping 4xx beats 401 oauth_rejected', () => {
    const body = {
      error: {
        type: 'not_found_error',
        resource_type: 'session_grouping',
      },
    }
    expect(isGroupingRejection(body)).toBe(true)
    expect(classifyCodeSessionCreateStatus(401, body)).toEqual({
      terminal: true,
      reason: 'grouping_rejected',
      status: 401,
      detail: undefined,
    })
    expect(
      isGroupingRejection({
        error: { reason: 'public_grouping_hosted_only' },
      }),
    ).toBe(true)
    expect(isGroupingRejection({ error: { reason: 'feature_disabled' } })).toBe(
      true,
    )
    expect(isGroupingRejection({ error: { type: 'not_found_error' } })).toBe(
      false,
    )
  })

  test('400 rejected / 503 transient', () => {
    expect(classifyCodeSessionCreateStatus(400, {})).toEqual({
      terminal: true,
      reason: 'request_rejected',
      status: 400,
      detail: undefined,
    })
    expect(classifyCodeSessionCreateStatus(503, {})).toBeNull()
    expect(classifyCodeSessionCreateStatus(429, {})).toBeNull()
  })

  test('mr grouping / request_rejected / malformed / generic', () => {
    expect(
      formatCodeSessionCreateFailure(
        {
          terminal: true,
          reason: 'grouping_rejected',
          status: 404,
          detail: 'gone',
        },
        { groupingId: 'proj', requestedGrouping: true },
      ),
    ).toBe(
      "Couldn't create a session in the requested Project (server 404: gone). The Project may not exist or may not be available to you.",
    )
    expect(
      formatCodeSessionCreateFailure(
        {
          terminal: true,
          reason: 'grouping_rejected',
          status: 404,
        },
        { groupingId: 'proj' },
      ),
    ).toContain("Couldn't recreate the session in its previous Project")
    expect(
      formatCodeSessionCreateFailure({
        terminal: true,
        reason: 'request_rejected',
        status: 400,
      }),
    ).toBe('Session creation failed (server 400) — see debug log')
    expect(
      formatCodeSessionCreateFailure({
        terminal: true,
        reason: 'malformed_response',
        status: 200,
      }),
    ).toBe(SESSION_CREATE_MALFORMED_RESPONSE_DETAIL)
    expect(formatCodeSessionCreateFailure(null)).toBe(
      'Session creation failed — see debug log',
    )
    expect(
      isCreateSessionFailure({
        terminal: true,
        reason: 'malformed_response',
      }),
    ).toBe(true)
  })
})

describe('densable 2.1.238 #25 remoteBridgeCore / x1r wiring', () => {
  test('Ot uses kt + v2_session_create_oauth_rejected', () => {
    expect(core).toContain('CLAUDE_AI_LOGIN_REJECTED_DETAIL')
    expect(core).toContain('v2_session_create_oauth_rejected')
    expect(core).toContain('reportSessionCreateFailure')
    expect(core).toContain("typeof minted !== 'string'")
  })

  test('initial /bridge soe uses Gt + v2_remote_creds_oauth_rejected', () => {
    expect(core).toContain('CLAUDE_AI_LOGIN_EXPIRED_THEN_REMOTE_CONTROL_DETAIL')
    expect(core).toContain('v2_remote_creds_oauth_rejected')
  })

  test('proactive null/soe uses yr; remint no-oauth uses cr', () => {
    expect(core).toContain('CLAUDE_AI_LOGIN_EXPIRED_RESTORE_DETAIL')
    expect(core).toContain('JWT_REFRESH_NO_OAUTH_DETAIL')
    expect(core).toContain('OAUTH_REAUTH_REQUIRED_DETAIL')
  })

  test('x1r onExhausted wired; jwtUtils fires after Ccb=3', () => {
    expect(core).toContain('onExhausted:')
    expect(core).toContain('OAUTH_TOKEN_UNAVAILABLE_RESTORE_DETAIL')
    expect(jwt).toContain('onExhausted')
    expect(jwt).toContain('Refresh chain exhausted for sessionId=')
    expect(jwt).toContain('bridge_token_refresh_exhausted')
    expect(jwt).toContain("onExhausted?.(sessionId, 'no_oauth_token')")
  })

  test('skeleton E2E: Ccb=3 consecutive no-oauth fires onExhausted', async () => {
    const exhausted: Array<[string, string]> = []
    const realSetTimeout = globalThis.setTimeout
    // Collapse REFRESH_RETRY_DELAY_MS (60s) so the Ccb chain finishes in CI.
    globalThis.setTimeout = ((
      fn: TimerHandler,
      ms?: number,
      ...args: unknown[]
    ) =>
      realSetTimeout(
        fn,
        typeof ms === 'number' && ms >= 1_000 ? 0 : ms,
        ...args,
      )) as typeof setTimeout

    let sched: ReturnType<typeof createTokenRefreshScheduler> | undefined
    try {
      sched = createTokenRefreshScheduler({
        getAccessToken: async () => undefined,
        onRefresh: () => {
          throw new Error('onRefresh must not fire without oauth')
        },
        onExhausted: (sessionId, reason) => {
          exhausted.push([sessionId, reason])
        },
        label: 'test-x1r',
        refreshBufferMs: 0,
      })
      const exp = Math.floor(Date.now() / 1000) - 60
      const payload = Buffer.from(JSON.stringify({ exp })).toString('base64url')
      sched.schedule('sess_ccb', `hdr.${payload}.sig`)

      const deadline = Date.now() + 2_000
      while (exhausted.length === 0 && Date.now() < deadline) {
        await new Promise<void>(r => realSetTimeout(r, 5))
      }
      expect(exhausted).toEqual([['sess_ccb', 'no_oauth_token']])
    } finally {
      sched?.cancelAll()
      globalThis.setTimeout = realSetTimeout
    }
  })
})
