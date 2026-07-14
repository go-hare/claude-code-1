/**
 * Official 2.1.x snt(): MCP effective permission mode.
 */
import { describe, expect, test } from 'bun:test'
import {
  getEffectivePermissionMode,
  mcpPermissionModeInternals,
  parseMcpPermissionModeOverride,
} from '../mcpPermissionMode.js'

describe('getEffectivePermissionMode (snt)', () => {
  test('non-MCP tool returns context mode', () => {
    expect(
      getEffectivePermissionMode(
        {},
        { mode: 'bypassPermissions', isBypassPermissionsModeAvailable: true },
      ),
    ).toBe('bypassPermissions')
  })

  test('per-server override applies only when elevated', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'bypassPermissions',
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('default')
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'default',
        mcpPermissionModeOverrides: { acme: 'auto' },
      }),
    ).toBe('default')
  })

  test('chrome classifier floor demotes elevated mode', () => {
    const tool = { mcpInfo: { serverName: 'claude-in-chrome' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'bypassPermissions',
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: true,
      }),
    ).toBe('auto')
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'bypassPermissions',
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe('default')
  })

  test('preview floor uses previewClassifierFloorEnabled', () => {
    const tool = { mcpInfo: { serverName: 'Claude Preview' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: true,
        previewClassifierFloorEnabled: false,
        canAutoClassifierRun: true,
      }),
    ).toBe('auto') // floor not enabled for preview
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        previewClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe('default')
  })

  test('override wins over chrome floor', () => {
    const tool = { mcpInfo: { serverName: 'claude-in-chrome' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'bypassPermissions',
        mcpPermissionModeOverrides: { 'claude-in-chrome': 'auto' },
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe('auto')
  })

  test('plan+bypass-available is elevated', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('default')
  })
})

describe('parseMcpPermissionModeOverride (WDu)', () => {
  test('null/undefined ok empty', () => {
    expect(parseMcpPermissionModeOverride(null)).toEqual({
      ok: true,
      override: undefined,
    })
    expect(parseMcpPermissionModeOverride(undefined)).toEqual({
      ok: true,
      override: undefined,
    })
  })

  test('default/auto accepted', () => {
    expect(parseMcpPermissionModeOverride('default')).toEqual({
      ok: true,
      override: 'default',
    })
    expect(parseMcpPermissionModeOverride('auto')).toEqual({
      ok: true,
      override: 'auto',
    })
  })

  test('other values rejected', () => {
    expect(parseMcpPermissionModeOverride('bypassPermissions')).toEqual({
      ok: false,
      rejected: 'bypassPermissions',
    })
  })
})

describe('server name sets', () => {
  test('chrome floor servers include preview', () => {
    expect(
      mcpPermissionModeInternals.CHROME_CLASSIFIER_FLOOR_SERVERS.has(
        'Claude Browser',
      ),
    ).toBe(true)
    expect(
      mcpPermissionModeInternals.PREVIEW_BROWSER_SERVERS.has('Claude Preview'),
    ).toBe(true)
  })
})
