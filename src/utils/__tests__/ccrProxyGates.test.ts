import { describe, expect, test } from 'bun:test'
import {
  buildCcrWebFetchProxyUrl,
  buildCcrWebSearchProxyUrl,
  CCR_WEBFETCH_PROXY_PATH,
  fetchViaCcrSessionWorker,
  formatCcrProxyToolError,
  planWebFetchCcrProxy,
  resolveCcrCodeSessionId,
  resolveCcrIngressBaseUrl,
  searchViaCcrSessionWorker,
  shouldWebFetchUseCcrProxy,
  shouldWebFetchUseCcrSessionWorker,
  shouldWebSearchUseCcrProxy,
  shouldWebSearchUseCcrSessionWorker,
  unwrapCcrWebFetchProxyUrl,
} from '../ccrProxyGates.js'

describe('ccrProxyGates', () => {
  test('default off', () => {
    expect(shouldWebFetchUseCcrProxy({})).toBe(false)
    expect(shouldWebSearchUseCcrProxy({})).toBe(false)
  })
  test('env on', () => {
    expect(
      shouldWebFetchUseCcrProxy({ CLAUDE_CODE_WEBFETCH_USE_CCR_PROXY: '1' }),
    ).toBe(true)
    expect(
      shouldWebSearchUseCcrProxy({
        CLAUDE_CODE_WEBSEARCH_USE_CCR_PROXY: 'yes',
      }),
    ).toBe(true)
  })

  test('resolveCcrIngressBaseUrl prefers SESSION_INGRESS_URL', () => {
    expect(
      resolveCcrIngressBaseUrl({
        SESSION_INGRESS_URL: 'https://ingress.example/',
        ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      }),
    ).toBe('https://ingress.example')
    expect(resolveCcrIngressBaseUrl({})).toBeUndefined()
  })

  test('buildCcrWebFetchProxyUrl encodes target + session', () => {
    const u = buildCcrWebFetchProxyUrl({
      targetUrl: 'https://example.com/a?b=1',
      ingressBaseUrl: 'https://ingress.example',
      sessionId: 'sid-1',
    })
    expect(u).toContain(CCR_WEBFETCH_PROXY_PATH)
    const parsed = new URL(u)
    expect(parsed.searchParams.get('url')).toBe('https://example.com/a?b=1')
    expect(parsed.searchParams.get('session_id')).toBe('sid-1')
  })

  test('buildCcrWebSearchProxyUrl encodes query', () => {
    const u = buildCcrWebSearchProxyUrl({
      query: 'claude code',
      ingressBaseUrl: 'https://ingress.example',
    })
    expect(new URL(u).searchParams.get('q')).toBe('claude code')
  })

  test('planWebFetchCcrProxy densable reasons', () => {
    expect(
      planWebFetchCcrProxy({
        targetUrl: 'https://example.com',
        env: {},
      }).useProxy,
    ).toBe(false)
    expect(
      planWebFetchCcrProxy({
        targetUrl: 'https://example.com',
        env: { CLAUDE_CODE_WEBFETCH_USE_CCR_PROXY: '1' },
      }),
    ).toMatchObject({ useProxy: false, reason: 'no_ingress_base' })

    const plan = planWebFetchCcrProxy({
      targetUrl: 'https://example.com/page',
      env: { CLAUDE_CODE_WEBFETCH_USE_CCR_PROXY: '1' },
      ingressBaseUrl: 'https://ingress.example',
      sessionId: 's1',
      authToken: 'tok',
    })
    expect(plan.useProxy).toBe(true)
    if (plan.useProxy) {
      expect(plan.fetchUrl).toContain(CCR_WEBFETCH_PROXY_PATH)
      expect(plan.headers.Authorization).toBe('Bearer tok')
      expect(plan.originalUrl).toBe('https://example.com/page')
    }
  })

  test('unwrapCcrWebFetchProxyUrl roundtrip', () => {
    const proxied = buildCcrWebFetchProxyUrl({
      targetUrl: 'https://example.com/x',
      ingressBaseUrl: 'https://ingress.example',
    })
    expect(unwrapCcrWebFetchProxyUrl(proxied)).toBe('https://example.com/x')
    expect(unwrapCcrWebFetchProxyUrl('https://example.com/direct')).toBe(
      'https://example.com/direct',
    )
  })

  test('resolveCcrCodeSessionId accepts cse_/session_ only', () => {
    expect(resolveCcrCodeSessionId({ CLAUDE_CODE_SESSION_ID: 'cse_abc' })).toBe(
      'cse_abc',
    )
    expect(
      resolveCcrCodeSessionId({ CLAUDE_CODE_SESSION_ID: 'session_xyz' }),
    ).toBe('session_xyz')
    expect(
      resolveCcrCodeSessionId({ CLAUDE_CODE_SESSION_ID: 'local-uuid' }),
    ).toBeUndefined()
    expect(resolveCcrCodeSessionId({})).toBeUndefined()
  })

  test('shouldWebSearchUseCcrSessionWorker X0d densable', () => {
    expect(
      shouldWebSearchUseCcrSessionWorker({
        env: {},
        provider: 'firstParty',
      }),
    ).toBe(false)
    expect(
      shouldWebSearchUseCcrSessionWorker({
        env: {
          CLAUDE_CODE_WEBSEARCH_USE_CCR_PROXY: '1',
          CLAUDE_CODE_SESSION_ID: 'cse_1',
        },
        provider: 'bedrock',
      }),
    ).toBe(false)
    expect(
      shouldWebSearchUseCcrSessionWorker({
        env: {
          CLAUDE_CODE_WEBSEARCH_USE_CCR_PROXY: '1',
          CLAUDE_CODE_SESSION_ID: 'cse_1',
        },
        provider: 'firstParty',
      }),
    ).toBe(true)
    expect(
      shouldWebFetchUseCcrSessionWorker({
        env: {
          CLAUDE_CODE_WEBFETCH_USE_CCR_PROXY: '1',
          CLAUDE_CODE_SESSION_ID: 'session_1',
        },
        provider: 'firstParty',
      }),
    ).toBe(true)
  })

  test('searchViaCcrSessionWorker Q0d posts worker route', async () => {
    const posts: Array<{ url: string; body: unknown }> = []
    const post = async (url: string, body: unknown) => {
      posts.push({ url, body })
      return {
        status: 200,
        data: {
          results: [
            { title: 'T', url: 'https://example.com', snippet: 's' },
            { title: 'no-url' },
          ],
        },
      }
    }
    const r = await searchViaCcrSessionWorker({
      query: 'hello',
      allowedDomains: ['example.com'],
      env: {
        CLAUDE_CODE_SESSION_ID: 'cse_test',
        ANTHROPIC_BASE_URL: 'https://api.example.com/',
      },
      authHeaders: { Authorization: 'Bearer t' },
      post: post as never,
    })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.results).toEqual([
        { title: 'T', url: 'https://example.com', snippet: 's' },
      ])
    }
    expect(posts).toHaveLength(1)
    expect(posts[0]!.url).toBe(
      'https://api.example.com/v1/code/sessions/cse_test/worker/web-search',
    )
    expect(posts[0]!.body).toEqual({
      query: 'hello',
      allowed_domains: ['example.com'],
    })
  })

  test('fetchViaCcrSessionWorker a_d + proxy error shape', async () => {
    const ok = await fetchViaCcrSessionWorker({
      url: 'https://example.com',
      env: { CLAUDE_CODE_SESSION_ID: 'session_x' },
      baseUrl: 'https://api.example.com',
      authHeaders: {},
      post: (async () => ({
        status: 200,
        data: {
          text: 'body',
          content_type: 'text/markdown',
          destination_url: 'https://example.com/final',
        },
      })) as never,
    })
    expect(ok).toEqual({
      ok: true,
      content: 'body',
      contentType: 'text/markdown',
      destinationUrl: 'https://example.com/final',
    })

    const rejected = await fetchViaCcrSessionWorker({
      url: 'https://example.com',
      env: { CLAUDE_CODE_SESSION_ID: 'session_x' },
      baseUrl: 'https://api.example.com',
      authHeaders: {},
      post: (async () => ({
        status: 403,
        data: { message: 'nope' },
      })) as never,
    })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) {
      expect(rejected.errorType).toBe('PROXY_REJECTED')
      expect(formatCcrProxyToolError(rejected)).toContain('PROXY_REJECTED')
    }
  })
})
