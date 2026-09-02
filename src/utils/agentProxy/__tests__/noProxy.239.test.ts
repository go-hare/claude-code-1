/**
 * densable 2.1.239 #56 Ohu / c0T — non-API anthropic.com hosts tunnel.
 */
import { describe, expect, test } from 'bun:test'
import {
  NO_PROXY_COMMON,
  NO_PROXY_EMBEDDED,
  isAnthropicHost,
  isNoProxyCommonHost,
  shouldTunnelNonApiAnthropicHost,
} from '../noProxy.js'

describe('isAnthropicHost densable c0T', () => {
  test('apex and suffix', () => {
    expect(isAnthropicHost('anthropic.com')).toBe(true)
    expect(isAnthropicHost('www.anthropic.com')).toBe(true)
    expect(isAnthropicHost('docs.anthropic.com')).toBe(true)
    expect(isAnthropicHost('api.anthropic.com')).toBe(true)
  })

  test('trailing-dot + case', () => {
    expect(isAnthropicHost('WWW.ANTHROPIC.COM.')).toBe(true)
  })

  test('not a suffix spoof', () => {
    expect(isAnthropicHost('anthropic.com.evil.com')).toBe(false)
    expect(isAnthropicHost('notanthropic.com')).toBe(false)
  })
})

describe('Ohu / #56 tunnel', () => {
  test('API hosts stay on Ohu', () => {
    expect(isNoProxyCommonHost('api.anthropic.com')).toBe(true)
    expect(isNoProxyCommonHost('api-staging.anthropic.com')).toBe(true)
    expect(isNoProxyCommonHost('mcp-proxy.anthropic.com')).toBe(true)
    expect(shouldTunnelNonApiAnthropicHost('api.anthropic.com')).toBe(false)
  })

  test('www / docs / apex are NOT in Ohu — tunnel', () => {
    expect(NO_PROXY_COMMON).not.toContain('www.anthropic.com')
    expect(NO_PROXY_COMMON).not.toContain('docs.anthropic.com')
    expect(NO_PROXY_COMMON).not.toContain('anthropic.com')
    expect(NO_PROXY_COMMON).not.toContain('*.anthropic.com')
    expect(shouldTunnelNonApiAnthropicHost('www.anthropic.com')).toBe(true)
    expect(shouldTunnelNonApiAnthropicHost('docs.anthropic.com')).toBe(true)
    expect(shouldTunnelNonApiAnthropicHost('anthropic.com')).toBe(true)
  })

  test('embedded list does not re-add wildcard anthropic', () => {
    expect(NO_PROXY_EMBEDDED).not.toContain('*.anthropic.com')
    expect(NO_PROXY_EMBEDDED).toContain('api.anthropic.com')
  })
})
