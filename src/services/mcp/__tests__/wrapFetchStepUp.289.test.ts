import { describe, expect, test } from 'bun:test'
import {
  ClaudeAuthProvider,
  parseWwwAuthenticateBearer,
  wrapFetchWithStepUpDetection,
} from '../auth.js'

function provider(): ClaudeAuthProvider {
  return new ClaudeAuthProvider('s', {
    type: 'http',
    url: 'https://example.com/mcp',
  } as never)
}

function pendingOf(p: ClaudeAuthProvider): string | undefined {
  return (p as unknown as { _pendingStepUpScope?: string })._pendingStepUpScope
}

const AUTH = { headers: { Authorization: 'Bearer t' } }

describe('densable Trn wrapFetchWithStepUpDetection', () => {
  test('401/403 stamps sawAuthChallenge', async () => {
    const p = provider()
    const wrapped = wrapFetchWithStepUpDetection(
      async () => new Response(null, { status: 401 }),
      p,
    )
    await wrapped('https://other.example/x')
    expect(p.sawAuthChallenge).toBe(true)
    expect(p.authChallengeOpen).toBe(false)
  })

  test('matching URL 401 sets authChallengeOpen', async () => {
    const url = 'https://example.com/mcp'
    const p = provider()
    const wrapped = wrapFetchWithStepUpDetection(
      async () => new Response(null, { status: 401 }),
      p,
    )
    await wrapped(url)
    expect(p.sawAuthChallenge).toBe(true)
    expect(p.authChallengeOpen).toBe(true)
  })

  test('401 with Authorization clears pending step-up (2.1.289 Trn)', async () => {
    const p = provider()
    p.markStepUpPending('tools:write')
    const wrapped = wrapFetchWithStepUpDetection(
      async () => new Response(null, { status: 401 }),
      p,
    )
    await wrapped('https://example.com/mcp', AUTH)
    expect(p.sawAuthChallenge).toBe(true)
    expect(pendingOf(p)).toBeUndefined()
  })

  test('403 double-space Bearer still marks step-up', async () => {
    const p = provider()
    const wrapped = wrapFetchWithStepUpDetection(
      async () =>
        new Response(null, {
          status: 403,
          headers: {
            'WWW-Authenticate':
              'Bearer  error="insufficient_scope", scope="tools:write"',
          },
        }),
      p,
    )
    await wrapped('https://example.com/mcp', AUTH)
    expect(p.sawAuthChallenge).toBe(true)
    expect(pendingOf(p)).toBe('tools:write')
  })
})

describe('densable yye parseWwwAuthenticateBearer', () => {
  test('parses Bearer fields without splitting on a single SP', () => {
    expect(
      parseWwwAuthenticateBearer(
        new Response(null, {
          headers: {
            'WWW-Authenticate':
              'Bearer  error="insufficient_scope", scope="openid"',
          },
        }),
      ),
    ).toEqual({ error: 'insufficient_scope', scope: 'openid' })
    expect(
      parseWwwAuthenticateBearer(
        new Response(null, {
          headers: { 'WWW-Authenticate': 'Basic realm="mcp"' },
        }),
      ),
    ).toEqual({})
    expect(parseWwwAuthenticateBearer(new Response(null))).toEqual({})
  })
})
