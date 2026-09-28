import { describe, expect, test } from 'bun:test'
import {
  PLUGIN_MENU_DEFERRED_RELOAD_MESSAGE,
  pluginMenuCloseReloadOutcome,
} from '../PluginSettings.js'
import { getErrorGuidance } from '../PluginErrors.js'

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
})
