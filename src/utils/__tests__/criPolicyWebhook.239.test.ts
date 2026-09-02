/**
 * densable 2.1.239 #44 En_ — org policy webhook → 400 + x-should-retry:false.
 */
import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { APIError } from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { shouldRetry } from '../../services/api/withRetry.js'
import {
  ORG_POLICY_BLOCKED_MESSAGE,
  assertCriPolicyAllowsRequest,
  buildOrgPolicyBlockedResponse,
  createCriPolicyPrecheck,
  criPolicyPrecheckFetchInput,
  decideCriPolicyWebhookResult,
  isAllowedCriWebhookUrl,
  isTrustedCriPolicyOrigin,
  orgPolicyBlockedToAPIError,
  redactCriForwardedHeaders,
  resolveCriPolicyConfigFromSources,
  resolveCriPolicyWebhook,
  sanitizeOrgPolicyReason,
  sanitizePrincipalSub,
  setCriPolicyConfigForTests,
} from '../criPolicyWebhook.js'

describe('resolveCriPolicyWebhook densable En_ gate', () => {
  test('null when cri disabled or webhook missing', () => {
    expect(resolveCriPolicyWebhook(undefined)).toBeNull()
    expect(
      resolveCriPolicyWebhook({
        enabled: false,
        policy: { webhook: { url: 'https://x' } },
      }),
    ).toBeNull()
    expect(resolveCriPolicyWebhook({ enabled: true, policy: {} })).toBeNull()
  })

  test('returns webhook when cri.enabled', () => {
    expect(
      resolveCriPolicyWebhook({
        enabled: true,
        policy: { webhook: { url: 'https://policy.example/hook' } },
      }),
    ).toEqual({ url: 'https://policy.example/hook' })
  })
})

describe('decideCriPolicyWebhookResult densable En_ precheck', () => {
  test('block:true → 400 policy_blocked + x-should-retry:false', () => {
    const r = decideCriPolicyWebhookResult({
      failClosed: true,
      requestId: 'req-1',
      principalSub: 'user-1',
      httpOk: true,
      decision: { block: true, reason: 'no secrets', rule_id: 'r1' },
    })
    expect(r).toEqual({
      action: 'block',
      response: {
        status: 400,
        type: 'policy_blocked',
        message: 'no secrets',
        request_id: 'req-1',
        headers: { 'x-should-retry': 'false' },
        cause: 'policy_hit',
        rule_id: 'r1',
      },
    })
  })

  test('block:false → allow', () => {
    expect(
      decideCriPolicyWebhookResult({
        failClosed: true,
        requestId: 'req-1',
        principalSub: 'u',
        httpOk: true,
        decision: { block: false },
      }),
    ).toEqual({ action: 'allow' })
  })

  test('missing block + fail-open → skip decision_shape', () => {
    expect(
      decideCriPolicyWebhookResult({
        failClosed: false,
        requestId: 'req-1',
        principalSub: 'u',
        httpOk: true,
        decision: { reason: 'oops' },
      }),
    ).toEqual({ action: 'skip', cause: 'decision_shape' })
  })

  test('webhook error + fail-closed → 400 + no-retry', () => {
    const r = decideCriPolicyWebhookResult({
      failClosed: true,
      requestId: 'req-2',
      principalSub: 'u',
      error: new Error('policy webhook timed out'),
    })
    expect(r.action).toBe('block')
    if (r.action === 'block') {
      expect(r.response.status).toBe(400)
      expect(r.response.headers['x-should-retry']).toBe('false')
      expect(r.response.message).toBe('policy check unavailable')
      expect(r.response.cause).toBe('engine_error')
    }
  })

  test('empty reason falls back to wn_', () => {
    const r = decideCriPolicyWebhookResult({
      failClosed: true,
      requestId: 'req-1',
      principalSub: 'u',
      httpOk: true,
      decision: { block: true, reason: '   ' },
    })
    if (r.action === 'block') {
      expect(r.response.message).toBe(ORG_POLICY_BLOCKED_MESSAGE)
    }
  })
})

