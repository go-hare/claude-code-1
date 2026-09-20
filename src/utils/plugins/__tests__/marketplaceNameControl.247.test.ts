/**
 * densable 2.1.247 #25 — marketplace/plugin names reject control + bidi.
 * Official: `[\p{Cc}\u200E\u200F\u202A-\u202E\u2066-\u2069]` + locked messages.
 */
import { describe, expect, test } from 'bun:test'
import {
  hasControlOrBidiFormatting,
  MARKETPLACE_NAME_CONTROL_OR_BIDI_MESSAGE,
  NAME_CONTROL_OR_BIDI_RE,
  PLUGIN_NAME_CONTROL_OR_BIDI_MESSAGE,
  PluginMarketplaceSchema,
  PluginManifestSchema,
} from '../schemas.js'

const owner = { name: 'Acme' }

function marketplace(name: string) {
  return {
    name,
    owner,
    plugins: [],
  }
}

describe('marketplace name control/bidi 247 #25', () => {
  test('official regex and messages', () => {
    expect(NAME_CONTROL_OR_BIDI_RE.source).toBe(
      '[\\p{Cc}\\u200E\\u200F\\u202A-\\u202E\\u2066-\\u2069]',
    )
    expect(MARKETPLACE_NAME_CONTROL_OR_BIDI_MESSAGE).toBe(
      'Marketplace name cannot contain control or bidirectional-formatting characters',
    )
    expect(PLUGIN_NAME_CONTROL_OR_BIDI_MESSAGE).toBe(
      'Plugin name cannot contain control or bidirectional-formatting characters',
    )
  })

  test('rejects Cc and bidi marks; allows kebab ascii', () => {
    expect(hasControlOrBidiFormatting('my-marketplace')).toBe(false)
    expect(hasControlOrBidiFormatting('my\u0001shop')).toBe(true)
    expect(hasControlOrBidiFormatting('my\u200Eshop')).toBe(true)
    expect(hasControlOrBidiFormatting('my\u202Ashop')).toBe(true)
    expect(hasControlOrBidiFormatting('my\u2066shop')).toBe(true)
  })

  test('PluginMarketplaceSchema rejects control/bidi names', () => {
    expect(
      PluginMarketplaceSchema().safeParse(marketplace('ok-name')).success,
    ).toBe(true)
    const ctrl = PluginMarketplaceSchema().safeParse(
      marketplace('bad\u0007name'),
    )
    expect(ctrl.success).toBe(false)
    if (!ctrl.success) {
      expect(
        ctrl.error.issues.some(
          i => i.message === MARKETPLACE_NAME_CONTROL_OR_BIDI_MESSAGE,
        ),
      ).toBe(true)
    }
    const bidi = PluginMarketplaceSchema().safeParse(
      marketplace('bad\u202Ename'),
    )
    expect(bidi.success).toBe(false)
  })

  test('PluginManifestSchema rejects control/bidi plugin names', () => {
    expect(
      PluginManifestSchema().safeParse({ name: 'ok-plugin' }).success,
    ).toBe(true)
    const ctrl = PluginManifestSchema().safeParse({ name: 'bad\u001bplugin' })
    expect(ctrl.success).toBe(false)
    if (!ctrl.success) {
      expect(
        ctrl.error.issues.some(
          i => i.message === PLUGIN_NAME_CONTROL_OR_BIDI_MESSAGE,
        ),
      ).toBe(true)
    }
  })
})
