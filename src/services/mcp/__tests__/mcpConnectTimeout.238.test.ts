/**
 * densable 2.1.238 #16 — Pwi: stdio always legacy (no GB);
 * ocv env-auto set includes stdio/ccr-proxy; ccr-proxy has its own GB;
 * invalid env warns then falls through; LGa denylist is GB-path only.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  isMcpCcrProxyServerConfig,
  isMcpCcrProxyUrl,
  isMcpNegotiationServerDenylisted,
  matchMcpServerDenylist,
  resetMcpCcrIngressCapture,
  resolveMcpNegotiationTransportKind,
  resolveMcpProtocolNegotiationPlan,
} from '../mcpConnectTimeout.js'

describe('densable 2.1.238 #16 Pwi stdio-always-legacy + ccr-proxy GB', () => {
  test('GB true for stdio still returns legacy (no tengu_mcp_protocol_negotiation_stdio)', () => {
    const plan = resolveMcpProtocolNegotiationPlan('stdio', {}, () => true)
    expect(plan.mode).toBe('legacy')
  })

  test('GB true for ccr-proxy enables auto without env', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'ccr-proxy',
      {},
      key => key === 'tengu_mcp_protocol_negotiation_ccr',
    )
    expect(plan.mode).toBe('auto')
  })

  test('GB false for ccr-proxy stays legacy', () => {
    const plan = resolveMcpProtocolNegotiationPlan('ccr-proxy', {}, () => false)
    expect(plan.mode).toBe('legacy')
  })

  test('env auto still enables stdio (ocv includes stdio)', () => {
    const plan = resolveMcpProtocolNegotiationPlan('stdio', {
      MCP_PROTOCOL_NEGOTIATION: 'auto',
    })
    expect(plan.mode).toBe('auto')
  })

  test('env auto enables ccr-proxy (ocv) and leaves sse legacy', () => {
    const env = { MCP_PROTOCOL_NEGOTIATION: 'auto' }
    expect(resolveMcpProtocolNegotiationPlan('ccr-proxy', env).mode).toBe(
      'auto',
    )
    expect(resolveMcpProtocolNegotiationPlan('sse', env).mode).toBe('legacy')
    expect(resolveMcpProtocolNegotiationPlan('ide', env).mode).toBe('legacy')
  })
})

describe('densable 2.1.238 #16 Pwi invalid env + LGa denylist', () => {
  test('invalid env warns then falls through to GB (http auto)', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      { MCP_PROTOCOL_NEGOTIATION: 'bogus' },
      key => key === 'tengu_mcp_protocol_negotiation_http',
    )
    expect(plan.mode).toBe('auto')
  })

  test('invalid env + GB false stays legacy', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      { MCP_PROTOCOL_NEGOTIATION: 'bogus' },
      () => false,
    )
    expect(plan.mode).toBe('legacy')
  })

  test('GB auto + denylist * forces legacy', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      {},
      () => true,
      { url: 'https://mcp.example.com' },
      true,
    )
    expect(plan.mode).toBe('legacy')
  })

  test('GB auto + denylist false stays auto', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      {},
      () => true,
      { url: 'https://mcp.example.com' },
      false,
    )
    expect(plan.mode).toBe('auto')
  })

  test('env auto does not apply denylist even if precomputed true', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      { MCP_PROTOCOL_NEGOTIATION: 'auto' },
      () => true,
      { url: 'https://mcp.example.com' },
      true,
    )
    expect(plan.mode).toBe('auto')
  })

  test('undefined serverConfig skips denylist even if precomputed true', () => {
    const plan = resolveMcpProtocolNegotiationPlan(
      'http',
      {},
      () => true,
      undefined,
      true,
    )
    expect(plan.mode).toBe('auto')
  })

  test('xwi hostname exact / subdomain / * / empty', () => {
    const server = { url: 'https://mcp.example.com/v1' }
    expect(matchMcpServerDenylist([], server)).toBe(false)
    expect(matchMcpServerDenylist(['*'], {})).toBe(true)
    expect(matchMcpServerDenylist(['example.com'], server)).toBe(true)
    expect(matchMcpServerDenylist(['mcp.example.com'], server)).toBe(true)
    expect(matchMcpServerDenylist(['other.com'], server)).toBe(false)
    expect(matchMcpServerDenylist([''], server)).toBe(false)
    expect(matchMcpServerDenylist(['example.com'], { url: 'not-a-url' })).toBe(
      false,
    )
    expect(matchMcpServerDenylist(['example.com'], {})).toBe(false)
  })

  test('LGa undefined server is not denylisted', () => {
    expect(isMcpNegotiationServerDenylisted(undefined, () => ['*'])).toBe(false)
  })
})

describe('densable 2.1.238 #16 n_f + Cke/pMn', () => {
  const origIngress = process.env.SESSION_INGRESS_URL
  const origAnthropic = process.env.ANTHROPIC_BASE_URL

  afterEach(() => {
    if (origIngress === undefined) delete process.env.SESSION_INGRESS_URL
    else process.env.SESSION_INGRESS_URL = origIngress
    if (origAnthropic === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = origAnthropic
    resetMcpCcrIngressCapture()
  })

  test('n_f maps http+ccrProxy to ccr-proxy, else http', () => {
    expect(resolveMcpNegotiationTransportKind('http', { ccrProxy: true })).toBe(
      'ccr-proxy',
    )
    expect(
      resolveMcpNegotiationTransportKind('http', { ccrProxy: false }),
    ).toBe('http')
    expect(resolveMcpNegotiationTransportKind('http')).toBe('http')
  })

  test('n_f inProcess wins; sdk → sdk-control; ide; stdio/undefined → stdio', () => {
    expect(
      resolveMcpNegotiationTransportKind('http', {
        inProcess: true,
        ccrProxy: true,
      }),
    ).toBe('in-process')
    expect(resolveMcpNegotiationTransportKind('sdk')).toBe('sdk-control')
    expect(resolveMcpNegotiationTransportKind('sse-ide')).toBe('ide')
    expect(resolveMcpNegotiationTransportKind('ws-ide')).toBe('ide')
    expect(resolveMcpNegotiationTransportKind('stdio')).toBe('stdio')
    expect(resolveMcpNegotiationTransportKind(undefined)).toBe('stdio')
    expect(resolveMcpNegotiationTransportKind('claudeai-proxy')).toBe(
      'claudeai-proxy',
    )
  })

  test('Cke: same-origin Gia path is CCR; origin mismatch is not', () => {
    resetMcpCcrIngressCapture({
      SESSION_INGRESS_URL: 'https://ingress.example',
    })
    expect(
      isMcpCcrProxyUrl(
        'https://ingress.example/v2/session_ingress/shttp/mcp/foo',
      ),
    ).toBe(true)
    expect(
      isMcpCcrProxyUrl('https://ingress.example/v2/ccr-sessions/abc'),
    ).toBe(true)
    expect(isMcpCcrProxyUrl('https://ingress.example/v1/code/sessions/x')).toBe(
      true,
    )
    expect(
      isMcpCcrProxyUrl(
        'https://other.example/v2/session_ingress/shttp/mcp/foo',
      ),
    ).toBe(false)
    expect(isMcpCcrProxyUrl('https://ingress.example/other')).toBe(false)
  })

  test('Cke: wss origin compares as https', () => {
    resetMcpCcrIngressCapture({
      SESSION_INGRESS_URL: 'https://ingress.example',
    })
    expect(
      isMcpCcrProxyUrl('wss://ingress.example/v2/session_ingress/mcp/ws/chan'),
    ).toBe(true)
  })

  test('pMn: url Cke true; url-less false (no cliOwnedConfigs invent)', () => {
    resetMcpCcrIngressCapture({
      SESSION_INGRESS_URL: 'https://ingress.example',
    })
    expect(
      isMcpCcrProxyServerConfig({
        url: 'https://ingress.example/v2/session_ingress/shttp/mcp/x',
      }),
    ).toBe(true)
    expect(isMcpCcrProxyServerConfig({ command: 'npx' })).toBe(false)
    expect(isMcpCcrProxyServerConfig(undefined)).toBe(false)
  })

  test('http CCR url + GB ccr flag enables auto via n_f kind', () => {
    resetMcpCcrIngressCapture({
      SESSION_INGRESS_URL: 'https://ingress.example',
    })
    const server = {
      type: 'http',
      url: 'https://ingress.example/v2/session_ingress/shttp/mcp/x',
    }
    const kind = resolveMcpNegotiationTransportKind(server.type, {
      ccrProxy: isMcpCcrProxyServerConfig(server),
    })
    expect(kind).toBe('ccr-proxy')
    const plan = resolveMcpProtocolNegotiationPlan(
      kind,
      {},
      key => key === 'tengu_mcp_protocol_negotiation_ccr',
      server,
    )
    expect(plan.mode).toBe('auto')
  })
})
