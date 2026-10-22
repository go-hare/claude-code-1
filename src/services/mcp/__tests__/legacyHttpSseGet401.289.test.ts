import { describe, expect, test } from 'bun:test'
import {
  LEGACY_HTTP_SSE_GET_401_MESSAGE,
  shouldApplyLegacyHttpSseGet401Guard,
  wrapLegacyHttpSseGet401Guard,
} from '../mcpConnectTimeout.js'

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
