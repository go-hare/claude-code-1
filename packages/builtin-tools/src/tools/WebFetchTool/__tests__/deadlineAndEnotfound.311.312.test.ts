import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import axios, { AxiosError } from 'axios'

;(globalThis as Record<string, unknown>).MACRO ??= { VERSION: '2.1.325' }

import {
  getWebFetchDeadlineMs,
  getWithPermittedRedirects,
  WebFetchRequestError,
} from '../utils.js'

describe('WebFetchTool deadline & cloud ENOTFOUND (#1243, #1331)', () => {
  const prevDeadline = process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS
  const prevRemote = process.env.CLAUDE_CODE_REMOTE

  afterEach(() => {
    if (prevDeadline === undefined) {
      delete process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS
    } else {
      process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS = prevDeadline
    }
    if (prevRemote === undefined) {
      delete process.env.CLAUDE_CODE_REMOTE
    } else {
      process.env.CLAUDE_CODE_REMOTE = prevRemote
    }
  })

  test('defaults deadline to 300000ms and respects CLAUDE_CODE_WEBFETCH_DEADLINE_MS', () => {
    delete process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS
    expect(getWebFetchDeadlineMs()).toBe(300_000)

    process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS = '50'
    expect(getWebFetchDeadlineMs()).toBe(50)
  })

  test('fails with EDEADLINE when request stalls past deadline (#1243)', async () => {
    process.env.CLAUDE_CODE_WEBFETCH_DEADLINE_MS = '30'
    const getSpy = spyOn(axios, 'get').mockImplementation(
      (_url, config) =>
        new Promise((_resolve, reject) => {
          config?.signal?.addEventListener?.('abort', () => {
            reject(new axios.CanceledError('aborted'))
          })
        }),
    )

    try {
      const callerController = new AbortController()
      await expect(
        getWithPermittedRedirects(
          'https://example.com/slow',
          callerController.signal,
          () => true,
        ),
      ).rejects.toMatchObject({
        name: 'WebFetchRequestError',
        code: 'EDEADLINE',
      })
    } finally {
      getSpy.mockRestore()
    }
  })

  test('augments ENOTFOUND error in cloud sessions (#1331)', async () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const getSpy = spyOn(axios, 'get').mockRejectedValue(
      new AxiosError('getaddrinfo ENOTFOUND blocked.example.com', 'ENOTFOUND'),
    )

    try {
      const err = await getWithPermittedRedirects(
        'https://blocked.example.com/page',
        new AbortController().signal,
        () => true,
      ).catch(e => e)

      expect(err).toBeInstanceOf(WebFetchRequestError)
      expect(err.code).toBe('ENOTFOUND')
      expect(err.message).toContain(
        "outside the session's allowed network domains",
      )
      expect(err.message).toContain(
        "blocked.example.com has to be allowed in the session's network settings",
      )
    } finally {
      getSpy.mockRestore()
    }
  })
})
