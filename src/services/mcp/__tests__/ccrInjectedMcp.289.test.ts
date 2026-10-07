import { afterEach, describe, expect, test } from 'bun:test'
import { HEARTHBOT_MCP_SERVER_NAME } from '../../../bridge/hearthbotMcp.js'
import {
  isCcrInjectedConfig,
  isCliOwnedConfig,
  markCliOwnedConfig,
  resetCliOwnedConfigsForTests,
} from '../cliOwnedConfigs.js'
import {
  resetHearthbotBareElicitationPinForTests,
  rewriteRemoteDynamicMcpConfig,
} from '../ccrInjectedMcp.js'
import { resetMcpCcrIngressCapture } from '../mcpConnectTimeout.js'

const prevRemote = process.env.CLAUDE_CODE_REMOTE
const prevIngress = process.env.SESSION_INGRESS_URL

afterEach(() => {
  resetCliOwnedConfigsForTests()
  resetHearthbotBareElicitationPinForTests()
  if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = prevRemote
  if (prevIngress === undefined) delete process.env.SESSION_INGRESS_URL
  else process.env.SESSION_INGRESS_URL = prevIngress
  resetMcpCcrIngressCapture()
})

describe('densable 2.1.289 REMOTE --mcp-config rewrite (mpn/NSn/nf?OEe)', () => {
  test('preserves cliOwned on clone without REMOTE', () => {
    const source = markCliOwnedConfig({
      type: 'http' as const,
      url: 'https://api.example/v2/ccr-sessions/-/meta/mcp',
    })
    const ar = rewriteRemoteDynamicMcpConfig('claude-code-remote', source)
    expect(ar.scope).toBe('dynamic')
    expect(isCliOwnedConfig(ar)).toBe(true)
    expect(isCcrInjectedConfig(ar)).toBe(false)
  })

  test('REMOTE + ENn stamps ccrInjected; hearthbot NSn pins bare', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    process.env.SESSION_INGRESS_URL = 'https://api.example'
    resetMcpCcrIngressCapture()
    const source = {
      type: 'http' as const,
      url: 'https://api.example/v2/ccr-sessions/cse_1/hearthbot/mcp',
    }
    const ar = rewriteRemoteDynamicMcpConfig(HEARTHBOT_MCP_SERVER_NAME, source)
    expect(ar.scope).toBe('dynamic')
    expect(isCcrInjectedConfig(ar)).toBe(true)
    expect(ar.bareElicitationCapability).toBe(true)
    expect(isCliOwnedConfig(ar)).toBe(false)
  })
})
