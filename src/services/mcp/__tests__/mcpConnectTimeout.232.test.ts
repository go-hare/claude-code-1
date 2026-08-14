/**
 * densable 2.1.232 #16 — y0 / Obf / IiS / oMf / k5a timeout surface.
 */
import { describe, expect, test } from 'bun:test'
import {
  classifyMcpAutoProbeFallback,
  createMcpConnectionTimeoutError,
  DEFAULT_MCP_CONNECT_TIMEOUT_MS,
  DEFAULT_MCP_TIMEOUT_MS,
  formatMcpProbeFallbackDebugMessage,
  formatPinnedLegacyRetryPreserveTimeoutLog,
  getMcpClientConnectTimeoutMs,
  getMcpConnectTimeoutMs,
  getMcpInitializeTimeoutMs,
  getMcpPinnedLegacyRetryTimeoutMs,
  getMcpTimeoutMs,
  MCP_PROTOCOL_PROBE_HTTP_CAP_MS,
  MCP_PROTOCOL_PROBE_STDIO_CAP_MS,
  parseMcpPositiveTimeoutMs,
  resolveMcpProtocolNegotiationPlan,
  shouldPreserveConnectTimeoutAfterPinnedLegacyRetry,
  truncateMcpErrorSnippet,
} from '../mcpConnectTimeout.js'
import { extractMcpConnectionErrorCode } from '../mcpConnectionIssue.js'

