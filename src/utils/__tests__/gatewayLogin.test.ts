/**
 * densable 2.1.212 #43 — gateway OIDC login pure helpers ($zd / a6n / dl_ / wki).
 */
import { describe, expect, test } from 'bun:test'
import {
  GATEWAY_DEVICE_CODE_GRANT,
  extractOAuthDeviceError,
  formatGatewayTlsCertHint,
  isPrivateNetworkAddress,
  normalizeGatewayLoginUrl,
  resolveSameOriginOAuthEndpoint,
  gatewayDeviceAuthorizationResponseSchema,
  gatewayTokenResponseSchema,
} from '../gatewayLogin.js'

describe('densable #43 resolveSameOriginOAuthEndpoint ($zd)', () => {
  test('same-origin advertised endpoint kept', () => {
    expect(
      resolveSameOriginOAuthEndpoint(
        'https://gw.corp.local',
        'https://gw.corp.local/oauth/device_authorization',
        '/oauth/device_authorization',
      ),
    ).toBe('https://gw.corp.local/oauth/device_authorization')
  })

  test('cross-origin advertised endpoint ignored', () => {
    expect(
      resolveSameOriginOAuthEndpoint(
        'https://gw.corp.local',
        'https://evil.example/oauth/device_authorization',
        '/oauth/device_authorization',
      ),
    ).toBe('https://gw.corp.local/oauth/device_authorization')
  })

  test('missing advertised uses path fallback', () => {
    expect(
      resolveSameOriginOAuthEndpoint(
        'https://gw.corp.local',
        undefined,
        '/oauth/token',
      ),
    ).toBe('https://gw.corp.local/oauth/token')
  })
})

describe('densable #43 isPrivateNetworkAddress (a6n)', () => {
  test('RFC1918 and loopback', () => {
    expect(isPrivateNetworkAddress('10.0.0.1')).toBe(true)
    expect(isPrivateNetworkAddress('172.16.5.1')).toBe(true)
    expect(isPrivateNetworkAddress('192.168.1.1')).toBe(true)
    expect(isPrivateNetworkAddress('127.0.0.1')).toBe(true)
    expect(isPrivateNetworkAddress('::1')).toBe(true)
  })

  test('public addresses rejected', () => {
    expect(isPrivateNetworkAddress('8.8.8.8')).toBe(false)
    expect(isPrivateNetworkAddress('1.1.1.1')).toBe(false)
  })
})

describe('densable #43 normalizeGatewayLoginUrl (u6n)', () => {
  test('adds https and strips trailing slash', () => {
    expect(normalizeGatewayLoginUrl('gw.corp.local/')).toBe(
      'https://gw.corp.local',
    )
  })

  test('rejects non-loopback http', () => {
    expect(() => normalizeGatewayLoginUrl('http://10.0.0.5')).toThrow(
      /https:\/\//,
    )
  })
})

describe('densable #43 formatGatewayTlsCertHint (dl_)', () => {
  test('self-signed message yields CA hint', () => {
    const hint = formatGatewayTlsCertHint(
      new Error('self-signed certificate in certificate chain'),
    )
    expect(hint).toContain("Could not verify the gateway's TLS certificate")
    expect(hint).toContain('NODE_EXTRA_CA_CERTS')
  })

  test('unrelated errors return null', () => {
    expect(formatGatewayTlsCertHint(new Error('ENOTFOUND'))).toBeNull()
  })
})

describe('densable #43 extractOAuthDeviceError (wki)', () => {
  test('reads axios error string', () => {
    const err = Object.assign(new Error('400'), {
      isAxiosError: true,
      response: { data: { error: 'authorization_pending' } },
    })
    expect(extractOAuthDeviceError(err)).toBe('authorization_pending')
  })

  test('non-axios returns undefined', () => {
    expect(extractOAuthDeviceError(new Error('x'))).toBeUndefined()
  })
})

describe('densable #43 device/token schemas', () => {
  test('device grant constant', () => {
    expect(GATEWAY_DEVICE_CODE_GRANT).toBe(
      'urn:ietf:params:oauth:grant-type:device_code',
    )
  })

  test('device authorization response shape', () => {
    const r = gatewayDeviceAuthorizationResponseSchema.safeParse({
      device_code: 'dc',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://gw/device',
      expires_in: 600,
      interval: 5,
    })
    expect(r.success).toBe(true)
  })

  test('token response shape', () => {
    const r = gatewayTokenResponseSchema.safeParse({
      access_token: 'jwt',
      expires_in: 3600,
      refresh_token: 'rt',
    })
    expect(r.success).toBe(true)
  })
})
