/**
 * densable 2.1.223 #11 — managed env per-key merge (server + machine-local)
 */
import { describe, expect, test } from 'bun:test'
import { mergeManagedEnvPerKey } from '../settings.js'
import type { SettingsJson } from '../types.js'

describe('densable 2.1.223 #11 mergeManagedEnvPerKey', () => {
  test('remote winner keeps its keys and fills missing from local', () => {
    const remote = {
      env: { FOO: 'remote', SHARED: 'from-remote' },
      model: 'claude-opus-4-8',
    } as SettingsJson
    const file = {
      env: { BAR: 'file', SHARED: 'from-file' },
    } as SettingsJson
    const merged = mergeManagedEnvPerKey(remote, [file])
    expect(merged?.env).toEqual({
      BAR: 'file',
      FOO: 'remote',
      SHARED: 'from-remote',
    })
    expect(merged?.model).toBe('claude-opus-4-8')
  })

  test('server-delivered empty env no longer disables local env block', () => {
    const remote = {
      env: {},
      disableBypassPermissionsMode: 'disable',
    } as SettingsJson
    const mdm = {
      env: { ORG_PROXY: 'http://proxy.local' },
    } as SettingsJson
    const merged = mergeManagedEnvPerKey(remote, [mdm])
    expect(merged?.env).toEqual({ ORG_PROXY: 'http://proxy.local' })
    expect(merged?.disableBypassPermissionsMode).toBe('disable')
  })

  test('lower sources layer then higher local before remote', () => {
    const remote = { env: { A: 'remote' } } as SettingsJson
    const hkcu = { env: { A: 'hkcu', B: 'hkcu', C: 'hkcu' } } as SettingsJson
    const file = { env: { B: 'file', D: 'file' } } as SettingsJson
    const mdm = { env: { C: 'mdm' } } as SettingsJson
    const merged = mergeManagedEnvPerKey(remote, [hkcu, file, mdm])
    expect(merged?.env).toEqual({
      A: 'remote',
      B: 'file',
      C: 'mdm',
      D: 'file',
    })
  })

  test('null winner with only local env returns env-only object', () => {
    const file = { env: { X: '1' } } as SettingsJson
    const merged = mergeManagedEnvPerKey(null, [file])
    expect(merged).toEqual({ env: { X: '1' } })
  })
})
