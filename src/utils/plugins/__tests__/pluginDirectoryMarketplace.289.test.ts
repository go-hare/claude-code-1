/**
 * densable 2.1.289 p5 / Qge — plugin-directory marketplace listing.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  loadPluginDirectoryMarketplaceByPurpose,
  loadPluginDirectoryMarketplaceListing,
} from '../pluginDirectoryMarketplace.js'

describe('densable 2.1.289 p5 / Qge', () => {
  test('p5 returns null when Vb()/eW host is absent', async () => {
    expect(await loadPluginDirectoryMarketplaceListing()).toBeNull()
    expect(
      await loadPluginDirectoryMarketplaceListing({
        onlyMissedListings: true,
        ignoreToggle: true,
      }),
    ).toBeNull()
  })

  test('Qge 4-arg wrapper forwards onlyMissedListings and returns null', async () => {
    expect(
      await loadPluginDirectoryMarketplaceByPurpose(
        'plugin',
        undefined,
        'install',
        true,
      ),
    ).toBeNull()
  })

  test('invent-ban export function Qge', () => {
    const src = readFileSync(
      join(import.meta.dir, '../pluginDirectoryMarketplace.ts'),
      'utf8',
    )
    expect(src).not.toContain('export function Qge(')
    expect(src).toContain(
      'export function loadPluginDirectoryMarketplaceByPurpose',
    )
    expect(src).toContain('onlyMissedListings')
  })
})