describe('vIT / principal sanitize', () => {
  test('caps reason at 500 + ellipsis', () => {
    const long = 'x'.repeat(501)
    const out = sanitizeOrgPolicyReason(long)
    expect(out.endsWith('\u2026')).toBe(true)
    expect(Array.from(out).length).toBe(501)
  })

  test('strips non-printable from sub', () => {
    expect(sanitizePrincipalSub('ab\ncd')).toBe('abcd')
  })
})

describe('Cew respects En_ no-retry even under REMOTE', () => {
  const prev = process.env.CLAUDE_CODE_REMOTE
  test('400 + x-should-retry:false is not retried', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const blocked = buildOrgPolicyBlockedResponse({
      requestId: 'req-1',
      message: ORG_POLICY_BLOCKED_MESSAGE,
      cause: 'policy_hit',
    })
    const err = new APIError(
      400,
      {
        type: 'error',
        error: { type: 'policy_blocked', message: blocked.message },
      },
      blocked.message,
      new Headers(blocked.headers),
    )
    expect(shouldRetry(err)).toBe(false)
  })
  test('remote 403 without header still retries (official JQn)', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    const err = new APIError(
      403,
      { type: 'error', error: { type: 'permission_error', message: 'no' } },
      'no',
      new Headers(),
    )
    expect(shouldRetry(err)).toBe(true)
  })
  afterAll(() => {
    if (prev === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prev
  })
})

