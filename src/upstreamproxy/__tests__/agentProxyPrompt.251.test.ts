/**
 * densable 2.1.251 #48 — agent-proxy An/xe + recentRelayFailures status.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildAgentProxyEnvNote,
  buildAgentProxyReadme,
  getAgentProxyNote,
  resetAgentProxyNoteForTests,
  setAgentProxyNote,
} from '../agentProxyPrompt.js'
import {
  buildAgentProxyStatusBody,
  clearRecentRelayFailuresForTests,
  getRecentRelayFailures,
} from '../relay.js'

describe('densable 2.1.251 #48 agent-proxy diagnosis', () => {
  test('An README names bare reset + recentRelayFailures', () => {
    const md = buildAgentProxyReadme(12345, '/tmp/ca.crt')
    expect(md).toContain('# Claude Code agent proxy')
    expect(md).toContain('http://127.0.0.1:12345')
    expect(md).toContain('/__agentproxy/status')
    expect(md).toContain('reaches the tool as a bare reset')
    expect(md).toContain('recentRelayFailures')
    expect(md).toContain('names the host and reason')
    expect(md).toContain('/tmp/ca.crt')
  })

  test('xe env note points at status and bare-reset classes', () => {
    const note = buildAgentProxyEnvNote('/tmp/ca.crt', '/tmp/README.md')
    expect(note).toContain(
      'Outbound HTTPS goes through a pre-configured agent proxy',
    )
    expect(note).toContain('/tmp/ca.crt')
    expect(note).toContain('see /tmp/README.md and ')
    expect(note).toContain('curl -sS "$HTTPS_PROXY/__agentproxy/status"')
    expect(note).toContain('connection reset')
    expect(note).toContain('unexpected disconnect')
    expect(note).toContain('RPC failed')
  })

  test('setNote/getNote bag (Ept/yBt)', () => {
    resetAgentProxyNoteForTests()
    expect(getAgentProxyNote()).toBeUndefined()
    setAgentProxyNote(
      'Outbound HTTPS goes through a pre-configured agent proxy',
    )
    expect(getAgentProxyNote()).toContain('agent proxy')
    resetAgentProxyNoteForTests()
  })

  test('status body includes recentRelayFailures array', () => {
    clearRecentRelayFailuresForTests()
    const body = JSON.parse(buildAgentProxyStatusBody()) as {
      recentRelayFailures: unknown[]
    }
    expect(Array.isArray(body.recentRelayFailures)).toBe(true)
    expect(getRecentRelayFailures()).toEqual([])
  })

  test('cleanupConn latches closed before ws.close so client hangup is not connection reset', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    const { join } = require('node:path') as typeof import('node:path')
    const src = readFileSync(join(import.meta.dir, '../relay.ts'), 'utf8')
    const cleanup = src.indexOf('function cleanupConn')
    const closed = src.indexOf('st.closed = true', cleanup)
    const wsClose = src.indexOf('st.ws.close()', cleanup)
    expect(cleanup).toBeGreaterThan(-1)
    expect(closed).toBeGreaterThan(cleanup)
    expect(wsClose).toBeGreaterThan(closed)
    expect(src).toContain('Client hangup hits sock close')
  })
})
