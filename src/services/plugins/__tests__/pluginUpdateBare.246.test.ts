/**
 * densable 2.1.246 #20 — `plugin update` bare name → name@marketplace.
 */
import { describe, expect, test } from 'bun:test'
import { resolvePluginUpdateId } from '../pluginOperations.js'

describe('plugin update bare name (2.1.246 #20)', () => {
  test('FQ id is unchanged', () => {
    expect(resolvePluginUpdateId('demo@acme', 'other@mkt', 'demo@disk')).toBe(
      'demo@acme',
    )
  })

  test('settings key wins over installed_plugins', () => {
    expect(
      resolvePluginUpdateId('demo', 'demo@from-settings', 'demo@from-disk'),
    ).toBe('demo@from-settings')
  })

  test('installed_plugins used when settings has no key', () => {
    expect(resolvePluginUpdateId('demo', null, 'demo@acme')).toBe('demo@acme')
  })

  test('bare name stays bare when nothing is installed', () => {
    expect(resolvePluginUpdateId('demo', null, null)).toBe('demo')
  })
})
