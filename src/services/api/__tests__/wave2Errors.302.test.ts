import { afterEach, describe, expect, test } from 'bun:test'
import {
  extractSafeServiceErrorDetail,
  extractServiceErrorMessage,
  getAssistantMessageFromError,
  getBgGatewayWithheldMessage,
  getBgGatewayWithheldShortMessage,
  isBgGatewayWithheld,
  isBgGatewayWithheldMessage,
  isPlainSingleLineDetail,
} from '../errors.js'

const origKind = process.env.CLAUDE_CODE_SESSION_KIND
const origWithheld = process.env.CLAUDE_BG_GATEWAY_WITHHELD
const origBaseUrl = process.env.ANTHROPIC_BASE_URL
const origJobDir = process.env.CLAUDE_JOB_DIR

afterEach(() => {
  if (origKind === undefined) delete process.env.CLAUDE_CODE_SESSION_KIND
  else process.env.CLAUDE_CODE_SESSION_KIND = origKind
  if (origWithheld === undefined) delete process.env.CLAUDE_BG_GATEWAY_WITHHELD
  else process.env.CLAUDE_BG_GATEWAY_WITHHELD = origWithheld
  if (origBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL
  else process.env.ANTHROPIC_BASE_URL = origBaseUrl
  if (origJobDir === undefined) delete process.env.CLAUDE_JOB_DIR
  else process.env.CLAUDE_JOB_DIR = origJobDir
})

describe('#922 CLAUDE_BG_GATEWAY_WITHHELD diagnostics', () => {
  test('isBgGatewayWithheld is true only for bg sessions with withheld dir and no ANTHROPIC_BASE_URL', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_GATEWAY_WITHHELD = '/tmp/other-project'
    delete process.env.ANTHROPIC_BASE_URL
    expect(isBgGatewayWithheld()).toBe(true)

    process.env.ANTHROPIC_BASE_URL = 'https://gateway.example.com'
    expect(isBgGatewayWithheld()).toBe(false)

    delete process.env.ANTHROPIC_BASE_URL
    process.env.CLAUDE_CODE_SESSION_KIND = 'interactive'
    expect(isBgGatewayWithheld()).toBe(false)
  })

  test('getBgGatewayWithheldMessage and short message include folder and respawn id', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_GATEWAY_WITHHELD = '/tmp/my-repo'
    process.env.CLAUDE_JOB_DIR = '/home/user/.claude/jobs/abc_123'
    delete process.env.ANTHROPIC_BASE_URL

    const full = getBgGatewayWithheldMessage()
    expect(full).toContain('No LLM gateway:')
    expect(full).toContain('`claude respawn abc_123`')
    expect(full).toContain('/tmp/my-repo')
    expect(isBgGatewayWithheldMessage(full)).toBe(true)

    const short = getBgGatewayWithheldShortMessage()
    expect(short).toBe(
      'No LLM gateway: opened from another folder · respawn from /tmp/my-repo',
    )
  })

  test('formatAPIErrorMessage returns invalid_request with No LLM gateway on x-api-key error when withheld', async () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    process.env.CLAUDE_BG_GATEWAY_WITHHELD = '/tmp/my-repo'
    delete process.env.ANTHROPIC_BASE_URL

    const msg = getAssistantMessageFromError(
      new Error('Missing x-api-key header'),
      'claude-sonnet-4-6',
    )
    expect(msg.error).toBe('invalid_request')
    expect(msg.message.content?.[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('No LLM gateway:'),
    })
  })
})

describe('#1100 service error detail extraction', () => {
  test('extractServiceErrorMessage reads top-level message or nested error.message', () => {
    expect(extractServiceErrorMessage({ message: 'Forbidden by policy' })).toBe(
      'Forbidden by policy',
    )
    expect(
      extractServiceErrorMessage({ error: { message: 'Domain blocked' } }),
    ).toBe('Domain blocked')
    expect(
      extractServiceErrorMessage({ error: { message: 123 } }),
    ).toBeUndefined()
  })

  test('isPlainSingleLineDetail rejects newlines, ANSI escapes, and >1024 chars', () => {
    expect(isPlainSingleLineDetail('Plain reason: 403 denied', 1024)).toBe(true)
    expect(isPlainSingleLineDetail('line1\nline2', 1024)).toBe(false)
    expect(isPlainSingleLineDetail('\x1b[31mred\x1b[0m', 1024)).toBe(false)
    expect(isPlainSingleLineDetail('a'.repeat(1025), 1024)).toBe(false)
  })

  test('extractSafeServiceErrorDetail returns plain detail and drops unsafe detail', () => {
    expect(
      extractSafeServiceErrorDetail({ error: { message: 'Egress denied' } }),
    ).toBe('Egress denied')
    expect(
      extractSafeServiceErrorDetail({ error: { message: 'bad\nmultiline' } }),
    ).toBeUndefined()
  })
})
