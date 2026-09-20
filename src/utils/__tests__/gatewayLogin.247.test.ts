/**
 * densable 2.1.247 #32 — gateway sign-in identifies Claude Code.
 *
 * Official Qe/J/K/jK (claude.exe):
 *   jr = "claude_code"
 *   device POST body = URLSearchParams({surface:jr})
 *   metadata/device/token/refresh send User-Agent: be()/pr()
 *   be/pr = getClaudeCodeUserAgent → `claude-code/<version>`
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  GATEWAY_LOGIN_SURFACE,
  gatewayDeviceAuthorizationBody,
  gatewayLoginFormHeaders,
  gatewayLoginMetadataHeaders,
  getGatewayLoginUserAgent,
} from '../gatewayLogin.js'
import { clearGatewayAuth, maybeRefreshGatewayIdp } from '../gatewayEnv.js'

// MACRO.VERSION is only injected in dev/build. Stub before UA reads.
;(globalThis as unknown as { MACRO: { VERSION: string } }).MACRO = {
  VERSION: '2.1.247-test',
}

afterEach(() => {
  clearGatewayAuth()
})

describe('densable 2.1.247 #32 gateway surface + User-Agent', () => {
  test('device-authorization form param is surface=claude_code (jr)', () => {
    expect(GATEWAY_LOGIN_SURFACE).toBe('claude_code')
    expect(gatewayDeviceAuthorizationBody()).toBe('surface=claude_code')
  })

  test('User-Agent is claude-code/<version> (be/pr)', () => {
    const ua = getGatewayLoginUserAgent()
    expect(ua.startsWith('claude-code/')).toBe(true)
    expect(ua).toMatch(/^claude-code\/\S+$/)
  })

  test('metadata GET headers send User-Agent only', () => {
    const headers = gatewayLoginMetadataHeaders()
    expect(Object.keys(headers)).toEqual(['User-Agent'])
    expect(headers['User-Agent']?.startsWith('claude-code/')).toBe(true)
  })

  test('device/token form headers send Content-Type + User-Agent', () => {
    const headers = gatewayLoginFormHeaders()
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(headers['User-Agent']?.startsWith('claude-code/')).toBe(true)
  })

  test('refresh POST headers include User-Agent claude-code/ (jK/pr)', async () => {
    let captured: Record<string, string> | undefined
    const result = await maybeRefreshGatewayIdp({
      session: {
        url: 'https://gw.example',
        jwt: 'old',
        expiresAtMs: Date.now() + 1_000,
        idpRefreshToken: 'r1',
        unpinned: true,
      },
      nowMs: Date.now(),
      autoPersist: false,
      postToken: async args => {
        captured = args.headers
        return {
          data: {
            access_token: 'fresh',
            expires_in: 300,
            refresh_token: 'r2',
          },
        }
      },
    })
    expect(result.status).toBe('refreshed')
    expect(captured?.['Content-Type']).toBe('application/x-www-form-urlencoded')
    expect(captured?.['User-Agent']?.startsWith('claude-code/')).toBe(true)
  })
})
