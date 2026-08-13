/**
 * densable 2.1.229 #10 — Hzo ignoreEnvOptOut for auto-mode classifier.
 */
import { afterEach, describe, expect, test } from 'bun:test'

// MACRO.VERSION is only injected in dev/build; unit tests need a stub.
if (!(globalThis as { MACRO?: unknown }).MACRO) {
  ;(globalThis as { MACRO: { VERSION: string; BUILD_TIME: string } }).MACRO = {
    VERSION: '0.0.0-test',
    BUILD_TIME: '0',
  }
}

const { getAttributionHeader } = await import('../system.js')

const saved: Record<string, string | undefined> = {}

function setEnv(k: string, v: string | undefined): void {
  if (!(k in saved)) saved[k] = process.env[k]
  if (v === undefined) delete process.env[k]
  else process.env[k] = v
}

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
    delete saved[k]
  }
})

describe('densable 2.1.229 Hzo getAttributionHeader ignoreEnvOptOut', () => {
  test('env opt-out returns empty without ignoreEnvOptOut', () => {
    setEnv('CLAUDE_CODE_ATTRIBUTION_HEADER', '0')
    setEnv('ANTHROPIC_BASE_URL', undefined)
    setEnv('ANTHROPIC_UNIX_SOCKET', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_OPENAI', undefined)
    expect(getAttributionHeader()).toBe('')
  })

  test('ignoreEnvOptOut forces header on firstParty direct', () => {
    setEnv('CLAUDE_CODE_ATTRIBUTION_HEADER', '0')
    setEnv('ANTHROPIC_BASE_URL', undefined)
    setEnv('ANTHROPIC_UNIX_SOCKET', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_OPENAI', undefined)
    const header = getAttributionHeader({ ignoreEnvOptOut: true })
    expect(header).toContain('x-anthropic-billing-header:')
    expect(header).toContain('cc_version=')
    expect(header).toContain('cc_entrypoint=')
  })

  test('ignoreEnvOptOut still empty under ANTHROPIC_UNIX_SOCKET', () => {
    setEnv('CLAUDE_CODE_ATTRIBUTION_HEADER', '0')
    setEnv('ANTHROPIC_UNIX_SOCKET', '/tmp/auth.sock')
    setEnv('ANTHROPIC_BASE_URL', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_OPENAI', undefined)
    expect(getAttributionHeader({ ignoreEnvOptOut: true })).toBe('')
  })

  test('ignoreEnvOptOut still empty on non-firstParty base URL', () => {
    setEnv('CLAUDE_CODE_ATTRIBUTION_HEADER', '0')
    setEnv('ANTHROPIC_BASE_URL', 'https://gateway.example.com')
    setEnv('ANTHROPIC_UNIX_SOCKET', undefined)
    setEnv('CLAUDE_CODE_USE_BEDROCK', undefined)
    setEnv('CLAUDE_CODE_USE_VERTEX', undefined)
    setEnv('CLAUDE_CODE_USE_OPENAI', undefined)
    expect(getAttributionHeader({ ignoreEnvOptOut: true })).toBe('')
  })
})
