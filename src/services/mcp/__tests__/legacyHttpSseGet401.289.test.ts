import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import {
  SdkErrorCode,
  SdkHttpError,
  SseError,
  UnauthorizedError,
} from '@modelcontextprotocol/client'
import {
  LEGACY_HTTP_SSE_GET_401_MESSAGE,
  createLegacyHttpSseFallbackFetches,
  getLegacySseErrorStatus,
  isLegacySseAuthChallenge,
  isLegacySseFallbackEligible,
  mergeLegacySseDialSignal,
  shouldApplyLegacyHttpSseGet401Guard,
  wrapLegacyHttpSseGet401Guard,
} from '../mcpConnectTimeout.js'

function sdkHttp(status: number, body = 'initialize failed'): SdkHttpError {
  return new SdkHttpError(
    SdkErrorCode.ClientHttpNotImplemented,
    `Error POSTing to endpoint: ${body}`,
    { status, statusText: 'Error' },
  )
}

describe('densable 2.1.289 legacy HTTP+SSE GET 401', () => {
  test('unique English matches gold ce factory', () => {
    expect(LEGACY_HTTP_SSE_GET_401_MESSAGE).toBe(
      'legacy HTTP+SSE stream GET answered 401 after the initialize POST was not a 405; not starting OAuth against this URL',
    )
  })

  test('gold !HEe && !o$ && !Ae — skip CCR / first-party / cli-owned', () => {
    expect(
      shouldApplyLegacyHttpSseGet401Guard({
        isCcrProxy: false,
        isFirstPartyAnthropicMcp: false,
        isCliOwnedBearer: false,
      }),
    ).toBe(true)
    expect(
      shouldApplyLegacyHttpSseGet401Guard({
        isCcrProxy: true,
        isFirstPartyAnthropicMcp: false,
        isCliOwnedBearer: false,
      }),
    ).toBe(false)
    expect(
      shouldApplyLegacyHttpSseGet401Guard({
        isCcrProxy: false,
        isFirstPartyAnthropicMcp: true,
        isCliOwnedBearer: false,
      }),
    ).toBe(false)
    expect(
      shouldApplyLegacyHttpSseGet401Guard({
        isCcrProxy: false,
        isFirstPartyAnthropicMcp: false,
        isCliOwnedBearer: true,
      }),
    ).toBe(false)
  })

  test('first GET 401 before 405 throws and cancels body', async () => {
    let cancelled = false
    const fetchImpl = async () =>
      new Response(null, {
        status: 401,
        statusText: 'Unauthorized',
      })
    const orig = fetchImpl
    const wrapped = wrapLegacyHttpSseGet401Guard(async (url, init) => {
      const res = await orig()
      Object.defineProperty(res, 'body', {
        value: {
          cancel: async () => {
            cancelled = true
          },
        },
      })
      return res
    }, true)
    await expect(
      wrapped('https://example.com/mcp', { method: 'GET' }),
    ).rejects.toThrow(LEGACY_HTTP_SSE_GET_401_MESSAGE)
    expect(cancelled).toBe(true)
  })

  test('GET 401 after initialize POST 405 does not throw', async () => {
    const wrapped = wrapLegacyHttpSseGet401Guard(async (_url, init) => {
      const method = (init?.method ?? 'GET').toUpperCase()
      return new Response(null, { status: method === 'POST' ? 405 : 401 })
    }, true)
    await wrapped('https://example.com/mcp', { method: 'POST' })
    const res = await wrapped('https://example.com/mcp', { method: 'GET' })
    expect(res.status).toBe(401)
  })

  test('disabled wrap is identity', async () => {
    const inner = async () => new Response(null, { status: 401 })
    expect(wrapLegacyHttpSseGet401Guard(inner, false)).toBe(inner)
  })

  test('gold Ct=Gt.ok: GET 403 does not arm; later GET 401 still throws', async () => {
    let n = 0
    const wrapped = wrapLegacyHttpSseGet401Guard(async () => {
      n++
      return new Response(null, { status: n === 1 ? 403 : 401 })
    }, true)
    const first = await wrapped('https://example.com/mcp', { method: 'GET' })
    expect(first.status).toBe(403)
    await expect(
      wrapped('https://example.com/mcp', { method: 'GET' }),
    ).rejects.toThrow(LEGACY_HTTP_SSE_GET_401_MESSAGE)
  })

  test('gold Ct=Gt.ok: GET 200 arms; later GET 401 does not throw', async () => {
    let n = 0
    const wrapped = wrapLegacyHttpSseGet401Guard(async () => {
      n++
      return new Response(null, { status: n === 1 ? 200 : 401 })
    }, true)
    expect(
      (await wrapped('https://example.com/mcp', { method: 'GET' })).status,
    ).toBe(200)
    expect(
      (await wrapped('https://example.com/mcp', { method: 'GET' })).status,
    ).toBe(401)
  })
})

