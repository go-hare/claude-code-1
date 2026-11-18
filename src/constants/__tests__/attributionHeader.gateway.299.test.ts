import { afterEach, describe, expect, test } from 'bun:test'
import { clearGatewayAuth, setGatewayAuth } from '../../utils/gatewayEnv.js'

if (!(globalThis as { MACRO?: unknown }).MACRO) {
  ;(globalThis as { MACRO: { VERSION: string; BUILD_TIME: string } }).MACRO = {
    VERSION: '0.0.0-test',
    BUILD_TIME: '0',
  }
}

const { getAttributionHeader } = await import('../system.js')

describe('2.1.299 #578 getAttributionHeader gateway & prev/dispatch fields', () => {
  const prevBaseUrl = process.env.ANTHROPIC_BASE_URL
  const prevAuthToken = process.env.ANTHROPIC_AUTH_TOKEN
  const prevHeaderEnv = process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
  const prevSessionKind = process.env.CLAUDE_CODE_SESSION_KIND
  const prevBgDispatch = process.env.CLAUDE_BG_DISPATCH_ENTRYPOINT

  afterEach(() => {
    clearGatewayAuth()
    if (prevBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
    else process.env.ANTHROPIC_BASE_URL = prevBaseUrl
    if (prevAuthToken === undefined) delete process.env.ANTHROPIC_AUTH_TOKEN
    else process.env.ANTHROPIC_AUTH_TOKEN = prevAuthToken
    if (prevHeaderEnv === undefined)
      delete process.env.CLAUDE_CODE_ATTRIBUTION_HEADER
    else process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = prevHeaderEnv
    if (prevSessionKind === undefined)
      delete process.env.CLAUDE_CODE_SESSION_KIND
    else process.env.CLAUDE_CODE_SESSION_KIND = prevSessionKind
    if (prevBgDispatch === undefined)
      delete process.env.CLAUDE_BG_DISPATCH_ENTRYPOINT
    else process.env.CLAUDE_BG_DISPATCH_ENTRYPOINT = prevBgDispatch
  })

  test('emits cc_gateway=1 for pinned gateway session with non-loopback URL', () => {
    setGatewayAuth({
      url: 'https://gateway.example.com',
      jwt: 'header.e30.sig',
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      unpinned: false,
    })
    const header = getAttributionHeader()
    expect(header).toContain('cc_gateway=1;')
  })

  test('emits cc_gateway=env for unpinned gateway session without gateway JWT aud', () => {
    setGatewayAuth({
      url: 'https://gateway.example.com',
      jwt: 'header.e30.sig',
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      unpinned: true,
    })
    const header = getAttributionHeader()
    expect(header).toContain('cc_gateway=env;')
  })

  test('omits cc_gateway for loopback gateway URL', () => {
    setGatewayAuth({
      url: 'http://127.0.0.1:8080',
      jwt: 'header.e30.sig',
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      unpinned: false,
    })
    const header = getAttributionHeader()
    expect(header).not.toContain('cc_gateway=')
  })

  test('CLAUDE_CODE_ATTRIBUTION_HEADER=0 removes entire attribution block even behind gateway', () => {
    setGatewayAuth({
      url: 'https://gateway.example.com',
      jwt: 'header.e30.sig',
      expiresAtMs: Number.MAX_SAFE_INTEGER,
      unpinned: false,
    })
    process.env.CLAUDE_CODE_ATTRIBUTION_HEADER = '0'
    expect(getAttributionHeader()).toBe('')
  })

  test('emits cc_prev_msg, cc_prev_prompt_index, cc_prev_turn_index, and cc_dispatch_entrypoint on first-party', () => {
    delete process.env.ANTHROPIC_BASE_URL
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_DISPATCH_ENTRYPOINT = 'remote_trigger'
    const header = getAttributionHeader({
      responseBeforeCompaction: {
        messageId: 'msg_01AbCdEf',
        turnPosition: { promptIndex: 2, turnIndex: 4 },
      },
    })
    expect(header).toContain('cc_prev_msg=msg_01AbCdEf;')
    expect(header).toContain('cc_prev_prompt_index=2; cc_prev_turn_index=4;')
    expect(header).toContain('cc_dispatch_entrypoint=remote_trigger;')
  })
})
