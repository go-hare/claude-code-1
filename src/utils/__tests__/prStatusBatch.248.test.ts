/**
 * densable 2.1.248 #16 V$n / tst / SJt / kJt.
 * Empty / Tt() / KX() → all null. Unparsed /pull/ hrefs stay unbatched.
 *
 * GOLD: V$n @184556749 sha 77b300b83f96cd49
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  countGraphqlCheckStates,
  fetchPrStatusBatch,
  getPrStatusShared,
  mapGraphqlPullRequest,
  parseGithubPullUrl,
} from '../prStatusPoller.js'

const prevEssential = process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

afterEach(() => {
  getPrStatusShared().reset()
  if (prevEssential === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  } else {
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = prevEssential
  }
})

function clearEssentialTraffic(): void {
  delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
  getPrStatusShared().reset()
}

describe('densable 2.1.248 #16 V$n / tst / SJt / kJt', () => {
  test('tst parses https github pull URLs only', () => {
    expect(
      parseGithubPullUrl('https://github.com/acme/widgets/pull/16'),
    ).toEqual({
      url: 'https://github.com/acme/widgets/pull/16',
      host: 'github.com',
      owner: 'acme',
      repo: 'widgets',
      num: 16,
    })
    expect(
      parseGithubPullUrl('http://github.com/acme/widgets/pull/16'),
    ).toBeNull()
  })

  test('SJt / kJt map GraphQL check + review fields', () => {
    expect(
      countGraphqlCheckStates(
        [
          { state: 'SUCCESS', count: 2 },
          { state: 'FAILURE', count: 1 },
          { state: 'QUEUED', count: 3 },
        ],
        [
          { state: 'SUCCESS', count: 1 },
          { state: 'ERROR', count: 1 },
          { state: 'PENDING', count: 1 },
        ],
      ),
    ).toEqual({ passed: 3, failed: 2, pending: 4 })
    expect(
      mapGraphqlPullRequest({
        number: 16,
        title: 'batch',
        state: 'OPEN',
        isDraft: true,
        additions: 4,
        deletions: 1,
        reviewDecision: 'APPROVED',
        commits: {
          nodes: [
            {
              commit: {
                statusCheckRollup: {
                  contexts: {
                    checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }],
                    statusContextCountsByState: [],
                  },
                },
              },
            },
          ],
        },
      }),
    ).toEqual({
      number: 16,
      title: 'batch',
      state: 'DRAFT',
      checks: { passed: 1, failed: 0, pending: 0 },
      review: 'APPROVED',
      additions: 4,
      deletions: 1,
    })
  })

  test('V$n empty hrefs → all-null, no unbatched', async () => {
    clearEssentialTraffic()
    const result = await fetchPrStatusBatch([])
    expect([...result.statuses]).toEqual([])
    expect(result.unbatched).toEqual([])
    expect(result.rateLimit).toBeNull()
  })

  test('V$n Tt() / KX() → all null + empty unbatched', async () => {
    const href = 'https://github.com/a/b/pull/1'
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    const essential = await fetchPrStatusBatch([href])
    expect(essential.statuses.get(href)).toBeNull()
    expect(essential.unbatched).toEqual([])
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

    getPrStatusShared().backOffUntil(Date.now() + 60_000)
    const backedOff = await fetchPrStatusBatch([href])
    expect(backedOff.statuses.get(href)).toBeNull()
    expect(backedOff.unbatched).toEqual([])
  })

  test('V$n unparsed /pull/ hrefs stay unbatched', async () => {
    clearEssentialTraffic()
    const href = 'http://github.com/a/b/pull/9'
    const result = await fetchPrStatusBatch([href])
    expect(result.unbatched).toEqual([href])
    expect(result.statuses.size).toBe(0)
  })
})
