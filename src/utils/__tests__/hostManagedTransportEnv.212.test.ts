/**
 * densable 2.1.212 #19 — host-managed sessions ignore settings-sourced
 * mTLS / extra CA / OAuth scopes (LGm/KVt) with warning.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearHostManagedSettingsEnvStripWarnsForTests,
  stripHostManagedSettingsEnv,
} from '../managedEnv.js'
import {
  HOST_TRANSPORT_SENSITIVE_ENV_VARS,
  isHostProxyEnvVar,
  isHostTransportSensitiveEnvVar,
} from '../managedEnvConstants.js'

afterEach(() => {
  clearHostManagedSettingsEnvStripWarnsForTests()
})

describe('densable #19 LGm / KVt transport-sensitive set', () => {
  test('includes mTLS, extra CA, TLS reject, OAuth scopes', () => {
    expect(HOST_TRANSPORT_SENSITIVE_ENV_VARS.has('NODE_EXTRA_CA_CERTS')).toBe(
      true,
    )
    expect(
      HOST_TRANSPORT_SENSITIVE_ENV_VARS.has('CLAUDE_CODE_CLIENT_CERT'),
    ).toBe(true)
    expect(
      HOST_TRANSPORT_SENSITIVE_ENV_VARS.has('CLAUDE_CODE_CLIENT_KEY'),
    ).toBe(true)
    expect(
      HOST_TRANSPORT_SENSITIVE_ENV_VARS.has(
        'CLAUDE_CODE_CLIENT_KEY_PASSPHRASE',
      ),
    ).toBe(true)
    expect(
      HOST_TRANSPORT_SENSITIVE_ENV_VARS.has('NODE_TLS_REJECT_UNAUTHORIZED'),
    ).toBe(true)
    expect(
      HOST_TRANSPORT_SENSITIVE_ENV_VARS.has('CLAUDE_CODE_OAUTH_SCOPES'),
    ).toBe(true)
  })

  test('KVt is case-insensitive', () => {
    expect(isHostTransportSensitiveEnvVar('node_extra_ca_certs')).toBe(true)
    expect(isHostTransportSensitiveEnvVar('claude_code_oauth_scopes')).toBe(
      true,
    )
  })

  test('PGm proxy vars', () => {
    expect(isHostProxyEnvVar('HTTP_PROXY')).toBe(true)
    expect(isHostProxyEnvVar('https_proxy')).toBe(true)
    expect(isHostProxyEnvVar('NO_PROXY')).toBe(true)
  })
})

describe('densable #19 stripHostManagedSettingsEnv (byy)', () => {
  test('no host flags: pass through transport keys', () => {
    const env = {
      NODE_EXTRA_CA_CERTS: '/repo/ca.pem',
      CLAUDE_CODE_CLIENT_CERT: '/repo/cert.pem',
      CLAUDE_CODE_OAUTH_SCOPES: 'user:inference',
      FOO: 'bar',
    }
    expect(
      stripHostManagedSettingsEnv(env, {
        managedByHost: false,
        managedByHostFlag: false,
      }),
    ).toEqual(env)
  })

  test('managedByHostFlag strips LGm transport keys and warns once', () => {
    const stripped: string[] = []
    const out = stripHostManagedSettingsEnv(
      {
        NODE_EXTRA_CA_CERTS: '/repo/ca.pem',
        CLAUDE_CODE_CLIENT_CERT: '/repo/cert.pem',
        CLAUDE_CODE_CLIENT_KEY: '/repo/key.pem',
        CLAUDE_CODE_OAUTH_SCOPES: 'user:inference',
        SAFE_KEEP: '1',
      },
      {
        managedByHost: true,
        managedByHostFlag: true,
        source: 'projectSettings',
        onStrip: key => stripped.push(key),
      },
    )
    expect(out).toEqual({ SAFE_KEEP: '1' })
    expect(stripped.sort()).toEqual(
      [
        'CLAUDE_CODE_CLIENT_CERT',
        'CLAUDE_CODE_CLIENT_KEY',
        'CLAUDE_CODE_OAUTH_SCOPES',
        'NODE_EXTRA_CA_CERTS',
      ].sort(),
    )
  })

  test('managedByHost without flag still strips provider routing', () => {
    const stripped: string[] = []
    const out = stripHostManagedSettingsEnv(
      {
        CLAUDE_CODE_USE_BEDROCK: '1',
        NODE_EXTRA_CA_CERTS: '/repo/ca.pem',
        KEEP: 'yes',
      },
      {
        managedByHost: true,
        managedByHostFlag: false,
        onStrip: key => stripped.push(key),
      },
    )
    // LGm only under managedByHostFlag — CA kept when only host-auth marker
    expect(out.NODE_EXTRA_CA_CERTS).toBe('/repo/ca.pem')
    expect(out.KEEP).toBe('yes')
    expect(out.CLAUDE_CODE_USE_BEDROCK).toBeUndefined()
    expect(stripped).toContain('CLAUDE_CODE_USE_BEDROCK')
  })

  test('managedByHostFlag strips HTTP_PROXY (PGm)', () => {
    const out = stripHostManagedSettingsEnv(
      { HTTP_PROXY: 'http://corp:8080', KEEP: '1' },
      { managedByHost: true, managedByHostFlag: true, onStrip: () => {} },
    )
    expect(out).toEqual({ KEEP: '1' })
  })
})
