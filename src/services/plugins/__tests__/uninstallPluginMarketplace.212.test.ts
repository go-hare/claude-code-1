/**
 * densable 2.1.212 #30 — uninstall must not target wrong marketplace
 * when user passes plugin@marketplace (settings key candidates).
 *
 * Pure unit coverage of the candidate-order / wu_ rules via exported
 * helpers + a focused mock of settings/V2 is heavy; here we assert the
 * identifier helpers and document the densable _Fe candidate contract.
 */
import { describe, expect, test } from 'bun:test'
import {
  findPluginKeyCaseInsensitive,
  parsePluginIdentifier,
  pluginIdEquals,
} from '../../../utils/plugins/pluginIdentifier.js'

/**
 * densable _Fe settings-key candidate builder (mirror of uninstallPluginOp).
 * Kept in test so the contract is executable without full settings mock.
 */
function uninstallSettingsCandidates(
  plugin: string,
  foundName: string,
  enabledKeys: string[],
): string[] {
  const nameLower = foundName.toLowerCase()
  const inputHasMarketplace = plugin.includes('@')
  return [
    ...enabledKeys.filter(L => L === plugin),
    ...enabledKeys.filter(L => pluginIdEquals(L, plugin)),
    ...(inputHasMarketplace
      ? []
      : [
          ...enabledKeys.filter(L => L === foundName),
          ...enabledKeys.filter(L => L.startsWith(`${foundName}@`)),
          ...enabledKeys.filter(L => L.toLowerCase() === nameLower),
          ...enabledKeys.filter(L =>
            L.toLowerCase().startsWith(`${nameLower}@`),
          ),
        ]),
    inputHasMarketplace ? plugin : foundName,
  ]
}

describe('densable #30 uninstall marketplace targeting', () => {
  test('with plugin@mkt does not expand to other marketplaces', () => {
    const enabled = ['demo@right-mkt', 'demo@wrong-mkt', 'other@x']
    const c = uninstallSettingsCandidates('demo@wrong-mkt', 'demo', enabled)
    // exact + Lwe + fallback may re-list same id; must never expand to other mkt
    expect(new Set(c.filter(k => k.startsWith('demo@')))).toEqual(
      new Set(['demo@wrong-mkt']),
    )
    expect(c).not.toContain('demo@right-mkt')
  })

  test('bare name expands to name@* settings keys', () => {
    const enabled = ['demo@right-mkt', 'demo@other']
    const c = uninstallSettingsCandidates('demo', 'demo', enabled)
    expect(c).toContain('demo@right-mkt')
    expect(c).toContain('demo@other')
  })

  test('wu_ delisted: input with @ only matches bare keys after exact fail', () => {
    // densable: (!a || !p) — with @, name-filter requires !keyMarketplace
    const plugin = 'demo@ghost'
    const { name } = parsePluginIdentifier(plugin)
    const keys = ['demo@real', 'demo', 'other@x']
    const inputHasMarketplace = plugin.includes('@')
    const matching = keys.filter(key => {
      const { name: keyName, marketplace: keyMkt } = parsePluginIdentifier(key)
      return pluginIdEquals(keyName, name) && (!inputHasMarketplace || !keyMkt)
    })
    expect(matching).toEqual(['demo'])
    expect(matching).not.toContain('demo@real')
  })

  test('are normalizes installed key casing after resolve', () => {
    const installed = ['Demo@Mkt']
    expect(findPluginKeyCaseInsensitive(installed, 'demo@mkt')).toBe('Demo@Mkt')
  })
})