describe('createCriPolicyPrecheck densable En_ factory', () => {
  afterEach(() => {
    setCriPolicyConfigForTests(undefined)
  })

  test('null when cri webhook is unset', () => {
    expect(createCriPolicyPrecheck(undefined)).toBeNull()
    expect(createCriPolicyPrecheck({ enabled: true, policy: {} })).toBeNull()
  })

  test('POST + block:true throws APIError that Cew will not retry', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = []
    const precheck = createCriPolicyPrecheck(
      {
        enabled: true,
        policy: { webhook: { url: 'https://policy.example/hook' } },
      },
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(
          JSON.stringify({
            block: true,
            reason: 'no secrets',
            rule_id: 'r1',
          }),
          { status: 200 },
        )
      }) as unknown as typeof fetch,
    )
    expect(precheck).not.toBeNull()
    try {
      await precheck!.precheck(
        { sub: 'user-1' },
        { model: 'claude' },
        'req-1',
        { path: '/v1/messages' },
      )
      throw new Error('expected policy_blocked')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      if (error instanceof APIError) {
        expect(error.status).toBe(400)
        const body = error.error as {
          error?: { type?: string; message?: string }
        }
        expect(body.error?.type).toBe('policy_blocked')
        expect(body.error?.message).toBe('no secrets')
        expect(shouldRetry(error)).toBe(false)
      }
    }
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://policy.example/hook')
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('x-request-id')).toBe('req-1')
    expect(headers.get('x-principal-sub')).toBe('user-1')
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      path: '/v1/messages',
      body: { model: 'claude' },
    })
  })

  test('timeout copy is official policy webhook timed out', async () => {
    const precheck = createCriPolicyPrecheck(
      {
        enabled: true,
        policy: {
          webhook: {
            url: 'https://policy.example/hook',
            timeout_ms: 1,
            fail_closed: true,
          },
        },
      },
      (async () => {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }) as unknown as typeof fetch,
    )
    try {
      await precheck!.precheck({ sub: 'u' }, undefined, 'req-t', {
        path: '/v1/messages',
      })
      throw new Error('expected fail-closed block')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      if (error instanceof APIError) {
        const body = error.error as { error?: { message?: string } }
        expect(body.error?.message).toBe('policy check unavailable')
        expect(shouldRetry(error)).toBe(false)
      }
    }
  })

  test('assert no-ops when config is forced off', async () => {
    setCriPolicyConfigForTests(null)
    let fetched = false
    await assertCriPolicyAllowsRequest({
      fetchImpl: (async () => {
        fetched = true
        return new Response(JSON.stringify({ block: false }), { status: 200 })
      }) as unknown as typeof fetch,
    })
    expect(fetched).toBe(false)
  })

  test('orgPolicyBlockedToAPIError keeps x-should-retry:false', () => {
    const err = orgPolicyBlockedToAPIError(
      buildOrgPolicyBlockedResponse({
        requestId: 'req-1',
        message: ORG_POLICY_BLOCKED_MESSAGE,
        cause: 'policy_hit',
      }),
    )
    expect(err.headers?.get('x-should-retry')).toBe('false')
    expect(shouldRetry(err)).toBe(false)
  })

  test('buildFetch calls En_ before gzip with real request meta', () => {
    const client = readFileSync(
      join(import.meta.dir, '../../services/api/client.ts'),
      'utf8',
    )
    const retry = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    expect(client).toContain('criPolicyPrecheckFetchInput')
    expect(client.indexOf('criPolicyPrecheckFetchInput')).toBeLessThan(
      client.indexOf('applyGzipRequestBodyInit(url, nextInit)'),
    )
    expect(retry).not.toContain('assertCriPolicyAllowsRequest')
  })

  test('criPolicyPrecheckFetchInput skips body parse when En_ is null', async () => {
    setCriPolicyConfigForTests(null)
    let fetched = false
    await criPolicyPrecheckFetchInput(
      'https://api.anthropic.com/v1/messages',
      { method: 'POST', body: 'not-json{' },
      (async () => {
        fetched = true
        return new Response(JSON.stringify({ block: false }), { status: 200 })
      }) as unknown as typeof fetch,
    )
    expect(fetched).toBe(false)
  })

  test('project/user cri is ignored; only admin policy origin counts', () => {
    const attacker = {
      enabled: true,
      policy: { webhook: { url: 'https://attacker.example/exfil' } },
    }
    expect(
      resolveCriPolicyConfigFromSources({
        policy: { cri: attacker },
        origin: null,
      }),
    ).toBeUndefined()
    expect(
      resolveCriPolicyConfigFromSources({
        policy: { cri: attacker },
        origin: 'hkcu',
      }),
    ).toBeUndefined()
    expect(isTrustedCriPolicyOrigin('file')).toBe(true)
    expect(
      resolveCriPolicyConfigFromSources({
        policy: { cri: attacker },
        origin: 'file',
      }),
    ).toEqual(attacker)
  })

  test('webhook URL must be https public host', () => {
    expect(isAllowedCriWebhookUrl('https://policy.example/hook')).toBe(true)
    expect(isAllowedCriWebhookUrl('https://facebook.com/hook')).toBe(true)
    expect(isAllowedCriWebhookUrl('https://fdm.example.com/hook')).toBe(true)
    expect(isAllowedCriWebhookUrl('http://policy.example/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://localhost/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://127.0.0.1/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://192.168.1.8/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://169.254.169.254/latest')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[fc00::1]/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[fd12:3456::1]/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[fe80::1]/hook')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[::ffff:127.0.0.1]/exfil')).toBe(
      false,
    )
    expect(isAllowedCriWebhookUrl('https://[::ffff:7f00:1]/exfil')).toBe(false)
    expect(
      isAllowedCriWebhookUrl('https://[::ffff:169.254.169.254]/latest'),
    ).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[::ffff:a9fe:a9fe]/latest')).toBe(
      false,
    )
    expect(isAllowedCriWebhookUrl('https://[::ffff:10.0.0.1]/')).toBe(false)
    expect(isAllowedCriWebhookUrl('https://[::ffff:8.8.8.8]/hook')).toBe(true)
  })

  test('forwarded headers drop Authorization / x-api-key / Cookie', () => {
    expect(
      redactCriForwardedHeaders({
        Authorization: 'Bearer secret',
        'x-api-key': 'sk-ant',
        Cookie: 'sid=1',
        'content-type': 'application/json',
      }),
    ).toEqual({ 'content-type': 'application/json' })
  })

  test('private webhook URL does not POST and fail-opens', async () => {
    const calls: unknown[] = []
    const precheck = createCriPolicyPrecheck(
      {
        enabled: true,
        policy: {
          webhook: {
            url: 'https://127.0.0.1/exfil',
            fail_closed: false,
          },
        },
      },
      (async (...args: unknown[]) => {
        calls.push(args)
        return new Response(JSON.stringify({ block: false }), { status: 200 })
      }) as unknown as typeof fetch,
    )
    await precheck!.precheck({ sub: 'u' }, { model: 'claude' }, 'req-1', {
      path: '/v1/messages',
      headers: { Authorization: 'Bearer leak' },
    })
    expect(calls).toEqual([])
  })

  test('criPolicyPrecheckFetchInput posts real path query headers body', async () => {
    setCriPolicyConfigForTests({
      enabled: true,
      policy: { webhook: { url: 'https://policy.example/hook' } },
    })
    const calls: Array<{ url: string; init: RequestInit }> = []
    await criPolicyPrecheckFetchInput(
      'https://api.anthropic.com/v1/messages?beta=foo',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-client-request-id': 'rid-9',
          Authorization: 'Bearer should-not-leak',
        },
        body: JSON.stringify({ model: 'claude' }),
      },
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(url), init: init ?? {} })
        return new Response(JSON.stringify({ block: false }), { status: 200 })
      }) as unknown as typeof fetch,
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('https://policy.example/hook')
    const posted = JSON.parse(String(calls[0]?.init.body)) as {
      path: string
      query: Record<string, string>
      headers?: Record<string, string>
      body: { model: string }
    }
    expect(posted.path).toBe('/v1/messages')
    expect(posted.query).toEqual({ beta: 'foo' })
    expect(posted.body).toEqual({ model: 'claude' })
    expect(posted.headers?.Authorization).toBeUndefined()
    expect(posted.headers?.authorization).toBeUndefined()
    expect(new Headers(calls[0]?.init.headers).get('x-request-id')).toBe(
      'rid-9',
    )
  })

  test('unparseable URL + fail-closed → policy check unavailable', async () => {
    setCriPolicyConfigForTests({
      enabled: true,
      policy: { webhook: { url: 'https://policy.example/hook' } },
    })
    let fetched = false
    try {
      await criPolicyPrecheckFetchInput(
        'not-a-url',
        { method: 'POST' },
        (async () => {
          fetched = true
          return new Response(JSON.stringify({ block: false }), { status: 200 })
        }) as unknown as typeof fetch,
      )
      throw new Error('expected fail-closed block')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      if (error instanceof APIError) {
        const body = error.error as { error?: { message?: string } }
        expect(body.error?.message).toBe('policy check unavailable')
        expect(shouldRetry(error)).toBe(false)
      }
    }
    expect(fetched).toBe(false)
  })

  test('unparseable URL + fail-open → skip', async () => {
    setCriPolicyConfigForTests({
      enabled: true,
      policy: {
        webhook: { url: 'https://policy.example/hook', fail_closed: false },
      },
    })
    await criPolicyPrecheckFetchInput('not-a-url', { method: 'POST' })
  })

  test('Request JSON fail + fail-closed → policy check unavailable', async () => {
    setCriPolicyConfigForTests({
      enabled: true,
      policy: { webhook: { url: 'https://policy.example/hook' } },
    })
    const req = new Request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json{',
    })
    try {
      await criPolicyPrecheckFetchInput(req)
      throw new Error('expected fail-closed block')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      if (error instanceof APIError) {
        const body = error.error as { error?: { message?: string } }
        expect(body.error?.message).toBe('policy check unavailable')
        expect(shouldRetry(error)).toBe(false)
      }
    }
  })

  test('bad JSON body + fail-closed → policy check unavailable', async () => {
    setCriPolicyConfigForTests({
      enabled: true,
      policy: { webhook: { url: 'https://policy.example/hook' } },
    })
    try {
      await criPolicyPrecheckFetchInput(
        'https://api.anthropic.com/v1/messages',
        { method: 'POST', body: 'not-json{' },
      )
      throw new Error('expected fail-closed block')
    } catch (error) {
      expect(error).toBeInstanceOf(APIError)
      if (error instanceof APIError) {
        const body = error.error as { error?: { message?: string } }
        expect(body.error?.message).toBe('policy check unavailable')
        expect(shouldRetry(error)).toBe(false)
      }
    }
  })
})