describe('densable W dialSignal HTTP→SSE fallback helpers', () => {
  test('_n: SdkHttpError 4xx except 401/403/429 is eligible; plain Error is not', () => {
    expect(
      isLegacySseFallbackEligible(sdkHttp(405, 'Method Not Allowed')),
    ).toBe(true)
    expect(isLegacySseFallbackEligible(sdkHttp(404, 'not found'))).toBe(true)
    expect(isLegacySseFallbackEligible(sdkHttp(401, 'auth'))).toBe(false)
    expect(isLegacySseFallbackEligible(sdkHttp(403, 'forbid'))).toBe(false)
    expect(isLegacySseFallbackEligible(sdkHttp(429, 'slow'))).toBe(false)
    expect(isLegacySseFallbackEligible(sdkHttp(500, 'boom'))).toBe(false)
    const analog = Object.assign(new Error('Error POSTing to endpoint: x'), {
      code: 405,
    })
    expect(isLegacySseFallbackEligible(analog)).toBe(false)
    expect(isLegacySseFallbackEligible(new Error('no code'))).toBe(false)
  })

  test('_n: JSON-RPC data: payload is not eligible; HTML is', () => {
    const rpc = sdkHttp(
      405,
      'data: {"jsonrpc":"2.0","id":1,"error":{"code":-32600,"message":"x"}}',
    )
    expect(isLegacySseFallbackEligible(rpc)).toBe(false)
    const rpcNullId = sdkHttp(
      400,
      'data: {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"x"}}',
    )
    expect(isLegacySseFallbackEligible(rpcNullId)).toBe(false)
    expect(isLegacySseFallbackEligible(sdkHttp(405, '<html>nope</html>'))).toBe(
      true,
    )
  })

  test('Bo: UnauthorizedError / SseError 401 vs timeout', () => {
    expect(
      isLegacySseAuthChallenge(new UnauthorizedError(), undefined, false),
    ).toBe(true)
    const sse401 = new SseError(
      401,
      'Unauthorized',
      new Event('error') as ErrorEvent,
    )
    expect(getLegacySseErrorStatus(sse401)).toBe(401)
    expect(isLegacySseAuthChallenge(sse401, sse401.code, false)).toBe(true)
    expect(
      isLegacySseAuthChallenge(new Error('timeout'), undefined, false),
    ).toBe(false)
  })

  test('Te merges dialSignal until connected', () => {
    const dial = new AbortController()
    const merged = mergeLegacySseDialSignal({}, dial.signal, () => false)
    expect(merged?.signal).toBe(dial.signal)
    const skipped = mergeLegacySseDialSignal(
      { method: 'GET' },
      dial.signal,
      () => true,
    )
    expect(skipped?.signal).toBeUndefined()
    expect(skipped?.method).toBe('GET')
  })

  test('ce token POST skips dialSignal; EventSource GET uses it', async () => {
    const dial = new AbortController()
    const seen: Array<AbortSignal | null | undefined> = []
    const base = async (_url: string | URL, init?: RequestInit) => {
      seen.push(init?.signal)
      return new Response(null, { status: 200 })
    }
    const { fetch, eventSourceFetch } = createLegacyHttpSseFallbackFetches({
      baseFetch: base,
      postMethodNotAllowed: true,
      dialSignal: dial.signal,
      dialConnected: () => false,
    })
    await fetch('https://example.com/token', {
      method: 'POST',
      body: new URLSearchParams({ grant_type: 'refresh_token' }),
    })
    expect(seen.at(-1)).toBeUndefined()
    await eventSourceFetch('https://example.com/sse', { method: 'GET' })
    expect(seen.at(-1)).toBe(dial.signal)
  })

  test('client.ts wires W factory and initialize POST reject rescue', () => {
    const clientDir = join(import.meta.dir, '../client')
    const src = [
      readFileSync(join(import.meta.dir, '../client.ts'), 'utf8'),
      ...readdirSync(clientDir)
        .filter(f => f.endsWith('.ts'))
        .sort()
        .map(f => readFileSync(join(clientDir, f), 'utf8')),
    ].join('\n')
    expect(src).toContain('createLegacyHttpSseFallbackFetches')
    expect(src).toContain('tengu_mcp_legacy_sse_fallback')
    expect(src).toContain('trying legacy HTTP+SSE')
    expect(src).toContain('dial.abort()')
    expect(src).toContain('connected over legacy HTTP+SSE')
    expect(src).toContain(
      'legacy HTTP+SSE stream GET answered with an auth challenge; its auth flow outran the fallback budget, so routing to needs-auth',
    )
    expect(src).toContain(
      'requires authorization: its legacy HTTP+SSE stream answered with an auth challenge and the authorization flow did not finish within the connect budget',
    )
    expect(src).toContain(
      'legacy HTTP+SSE not confirmed (${snippet}); surfacing the POST failure',
    )
  })
})
