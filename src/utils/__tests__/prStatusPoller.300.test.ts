import { beforeEach, describe, expect, mock, test } from 'bun:test'
import {
  createPrStatusShared,
  fetchPrStatusBatch,
  getPrStatusShared,
} from '../prStatusPoller.js'
import * as execMod from '../execFileNoThrow.js'

describe('2.1.300 #767 prStatusPoller batch per-node tolerance', () => {
  beforeEach(() => {
    getPrStatusShared().reset()
  })

  test('valid PRs still update when another PR node in the batch is malformed, and malformedBatchNodeLogged latches once', async () => {
    const validPrUrl = 'https://github.com/acme/repo/pull/1'
    const malformedPrUrl = 'https://github.com/acme/repo/pull/2'

    // Mock execFileNoThrow via spyOn
    const execSpy = mock(async () => ({
      stdout: JSON.stringify({
        data: {
          rateLimit: {
            cost: 1,
            remaining: 4900,
            resetAt: '2026-11-18T19:00:00Z',
          },
          r0: {
            p0_0: {
              number: 1,
              title: 'Valid PR',
              state: 'OPEN',
              isDraft: false,
              reviewDecision: 'APPROVED',
              additions: 10,
              deletions: 2,
              commits: {
                nodes: [
                  {
                    commit: {
                      statusCheckRollup: {
                        contexts: {
                          checkRunCountsByState: [
                            { state: 'SUCCESS', count: 3 },
                          ],
                          statusContextCountsByState: [],
                        },
                      },
                    },
                  },
                ],
              },
            },
            p0_1: {
              number: 'not-a-number',
              title: null,
            },
          },
        },
        errors: [{ message: 'partial failure' }],
      }),
      stderr: '',
      code: 0,
      interrupted: false,
    }))

    const { spyOn } = await import('bun:test')
    const spied = spyOn(execMod, 'execFileNoThrow').mockImplementation(
      execSpy as unknown as typeof execMod.execFileNoThrow,
    )

    try {
      const result = await fetchPrStatusBatch([validPrUrl, malformedPrUrl])
      expect(result.statuses.get(validPrUrl)).toEqual({
        number: 1,
        title: 'Valid PR',
        state: 'OPEN',
        checks: { passed: 3, failed: 0, pending: 0 },
        review: 'APPROVED',
        additions: 10,
        deletions: 2,
      })
      expect(result.statuses.get(malformedPrUrl)).toBeNull()
      expect(getPrStatusShared().malformedBatchNodeLogged).toBe(true)

      const fresh = createPrStatusShared()
      expect(fresh.malformedBatchNodeLogged).toBe(false)
    } finally {
      spied.mockRestore()
    }
  })
})
