import { afterEach, describe, expect, mock, test } from 'bun:test'

const proxyStub = () => ({
  disableKeepAlive: () => {},
  getAddressFamily: () => 0,
  getProxyUrl: () => undefined,
  getNoProxy: () => undefined,
  shouldBypassProxy: () => false,
  createAxiosInstance: () => ({}),
  getProxyAgent: () => undefined,
  getWebSocketProxyAgent: () => undefined,
  getWebSocketProxyUrl: () => undefined,
  shouldDisableFetchTimeoutForBodyIdle: () => false,
  getProxyFetchOptions: () => ({}),
  getFetchOptions: () => ({}),
  configureGlobalAgents: () => {},
  AWS_SDK_REQUEST_TIMEOUT_MS: 30_000,
  getAwsSdkProxyRequestHandler: async () => undefined,
  getAWSClientProxyConfig: async () => ({}),
  clearProxyCache: () => {},
})
mock.module('src/utils/proxy.js', proxyStub)
mock.module('../proxy.js', proxyStub)

const {
  BACKGROUND_EXIT_FAILSAFE_MIN_MS,
  OAUTH_REFRESH_WAIT_MS,
  acquireOAuthRefreshHold,
  drainBackgroundShutdownWork,
  getHeldOAuthRefreshPromise,
  getHeldOAuthRefreshTimeoutMs,
  hasPendingBackgroundShutdownWork,
  resetShutdownState,
  trackBackgroundShutdownWork,
  waitForHeldOAuthRefresh,
  waitForOAuthRefreshRelease,
} = await import('../gracefulShutdown.js')

describe('gracefulShutdown 2.1.300 & 2.1.301 alignment (#765, #860)', () => {
  afterEach(() => {
    resetShutdownState()
  })

  test('#765 tracks and drains background shutdown work', async () => {
    expect(BACKGROUND_EXIT_FAILSAFE_MIN_MS).toBe(15000)
    expect(hasPendingBackgroundShutdownWork()).toBe(false)

    let resolveWork!: () => void
    const work = new Promise<void>(resolve => {
      resolveWork = resolve
    })
    trackBackgroundShutdownWork(work)
    expect(hasPendingBackgroundShutdownWork()).toBe(true)

    let drained = false
    const drainPromise = drainBackgroundShutdownWork().then(() => {
      drained = true
    })
    await Promise.resolve()
    expect(drained).toBe(false)

    resolveWork()
    await drainPromise
    expect(drained).toBe(true)
    expect(hasPendingBackgroundShutdownWork()).toBe(false)
  })

  test('#860 acquireOAuthRefreshHold / waitForHeldOAuthRefresh waits until lock releases', async () => {
    expect(getHeldOAuthRefreshPromise()).toBeNull()
    expect(await waitForHeldOAuthRefresh(0)).toBe(true)

    const release = acquireOAuthRefreshHold()
    expect(getHeldOAuthRefreshPromise()).not.toBeNull()
    expect(getHeldOAuthRefreshTimeoutMs()).toBeGreaterThanOrEqual(
      OAUTH_REFRESH_WAIT_MS,
    )

    // Releasing resolves waitForOAuthRefreshRelease with true
    setTimeout(release, 10)
    expect(await waitForOAuthRefreshRelease(500)).toBe(true)
    expect(getHeldOAuthRefreshPromise()).toBeNull()
  })
})
