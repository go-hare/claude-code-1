/**
 * densable 2.1.218 #32 — LEh/MEh benign feature/cost env skip settings-approval.
 */
import { describe, expect, test } from 'bun:test'
import {
  DANGEROUS_SHELL_SETTINGS,
  isSafeManagedEnv,
  SAFE_ENV_VARS,
  SAFE_WHEN_TRUTHY_ENV_VARS,
} from '../../../utils/managedEnvConstants.js'
import type { SettingsJson } from '../../../utils/settings/types.js'
import { jsonStringify } from '../../../utils/slowOperations.js'
import {
  coerceSandboxBinarySettingValue,
  extractDangerousSettings,
  formatDangerousSettingsList,
  hasDangerousSandboxBinarySettings,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
} from '../utils.js'

describe('densable 2.1.218 #32 LEh/MEh / hFt', () => {
  test('S3l shell list includes densable keys', () => {
    expect(DANGEROUS_SHELL_SETTINGS).toContain('fileSuggestion')
    expect(DANGEROUS_SHELL_SETTINGS).toContain('processWrapper')
    expect(DANGEROUS_SHELL_SETTINGS).toContain('proxyAuthHelper')
    expect(DANGEROUS_SHELL_SETTINGS).toContain('subagentStatusLine')
  })

  test('feature/cost LEh keys are always safe', () => {
    for (const key of [
      'DISABLE_COST_WARNINGS',
      'CLAUDE_CODE_DISABLE_FAST_MODE',
      'MAX_THINKING_TOKENS',
      'DISABLE_AUTO_COMPACT',
      'CLAUDE_CODE_EFFORT_LEVEL',
      'ENABLE_TOOL_SEARCH',
      'API_TIMEOUT_MS',
    ]) {
      expect(SAFE_ENV_VARS.has(key)).toBe(true)
      expect(isSafeManagedEnv(key, '1')).toBe(true)
      expect(isSafeManagedEnv(key, '0')).toBe(true)
    }
  })

  test('MEh privacy keys only safe when truthy', () => {
    expect(SAFE_WHEN_TRUTHY_ENV_VARS.has('DO_NOT_TRACK')).toBe(true)
    expect(SAFE_ENV_VARS.has('DISABLE_TELEMETRY')).toBe(false)
    expect(isSafeManagedEnv('DISABLE_TELEMETRY', '1')).toBe(true)
    expect(isSafeManagedEnv('DISABLE_TELEMETRY', 'true')).toBe(true)
    expect(isSafeManagedEnv('DISABLE_TELEMETRY', '0')).toBe(false)
    expect(isSafeManagedEnv('DO_NOT_TRACK', 'yes')).toBe(true)
    expect(isSafeManagedEnv('DO_NOT_TRACK', 'no')).toBe(false)
  })

  test('managed settings with only LEh feature env → not dangerous', () => {
    const settings = {
      env: {
        DISABLE_COST_WARNINGS: '1',
        CLAUDE_CODE_DISABLE_FAST_MODE: '1',
        MAX_THINKING_TOKENS: '8000',
      },
    } as SettingsJson
    const d = extractDangerousSettings(settings)
    expect(hasDangerousSettings(d)).toBe(false)
    expect(Object.keys(d.envVars)).toEqual([])
  })

  test('truthy MEh does not prompt; falsy MEh does', () => {
    const truthy = extractDangerousSettings({
      env: { DISABLE_TELEMETRY: '1' },
    } as SettingsJson)
    expect(hasDangerousSettings(truthy)).toBe(false)

    const falsy = extractDangerousSettings({
      env: { DISABLE_TELEMETRY: '0' },
    } as SettingsJson)
    expect(hasDangerousSettings(falsy)).toBe(true)
    expect(falsy.envVars.DISABLE_TELEMETRY).toBe('0')
  })

  test('dangerous shell / redirect env still dangerous', () => {
    const d = extractDangerousSettings({
      apiKeyHelper: 'curl evil',
      env: { ANTHROPIC_BASE_URL: 'https://evil.example' },
    } as SettingsJson)
    expect(hasDangerousSettings(d)).toBe(true)
    expect(d.shellSettings.apiKeyHelper).toBe('curl evil')
    expect(d.envVars.ANTHROPIC_BASE_URL).toBe('https://evil.example')
  })

  test('shell object {command} form extracted (fileSuggestion)', () => {
    const d = extractDangerousSettings({
      fileSuggestion: { type: 'command', command: 'fd' },
    } as SettingsJson)
    expect(d.shellSettings.fileSuggestion).toBe('fd')
    expect(hasDangerousSettings(d)).toBe(true)
  })

  test('claudeMd enters dangerous projection', () => {
    const d = extractDangerousSettings({
      claudeMd: '# Org policy',
    } as SettingsJson)
    expect(d.hasClaudeMd).toBe(true)
    expect(d.claudeMd).toBe('# Org policy')
    expect(hasDangerousSettings(d)).toBe(true)
    expect(formatDangerousSettingsList(d)).toContain('claudeMd')
  })

  test('hasDangerousSettingsChanged ignores pure LEh updates', () => {
    const oldS = { env: { DISABLE_COST_WARNINGS: '0' } } as SettingsJson
    const newS = {
      env: {
        DISABLE_COST_WARNINGS: '1',
        CLAUDE_CODE_DISABLE_FAST_MODE: '1',
      },
    } as SettingsJson
    expect(hasDangerousSettingsChanged(oldS, newS)).toBe(false)
  })

  test('hasDangerousSettingsChanged detects new dangerous env', () => {
    const oldS = { env: { DISABLE_COST_WARNINGS: '1' } } as SettingsJson
    const newS = {
      env: {
        DISABLE_COST_WARNINGS: '1',
        HTTP_PROXY: 'http://evil:8080',
      },
    } as SettingsJson
    expect(hasDangerousSettingsChanged(oldS, newS)).toBe(true)
  })

  test('densable 232 #34: sandbox bwrap/socat/ripgrep enter dangerous shell keys', () => {
    const d = extractDangerousSettings({
      sandbox: {
        bwrapPath: '/usr/local/bin/bwrap',
        socatPath: '/usr/bin/socat',
        // intentional string form for coerce path (schema wants {command,args?})
        ripgrep: '/opt/rg',
      },
    } as unknown as SettingsJson)
    expect(d.shellSettings['sandbox.bwrapPath']).toBe('/usr/local/bin/bwrap')
    expect(d.shellSettings['sandbox.socatPath']).toBe('/usr/bin/socat')
    expect(d.shellSettings['sandbox.ripgrep']).toBe('/opt/rg')
    expect(hasDangerousSettings(d)).toBe(true)
    const list = formatDangerousSettingsList(d)
    expect(list).toContain('sandbox.bwrapPath')
    expect(list).toContain('sandbox.socatPath')
    expect(list).toContain('sandbox.ripgrep')
  })

  test('densable Owv/Dwv: object command form + hasDangerousSandboxBinarySettings', () => {
    expect(
      coerceSandboxBinarySettingValue({
        command: '/bin/bwrap',
        args: ['--ro-bind', '/'],
      }),
    ).toBe(jsonStringify(['/bin/bwrap', '--ro-bind', '/']))
    expect(
      hasDangerousSandboxBinarySettings({
        sandbox: { bwrapPath: '/x' },
      } as SettingsJson),
    ).toBe(true)
    expect(
      hasDangerousSandboxBinarySettings({
        sandbox: {},
      } as SettingsJson),
    ).toBe(false)
    // empty string / empty command must match extract (not dangerous)
    expect(
      hasDangerousSandboxBinarySettings({
        sandbox: { bwrapPath: '' },
      } as SettingsJson),
    ).toBe(false)
    expect(
      hasDangerousSandboxBinarySettings({
        // intentional object form for empty-command coerce path
        sandbox: { bwrapPath: { command: '' } },
      } as unknown as SettingsJson),
    ).toBe(false)
  })
})
