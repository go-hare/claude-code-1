/**
 * Official 2.1.207: pluginConfigs only from user / flag / managed settings.
 * Pure-function tests — no process-global mock.module.
 */
import { describe, expect, test } from 'bun:test'
import {
  mergePluginConfigEntries,
  PLUGIN_CONFIG_SETTING_SOURCES,
} from '../pluginConfigSources.js'

describe('PLUGIN_CONFIG_SETTING_SOURCES (2.1.207)', () => {
  test('allows only user, flag, and policy — not project or local', () => {
    expect([...PLUGIN_CONFIG_SETTING_SOURCES]).toEqual([
      'userSettings',
      'flagSettings',
      'policySettings',
    ])
    expect(PLUGIN_CONFIG_SETTING_SOURCES).not.toContain('projectSettings')
    expect(PLUGIN_CONFIG_SETTING_SOURCES).not.toContain('localSettings')
  })
})

describe('mergePluginConfigEntries (2.1.207)', () => {
  test('later sources win; project-style entries can be omitted by caller', () => {
    // Caller only feeds allowed sources — project/local never appear here.
    const result = mergePluginConfigEntries([
      { options: { a: 'user', b: 'user-only' } },
      { options: { a: 'flag' } },
      {
        options: { d: 'policy' },
        mcpServers: { srv: { token: 'pol' } },
      },
    ])
    expect(result.options).toEqual({
      a: 'flag',
      b: 'user-only',
      d: 'policy',
    })
    expect(result.mcpServers?.srv).toEqual({ token: 'pol' })
  })

  test('skips null/undefined entries (disabled sources)', () => {
    const result = mergePluginConfigEntries([
      { options: { a: 1 } },
      undefined,
      null,
    ])
    expect(result.options).toEqual({ a: 1 })
  })

  test('merges per-server mcpServers without clobbering siblings', () => {
    const result = mergePluginConfigEntries([
      { mcpServers: { a: { x: 1 }, b: { y: 2 } } },
      { mcpServers: { a: { x: 9, z: 3 } } },
    ])
    expect(result.mcpServers).toEqual({
      a: { x: 9, z: 3 },
      b: { y: 2 },
    })
  })
})
