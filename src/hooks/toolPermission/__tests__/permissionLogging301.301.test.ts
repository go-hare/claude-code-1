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
mock.module('../../../utils/proxy.js', proxyStub)

const { buildAutoClassifierOTelAttributes } = await import(
  '../permissionLogging.js'
)

describe('permissionLogging 2.1.301 alignment (#847, #848)', () => {
  const origOtelDetails = process.env.OTEL_LOG_TOOL_DETAILS

  afterEach(() => {
    if (origOtelDetails === undefined) {
      delete process.env.OTEL_LOG_TOOL_DETAILS
    } else {
      process.env.OTEL_LOG_TOOL_DETAILS = origOtelDetails
    }
  })

  test('#847 returns classifier_verdict allow on accept only when classifierAllowed is true', () => {
    expect(
      buildAutoClassifierOTelAttributes('accept', {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'safe',
        classifierAllowed: true,
      }),
    ).toEqual({ classifier_verdict: 'allow' })

    expect(
      buildAutoClassifierOTelAttributes('accept', {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'safe',
      }),
    ).toBeUndefined()

    expect(
      buildAutoClassifierOTelAttributes('accept', {
        type: 'rule',
        rule: { toolName: 'Bash' } as any,
      }),
    ).toBeUndefined()
  })

  test('#847 returns no_verdict when noVerdict is true, else block', () => {
    expect(
      buildAutoClassifierOTelAttributes('reject', {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'safeguard',
        noVerdict: true,
        category: 'exfiltration',
      }),
    ).toEqual({ classifier_verdict: 'no_verdict' })
  })

  test('#848 includes classifier_category on block only when OTEL_LOG_TOOL_DETAILS=1', () => {
    delete process.env.OTEL_LOG_TOOL_DETAILS
    expect(
      buildAutoClassifierOTelAttributes('reject', {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'blocked',
        category: 'destructive',
      }),
    ).toEqual({ classifier_verdict: 'block' })

    process.env.OTEL_LOG_TOOL_DETAILS = '1'
    expect(
      buildAutoClassifierOTelAttributes('reject', {
        type: 'classifier',
        classifier: 'auto-mode',
        reason: 'blocked',
        category: 'destructive',
      }),
    ).toEqual({
      classifier_verdict: 'block',
      classifier_category: 'destructive',
    })
  })
})
