/**
 * densable 2.1.222 #4 — proxy-aware startup connectivity preflight (Coh).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildPreflightProbeUrls,
  formatPreflightConnectError,
  formatPreflightStatusError,
  formatPreflightTimeoutError,
  getPreflightFetchOptions,
  PREFLIGHT_CONNECTIVITY_TIMEOUT_MS,
} from '../preflightChecks.js'

describe('buildPreflightProbeUrls (densable Coh)', () => {
  test('api hello + oauth hello from TOKEN_URL origin', () => {
    const urls = buildPreflightProbeUrls({
      BASE_API_URL: 'https://api.anthropic.com',
      TOKEN_URL: 'https://platform.claude.com/v1/oauth/token',
    })
    expect(urls).toEqual([
      'https://api.anthropic.com/api/hello',
      'https://platform.claude.com/v1/oauth/hello',
    ])
  })

  test('custom gateway base still builds both probes', () => {
    const urls = buildPreflightProbeUrls({
      BASE_API_URL: 'https://gateway.example.com',
      TOKEN_URL: 'https://gateway.example.com/v1/oauth/token',
    })
    expect(urls[0]).toBe('https://gateway.example.com/api/hello')
    expect(urls[1]).toBe('https://gateway.example.com/v1/oauth/hello')
  })
})

describe('preflight error formatters', () => {
  test('timeout message densable Toh/1000 seconds', () => {
    expect(formatPreflightTimeoutError('api.anthropic.com')).toBe(
      'Connection to api.anthropic.com timed out after 10 seconds',
    )
    expect(PREFLIGHT_CONNECTIVITY_TIMEOUT_MS).toBe(10_000)
  })

  test('status + connect errors', () => {
    expect(formatPreflightStatusError('x.com', 503)).toBe(
      'Failed to connect to x.com: Status 503',
    )
    const err = new Error('ECONNREFUSED') as Error & { code?: string }
    err.code = 'ECONNREFUSED'
    expect(formatPreflightConnectError('x.com', err)).toBe(
      'Failed to connect to x.com: ECONNREFUSED',
    )
  })
})

describe('getPreflightFetchOptions proxy awareness', () => {
  const saved: Record<string, string | undefined> = {}

  afterEach(() => {
    for (const k of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'NO_PROXY',
      'no_proxy',
      'CLAUDE_CODE_HOST_HTTP_PROXY_PORT',
    ]) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
      delete saved[k]
    }
  })

  function snap(k: string) {
    saved[k] = process.env[k]
  }

  test('no proxy → usedProxy false', () => {
    for (const k of [
      'HTTPS_PROXY',
      'https_proxy',
      'HTTP_PROXY',
      'http_proxy',
      'CLAUDE_CODE_HOST_HTTP_PROXY_PORT',
    ]) {
      snap(k)
      delete process.env[k]
    }
    const o = getPreflightFetchOptions('https://api.anthropic.com/api/hello')
    expect(o.usedProxy).toBe(false)
  })

  test('HTTPS_PROXY set → usedProxy true (unless NO_PROXY)', () => {
    snap('HTTPS_PROXY')
    snap('NO_PROXY')
    snap('no_proxy')
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8888'
    delete process.env.NO_PROXY
    delete process.env.no_proxy
    const o = getPreflightFetchOptions('https://api.anthropic.com/api/hello')
    expect(o.usedProxy).toBe(true)
  })

  test('NO_PROXY matching host → usedProxy false', () => {
    snap('HTTPS_PROXY')
    snap('NO_PROXY')
    process.env.HTTPS_PROXY = 'http://127.0.0.1:8888'
    process.env.NO_PROXY = 'api.anthropic.com'
    const o = getPreflightFetchOptions('https://api.anthropic.com/api/hello')
    expect(o.usedProxy).toBe(false)
  })
})

describe('source wiring densable Coh', () => {
  test('preflightChecks no longer stubs success', async () => {
    const src = await Bun.file(
      new URL('../preflightChecks.tsx', import.meta.url),
    ).text()
    expect(src).not.toContain('Skip connectivity check')
    expect(src).toContain('AbortSignal.timeout')
    expect(src).toContain('getProxyFetchOptions')
    expect(src).toContain('getSSLErrorHint')
    expect(src).toContain('/api/hello')
    expect(src).toContain('/v1/oauth/hello')
    expect(src).toContain('Checking connectivity...')
  })
})
