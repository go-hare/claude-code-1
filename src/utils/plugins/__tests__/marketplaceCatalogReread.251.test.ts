/**
 * densable 2.1.251 #27 — qFe re-reads a null marketplace catalog.
 * $Y is named in the gold loop and its body is not in the excerpt.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  MARKETPLACE_CATALOG_REREAD_DELAYS_MS,
  rereadMarketplaceCatalogIfNull,
} from '../marketplaceCatalogReread.js'

describe('densable 2.1.251 #27 marketplace catalog re-read', () => {
  test('retries 30, 70, 150 while the catalog stays null and a registry entry exists', async () => {
    const sleeps: number[] = []
    const logs: string[] = []
    let reads = 0
    const catalog = await rereadMarketplaceCatalogIfNull({
      name: 'plugins',
      catalog: null,
      hasRegistryEntry: true,
      read: async () => {
        reads += 1
        return reads < 3 ? null : { plugins: ['skill'] }
      },
      sleepMs: async ms => {
        sleeps.push(ms)
      },
      log: message => {
        logs.push(message)
      },
    })
    expect(sleeps).toEqual([...MARKETPLACE_CATALOG_REREAD_DELAYS_MS])
    expect(catalog).toEqual({ plugins: ['skill'] })
    expect(logs).toEqual([
      'Marketplace plugins: catalog readable again after a re-read (another process was refreshing it)',
    ])
  })

  test('does not re-read a catalog that is already present', async () => {
    let reads = 0
    const catalog = await rereadMarketplaceCatalogIfNull({
      name: 'plugins',
      catalog: { ok: true },
      hasRegistryEntry: true,
      read: async () => {
        reads += 1
        return null
      },
      sleepMs: async () => {},
    })
    expect(catalog).toEqual({ ok: true })
    expect(reads).toBe(0)
  })

  test('does not re-read when there is no registry entry', async () => {
    let reads = 0
    const catalog = await rereadMarketplaceCatalogIfNull({
      name: 'plugins',
      catalog: null,
      hasRegistryEntry: false,
      read: async () => {
        reads += 1
        return { ok: true }
      },
      sleepMs: async () => {},
    })
    expect(catalog).toBeNull()
    expect(reads).toBe(0)
  })

  test('skill-catalog preload calls the re-read; command paths do not', () => {
    const loader = readFileSync(
      join(import.meta.dir, '../pluginLoader.ts'),
      'utf8',
    )
    expect(loader).toContain('rereadMarketplaceCatalogIfNull')
    expect(loader).toContain('hasRegistryEntry: registryEntry !== undefined')
    const paths = readFileSync(
      join(import.meta.dir, '../pluginCommandPaths.ts'),
      'utf8',
    )
    expect(paths).not.toContain('rereadMarketplaceCatalogIfNull')
  })
})
