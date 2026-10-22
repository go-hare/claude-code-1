/**
 * densable 2.1.289 `fkt` / `spo` — Anthropic-own plugin name lock.
 */
import { describe, expect, test } from 'bun:test'
import {
  ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE,
  checkAnthropicOwnPluginName,
} from '../pluginReservedName.js'
import {
  validateMarketplaceManifest,
  validatePluginManifest,
} from '../validatePlugin.js'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'

describe('densable 2.1.289 fkt / spo reserved plugin names', () => {
  test('reserved whole product is an error', () => {
    const hit = checkAnthropicOwnPluginName('claude-code')
    expect(hit?.severity).toBe('error')
    expect(hit?.message).toContain(
      "is reserved: it passes as one of Anthropic's own",
    )
    expect(hit?.message).toContain('Name it for what it does.')
  })

  test('mark token is a warning', () => {
    const hit = checkAnthropicOwnPluginName('my-claude-helper')
    expect(hit?.severity).toBe('warning')
    expect(hit?.message).toContain("reads as one of Anthropic's own")
    expect(hit?.message).not.toContain(
      ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE,
    )
  })

  test('ordinary names are fine', () => {
    expect(checkAnthropicOwnPluginName('review-helper')).toBeUndefined()
  })

  test('plugin.json alone appends spo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'plugin-fkt-'))
    const file = join(dir, 'plugin.json')
    await writeFile(
      file,
      JSON.stringify({
        name: 'claude-code',
        description: 'x',
        version: '1.0.0',
      }),
    )
    const r = await validatePluginManifest(file)
    expect(r.success).toBe(false)
    expect(
      r.errors.some(e =>
        e.message.includes(ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE),
      ),
    ).toBe(true)
  })

  test('marketplace entries do not append spo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mp-fkt-'))
    const file = join(dir, 'marketplace.json')
    await writeFile(
      file,
      JSON.stringify({
        name: 'acme-tools',
        owner: { name: 'acme' },
        plugins: [{ name: 'claude-code', source: './p' }],
      }),
    )
    const r = await validateMarketplaceManifest(file)
    const row = r.errors.find(e => e.path === 'plugins[0].name')
    expect(row?.message).toContain(
      "is reserved: it passes as one of Anthropic's own",
    )
    expect(row?.message).not.toContain(
      ANTHROPIC_OWN_PLUGIN_VALIDATE_MARKETPLACE,
    )
  })
})
