import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildHttpsProxyAgentAuthHeaders,
  buildProxyAuthHelperChildEnv,
  buildProxyOptionWithAuth,
  buildUndiciProxyAgentAuthOptions,
  classifyProxyAuthHelperFailure,
  clearProxyAuthHelperState,
  formatProxyAuthHelperFailure,
  getCachedProxyAuthHelperValue,
  parseProxyAuthHelperStdout,
  PROXY_AUTH_HELPER_FAILED_PREFIX,
  runProxyAuthHelper,
  setProxyAuthHelperConfig,
} from '../proxyAuthHelper.js'
import {
  DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
  resolveProxyAuthHelperCommand,
  resolveProxyAuthHelperTtlMs,
  shouldReuseProxyAuthHelperCache,
  shouldSkipProxyAuthHelperForTrust,
} from '../residualFinalEnvGates.js'

afterEach(() => {
  clearProxyAuthHelperState()
})

describe('proxyAuthHelper gates', () => {
  test('command requires env enable', () => {
    expect(
      resolveProxyAuthHelperCommand({
        env: {},
        helperCommand: 'echo Bearer x',
      }),
    ).toBeUndefined()
    expect(
      resolveProxyAuthHelperCommand({
        env: { CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER: '1' },
        helperCommand: 'echo Bearer x',
      }),
    ).toBe('echo Bearer x')
  })
  test('ttl default and override', () => {
    expect(resolveProxyAuthHelperTtlMs({})).toBe(
      DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
    )
    expect(
      resolveProxyAuthHelperTtlMs({
        CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS: '0',
      }),
    ).toBe(0)
    expect(
      resolveProxyAuthHelperTtlMs({
        CLAUDE_CODE_PROXY_AUTH_HELPER_TTL_MS: '12000',
      }),
    ).toBe(12000)
  })
  test('trust skip', () => {
    expect(
      shouldSkipProxyAuthHelperForTrust({
        fromProjectOrLocal: true,
        trustAccepted: false,
      }),
    ).toBe(true)
    expect(
      shouldSkipProxyAuthHelperForTrust({
        fromProjectOrLocal: true,
        isNonInteractive: true,
        trustAccepted: false,
      }),
    ).toBe(false)
  })
  test('cache reuse', () => {
    expect(
      shouldReuseProxyAuthHelperCache({
        cachedAtMs: 1000,
        nowMs: 1000 + DEFAULT_PROXY_AUTH_HELPER_TTL_MS - 1,
        ttlMs: DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
      }),
    ).toBe(true)
    expect(
      shouldReuseProxyAuthHelperCache({
        cachedAtMs: 1000,
        nowMs: 1000 + DEFAULT_PROXY_AUTH_HELPER_TTL_MS + 1,
        ttlMs: DEFAULT_PROXY_AUTH_HELPER_TTL_MS,
      }),
    ).toBe(false)
  })
})

describe('proxyAuthHelper helpers', () => {
  test('parse stdout', () => {
    expect(parseProxyAuthHelperStdout('  Bearer tok  ')).toBe('Bearer tok')
    expect(parseProxyAuthHelperStdout('')).toBeNull()
  })
  test('child env injects proxy vars', () => {
    const env = buildProxyAuthHelperChildEnv({
      baseEnv: { PATH: '/bin' },
      proxyUrl: 'http://proxy',
      proxyHost: 'proxy',
      proxyAuthenticate: 'Basic x',
    })
    expect(env.CLAUDE_CODE_PROXY_URL).toBe('http://proxy')
    expect(env.CLAUDE_CODE_PROXY_HOST).toBe('proxy')
    expect(env.CLAUDE_CODE_PROXY_AUTHENTICATE).toBe('Basic x')
  })
  test('failure prefix', () => {
    expect(formatProxyAuthHelperFailure('timed out')).toBe(
      `${PROXY_AUTH_HELPER_FAILED_PREFIX}timed out`,
    )
  })
  test('classify failure reasons', () => {
    expect(classifyProxyAuthHelperFailure({ timedOut: true })).toBe('timed out')
    expect(classifyProxyAuthHelperFailure({ failed: true, exitCode: 2 })).toBe(
      'exited 2',
    )
    expect(classifyProxyAuthHelperFailure({ hasStdout: false })).toBe(
      'did not return a value',
    )
  })
  test('buildProxyOptionWithAuth', () => {
    expect(
      buildProxyOptionWithAuth({
        proxyUrl: 'http://p',
        proxyAuthorization: null,
      }),
    ).toBe('http://p')
    expect(
      buildProxyOptionWithAuth({
        proxyUrl: 'http://p',
        proxyAuthorization: 'Basic x',
      }),
    ).toEqual({
      url: 'http://p',
      headers: { 'Proxy-Authorization': 'Basic x' },
    })
  })

  test('buildUndiciProxyAgentAuthOptions densable', () => {
    expect(
      buildUndiciProxyAgentAuthOptions({
        proxyUrl: 'http://p',
        proxyAuthorization: null,
      }),
    ).toBeNull()
    expect(
      buildUndiciProxyAgentAuthOptions({
        proxyUrl: 'http://p',
        proxyAuthorization: '  ',
      }),
    ).toBeNull()
    expect(
      buildUndiciProxyAgentAuthOptions({
        proxyUrl: 'http://p',
        proxyAuthorization: 'Basic x',
        requestTls: { ca: 'ca' },
      }),
    ).toEqual({
      uri: 'http://p',
      token: 'Basic x',
      requestTls: { ca: 'ca' },
    })
  })

  test('buildHttpsProxyAgentAuthHeaders densable', () => {
    expect(buildHttpsProxyAgentAuthHeaders(null)).toBeUndefined()
    expect(buildHttpsProxyAgentAuthHeaders('Basic y')).toEqual({
      'Proxy-Authorization': 'Basic y',
    })
  })
})

describe('proxyAuthHelper fkn runtime', () => {
  test('null when no helper configured', async () => {
    expect(await runProxyAuthHelper()).toBeNull()
  })

  test('skips when project/local trust not accepted', async () => {
    setProxyAuthHelperConfig({
      helper: 'echo Bearer skip',
      fromProjectOrLocal: true,
      trustAccepted: () => false,
    })
    // Need env enable for resolveProxyAuthHelperCommand
    const prev = process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
    process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = '1'
    try {
      // Force interactive so trust gate applies (tests often run non-interactive).
      expect(await runProxyAuthHelper({ isNonInteractive: false })).toBeNull()
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
      else process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = prev
    }
  })

  test('runs shell helper and caches', async () => {
    const prev = process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
    process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = '1'
    setProxyAuthHelperConfig({
      helper: 'printf "Bearer tok123"',
      fromProjectOrLocal: false,
      trustAccepted: () => true,
    })
    try {
      const v = await runProxyAuthHelper({
        proxyUrl: 'http://proxy.local:8080',
      })
      expect(v).toBe('Bearer tok123')
      expect(getCachedProxyAuthHelperValue()).toBe('Bearer tok123')
      // second call hits cache (same process)
      const v2 = await runProxyAuthHelper({
        proxyUrl: 'http://proxy.local:8080',
      })
      expect(v2).toBe('Bearer tok123')
    } finally {
      if (prev === undefined)
        delete process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER
      else process.env.CLAUDE_CODE_ENABLE_PROXY_AUTH_HELPER = prev
    }
  })
})
