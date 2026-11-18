import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  filterMcpToolsByNameLength,
  MAX_MCP_TOOL_NAME_LENGTH,
  resetReportedLongToolNamesForTest,
} from '../clientHelpers.js'
import {
  clearRememberedLegacyStdio,
  isRememberedLegacyStdio,
  recordRememberedLegacyStdio,
  resetStdioDiscoverVerdictCacheForTest,
  resolveMcpProtocolNegotiationPlan,
  STDIO_DISCOVER_VERDICT_TTL_MS,
} from '../mcpConnectTimeout.js'

describe('v2.1.292 MCP alignment (#208, #263, #264, #458)', () => {
  beforeEach(() => {
    resetReportedLongToolNamesForTest()
    resetStdioDiscoverVerdictCacheForTest()
  })

  afterEach(() => {
    resetReportedLongToolNamesForTest()
    resetStdioDiscoverVerdictCacheForTest()
  })

  test('#208 filterMcpToolsByNameLength omits tools > 128 chars', () => {
    const okName = 'a'.repeat(MAX_MCP_TOOL_NAME_LENGTH)
    const tooLongName = 'b'.repeat(MAX_MCP_TOOL_NAME_LENGTH + 1)
    const kept = filterMcpToolsByNameLength(
      [
        { name: okName, mcpInfo: { serverName: 'srv' } },
        { name: tooLongName, mcpInfo: { serverName: 'srv' } },
      ],
      'srv',
    )
    expect(kept.map(t => t.name)).toEqual([okName])
  })

  test('#263 7-day stdio remembered-legacy cache', () => {
    const cfg = { type: 'stdio', command: 'npx', args: ['some-mcp'] }
    const t0 = 1_700_000_000_000
    expect(isRememberedLegacyStdio(cfg, {}, t0)).toBe(false)

    recordRememberedLegacyStdio(cfg, t0)
    expect(isRememberedLegacyStdio(cfg, {}, t0 + 1000)).toBe(true)
    expect(
      isRememberedLegacyStdio(cfg, {}, t0 + STDIO_DISCOVER_VERDICT_TTL_MS - 1),
    ).toBe(true)
    // Overridden when MCP_PROTOCOL_NEGOTIATION=auto
    expect(
      isRememberedLegacyStdio(
        cfg,
        { MCP_PROTOCOL_NEGOTIATION: 'auto' },
        t0 + 1000,
      ),
    ).toBe(false)
    // Expires after 7 days (604_800_000 ms)
    expect(
      isRememberedLegacyStdio(cfg, {}, t0 + STDIO_DISCOVER_VERDICT_TTL_MS + 1),
    ).toBe(false)

    recordRememberedLegacyStdio(cfg, t0)
    clearRememberedLegacyStdio(cfg)
    expect(isRememberedLegacyStdio(cfg, {}, t0 + 1000)).toBe(false)
  })

  test('#264 & #458 stdio and claudeai-proxy default to auto (2026-07-28), legacy opts out', () => {
    expect(resolveMcpProtocolNegotiationPlan('stdio', {}).mode).toBe('auto')
    expect(resolveMcpProtocolNegotiationPlan('claudeai-proxy', {}).mode).toBe(
      'auto',
    )
    expect(resolveMcpProtocolNegotiationPlan('http', {}).mode).toBe('auto')
    expect(resolveMcpProtocolNegotiationPlan('ccr-proxy', {}).mode).toBe('auto')

    expect(
      resolveMcpProtocolNegotiationPlan('stdio', {
        MCP_PROTOCOL_NEGOTIATION: 'legacy',
      }).mode,
    ).toBe('legacy')
    expect(
      resolveMcpProtocolNegotiationPlan('claudeai-proxy', {
        MCP_PROTOCOL_NEGOTIATION: 'legacy',
      }).mode,
    ).toBe('legacy')
  })
})
