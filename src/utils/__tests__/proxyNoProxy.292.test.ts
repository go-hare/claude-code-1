import { afterEach, describe, expect, test } from 'bun:test'
import { getProxyFetchOptions } from '../proxy.js'

const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
  'NO_PROXY',
  'no_proxy',
] as const

const SAVED_ENV: Record<string, string | undefined> = Object.fromEntries(
  PROXY_ENV_KEYS.map(k => [k, process.env[k]]),
)

afterEach(() => {
  for (const key of PROXY_ENV_KEYS) {
    if (SAVED_ENV[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = SAVED_ENV[key]
    }
  }
})

describe('v2.1.292 #207 NO_PROXY in getProxyFetchOptions', () => {
  test('omits proxy when opts.url matches NO_PROXY', () => {
    process.env.HTTPS_PROXY = 'http://proxy.internal:8080'
    process.env.NO_PROXY = 'api.anthropic.com,.internal.local'

    const bypassed = getProxyFetchOptions({
      forAnthropicAPI: true,
      url: 'https://api.anthropic.com/v1/messages',
    })
    expect(bypassed.proxy).toBeUndefined()
    expect(bypassed.dispatcher).toBeUndefined()

    const proxied = getProxyFetchOptions({
      forAnthropicAPI: true,
      url: 'https://other.example.com/v1/messages',
    })
    expect(proxied.proxy ?? proxied.dispatcher).toBeDefined()
  })

  test('supports fallbackProxy and respects fallbackProxy.noProxy', () => {
    for (const key of PROXY_ENV_KEYS) {
      delete process.env[key]
    }

    const bypassed = getProxyFetchOptions({
      url: 'https://gateway.internal.local/v1/messages',
      fallbackProxy: {
        url: 'http://fallback-proxy:3128',
        noProxy: '.internal.local',
      },
    })
    expect(bypassed.proxy).toBeUndefined()

    const used = getProxyFetchOptions({
      url: 'https://api.anthropic.com/v1/messages',
      fallbackProxy: {
        url: 'http://fallback-proxy:3128',
        noProxy: '.internal.local',
      },
    })
    expect(used.proxy).toBe('http://fallback-proxy:3128')
  })
})
