/**
 * densable 2.1.248 #16 — leftover host for official class gc prStatuses.
 * Gold: Yu @192120820 · Li @192124642 · #x/#E · V$n + G$n · Wo/KC.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PrStatusCacheEntry } from '../../../utils/prStatusCache.js'
import { PR_STATUS_CACHE_FILENAME } from '../../../utils/prStatusCache.js'
import {
  CHILD_HREF_CONTROL_RE,
  collectJobPrHrefs,
  createPrStatusRoster,
  fleetJobChildren,
  fleetPrFetchIntervalMs,
  pruneMapToKeys,
  prReviewStateFromEntry,
  uniqueHrefs,
} from '../prStatuses.js'

const VALID: PrStatusCacheEntry = {
  number: 16,
  title: 'roster',
  state: 'OPEN',
  checks: { passed: 1, failed: 0, pending: 0 },
  review: 'REVIEW_REQUIRED',
  additions: 2,
  deletions: 1,
}

const MERGED: PrStatusCacheEntry = {
  ...VALID,
  state: 'MERGED',
  title: 'done',
}

function withConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pr-statuses-248-'))
  process.env.CLAUDE_CONFIG_DIR = dir
  return dir
}

let tmpDir: string | undefined
const prevConfig = process.env.CLAUDE_CONFIG_DIR

afterEach(() => {
  if (prevConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = prevConfig
  if (tmpDir) {
    rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('densable 2.1.248 #16 Yu / Li / se', () => {
  test('Yu focused + idle bands', () => {
    expect(fleetPrFetchIntervalMs(true, 0)).toBe(15_000)
    expect(fleetPrFetchIntervalMs(true, 29_999)).toBe(15_000)
    expect(fleetPrFetchIntervalMs(true, 30_000)).toBe(60_000)
    expect(fleetPrFetchIntervalMs(true, 299_999)).toBe(60_000)
    expect(fleetPrFetchIntervalMs(true, 300_000)).toBe(180_000)
    expect(fleetPrFetchIntervalMs(false, 0)).toBe(60_000)
    expect(fleetPrFetchIntervalMs(false, 30_000)).toBe(300_000)
    expect(fleetPrFetchIntervalMs(false, 600_000)).toBe(900_000)
    expect(fleetPrFetchIntervalMs(false, 3_600_000)).toBe(1_800_000)
  })

  test('Li drops keys not in the live set and keeps identity when unchanged', () => {
    const map = new Map([
      ['a', VALID],
      ['b', MERGED],
    ])
    expect(pruneMapToKeys(map, new Set(['a', 'b']))).toBe(map)
    const pruned = pruneMapToKeys(map, new Set(['b']))
    expect(pruned).not.toBe(map)
    expect([...pruned.keys()]).toEqual(['b'])
  })

  test('se unique + collect skips frame children', () => {
    expect(uniqueHrefs(['u', 'u', 'v'])).toEqual(['u', 'v'])
    expect(
      collectJobPrHrefs([
        {
          children: [
            { href: 'https://github.com/a/b/pull/1', kind: 'pr' },
            { href: 'https://github.com/a/b/pull/1', kind: 'pr' },
            { href: 'https://example/frame', kind: 'frame' },
          ],
        },
      ]),
    ).toEqual(['https://github.com/a/b/pull/1'])
  })

  test('Wo / KC.test drops control-char hrefs', () => {
    const dirty = 'https://github.com/a/b/pull/1\x01'
    expect(CHILD_HREF_CONTROL_RE.test(dirty)).toBe(true)
    expect(
      fleetJobChildren([
        { href: dirty, kind: 'pr' },
        { href: 'https://github.com/a/b/pull/2', kind: 'pr' },
      ]).map(child => child.href),
    ).toEqual(['https://github.com/a/b/pull/2'])
    expect(
      collectJobPrHrefs([
        {
          children: [
            { href: dirty, kind: 'pr' },
            { href: 'https://github.com/a/b/pull/2', kind: 'pr' },
          ],
        },
      ]),
    ).toEqual(['https://github.com/a/b/pull/2'])
  })

  test('RJt → leftover prReviewState', () => {
    expect(prReviewStateFromEntry(VALID)).toBe('pending')
    expect(prReviewStateFromEntry({ ...VALID, review: 'APPROVED' })).toBe(
      'approved',
    )
    expect(
      prReviewStateFromEntry({ ...VALID, review: 'CHANGES_REQUESTED' }),
    ).toBe('changes_requested')
    expect(prReviewStateFromEntry({ ...VALID, state: 'DRAFT' })).toBe('draft')
    expect(prReviewStateFromEntry(MERGED)).toBeUndefined()
    expect(prReviewStateFromEntry(null)).toBeUndefined()
  })
})

describe('densable 2.1.248 #16 #x / #E / load PR slice', () => {
  test('#x loads disk cache when empty; malformed entries do not throw', async () => {
    tmpDir = withConfigDir()
    writeFileSync(
      join(tmpDir, PR_STATUS_CACHE_FILENAME),
      JSON.stringify({
        'https://github.com/a/b/pull/1': VALID,
        bad: { number: 'nope' },
      }),
    )
    const roster = createPrStatusRoster({
      focused: () => true,
      lastInteraction: () => Date.now(),
      fetchByUrl: async () => null,
    })
    await expect(roster.loadOnAttach()).resolves.toBeUndefined()
    expect(roster.prStatuses.get('https://github.com/a/b/pull/1')).toEqual(
      VALID,
    )
    expect(roster.prStatuses.has('bad')).toBe(false)
  })

  test('load() fetches open hrefs via G$n, skips MERGED, prunes stale keys', async () => {
    tmpDir = withConfigDir()
    const hrefOpen = 'https://github.com/a/b/pull/2'
    const hrefMerged = 'https://github.com/a/b/pull/3'
    const hrefGone = 'https://github.com/a/b/pull/9'
    const fetched: string[] = []
    const roster = createPrStatusRoster({
      now: () => 1_000_000,
      focused: () => true,
      lastInteraction: () => 1_000_000,
      useBatch: false,
      fetchByUrl: async url => {
        fetched.push(url)
        return { ...VALID, number: 2, title: url }
      },
    })
    roster.apply(() => {
      const next = new Map<string, PrStatusCacheEntry | null>()
      next.set(hrefMerged, MERGED)
      next.set(hrefGone, VALID)
      return next
    })
    await roster.refreshFromJobs([
      {
        children: [
          { href: hrefOpen, kind: 'pr' },
          { href: hrefMerged, kind: 'pr' },
        ],
      },
    ])
    expect(fetched).toEqual([hrefOpen])
    expect(roster.prStatuses.get(hrefOpen)?.title).toBe(hrefOpen)
    expect(roster.prStatuses.get(hrefMerged)?.state).toBe('MERGED')
    expect(roster.prStatuses.has(hrefGone)).toBe(false)
  })

  test('Yu gate skips a second fetch inside the interval', async () => {
    tmpDir = withConfigDir()
    let n = 0
    const roster = createPrStatusRoster({
      now: () => 50_000,
      focused: () => true,
      lastInteraction: () => 50_000,
      useBatch: false,
      fetchByUrl: async () => {
        n++
        return VALID
      },
    })
    const jobs = [
      { children: [{ href: 'https://github.com/a/b/pull/4', kind: 'pr' }] },
    ]
    await roster.refreshFromJobs(jobs)
    await roster.refreshFromJobs(jobs)
    expect(n).toBe(1)
  })

  test('load() V$n batch + unbatched G$n', async () => {
    tmpDir = withConfigDir()
    const hrefBatch = 'https://github.com/a/b/pull/5'
    const hrefUnbatched = 'http://github.com/a/b/pull/6'
    const batched: string[][] = []
    const fetched: string[] = []
    const roster = createPrStatusRoster({
      now: () => 1_000_000,
      focused: () => true,
      lastInteraction: () => 1_000_000,
      useBatch: true,
      fetchBatch: async hrefs => {
        batched.push([...hrefs])
        return {
          statuses: new Map([[hrefBatch, { ...VALID, title: 'batch' }]]),
          rateLimit: null,
          unbatched: [hrefUnbatched],
        }
      },
      fetchByUrl: async url => {
        fetched.push(url)
        return { ...VALID, title: url }
      },
    })
    await roster.refreshFromJobs([
      {
        children: [
          { href: hrefBatch, kind: 'pr' },
          { href: hrefUnbatched, kind: 'pr' },
        ],
      },
    ])
    expect(batched).toEqual([[hrefBatch, hrefUnbatched]])
    expect(fetched).toEqual([hrefUnbatched])
    expect(roster.prStatuses.get(hrefBatch)?.title).toBe('batch')
    expect(roster.prStatuses.get(hrefUnbatched)?.title).toBe(hrefUnbatched)
  })

  test('HOST: AgentView.refresh is leftover #x + load', () => {
    const agentView = readFileSync(
      join(import.meta.dir, '../../AgentView.tsx'),
      'utf8',
    )
    expect(agentView).toContain('fleetPrStatuses.loadOnAttach()')
    expect(agentView).toContain('fleetPrStatuses.refreshFromJobs')
    expect(agentView).toContain(
      'deriveActivity(session, fleetPrStatuses.prStatuses)',
    )
    expect(agentView).toContain('children: job.children ?? null')
    expect(agentView).not.toContain('prViewCache')
    const host = readFileSync(join(import.meta.dir, '../prStatuses.ts'), 'utf8')
    expect(host).toContain('fetchPrStatusBatch')
    expect(host).toContain('CHILD_HREF_CONTROL_RE')
  })
})
