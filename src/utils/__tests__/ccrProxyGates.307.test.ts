import { describe, expect, test } from 'bun:test'
import { postCcrSessionWorker } from '../ccrProxyGates.js'

describe('#1100 postCcrSessionWorker 403 & error-field parsing', () => {
  const baseEnv: NodeJS.ProcessEnv = {
    CLAUDE_CODE_SESSION_ID: 'session_abc123',
    ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
  }

  test('403 with nested error.message surfaces the plain reason', async () => {
    const res = await postCcrSessionWorker({
      route: 'web-search',
      toolName: 'WebSearch',
      logLabel: 'websearch-proxy',
      targetErrorLabel: 'search error',
      body: { query: 'test' },
      env: baseEnv,
      authHeaders: { Authorization: 'Bearer tok' },
      post: (async () => ({
        status: 403,
        data: { error: { message: 'Web search is disabled for this org' } },
        headers: {},
      })) as unknown as typeof import('axios').default.post,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.statusCode).toBe(403)
      expect(res.errorType).toBe('PROXY_REJECTED')
      expect(res.errorMessage).toContain('Web search is disabled for this org')
    }
  })

  test('302 redirect returns explicit redirect message', async () => {
    const res = await postCcrSessionWorker({
      route: 'web-fetch',
      toolName: 'WebFetch',
      logLabel: 'webfetch-proxy',
      targetErrorLabel: 'fetch error',
      body: { url: 'https://example.com' },
      env: baseEnv,
      authHeaders: { Authorization: 'Bearer tok' },
      post: (async () => ({
        status: 302,
        data: {},
        headers: {},
      })) as unknown as typeof import('axios').default.post,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.errorMessage).toContain('answered with a redirect (HTTP 302)')
    }
  })

  test('200 target error validates error_type and plain single-line error_message', async () => {
    const res = await postCcrSessionWorker({
      route: 'web-fetch',
      toolName: 'WebFetch',
      logLabel: 'webfetch-proxy',
      targetErrorLabel: 'fetch error',
      body: { url: 'https://example.com' },
      env: baseEnv,
      authHeaders: { Authorization: 'Bearer tok' },
      post: (async () => ({
        status: 200,
        data: {
          error: {
            error_type: 'bad type with spaces!',
            error_message: 'line1\nline2',
          },
        },
        headers: {},
      })) as unknown as typeof import('axios').default.post,
    })

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.source).toBe('target')
      expect(res.errorType).toBe('UNKNOWN')
      expect(res.errorMessage).toBe('')
    }
  })
})
