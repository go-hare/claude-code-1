/**
 * densable 2.1.251 #66 — qe / so / ro / oo / he (gold-251-f).
 */
import { describe, expect, test } from 'bun:test'
import {
  DANGEROUS_SANDBOX_QE_KEYS,
  getSandboxNestedValue,
  isDangerousSandboxQeValueSet,
  isSandboxCredentialsDenyOnly,
  projectDangerousSandboxQeSettings,
  sandboxAllowedDomainsProjection,
  SANDBOX_QE_ALLOWED_DOMAINS_KEYS,
} from '../dangerousSandboxQe.js'

describe('densable 2.1.251 #66 dangerousSandboxQe', () => {
  test('qe list matches SEA gold order', () => {
    expect([...DANGEROUS_SANDBOX_QE_KEYS]).toEqual([
      'allowAppleEvents',
      'credentials',
      'enableWeakerNestedSandbox',
      'enableWeakerNetworkIsolation',
      'filesystem.disabled',
      'network.allowAllUnixSockets',
      'network.allowMachLookup',
      'network.allowUnixSockets',
      'network.httpProxyPort',
      'network.socksProxyPort',
      'network.tlsTerminate',
    ])
  })

  test('no set is credentials + network.tlsTerminate', () => {
    expect([...SANDBOX_QE_ALLOWED_DOMAINS_KEYS].sort()).toEqual([
      'credentials',
      'network.tlsTerminate',
    ])
  })

  test('he reads dotted paths', () => {
    const sandbox = {
      network: {
        tlsTerminate: { caCertPath: '/ca' },
        allowedDomains: ['b.com'],
      },
      filesystem: { disabled: true },
    }
    expect(getSandboxNestedValue(sandbox, 'filesystem.disabled')).toBe(true)
    expect(getSandboxNestedValue(sandbox, 'network.tlsTerminate')).toEqual({
      caCertPath: '/ca',
    })
    expect(getSandboxNestedValue(sandbox, 'network.missing')).toBeUndefined()
  })

  test('oo unique-sorts string domains', () => {
    expect(
      sandboxAllowedDomainsProjection(['b.com', 'a.com', 'b.com']),
    ).toEqual(['a.com', 'b.com'])
    expect(sandboxAllowedDomainsProjection(null)).toBeUndefined()
    expect(sandboxAllowedDomainsProjection([1, 'x'])).toEqual(['x'])
  })

  test('so false for undef/null/false/empty-array', () => {
    expect(isDangerousSandboxQeValueSet('x', undefined)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', null)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', false)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', [])).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', true)).toBe(true)
  })

  test('ro deny-only credentials skip so; mask/allowPlaintext require approval', () => {
    const denyOnly = {
      files: [{ path: '/a', mode: 'deny' }],
      envVars: [{ name: 'K', mode: 'deny' }],
      sigv4: { streaming: 'deny' },
      allowPlaintextInject: false,
    }
    expect(isSandboxCredentialsDenyOnly(denyOnly)).toBe(true)
    expect(isDangerousSandboxQeValueSet('credentials', denyOnly)).toBe(false)

    const mask = {
      envVars: [{ name: 'AWS_ACCESS_KEY_ID', mode: 'mask' }],
    }
    expect(isSandboxCredentialsDenyOnly(mask)).toBe(false)
    expect(isDangerousSandboxQeValueSet('credentials', mask)).toBe(true)

    expect(
      isDangerousSandboxQeValueSet('credentials', {
        allowPlaintextInject: true,
      }),
    ).toBe(true)
  })

  test('project puts qe keys under sandbox.* and attaches allowedDomains for no', () => {
    const bag = projectDangerousSandboxQeSettings({
      enabled: true,
      enableWeakerNestedSandbox: true,
      filesystem: { disabled: false },
      credentials: {
        envVars: [{ name: 'T', mode: 'mask' }],
      },
      network: {
        tlsTerminate: {},
        httpProxyPort: 8080,
        allowedDomains: ['z.example', 'a.example', 'z.example'],
        allowMachLookup: ['com.example.*'],
      },
    })
    expect(bag['sandbox.enableWeakerNestedSandbox']).toEqual({
      value: true,
      enabled: true,
    })
    expect(bag['sandbox.filesystem.disabled']).toBeUndefined()
    expect(bag['sandbox.network.httpProxyPort']).toEqual({
      value: 8080,
      enabled: true,
    })
    expect(bag['sandbox.network.allowMachLookup']).toEqual({
      value: ['com.example.*'],
      enabled: true,
    })
    expect(bag['sandbox.network.tlsTerminate']).toEqual({
      value: {},
      enabled: true,
      allowedDomains: ['a.example', 'z.example'],
    })
    expect(bag['sandbox.credentials']).toEqual({
      value: {
        envVars: [{ name: 'T', mode: 'mask' }],
      },
      enabled: true,
      allowedDomains: ['a.example', 'z.example'],
    })
  })
})
