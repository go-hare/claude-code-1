/**
 * Official 2.1.x snt(): MCP effective permission mode.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { getIsInteractive, setIsInteractive } from '../../../bootstrap/state.js'
import {
  chromeCommandBypassesDontAsk,
  getEffectivePermissionMode,
  isChromeFamilyClassifierEligible,
  isPreviewBrowserServer,
  mcpPermissionModeInternals,
  parseMcpPermissionModeOverride,
} from '../mcpPermissionMode.js'

describe('getEffectivePermissionMode (snt)', () => {
  let prevInteractive: boolean
  beforeEach(() => {
    prevInteractive = getIsInteractive()
    setIsInteractive(true)
  })
  afterEach(() => {
    setIsInteractive(prevInteractive)
  })

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

  test('server override default under global auto is effective default (snt)', () => {
    // permissions.ts auto-branch must use effectiveMode only — not OR global
    // mode===auto — so this demotion is not ignored.
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('default')
  })

  test('server override dontAsk under global auto is effective dontAsk (NHo xe)', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        mcpPermissionModeOverrides: { acme: 'dontAsk' },
      }),
    ).toBe('dontAsk')
  })

  test('server override auto under global plan is effective auto (NHo br)', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
        mcpPermissionModeOverrides: { acme: 'auto' },
      }),
    ).toBe('auto')
  })
  test('plan is elevated when bypass is listable (gold t2)', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'plan',
        isBypassPermissionsModeAvailable: true,
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('default')
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'plan',
        isBypassPermissionsModeAvailable: false,
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('plan')
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

  test('preview floors when elevated without previewClassifierFloorEnabled (gold Dc)', () => {
    const tool = { mcpInfo: { serverName: 'Claude Preview' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: false,
        canAutoClassifierRun: false,
      }),
    ).toBe('default')
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: false,
        canAutoClassifierRun: true,
      }),
    ).toBe('auto')
  })

  test('chrome still needs chromeClassifierFloorEnabled (gold Mc)', () => {
    const tool = { mcpInfo: { serverName: 'claude-in-chrome' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: false,
        canAutoClassifierRun: false,
      }),
    ).toBe('auto')
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

  test('plan inherit (prePlanMode) without listable bypass is not t2-elevated', () => {
    const tool = { mcpInfo: { serverName: 'acme' } }
    expect(
      getEffectivePermissionMode(tool, {
        mode: 'plan',
        isBypassPermissionsModeAvailable: false,
        prePlanMode: 'bypassPermissions',
        mcpPermissionModeOverrides: { acme: 'default' },
      }),
    ).toBe('plan')
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

describe('isChromeFamilyClassifierEligible (gold xHo)', () => {
  test('preview is eligible when canAutoClassifierRun, without chrome floor flag', () => {
    expect(
      isChromeFamilyClassifierEligible(
        { mcpInfo: { serverName: 'Claude Preview' } },
        {
          chromeClassifierFloorEnabled: false,
          canAutoClassifierRun: true,
        },
      ),
    ).toBe(true)
    expect(
      isChromeFamilyClassifierEligible(
        { mcpInfo: { serverName: 'Claude Preview' } },
        {
          chromeClassifierFloorEnabled: false,
          canAutoClassifierRun: false,
        },
      ),
    ).toBe(false)
  })

  test('chrome needs chromeClassifierFloorEnabled and canAutoClassifierRun', () => {
    const tool = { mcpInfo: { serverName: 'claude-in-chrome' } }
    expect(
      isChromeFamilyClassifierEligible(tool, {
        chromeClassifierFloorEnabled: false,
        canAutoClassifierRun: true,
      }),
    ).toBe(false)
    expect(
      isChromeFamilyClassifierEligible(tool, {
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe(false)
    expect(
      isChromeFamilyClassifierEligible(tool, {
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: true,
      }),
    ).toBe(true)
  })

  test('non-chrome MCP and missing mcpInfo are not eligible', () => {
    expect(
      isChromeFamilyClassifierEligible(
        { mcpInfo: { serverName: 'acme' } },
        {
          chromeClassifierFloorEnabled: true,
          canAutoClassifierRun: true,
        },
      ),
    ).toBe(false)
    expect(
      isChromeFamilyClassifierEligible(
        {},
        {
          chromeClassifierFloorEnabled: true,
          canAutoClassifierRun: true,
        },
      ),
    ).toBe(false)
  })
})

describe('chromeCommandBypassesDontAsk (gold NHo Fe metadata)', () => {
  test('Preview/Browser s8t hostHandlesOriginConsent bypasses dontAsk', () => {
    expect(isPreviewBrowserServer('Claude Preview')).toBe(true)
    expect(isPreviewBrowserServer('Claude Browser')).toBe(true)
    expect(isPreviewBrowserServer('claude-in-chrome')).toBe(false)
    expect(
      chromeCommandBypassesDontAsk({
        metadata: {
          command: { chrome: { hostHandlesOriginConsent: true } },
        },
      }),
    ).toBe(true)
    expect(
      chromeCommandBypassesDontAsk({
        metadata: { command: { chrome: { domainAllowed: true } } },
      }),
    ).toBe(true)
    expect(
      chromeCommandBypassesDontAsk({
        metadata: { command: { chrome: { domainAllowed: false } } },
      }),
    ).toBe(false)
    expect(chromeCommandBypassesDontAsk({})).toBe(false)
  })
})
