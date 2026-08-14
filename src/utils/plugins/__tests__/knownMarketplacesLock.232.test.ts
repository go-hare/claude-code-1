/**
 * densable 2.1.232 #29 — known_marketplaces.json concurrent write protection.
 * densable: TL (KKd) serial queue + ict lock RMW + fallback write analytics.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createKeyedSerialQueue,
  loadKnownMarketplacesConfig,
  updateKnownMarketplacesConfig,
  _test,
} from '../marketplaceManager.js'

describe('createKeyedSerialQueue (densable TL)', () => {
  test('same key runs serially; order preserved', async () => {
    const q = createKeyedSerialQueue()
    const order: number[] = []
    const a = q.run('k', async () => {
      order.push(1)
      await new Promise(r => setTimeout(r, 30))
      order.push(2)
      return 'a'
    })
    const b = q.run('k', async () => {
      order.push(3)
      return 'b'
    })
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(order).toEqual([1, 2, 3])
  })

  test('different keys run in parallel', async () => {
    const q = createKeyedSerialQueue()
    let released = false
    const slow = q.run('a', async () => {
      await new Promise(r => setTimeout(r, 40))
      released = true
      return 1
    })
    const fast = q.run('b', async () => {
      // Should not wait for 'a'
      return released ? 'after' : 'before'
    })
    expect(await fast).toBe('before')
    await slow
  })

  test('failed job does not poison subsequent runs', async () => {
    const q = createKeyedSerialQueue()
    await expect(
      q.run('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await q.run('k', async () => 'ok')).toBe('ok')
  })

  test('drain settles pending work', async () => {
    const q = createKeyedSerialQueue()
    let done = false
    void q.run('k', async () => {
      await new Promise(r => setTimeout(r, 20))
      done = true
    })
    await q.drain()
    expect(done).toBe(true)
  })
})

describe('updateKnownMarketplacesConfig (densable ict)', () => {
  let prevCacheDir: string | undefined
  let tmpRoot: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'km-lock-232-'))
    prevCacheDir = process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = tmpRoot
    _test.knownMarketplacesSerialQueue.clearForTest()
  })

  afterEach(() => {
    if (prevCacheDir === undefined) {
      delete process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR
    } else {
      process.env.CLAUDE_CODE_PLUGIN_CACHE_DIR = prevCacheDir
    }
    _test.knownMarketplacesSerialQueue.clearForTest()
  })

  test('null mutator skips write and returns false', async () => {
    const wrote = await updateKnownMarketplacesConfig(() => null)
    expect(wrote).toBe(false)
  })

  test('mutator creates file with entry (fallback ok when file missing)', async () => {
    const wrote = await updateKnownMarketplacesConfig(cfg => {
      cfg['demo'] = {
        source: { source: 'github', repo: 'o/r' },
        installLocation: join(tmpRoot, 'marketplaces', 'demo'),
        lastUpdated: '2026-01-01T00:00:00.000Z',
      }
      return cfg
    })
    expect(wrote).toBe(true)
    const loaded = await loadKnownMarketplacesConfig()
    expect(loaded.demo?.source).toEqual({ source: 'github', repo: 'o/r' })
  })

  test('concurrent RMW preserves both keys (serial queue)', async () => {
    // Seed empty config file so proper-lockfile can lock the target.
    await mkdir(tmpRoot, { recursive: true })
    await writeFile(join(tmpRoot, 'known_marketplaces.json'), '{}', 'utf-8')

    const p1 = updateKnownMarketplacesConfig(cfg => {
      cfg['a'] = {
        source: { source: 'github', repo: 'a/a' },
        installLocation: join(tmpRoot, 'marketplaces', 'a'),
        lastUpdated: '2026-01-01T00:00:00.000Z',
      }
      return cfg
    })
    const p2 = updateKnownMarketplacesConfig(cfg => {
      cfg['b'] = {
        source: { source: 'github', repo: 'b/b' },
        installLocation: join(tmpRoot, 'marketplaces', 'b'),
        lastUpdated: '2026-01-02T00:00:00.000Z',
      }
      return cfg
    })
    const [w1, w2] = await Promise.all([p1, p2])
    expect(w1).toBe(true)
    expect(w2).toBe(true)

    const raw = await readFile(
      join(tmpRoot, 'known_marketplaces.json'),
      'utf-8',
    )
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(parsed).toHaveProperty('a')
    expect(parsed).toHaveProperty('b')
  })

  test('second writer sees first writer result under same key chain', async () => {
    await mkdir(tmpRoot, { recursive: true })
    await writeFile(join(tmpRoot, 'known_marketplaces.json'), '{}', 'utf-8')

    await updateKnownMarketplacesConfig(cfg => {
      cfg['x'] = {
        source: { source: 'github', repo: 'x/x' },
        installLocation: join(tmpRoot, 'marketplaces', 'x'),
        lastUpdated: 't1',
      }
      return cfg
    })
    await updateKnownMarketplacesConfig(cfg => {
      expect(cfg.x).toBeDefined()
      cfg['x'] = {
        ...cfg.x!,
        lastUpdated: 't2',
      }
      return cfg
    })
    const loaded = await loadKnownMarketplacesConfig()
    expect(loaded.x?.lastUpdated).toBe('t2')
  })
})
