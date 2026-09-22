/**
 * densable 2.1.248 #24 — official `ko` / `x6e` / `re` / skip `EFe`.
 * GOLD: gold-248-24-official-host.txt (`ko` @207025228, flags @207040674).
 * Unique vs 247: helperMintsAuthHeader → HEADERS_HELPER_AUTH_REJECTED.
 * Do not invent skip on a truthy headersHelper string (`!!helper`).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { classifyAuthReconnectKind } from '../authReconnect.js'
import { HIDDEN_MCP_ERROR_CODES } from '../mcpConnectionIssue.js'
import {
  AUTH_HEADER_REJECTED,
  classifyConnectAuthHeaderRejection,
  HEADERS_HELPER_AUTH_REJECTED,
  headersHaveAuthorization,
  helperMintsAuthHeader,
  hasUserAuthHeader,
  resolveConnectAuthFlags,
  shouldSkipOAuthAuthProvider,
} from '../connectAuthClassify.js'

const clientSrc = readFileSync(join(import.meta.dir, '../client.ts'), 'utf8')

function unauthorized(status = 401): Error & { code: number } {
  return Object.assign(new Error('Unauthorized'), {
    name: 'UnauthorizedError',
    code: status,
  })
}

describe('densable 2.1.248 #24 headersHelper 401 vs OAuth', () => {
  test('HOST skips authProvider and classifies minted Authorization', () => {
    expect(clientSrc).toContain('resolveRemoteConnectAuth')
    expect(clientSrc).toContain('shouldSkipOAuthAuthProvider')
    expect(clientSrc).toContain('maybeConnectAuthHeaderRejection')
    expect(clientSrc).toContain('helperMintsAuthHeader')
    expect(clientSrc).not.toContain('helperMintsAuthHeader: !!')
    expect(HIDDEN_MCP_ERROR_CODES.has(HEADERS_HELPER_AUTH_REJECTED)).toBe(true)
  })

  test('x6e: Authorization header case-insensitive', () => {
    expect(headersHaveAuthorization({ Authorization: 'Bearer x' })).toBe(true)
    expect(headersHaveAuthorization({ authorization: 'Bearer x' })).toBe(true)
    expect(headersHaveAuthorization({ Accept: 'application/json' })).toBe(false)
  })

  test('ce: static http/sse Authorization; re: helper + minted Authorization', () => {
    expect(
      hasUserAuthHeader({
        type: 'http',
        headers: { Authorization: 'Bearer static' },
      }),
    ).toBe(true)
    expect(
      helperMintsAuthHeader(
        { type: 'http', headersHelper: 'mint.sh' },
        { Authorization: 'Bearer minted' },
      ),
    ).toBe(true)
    expect(
      helperMintsAuthHeader(
        { type: 'http', headersHelper: 'mint.sh' },
        { 'X-Api-Key': 'k' },
      ),
    ).toBe(false)
    expect(
      helperMintsAuthHeader({ type: 'http' }, { Authorization: 'Bearer x' }),
    ).toBe(false)
  })

  test('k=ce||re?void 0: skip OAuth authProvider', () => {
    const minted = resolveConnectAuthFlags(
      { type: 'http', headersHelper: 'mint.sh' },
      { Authorization: 'Bearer minted' },
    )
    expect(minted.helperMintsAuthHeader).toBe(true)
    expect(shouldSkipOAuthAuthProvider(minted)).toBe(true)
    const helperNoAuth = resolveConnectAuthFlags(
      { type: 'http', headersHelper: 'mint.sh' },
      { 'X-Api-Key': 'k' },
    )
    expect(shouldSkipOAuthAuthProvider(helperNoAuth)).toBe(false)
  })

  test('ko: static Authorization → AUTH_HEADER_REJECTED (wins over helper)', () => {
    const r = classifyConnectAuthHeaderRejection({
      error: unauthorized(),
      statusCode: 401,
      hasUserAuthHeader: true,
      helperMintsAuthHeader: true,
    })
    expect(r?.errorCode).toBe(AUTH_HEADER_REJECTED)
    expect(r?.message).toContain(
      'OAuth fallback is disabled when headers.Authorization is set',
    )
  })

  test('ko: helper minted Authorization → HEADERS_HELPER_AUTH_REJECTED', () => {
    const r = classifyConnectAuthHeaderRejection({
      error: unauthorized(403),
      statusCode: 403,
      hasUserAuthHeader: false,
      helperMintsAuthHeader: true,
    })
    expect(r?.errorCode).toBe(HEADERS_HELPER_AUTH_REJECTED)
    expect(r?.message).toContain(
      'disabled when the helper supplies Authorization',
    )
    expect(r?.message).toContain('HTTP 403')
    expect(r?.message).toContain('minted by the configured headersHelper')
  })

  test('ko: no Authorization already set → undefined (OAuth Yo path)', () => {
    expect(
      classifyConnectAuthHeaderRejection({
        error: unauthorized(),
        statusCode: 401,
        hasUserAuthHeader: false,
        helperMintsAuthHeader: false,
      }),
    ).toBeUndefined()
  })

  test('tool 401: helper re-runs; gC static Authorization skips oauth refresh', () => {
    expect(
      classifyAuthReconnectKind({
        type: 'http',
        headersHelper: 'mint.sh',
        hasRefreshToken: true,
        hasUserAuthHeader: true,
      }),
    ).toBe('mcp_headers_helper')
    expect(
      classifyAuthReconnectKind({
        type: 'http',
        url: 'https://x',
        hasRefreshToken: true,
        hasUserAuthHeader: true,
      }),
    ).toBeNull()
  })
})
