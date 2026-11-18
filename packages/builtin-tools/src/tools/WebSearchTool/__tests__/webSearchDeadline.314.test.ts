import { afterEach, describe, expect, test } from 'bun:test'
import {
  DEFAULT_WEBSEARCH_DEADLINE_MS,
  getWebSearchDeadlineMs,
  WebSearchRequestError,
  withWebSearchDeadline,
} from '../adapters/deadline.js'

describe('WebSearchTool 300s response stall deadline (#1243)', () => {
  const prevDeadline = process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS

  afterEach(() => {
    if (prevDeadline === undefined) {
      delete process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS
    } else {
      process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS = prevDeadline
    }
  })

  test('defaults deadline to 300000ms and respects CLAUDE_CODE_WEBSEARCH_DEADLINE_MS', () => {
    delete process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS
    expect(DEFAULT_WEBSEARCH_DEADLINE_MS).toBe(300_000)
    expect(getWebSearchDeadlineMs()).toBe(300_000)

    process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS = '50'
    expect(getWebSearchDeadlineMs()).toBe(50)
  })

  test('rejects with EDEADLINE when search stalls past deadline', async () => {
    process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS = '25'
    const callerController = new AbortController()

    await expect(
      withWebSearchDeadline(callerController.signal, signal => {
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new Error('aborted'))
          })
        })
      }),
    ).rejects.toMatchObject({
      name: 'WebSearchRequestError',
      code: 'EDEADLINE',
    })
  })

  test('propagates caller abort without turning it into EDEADLINE', async () => {
    process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS = '5000'
    const callerController = new AbortController()
    const promise = withWebSearchDeadline(callerController.signal, signal => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('user cancelled')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    callerController.abort()
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' })
  })

  test('returns result normally when search finishes before deadline', async () => {
    process.env.CLAUDE_CODE_WEBSEARCH_DEADLINE_MS = '500'
    const result = await withWebSearchDeadline(undefined, async () => [
      { title: 'ok', url: 'https://example.com' },
    ])
    expect(result).toEqual([{ title: 'ok', url: 'https://example.com' }])
    expect(new WebSearchRequestError('timeout', 'EDEADLINE').code).toBe(
      'EDEADLINE',
    )
  })
})
