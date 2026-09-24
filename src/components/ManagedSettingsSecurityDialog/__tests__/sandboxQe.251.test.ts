/**
 * densable 2.1.251 #66 — qe sandbox weakening keys enter sandboxSettings;
 * so() gates empty; Zor hash includes the bag.
 */
import { describe, expect, test } from 'bun:test'
import type { SettingsJson } from '../../../utils/settings/types.js'
import {
  DANGEROUS_SANDBOX_QE_KEYS,
  extractDangerousSettings,
  formatSandboxQeSettingValue,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
  isDangerousSandboxQeValueSet,
  listManagedSettingsForApproval,
} from '../utils.js'
import {
  hashDangerousSettings,
  hashSettingsDangerousProjection,
} from '../../../services/remoteManagedSettings/orgConsent.js'

describe('densable 2.1.251 #66 sandbox qe projection', () => {
  test('qe list matches SEA gold (exact order)', () => {
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

  test('so is false for undef/null/false/empty-array', () => {
    expect(isDangerousSandboxQeValueSet('x', undefined)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', null)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', false)).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', [])).toBe(false)
    expect(isDangerousSandboxQeValueSet('x', true)).toBe(true)
    expect(isDangerousSandboxQeValueSet('x', 1)).toBe(true)
    expect(isDangerousSandboxQeValueSet('x', { a: 1 })).toBe(true)
  })

  test('weaker nested/network + tlsTerminate enter sandboxSettings', () => {
    const d = extractDangerousSettings({
      sandbox: {
        enabled: true,
        enableWeakerNestedSandbox: true,
        enableWeakerNetworkIsolation: true,
        network: {
          tlsTerminate: { caCertPath: '/ca.pem', caKeyPath: '/ca.key' },
          allowedDomains: ['api.example.com'],
          httpProxyPort: 8080,
        },
      },
    } as SettingsJson)

    expect(d.sandboxSettings['sandbox.enableWeakerNestedSandbox']).toBe(
      formatSandboxQeSettingValue({
        value: true,
        enabled: true,
      }),
    )
    expect(d.sandboxSettings['sandbox.enableWeakerNetworkIsolation']).toBe(
      formatSandboxQeSettingValue({
        value: true,
        enabled: true,
      }),
    )
    expect(d.sandboxSettings['sandbox.network.httpProxyPort']).toBe(
      formatSandboxQeSettingValue({
        value: 8080,
        enabled: true,
      }),
    )
    // tlsTerminate is in no → attaches allowedDomains
    expect(d.sandboxSettings['sandbox.network.tlsTerminate']).toBe(
      formatSandboxQeSettingValue({
        value: { caCertPath: '/ca.pem', caKeyPath: '/ca.key' },
        enabled: true,
        allowedDomains: ['api.example.com'],
      }),
    )
    expect(d.shellSettings['sandbox.enableWeakerNestedSandbox']).toBeUndefined()
    expect(hasDangerousSettings(d)).toBe(true)
  })

  test('filesystem.disabled true is dangerous; false is not', () => {
    const on = extractDangerousSettings({
      sandbox: { filesystem: { disabled: true } },
    } as SettingsJson)
    expect(on.sandboxSettings['sandbox.filesystem.disabled']).toBeDefined()

    const off = extractDangerousSettings({
      sandbox: { filesystem: { disabled: false } },
    } as SettingsJson)
    expect(off.sandboxSettings['sandbox.filesystem.disabled']).toBeUndefined()
    expect(hasDangerousSettings(off)).toBe(false)
  })

  test('credentials enter bag; allowedDomains attached', () => {
    const d = extractDangerousSettings({
      sandbox: {
        credentials: {
          envVars: [{ name: 'AWS_ACCESS_KEY_ID', mode: 'mask' }],
        },
        network: { allowedDomains: ['*.amazonaws.com'] },
      },
    } as SettingsJson)
    expect(d.sandboxSettings['sandbox.credentials']).toBe(
      formatSandboxQeSettingValue({
        value: {
          envVars: [{ name: 'AWS_ACCESS_KEY_ID', mode: 'mask' }],
        },
        allowedDomains: ['*.amazonaws.com'],
      }),
    )
  })

  test('so/ro: deny-only credentials do not enter sandboxSettings', () => {
    const d = extractDangerousSettings({
      sandbox: {
        credentials: {
          files: [{ path: '/secret', mode: 'deny' }],
          envVars: [{ name: 'AWS_SECRET_ACCESS_KEY', mode: 'deny' }],
          sigv4: { streaming: 'deny' },
          allowPlaintextInject: false,
        },
      },
    } as SettingsJson)
    expect(d.sandboxSettings['sandbox.credentials']).toBeUndefined()
    expect(hasDangerousSettings(d)).toBe(false)
  })

  test('oo: allowedDomains unique-sort is stable for hash/skip', () => {
    const a = extractDangerousSettings({
      sandbox: {
        network: {
          tlsTerminate: { caCertPath: '/ca.pem' },
          allowedDomains: ['z.example', 'a.example', 'z.example'],
        },
      },
    } as SettingsJson)
    const b = extractDangerousSettings({
      sandbox: {
        network: {
          tlsTerminate: { caCertPath: '/ca.pem' },
          allowedDomains: ['a.example', 'z.example'],
        },
      },
    } as SettingsJson)
    expect(a.sandboxSettings['sandbox.network.tlsTerminate']).toBe(
      formatSandboxQeSettingValue({
        value: { caCertPath: '/ca.pem' },
        allowedDomains: ['a.example', 'z.example'],
      }),
    )
    expect(hashDangerousSettings(a)).toBe(hashDangerousSettings(b))
  })

  test('hash changes when qe weakening is added (Zor re-prompt)', () => {
    const baseline = {
      env: { HTTP_PROXY: 'http://old:1' },
    } as SettingsJson
    const next = {
      env: { HTTP_PROXY: 'http://old:1' },
      sandbox: { enableWeakerNestedSandbox: true },
    } as SettingsJson
    expect(hasDangerousSettingsChanged(baseline, next)).toBe(true)
    expect(hashSettingsDangerousProjection(baseline)).not.toBe(
      hashSettingsDangerousProjection(next),
    )
    const listed = listManagedSettingsForApproval(
      baseline,
      extractDangerousSettings(next),
    )
    expect(listed.items).toContain('sandbox.enableWeakerNestedSandbox')
  })

  test('same qe projection yields stable hash', () => {
    const settings = {
      sandbox: {
        enableWeakerNestedSandbox: true,
        network: { socksProxyPort: 1080 },
      },
    } as SettingsJson
    const a = extractDangerousSettings(settings)
    const b = extractDangerousSettings(settings)
    expect(hashDangerousSettings(a)).toBe(hashDangerousSettings(b))
    expect(hasDangerousSettingsChanged(settings, settings)).toBe(false)
  })
})
