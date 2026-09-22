/**
 * densable 2.1.248 #16 uXe / K$n / q$n / RJt — malformed PR-status cache
 * entries must drop (not crash). Gold drop string 1:1.
 *
 * GOLD: gold-248-agents-pass2.txt / gold-248-agents-bodies.txt
 *       gold-248-16-roster.txt
 * uXe @184559295 sha=47077b3550afa3f2
 * K$n @184559595 sha=d5f332dda9cbcad7
 * q$n @184558619 sha=bfeb4eac3fbfa629
 * roster #x @192131709 / #E @192134546 leftover host:
 * src/screens/fleetView/prStatuses.ts via AgentView.refresh.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { debugMock } from '../../../tests/mocks/debug.js'

const debugLogs: string[] = []

mock.module('../debug.ts', () => ({
  ...debugMock(),
  logForDebugging: (message: string) => {
    debugLogs.push(message)
  },
}))

import {
  getPrStatusCachePath,
  loadPrStatusCache,
  parsePrStatusCache,
  persistPrStatusCache,
  PR_STATUS_CACHE_FILENAME,
  PR_STATUS_CACHE_STATE_KEY,
  prStatusCacheEntrySchema,
  type PrStatusCacheEntry,
  type PrStatusCacheStorage,
} from '../prStatusCache.js'
import { getPrStatusShared } from '../prStatusPoller.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../storageV5/hoverRestPin.js'

const GOLD_DROP =
  'loadPrStatusCache: dropped ${dropped} malformed cache entries'
const src = readFileSync(join(import.meta.dir, '../prStatusCache.ts'), 'utf8')

const VALID_ENTRY: PrStatusCacheEntry = {
  number: 16,
  title: 'drop malformed cache',
  state: 'OPEN',
  checks: { passed: 2, failed: 0, pending: 1 },
  review: 'APPROVED',
  additions: 4,
  deletions: 1,
}

function validBody(
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { 'job-ok': VALID_ENTRY, ...extra }
}

afterEach(() => {
  debugLogs.length = 0
  getPrStatusShared().reset()
  resetHoverRestPinForTests()
})

describe('densable 2.1.248 #16 RJt schema', () => {
  test('accepts gold fleet PR cache entry', () => {
    expect(prStatusCacheEntrySchema().safeParse(VALID_ENTRY).success).toBe(true)
    expect(
      prStatusCacheEntrySchema().safeParse({
        ...VALID_ENTRY,
        review: null,
        state: 'DRAFT',
      }).success,
    ).toBe(true)
  })

  test('rejects missing fields and illegal enums', () => {
    expect(prStatusCacheEntrySchema().safeParse({}).success).toBe(false)
    expect(
      prStatusCacheEntrySchema().safeParse({
        ...VALID_ENTRY,
        state: 'open',
      }).success,
    ).toBe(false)
    expect(
      prStatusCacheEntrySchema().safeParse({
        ...VALID_ENTRY,
        review: undefined,
      }).success,
    ).toBe(false)
    expect(
      prStatusCacheEntrySchema().safeParse({
        number: 1,
        title: 'x',
      }).success,
    ).toBe(false)
  })
})

describe('densable 2.1.248 #16 uXe parsePrStatusCache', () => {
  test('gold drop log string is 1:1', () => {
    expect(src).toContain(GOLD_DROP)
    expect(src).not.toContain('malformed PR')
  })

  test('keeps valid entries', () => {
    const cache = parsePrStatusCache(JSON.stringify(validBody()))
    expect(cache.size).toBe(1)
    expect(cache.get('job-ok')).toEqual(VALID_ENTRY)
    expect(debugLogs).toEqual([])
  })

  test('invalid JSON returns empty map and does not throw', () => {
    expect(parsePrStatusCache('{')).toEqual(new Map())
    expect(parsePrStatusCache('')).toEqual(new Map())
    expect(debugLogs).toEqual([])
  })

  test('null / array / non-object JSON returns empty map', () => {
    expect(parsePrStatusCache('null')).toEqual(new Map())
    expect(parsePrStatusCache('[]')).toEqual(new Map())
    expect(parsePrStatusCache('"x"')).toEqual(new Map())
    expect(parsePrStatusCache('1')).toEqual(new Map())
    expect(debugLogs).toEqual([])
  })

  test('drops malformed entries and logs gold 1:1', () => {
    const cache = parsePrStatusCache(
      JSON.stringify(
        validBody({
          'job-bad': { number: 1, title: 'nope' },
          'job-also-bad': null,
        }),
      ),
    )
    expect(cache.size).toBe(1)
    expect(cache.get('job-ok')).toEqual(VALID_ENTRY)
    expect(cache.has('job-bad')).toBe(false)
    expect(debugLogs).toEqual([
      'loadPrStatusCache: dropped 2 malformed cache entries',
    ])
  })

  test('all-malformed body is empty map, not a throw', () => {
    const cache = parsePrStatusCache(
      JSON.stringify({ a: 1, b: 'x', c: { number: '1' } }),
    )
    expect(cache.size).toBe(0)
    expect(debugLogs).toEqual([
      'loadPrStatusCache: dropped 3 malformed cache entries',
    ])
  })
})

describe('densable 2.1.248 #16 K$n loadPrStatusCache', () => {
  test('storage leftover key is Se.state(gh-pr-status-cache)', () => {
    expect(PR_STATUS_CACHE_STATE_KEY).toEqual({
      namespace: 'state',
      id: 'gh-pr-status-cache',
    })
    expect(PR_STATUS_CACHE_FILENAME).toBe('gh-pr-status-cache.json')
    expect(src).toContain('storage.read([PR_STATUS_CACHE_STATE_KEY])')
    expect(src).toContain('return parsePrStatusCache(raw)')
  })

  test('storage not found returns empty map', async () => {
    const storage: PrStatusCacheStorage = {
      read: async () => ({
        ok: true,
        value: { items: [{ found: false }] },
      }),
    }
    await expect(loadPrStatusCache(storage)).resolves.toEqual(new Map())
    expect(debugLogs).toEqual([])
  })

  test('storage !ok logs code and returns empty map', async () => {
    const storage: PrStatusCacheStorage = {
      read: async () => ({
        ok: false,
        error: { code: 'Failed' },
      }),
    }
    await expect(loadPrStatusCache(storage)).resolves.toEqual(new Map())
    expect(debugLogs).toEqual(['loadPrStatusCache: Failed'])
  })

  test('storage throw logs and returns empty map', async () => {
    const storage: PrStatusCacheStorage = {
      read: async () => {
        throw new Error('boom')
      },
    }
    await expect(loadPrStatusCache(storage)).resolves.toEqual(new Map())
    expect(debugLogs).toEqual(['loadPrStatusCache: boom'])
  })

  test('storage body with mixed entries drops malformed', async () => {
    const storage: PrStatusCacheStorage = {
      read: async reqs => {
        expect(reqs).toEqual([PR_STATUS_CACHE_STATE_KEY])
        return {
          ok: true,
          value: {
            items: [
              {
                found: true,
                value: Buffer.from(
                  JSON.stringify(
                    validBody({ bad: { title: 'missing number' } }),
                  ),
                ),
              },
            ],
          },
        }
      },
    }
    const cache = await loadPrStatusCache(storage)
    expect(cache.size).toBe(1)
    expect(cache.get('job-ok')).toEqual(VALID_ENTRY)
    expect(debugLogs).toEqual([
      'loadPrStatusCache: dropped 1 malformed cache entries',
    ])
  })

  test('fs leftover file: missing is empty; malformed does not throw', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-status-cache-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      expect(getPrStatusCachePath()).toBe(join(dir, PR_STATUS_CACHE_FILENAME))
      await expect(loadPrStatusCache()).resolves.toEqual(new Map())

      writeFileSync(
        join(dir, PR_STATUS_CACHE_FILENAME),
        JSON.stringify(validBody({ bad: { number: 1 } })),
      )
      const cache = await loadPrStatusCache()
      expect(cache.size).toBe(1)
      expect(cache.get('job-ok')).toEqual(VALID_ENTRY)
      expect(debugLogs).toEqual([
        'loadPrStatusCache: dropped 1 malformed cache entries',
      ])
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('densable 2.1.248 #16 q$n persistPrStatusCache', () => {
  test('gold persist strings are 1:1', () => {
    expect(src).toContain('persistPrStatusCache: ${result.error.code}')
    expect(src).toContain('persistPrStatusCache: ${errorMessage(err)}')
    expect(src).toContain('438 & ~process.umask()')
    expect(src).toContain(
      "body === '{}' || !getPrStatusShared().notePersistedCacheBody(body)",
    )
    expect(src).toContain('isHoverRestOn() && write')
    expect(src).toContain(
      'writeFile(getPrStatusCachePath(), body).catch(() => {})',
    )
    expect(src).toContain('if (value) bodyObj[key] = value')
  })

  test('empty map and all-falsy values are no-ops', async () => {
    const writes: unknown[] = []
    const storage: PrStatusCacheStorage = {
      read: async () => ({ ok: true, value: { items: [] } }),
      write: async (key, value) => {
        writes.push([key, value])
        return { ok: true }
      },
    }
    pinHoverRest(true)
    await persistPrStatusCache(new Map(), storage)
    await persistPrStatusCache(
      new Map<string, PrStatusCacheEntry | null>([
        ['a', null],
        ['b', undefined as unknown as PrStatusCacheEntry],
      ]),
      storage,
    )
    expect(writes).toEqual([])
    expect(getPrStatusShared().lastPersistedCacheBody).toBe('')
    expect(debugLogs).toEqual([])
  })

  test('storage + hover-rest writes hXe; !ok logs gold code', async () => {
    const writes: Array<{ key: unknown; value: string; mode?: number }> = []
    const storage: PrStatusCacheStorage = {
      read: async () => ({ ok: true, value: { items: [] } }),
      write: async (key, value, opts) => {
        writes.push({ key, value, mode: opts?.mode })
        return { ok: false, error: { code: 'Failed' } }
      },
    }
    pinHoverRest(true)
    const cache = new Map<string, PrStatusCacheEntry>([['job-ok', VALID_ENTRY]])
    await persistPrStatusCache(cache, storage)
    expect(writes).toEqual([
      {
        key: PR_STATUS_CACHE_STATE_KEY,
        value: JSON.stringify({ 'job-ok': VALID_ENTRY }),
        mode: 438 & ~process.umask(),
      },
    ])
    expect(debugLogs).toEqual(['persistPrStatusCache: Failed'])
  })

  test('storage throw logs gold persistPrStatusCache: err', async () => {
    const storage: PrStatusCacheStorage = {
      read: async () => ({ ok: true, value: { items: [] } }),
      write: async () => {
        throw new Error('boom')
      },
    }
    pinHoverRest(true)
    await persistPrStatusCache(new Map([['job-ok', VALID_ENTRY]]), storage)
    expect(debugLogs).toEqual(['persistPrStatusCache: boom'])
  })

  test('same body is skipped by JE().notePersistedCacheBody', async () => {
    let writes = 0
    const storage: PrStatusCacheStorage = {
      read: async () => ({ ok: true, value: { items: [] } }),
      write: async () => {
        writes++
        return { ok: true }
      },
    }
    pinHoverRest(true)
    const cache = new Map([['job-ok', VALID_ENTRY]])
    await persistPrStatusCache(cache, storage)
    await persistPrStatusCache(cache, storage)
    expect(writes).toBe(1)
    expect(
      getPrStatusShared().notePersistedCacheBody(
        JSON.stringify({ 'job-ok': VALID_ENTRY }),
      ),
    ).toBe(false)
    getPrStatusShared().reset()
    expect(getPrStatusShared().lastPersistedCacheBody).toBe('')
  })

  test('hover-rest off uses leftover file even if storage is passed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-status-persist-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    let writes = 0
    const storage: PrStatusCacheStorage = {
      read: async () => ({ ok: true, value: { items: [] } }),
      write: async () => {
        writes++
        return { ok: true }
      },
    }
    try {
      await persistPrStatusCache(new Map([['job-ok', VALID_ENTRY]]), storage)
      expect(writes).toBe(0)
      const raw = readFileSync(join(dir, PR_STATUS_CACHE_FILENAME), 'utf8')
      expect(JSON.parse(raw)).toEqual(validBody())
      const loaded = await loadPrStatusCache()
      expect(loaded.get('job-ok')).toEqual(VALID_ENTRY)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('leftover write failure is swallowed', async () => {
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = join(
      tmpdir(),
      'pr-status-persist-missing',
      'no-such-dir',
    )
    try {
      await expect(
        persistPrStatusCache(new Map([['job-ok', VALID_ENTRY]])),
      ).resolves.toBeUndefined()
      expect(debugLogs).toEqual([])
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
    }
  })

  test('skips falsy map entries in the persisted body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-status-persist-falsy-'))
    const prev = process.env.CLAUDE_CONFIG_DIR
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      await persistPrStatusCache(
        new Map<string, PrStatusCacheEntry | null>([
          ['job-ok', VALID_ENTRY],
          ['job-null', null],
        ]),
      )
      const raw = readFileSync(join(dir, PR_STATUS_CACHE_FILENAME), 'utf8')
      expect(JSON.parse(raw)).toEqual({ 'job-ok': VALID_ENTRY })
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR
      else process.env.CLAUDE_CONFIG_DIR = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('densable 2.1.248 #16 production callers + roster gold', () => {
  test('leftover AgentView wires official #x/#E via fleetView/prStatuses', () => {
    const gold = readFileSync(
      join(
        import.meta.dir,
        '../../../docs/upstream-extraction/v2.1.248/snippets/gold-248-16-roster.txt',
      ),
      'utf8',
    )
    expect(gold).toContain(
      '#x(i){if(this.#i=i,this.#y=0,this.#t.prStatuses.size===0)this.#e.loadPrStatusCache(this.#n).then((d)=>{if(d.size)this.#E((m)=>m.size?new Map([...d,...m]):d)});if(this.load()',
    )
    expect(gold).toContain(
      '#E(i){let d=this.#t.prStatuses;if(this.#p("prStatuses",i),this.#t.prStatuses!==d)this.#e.persistPrStatusCache(this.#t.prStatuses,this.#n)}',
    )
    expect(gold).toContain('class gc{')

    const agentView = readFileSync(
      join(import.meta.dir, '../../screens/AgentView.tsx'),
      'utf8',
    )
    const host = readFileSync(
      join(import.meta.dir, '../../screens/fleetView/prStatuses.ts'),
      'utf8',
    )
    expect(agentView).toContain('fleetPrStatuses.loadOnAttach()')
    expect(agentView).toContain('fleetPrStatuses.refreshFromJobs')
    expect(host).toContain('loadPrStatusCache')
    expect(host).toContain('persistPrStatusCache')
    expect(host).toContain("state !== 'MERGED' && state !== 'CLOSED'")
    expect(host).not.toContain('export class gc')
    expect(host).toContain('fetchPrStatusBatch')
  })
})
