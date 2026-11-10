import { describe, expect, test } from 'bun:test'
import {
  isTransientError,
  PLUGIN_MENU_DEFERRED_RELOAD_MESSAGE,
  pluginMenuCloseReloadOutcome,
} from '../PluginSettings.js'
import { formatErrorMessage, getErrorGuidance } from '../PluginErrors.js'

describe('densable 2.1.283 /plugin close auto-reload (Ll)', () => {
  test('none when needsRefresh is false', () => {
    expect(pluginMenuCloseReloadOutcome(false, true)).toBe('none')
    expect(pluginMenuCloseReloadOutcome(false, false)).toBe('none')
  })

  test('deferred while main query runs, else queued', () => {
    expect(pluginMenuCloseReloadOutcome(true, true)).toBe('deferred')
    expect(pluginMenuCloseReloadOutcome(true, false)).toBe('queued')
  })

  test('deferred toast keeps /reload-plugins', () => {
    expect(PLUGIN_MENU_DEFERRED_RELOAD_MESSAGE).toContain('/reload-plugins')
  })
})

describe('densable 2.1.283 plugin cache-miss guidance', () => {
  test('plugin-cache-miss points at /plugin', () => {
    expect(
      getErrorGuidance({
        type: 'plugin-cache-miss',
        source: 'x',
        plugin: 'demo',
        installPath: '/tmp/p',
      }),
    ).toBe('Run /plugin to refresh the plugin cache')
  })

  test('marketplace-load-failed cache-miss uses /reload-plugins', () => {
    expect(
      getErrorGuidance({
        type: 'marketplace-load-failed',
        source: 'x',
        marketplace: 'official',
        reason: 'cache-miss',
      }),
    ).toBe('Run /reload-plugins to refresh the marketplace cache')
    expect(
      getErrorGuidance({
        type: 'marketplace-load-failed',
        source: 'x',
        marketplace: 'official',
        reason: 'cache-miss',
        catalogReadFailed: true,
      }),
    ).toBe(
      'The cached marketplace catalog could not be read; run /reload-plugins to refresh it',
    )
    expect(
      getErrorGuidance({
        type: 'marketplace-load-failed',
        source: 'x',
        marketplace: 'official',
        reason: 'network',
      }),
    ).toBeNull()
  })

  test('2.1.289 isTransientError includes cache-miss and marketplace-not-found; new error branches format cleanly', () => {
    expect(
      isTransientError({
        type: 'marketplace-load-failed',
        source: 'x',
        marketplace: 'official',
        reason: 'cache-miss',
      }),
    ).toBe(true)
    expect(
      isTransientError({
        type: 'marketplace-not-found',
        source: 'x',
        marketplace: 'official',
        availableMarketplaces: [],
      }),
    ).toBe(true)
    expect(
      getErrorGuidance({
        type: 'hook-load-failed',
        source: 'x',
        plugin: 'demo',
        hookPath: '/tmp/h',
        reason: 'bad',
      }),
    ).toBe(
      "Check the plugin's hooks configuration and that its hooks file is readable",
    )
    expect(
      formatErrorMessage({
        type: 'dependency-version-unsatisfied',
        source: 'x',
        plugin: 'demo',
        dependency: 'core',
        required: '^2.0.0',
        installed: '1.0.0',
      }),
    ).toBe('Requires "core" ^2.0.0, installed 1.0.0')
    expect(
      formatErrorMessage({
        type: 'autoupdate-blocked-by-pinner',
        source: 'x',
        heldAt: '1.2.0',
        blockedBy: ['dep-a'],
        disabledPinners: ['dep-a'],
      }),
    ).toBe(
      'Autoupdate held at 1.2.0 — version constraint from dep-a (dep-a is disabled)',
    )
  })
})
