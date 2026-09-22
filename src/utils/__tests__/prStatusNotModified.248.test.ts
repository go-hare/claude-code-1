/**
 * densable 2.1.248 #41 — PR unchanged: REST 304 empty-ok + streak + A$ 30s.
 *
 * GOLD: gold-248-na-41-A$.txt / gold-248-na-41-dXe.txt / gold-248-41-nge.txt
 * Footer FY→nge→wY(shared:JE(), y5e, eDt). 247 Wut leftover stays as p5e.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

import {
  applyPollerFetchResult,
  applyRestListResponse,
  buildDirectPrStatus,
  countCheckRollup,
  createAsyncTtlCache,
  createPrStatusShared,
  GITHUB_PR_API_VERSION,
  isDirectApiEnabled,
  PR_STATUS_BY_URL_TTL_MS,
  PR_STATUS_FOCUS_RECHECK_MS,
  PR_STATUS_UNFOCUSED_MIN_MS,
  PrStatusPoller,
  prStatusPollIntervalMs,
  restListConditionalHeaders,
  restListSchema,
  type DirectState,
  type RestListResponse,
} from '../prStatusPoller.js'

const pollerSrc = readFileSync(
  join(import.meta.dir, '../prStatusPoller.ts'),
  'utf8',
)
const leftoverSrc = readFileSync(
  join(import.meta.dir, '../../hooks/usePrStatus.ts'),
  'utf8',
)
const footerSrc = readFileSync(
  join(
    import.meta.dir,
    '../../components/PromptInput/PromptInputFooterLeftSide.tsx',
  ),
  'utf8',
)
const ghSrc = readFileSync(join(import.meta.dir, '../ghPrStatus.ts'), 'utf8')

function emptyState(branch = 'feat'): DirectState {
  return {
    branch,
    etag: null,
    pr: null,
    reviewDecision: '',
    lastReviewFetchAt: 0,
    redirectedListUrl: null,
  }
}

function jsonResp(
  status: number,
  body: unknown,
  etag: string | null = null,
): RestListResponse & { jsonCalls: number } {
  const jsonCalls = { n: 0 }
  const resp = {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'etag' ? etag : null),
    },
    json: async () => {
      jsonCalls.n++
      return body
    },
    get jsonCalls() {
      return jsonCalls.n
    },
  }
  return resp
}

describe('densable 2.1.248 #41 p5e=60000 and sJt gh pr view (no 304)', () => {
  test('p5e focus sibling is 60000; sJt has no 304', () => {
    expect(leftoverSrc).toContain('densable 2.1.247 Wut')
    expect(leftoverSrc).toContain('248 p5e')
    expect(leftoverSrc).toContain('PR_STATUS_FOCUS_RECHECK_MS')
    expect(PR_STATUS_FOCUS_RECHECK_MS).toBe(60_000)
    expect(ghSrc).toContain(
      'number,url,reviewDecision,isDraft,headRefName,state',
    )
    expect(ghSrc).not.toContain('If-None-Match')
    expect(pollerSrc).toContain('pollerNotModifiedStreak')
    expect(pollerSrc).toContain('status === 304')
  })
})

describe('densable 2.1.248 #41 production footer caller', () => {
  test('FY leftover calls usePrStatus; nge leftover calls wY/eDt/JE', () => {
    expect(footerSrc).toContain('usePrStatus')
    expect(footerSrc).toContain(
      'const prStatus = usePrStatus(isLoading, isPrStatusEnabled())',
    )
    expect(leftoverSrc).toContain('fetchPrStatusForPoller')
    expect(leftoverSrc).toContain('getPrStatusShared')
    expect(leftoverSrc).toContain('isDirectApiEnabled')
    expect(leftoverSrc).toContain('new PrStatusPoller')
    expect(pollerSrc).toContain('fetchPrStatusForPoller')
    expect(pollerSrc).toContain('fetchDirectPrStatus')
    expect(pollerSrc).toContain("tengu_harbor_prism'")
    expect(pollerSrc).toContain('isDirectApiEnabled()')
    expect(pollerSrc).toContain('fetchGithubPrStatus')
    expect(isDirectApiEnabled()).toBe(false)
  })
})

describe('densable 2.1.248 #41 A$ prStatusByUrl TTL', () => {
  test('gold TTL is 30000', () => {
    expect(PR_STATUS_BY_URL_TTL_MS).toBe(30_000)
    expect(pollerSrc).toContain('PR_STATUS_BY_URL_TTL_MS')
    expect(pollerSrc).toContain('createAsyncTtlCache')
    expect(pollerSrc).toContain('fetchPrStatusByUrl')
  })

  test('cold miss computes once; hit returns cache', async () => {
    let calls = 0
    const fn = createAsyncTtlCache(async (url: string) => {
      calls++
      return { url, n: calls }
    }, 60_000)
    expect(await fn('https://example.com/1')).toEqual({
      url: 'https://example.com/1',
      n: 1,
    })
    expect(await fn('https://example.com/1')).toEqual({
      url: 'https://example.com/1',
      n: 1,
    })
    expect(calls).toBe(1)
  })

  test('concurrent cold-miss shares one in-flight promise', async () => {
    let calls = 0
    const fn = createAsyncTtlCache(async () => {
      calls++
      await new Promise<void>(resolve => setTimeout(resolve, 15))
      return calls
    }, 60_000)
    const [a, b] = await Promise.all([fn(), fn()])
    expect(a).toBe(1)
    expect(b).toBe(1)
    expect(calls).toBe(1)
  })

  test('cache.clear drops entries', async () => {
    let calls = 0
    const fn = createAsyncTtlCache(async () => {
      calls++
      return calls
    }, 60_000)
    await fn()
    fn.cache.clear()
    await fn()
    expect(calls).toBe(2)
  })

  test('stale TTL returns previous value immediately', async () => {
    let calls = 0
    const fn = createAsyncTtlCache(async () => {
      calls++
      return calls
    }, 1)
    expect(await fn()).toBe(1)
    await new Promise<void>(resolve => setTimeout(resolve, 10))
    expect(await fn()).toBe(1)
  })
})

describe('densable 2.1.248 #41 REST 304 empty-ok', () => {
  test('lJt schema is number/html_url/draft', () => {
    expect(
      restListSchema().safeParse([
        {
          number: 41,
          html_url: 'https://github.com/o/r/pull/41',
          draft: false,
        },
      ]).success,
    ).toBe(true)
    expect(restListSchema().safeParse([{ number: 1 }]).success).toBe(false)
  })

  test('If-None-Match only when etag is truthy', () => {
    expect(GITHUB_PR_API_VERSION).toBe('2022-11-28')
    expect(restListConditionalHeaders(null)).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    })
    expect(restListConditionalHeaders('W/"abc"')).toEqual({
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'If-None-Match': 'W/"abc"',
    })
    expect(pollerSrc).toContain("'If-None-Match'")
  })

  test('status===304 is empty-ok: no json(), etag/pr unchanged', async () => {
    const state = emptyState()
    state.etag = '"keep"'
    state.pr = {
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: false,
    }
    state.reviewDecision = 'APPROVED'
    const resp = jsonResp(
      304,
      [{ number: 99, html_url: 'nope', draft: true }],
      '"new"',
    )
    await expect(applyRestListResponse(state, resp)).resolves.toBe(
      'not-modified',
    )
    expect(resp.jsonCalls).toBe(0)
    expect(state.etag).toBe('"keep"')
    expect(state.pr?.number).toBe(41)
    expect(state.reviewDecision).toBe('APPROVED')
  })

  test('304 is empty-ok even when ok is false (fetch 304)', async () => {
    const state = emptyState()
    state.pr = {
      number: 7,
      url: 'https://github.com/o/r/pull/7',
      isDraft: false,
    }
    const resp: RestListResponse = {
      status: 304,
      ok: false,
      headers: { get: () => null },
      json: async () => {
        throw new Error('body must not be read on 304')
      },
    }
    await expect(applyRestListResponse(state, resp)).resolves.toBe(
      'not-modified',
    )
    expect(state.pr?.number).toBe(7)
  })

  test('200 updates etag + first list item; empty list clears pr', async () => {
    const state = emptyState()
    state.pr = {
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: false,
    }
    state.reviewDecision = 'APPROVED'
    const resp = jsonResp(
      200,
      [
        {
          number: 41,
          html_url: 'https://github.com/o/r/pull/41',
          draft: true,
        },
      ],
      'W/"v2"',
    )
    await expect(applyRestListResponse(state, resp)).resolves.toBe('updated')
    expect(resp.jsonCalls).toBe(1)
    expect(state.etag).toBe('W/"v2"')
    expect(state.pr).toEqual({
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: true,
    })
    expect(state.reviewDecision).toBe('APPROVED')

    const cleared = jsonResp(200, [], '"empty"')
    await expect(applyRestListResponse(state, cleared)).resolves.toBe('updated')
    expect(state.pr).toBeNull()
  })

  test('200 with a new PR number clears reviewDecision', async () => {
    const state = emptyState()
    state.pr = {
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      isDraft: false,
    }
    state.reviewDecision = 'APPROVED'
    await applyRestListResponse(
      state,
      jsonResp(
        200,
        [
          {
            number: 2,
            html_url: 'https://github.com/o/r/pull/2',
            draft: false,
          },
        ],
        '"n"',
      ),
    )
    expect(state.reviewDecision).toBe('')
    expect(state.pr?.number).toBe(2)
  })

  test('non-ok non-304 is fetch-failed', async () => {
    const state = emptyState()
    await expect(
      applyRestListResponse(state, jsonResp(403, { message: 'nope' })),
    ).resolves.toBe('fetch-failed')
    expect(state.pr).toBeNull()
  })
})

describe('densable 2.1.248 #41 notModified + streak + bump.emit', () => {
  test('fe same identity+review sets notModified:true', () => {
    const prev = {
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: false,
      reviewDecision: 'APPROVED',
    }
    const current = {
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: false,
    }
    expect(buildDirectPrStatus(prev, current, 'APPROVED', false)).toEqual({
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      reviewState: 'approved',
      notModified: true,
    })
    expect(
      buildDirectPrStatus(prev, current, 'CHANGES_REQUESTED', false),
    ).toEqual({
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      reviewState: 'changes_requested',
    })
    expect(buildDirectPrStatus(prev, current, 'APPROVED', true)).toEqual({
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      reviewState: 'approved',
    })
  })

  test('pollerNotModifiedStreak increments on Re, else resets', () => {
    const shared = createPrStatusShared()
    expect(shared.pollerNotModifiedStreak).toBe(0)
    applyPollerFetchResult(shared, {
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      reviewState: 'pending',
      notModified: true,
    })
    expect(shared.pollerNotModifiedStreak).toBe(1)
    applyPollerFetchResult(shared, {
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      reviewState: 'pending',
      notModified: true,
    })
    expect(shared.pollerNotModifiedStreak).toBe(2)
    applyPollerFetchResult(shared, {
      number: 1,
      url: 'https://github.com/o/r/pull/1',
      reviewState: 'approved',
    })
    expect(shared.pollerNotModifiedStreak).toBe(0)
  })

  test('fetch-failed bumps pollerBadStreak and zeros notModified streak', () => {
    const shared = createPrStatusShared()
    applyPollerFetchResult(shared, {
      number: 1,
      url: 'u',
      reviewState: 'pending',
      notModified: true,
    })
    applyPollerFetchResult(shared, 'fetch-failed')
    expect(shared.pollerBadStreak).toBe(1)
    expect(shared.pollerNotModifiedStreak).toBe(0)
    applyPollerFetchResult(shared, {
      number: 1,
      url: 'u',
      reviewState: 'pending',
    })
    expect(shared.pollerBadStreak).toBe(0)
  })

  test('bump.emit resets streak then notifies (push / gh pr)', () => {
    const shared = createPrStatusShared()
    shared.pollerNotModifiedStreak = 4
    let seen = -1
    let fired = 0
    shared.bump.subscribe(() => {
      fired++
      seen = shared.pollerNotModifiedStreak
    })
    shared.bump.emit()
    expect(shared.pollerNotModifiedStreak).toBe(0)
    expect(seen).toBe(0)
    expect(fired).toBe(1)
  })

  test('reset() zeros streak and clears prStatusByUrl cache', () => {
    const shared = createPrStatusShared()
    shared.pollerNotModifiedStreak = 3
    shared.pollerBadStreak = 2
    shared.directStateForBranch('feat')
    shared.reset()
    expect(shared.pollerNotModifiedStreak).toBe(0)
    expect(shared.pollerBadStreak).toBe(0)
    expect(shared.directState).toBeNull()
  })

  test('304 + unchanged review increments streak; bump emit drops it', async () => {
    const shared = createPrStatusShared()
    const state = shared.directStateForBranch('feat')
    state.etag = '"v1"'
    state.pr = {
      number: 41,
      url: 'https://github.com/o/r/pull/41',
      isDraft: false,
    }
    state.reviewDecision = 'APPROVED'
    const prev = { ...state.pr, reviewDecision: state.reviewDecision }
    await expect(
      applyRestListResponse(state, jsonResp(304, [], '"ignored"')),
    ).resolves.toBe('not-modified')
    const status = buildDirectPrStatus(
      prev,
      state.pr!,
      state.reviewDecision,
      false,
    )
    expect(status.notModified).toBe(true)
    applyPollerFetchResult(shared, status)
    expect(shared.pollerNotModifiedStreak).toBe(1)
    shared.bump.emit()
    expect(shared.pollerNotModifiedStreak).toBe(0)
  })
})

describe('densable 2.1.248 #41 y5e interval uses streak', () => {
  test('H<=0 / 1 / 2 / 3+ backoff 90s / 120s / 240s / 300s', () => {
    expect(prStatusPollIntervalMs(true, 0, 0, 0)).toBe(90_000)
    expect(prStatusPollIntervalMs(true, 0, 0, 1)).toBe(120_000)
    expect(prStatusPollIntervalMs(true, 0, 0, 2)).toBe(240_000)
    expect(prStatusPollIntervalMs(true, 0, 0, 3)).toBe(300_000)
    expect(prStatusPollIntervalMs(true, 0, 0, 9)).toBe(300_000)
  })

  test('unfocused floor is g5e=300000', () => {
    expect(PR_STATUS_UNFOCUSED_MIN_MS).toBe(300_000)
    expect(prStatusPollIntervalMs(false, 0, 0, 0)).toBe(300_000)
  })
})

describe('densable 2.1.248 #41 wY poller uses streak', () => {
  test('notModified fetch increments streak; bump.emit polls again', async () => {
    const shared = createPrStatusShared()
    let fetches = 0
    const poller = new PrStatusPoller(
      {
        setTimeout: (_fn, _ms) => () => {},
        now: () => Date.now(),
        getLastInteractionTime: () => 1,
        fetchPrStatus: async () => {
          fetches++
          return {
            number: 41,
            url: 'https://github.com/o/r/pull/41',
            reviewState: 'approved',
            notModified: true,
          }
        },
        isDirectApiEnabled: () => true,
        shared,
      },
      { isLoading: false, enabled: true, focused: true },
    )
    const unsub = poller.subscribe(() => {})
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(fetches).toBeGreaterThan(0)
    expect(shared.pollerNotModifiedStreak).toBeGreaterThan(0)
    const afterFirst = fetches
    shared.bump.emit()
    await new Promise<void>(resolve => setTimeout(resolve, 20))
    expect(fetches).toBeGreaterThan(afterFirst)
    unsub()
  })
})

describe('densable 2.1.248 #41 yJt check rollup', () => {
  test('counts SUCCESS/FAILURE/PENDING gold buckets', () => {
    expect(
      countCheckRollup([
        { conclusion: 'SUCCESS' },
        { conclusion: 'NEUTRAL' },
        { conclusion: 'SKIPPED' },
        { conclusion: 'FAILURE' },
        { conclusion: 'ERROR' },
        { conclusion: 'PENDING' },
        { state: 'EXPECTED' },
        { status: 'QUEUED' },
      ]),
    ).toEqual({ passed: 3, failed: 2, pending: 3 })
  })
})
