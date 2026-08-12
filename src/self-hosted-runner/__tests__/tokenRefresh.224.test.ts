/**
 * densable 2.1.224 #1 — token refresh scheduler + push/ack helpers.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  DEFAULT_MAX_REFRESH_FAILURES,
  DEFAULT_REFRESH_BUFFER_MS,
  FALLBACK_REFRESH_MS,
  NO_OAUTH_RETRY_MS,
  TOKEN_ACK_GRACE_MS,
  __resetTokenPushSeqForTests,
  createRunnerTokenRefreshScheduler,
  createTokenRefreshScheduler,
  decodeJwtExpirySeconds,
  decodeRunnerTokenExpirySeconds,
  formatDelayMs,
  pushTokenToChild,
  sweepPendingTokenAcks,
} from '../tokenRefresh.js'

function makeJwt(expSec: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString(
    'base64url',
  )
  const payload = Buffer.from(JSON.stringify({ exp: expSec })).toString(
    'base64url',
  )
  return `${header}.${payload}.sig`
}

afterEach(() => {
  __resetTokenPushSeqForTests()
})

describe('densable 2.1.224 #1 tokenRefresh (tur/qUi/q2h/j2h)', () => {
  test('decodeJwtExpirySeconds + runner sk-ant strip (jJl)', () => {
    const exp = Math.floor(Date.now() / 1000) + 3600
    const jwt = makeJwt(exp)
    expect(decodeJwtExpirySeconds(jwt)).toBe(exp)
    expect(decodeRunnerTokenExpirySeconds(`sk-ant-sid-${jwt}`)).toBe(exp)
    expect(decodeJwtExpirySeconds('not-a-jwt')).toBeNull()
  })

  test('formatDelayMs (Ws subset)', () => {
    expect(formatDelayMs(5000)).toBe('5s')
    expect(formatDelayMs(60_000)).toBe('1m')
    expect(formatDelayMs(90_000)).toBe('1m 30s')
  })

  test('constants match SEA Zo_/ei_/ti_/jas', () => {
    expect(DEFAULT_REFRESH_BUFFER_MS).toBe(300_000)
    expect(DEFAULT_MAX_REFRESH_FAILURES).toBe(3)
    expect(NO_OAUTH_RETRY_MS).toBe(60_000)
    expect(FALLBACK_REFRESH_MS).toBe(1_800_000)
    expect(TOKEN_ACK_GRACE_MS).toBe(90_000)
  })

  test('createTokenRefreshScheduler refreshes when within buffer', async () => {
    const tokens: string[] = []
    const getAccessToken = mock(async () => 'new-token-abc')
    const scheduler = createTokenRefreshScheduler({
      getAccessToken,
      onRefresh: (_sid, t) => {
        tokens.push(t)
      },
      label: 'test',
      refreshBufferMs: 60_000,
    })
    const exp = Math.floor(Date.now() / 1000) + 30 // expires in 30s < buffer
    scheduler.schedule('sess-1', makeJwt(exp))
    await new Promise(r => setTimeout(r, 30))
    expect(getAccessToken).toHaveBeenCalled()
    expect(tokens).toEqual(['new-token-abc'])
    scheduler.cancelAll()
  })

  test('createRunnerTokenRefreshScheduler uses adaptive + infinite fails', () => {
    const scheduler = createRunnerTokenRefreshScheduler({
      getAccessToken: async () => null,
      onRefresh: () => {},
      label: 'self-hosted-runner',
    })
    scheduler.schedule(
      'runner',
      makeJwt(Math.floor(Date.now() / 1000) + 10_000),
    )
    scheduler.cancelAll()
  })

  test('pushTokenToChild + sweepPendingTokenAcks', () => {
    const lines: string[] = []
    const pending = new Map()
    const statuses: string[] = []
    const rid = pushTokenToChild({
      label: 'session',
      sessionId: 's1',
      envVar: 'CLAUDE_CODE_SESSION_ACCESS_TOKEN',
      token: 'tok',
      write: line => lines.push(line),
      pendingAcks: pending,
      onStatus: m => statuses.push(m),
      nowMs: 1_000,
    })
    expect(rid).toMatch(/^shr-token-session-/)
    expect(pending.has(rid!)).toBe(true)
    expect(lines[0]).toContain('update_environment_variables')
    expect(JSON.parse(lines[0]!)).toMatchObject({
      type: 'update_environment_variables',
      variables: { CLAUDE_CODE_SESSION_ACCESS_TOKEN: 'tok' },
      request_id: rid,
    })

    sweepPendingTokenAcks({
      pendingAcks: pending,
      sessionId: 's1',
      onStatus: m => statuses.push(m),
      nowMs: 1_000 + TOKEN_ACK_GRACE_MS + 1,
    })
    expect(pending.size).toBe(0)
    expect(statuses.some(s => s.includes('never acked'))).toBe(true)
  })

  test('pushTokenToChild without write warns', () => {
    const statuses: string[] = []
    const rid = pushTokenToChild({
      label: 'runner',
      sessionId: 's1',
      envVar: 'X',
      token: 't',
      onStatus: m => statuses.push(m),
    })
    expect(rid).toBeUndefined()
    expect(statuses[0]).toMatch(/stdin is not wired/)
  })
})