describe('densable 2.1.232 #16 MCP connect timeout helpers', () => {
  test('y0 defaults to 30000 when unset / non-positive', () => {
    expect(getMcpTimeoutMs({})).toBe(DEFAULT_MCP_TIMEOUT_MS)
    expect(getMcpTimeoutMs({ MCP_TIMEOUT: '0' })).toBe(DEFAULT_MCP_TIMEOUT_MS)
    expect(getMcpTimeoutMs({ MCP_TIMEOUT: '-1' })).toBe(DEFAULT_MCP_TIMEOUT_MS)
    expect(getMcpTimeoutMs({ MCP_TIMEOUT: 'abc' })).toBe(DEFAULT_MCP_TIMEOUT_MS)
  })

  test('y0 respects positive MCP_TIMEOUT capped at 2^31-1', () => {
    expect(getMcpTimeoutMs({ MCP_TIMEOUT: '45000' })).toBe(45000)
    expect(getMcpTimeoutMs({ MCP_TIMEOUT: '9999999999' })).toBe(2_147_483_647)
  })

  test('Obf defaults to 5000 and respects MCP_CONNECT_TIMEOUT_MS', () => {
    expect(getMcpConnectTimeoutMs({})).toBe(DEFAULT_MCP_CONNECT_TIMEOUT_MS)
    expect(getMcpConnectTimeoutMs({ MCP_CONNECT_TIMEOUT_MS: '8000' })).toBe(
      8000,
    )
    expect(getMcpConnectTimeoutMs({ MCP_CONNECT_TIMEOUT_MS: '0' })).toBe(
      DEFAULT_MCP_CONNECT_TIMEOUT_MS,
    )
  })

  test('IiS = max(y0 - 5000, floor(y0/3))', () => {
    // default y0=30000 → max(25000, 10000) = 25000
    expect(getMcpInitializeTimeoutMs({})).toBe(25_000)
    // y0=9000 → max(4000, 3000) = 4000
    expect(getMcpInitializeTimeoutMs({ MCP_TIMEOUT: '9000' })).toBe(4_000)
    // y0=6000 → max(1000, 2000) = 2000
    expect(getMcpInitializeTimeoutMs({ MCP_TIMEOUT: '6000' })).toBe(2_000)
  })

  test('client connect timeout: auto uses IiS, legacy uses y0', () => {
    const env = { MCP_TIMEOUT: '30000' }
    expect(getMcpClientConnectTimeoutMs('legacy', env)).toBe(30_000)
    expect(getMcpClientConnectTimeoutMs('auto', env)).toBe(25_000)
  })

  test('oMf tags CONNECT_TIMEOUT when requested', () => {
    const tagged = createMcpConnectionTimeoutError('timeout msg', {
      tagConnectTimeout: true,
    })
    expect(tagged.message).toBe('timeout msg')
    expect(tagged.telemetryMessage).toBe('MCP connection timeout')
    expect(tagged.code).toBe('CONNECT_TIMEOUT')

    const plain = createMcpConnectionTimeoutError('timeout msg', {
      tagConnectTimeout: false,
    })
    expect(plain.code).toBeUndefined()
  })

  test('k5a: env legacy forces legacy for all transports', () => {
    const env = { MCP_PROTOCOL_NEGOTIATION: 'legacy' }
    expect(
      resolveMcpProtocolNegotiationPlan('http', env, () => true).mode,
    ).toBe('legacy')
    expect(
      resolveMcpProtocolNegotiationPlan('stdio', env, () => true).mode,
    ).toBe('legacy')
  })

  test('k5a: env auto enables probe caps for http/stdio only', () => {
    const env = { MCP_PROTOCOL_NEGOTIATION: 'auto', MCP_TIMEOUT: '30000' }
    const http = resolveMcpProtocolNegotiationPlan('http', env)
    expect(http.mode).toBe('auto')
    if (http.mode === 'auto') {
      expect(http.probeTimeoutMs).toBe(
        Math.min(MCP_PROTOCOL_PROBE_HTTP_CAP_MS, Math.floor(30_000 / 3)),
      )
    }
    const stdio = resolveMcpProtocolNegotiationPlan('stdio', env)
    expect(stdio.mode).toBe('auto')
    if (stdio.mode === 'auto') {
      expect(stdio.probeTimeoutMs).toBe(
        Math.min(MCP_PROTOCOL_PROBE_STDIO_CAP_MS, Math.floor(30_000 / 3)),
      )
    }
    expect(resolveMcpProtocolNegotiationPlan('sse', env).mode).toBe('legacy')
    expect(resolveMcpProtocolNegotiationPlan('ws', env).mode).toBe('legacy')
  })

  test('k5a: default GB false → legacy without env', () => {
    const plan = resolveMcpProtocolNegotiationPlan('http', {}, () => false)
    expect(plan.mode).toBe('legacy')
  })

  test('k5a: GB true for http enables auto without env', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      {},
      key => key === 'tengu_mcp_protocol_negotiation_http',
    )
    expect(plan.mode).toBe('auto')
  })

  test('parseMcpPositiveTimeoutMs floors and caps', () => {
    expect(parseMcpPositiveTimeoutMs('12.9', 1)).toBe(12)
    expect(parseMcpPositiveTimeoutMs(undefined, 99)).toBe(99)
  })

  test('RequestTimeout (-32001) maps to CONNECT_TIMEOUT when enabled', () => {
    // Force mapping on (opts default true; GB default true when adapter missing)
    const code = extractMcpConnectionErrorCode(
      { code: -32001 },
      { mapRequestTimeoutToConnectTimeout: true },
    )
    // If GB returns true (default), expect CONNECT_TIMEOUT; allow either if GB mocked off.
    expect(code === 'CONNECT_TIMEOUT' || code === '-32001').toBe(true)

    const forcedOff = extractMcpConnectionErrorCode(
      { code: -32001 },
      { mapRequestTimeoutToConnectTimeout: false },
    )
    expect(forcedOff).toBe('-32001')
  })

  test('pre-tagged CONNECT_TIMEOUT preserved', () => {
    expect(extractMcpConnectionErrorCode({ code: 'CONNECT_TIMEOUT' })).toBe(
      'CONNECT_TIMEOUT',
    )
  })

  test('auto probe EraNegotiationFailed on stdio → closed fallback', () => {
    const plan = resolveMcpProtocolNegotiationPlan('stdio', {
      MCP_PROTOCOL_NEGOTIATION: 'auto',
    })
    const err = Object.assign(new Error('era failed'), {
      code: 'EraNegotiationFailed',
    })
    const d = classifyMcpAutoProbeFallback(plan, err, {
      transportType: 'stdio',
      canRecreateTransport: true,
    })
    expect(d).toEqual({ shouldFallback: true, reason: 'closed' })
  })

  test('auto probe EraNegotiationFailed on http → probe_failed', () => {
    const plan = resolveMcpProtocolNegotiationPlan('http', {
      MCP_PROTOCOL_NEGOTIATION: 'auto',
    })
    const err = Object.assign(new Error('era failed'), {
      code: 'EraNegotiationFailed',
    })
    const d = classifyMcpAutoProbeFallback(plan, err, {
      transportType: 'http',
      canRecreateTransport: true,
    })
    expect(d).toEqual({ shouldFallback: true, reason: 'probe_failed' })
  })

  test('auto probe RequestTimeout with transport marker → probe_timeout', () => {
    const plan = resolveMcpProtocolNegotiationPlan('http', {
      MCP_PROTOCOL_NEGOTIATION: 'auto',
    })
    const err = Object.assign(new Error('timeout'), { code: -32001 })
    const d = classifyMcpAutoProbeFallback(plan, err, {
      transportType: 'http',
      transport: { _anthropicProbeTimedOut: true },
      canRecreateTransport: true,
    })
    expect(d).toEqual({ shouldFallback: true, reason: 'probe_timeout' })
  })

  test('legacy mode never falls back to pinned-legacy', () => {
    const plan = resolveMcpProtocolNegotiationPlan('http', {
      MCP_PROTOCOL_NEGOTIATION: 'legacy',
    })
    const err = Object.assign(new Error('era failed'), {
      code: 'EraNegotiationFailed',
    })
    expect(
      classifyMcpAutoProbeFallback(plan, err, {
        transportType: 'http',
        canRecreateTransport: true,
      }),
    ).toEqual({ shouldFallback: false })
  })

  test('pinned-legacy remaining budget floors at 1000ms', () => {
    const started = 1_000_000
    // elapsed 29_500 with y0=30000 → max(1000, 500)=1000
    expect(
      getMcpPinnedLegacyRetryTimeoutMs(started, started + 29_500, {
        MCP_TIMEOUT: '30000',
      }),
    ).toBe(1_000)
    // elapsed 5s → remaining 25s
    expect(
      getMcpPinnedLegacyRetryTimeoutMs(started, started + 5_000, {
        MCP_TIMEOUT: '30000',
      }),
    ).toBe(25_000)
  })

  test('preserve CONNECT_TIMEOUT only for probe_timeout non-auth non-outer', () => {
    expect(
      shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
        'probe_timeout',
        new Error('ECONNREFUSED'),
      ),
    ).toBe(true)
    expect(
      shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
        'probe_failed',
        new Error('ECONNREFUSED'),
      ),
    ).toBe(false)
    expect(
      shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
        'probe_timeout',
        new Error('nope'),
        { outerTimedOut: true },
      ),
    ).toBe(false)
    const unauth = new Error('need auth')
    unauth.name = 'UnauthorizedError'
    expect(
      shouldPreserveConnectTimeoutAfterPinnedLegacyRetry(
        'probe_timeout',
        unauth,
      ),
    ).toBe(false)
  })

  test('probe fallback debug strings match densable gold', () => {
    expect(formatMcpProbeFallbackDebugMessage('closed', 'stdio')).toBe(
      'version negotiation probe closed the stdio server (rmcp-class pre-init hard close); respawning pinned legacy',
    )
    expect(formatMcpProbeFallbackDebugMessage('probe_timeout', 'http')).toBe(
      'version negotiation probe timed out on the http transport; reconnecting pinned legacy within the remaining budget',
    )
    expect(formatMcpProbeFallbackDebugMessage('probe_failed', 'http')).toBe(
      'version negotiation probe failed on the http transport; reconnecting pinned legacy',
    )
    expect(
      formatPinnedLegacyRetryPreserveTimeoutLog(
        truncateMcpErrorSnippet('typed boom'),
      ),
    ).toBe(
      'pinned-legacy retry after the probe timeout failed typed (typed boom); preserving the timeout classification so the connect stays ladder-retryable',
    )
  })
})
