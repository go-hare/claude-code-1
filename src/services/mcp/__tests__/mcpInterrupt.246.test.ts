/**
 * densable 2.1.246 #10 — MCP abort is Q6 + throw, not empty content.
 *
 * Official WZe: AbortError → `{content:Q6,interrupted:!0,isError:!0}`
 * Official MCP call: `if(Ae.interrupted)throw new Rn(Q6)`
 * Q6 @212352459
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AbortError } from '../../../utils/errors.js'
import {
  MCP_TOOL_CALL_INTERRUPTED,
  throwIfMcpToolCallInterrupted,
} from '../client.js'

const clientSrc = readFileSync(join(import.meta.dir, '../client.ts'), 'utf8')

describe('densable 2.1.246 #10 MCP interrupt is not empty output', () => {
  test('Q6 interrupt sentence is the official string', () => {
    expect(MCP_TOOL_CALL_INTERRUPTED).toBe(
      'The tool call was interrupted before a result was received. It may or may not have completed on the server — verify before assuming it succeeded, and retry if needed.',
    )
  })

  test('AbortError catch returns Q6 + interrupted + isError (not undefined content)', () => {
    expect(clientSrc).toContain('content: MCP_TOOL_CALL_INTERRUPTED')
    expect(clientSrc).toContain('interrupted: true')
    expect(clientSrc).toContain('isError: true')
    expect(clientSrc).not.toContain('return { content: undefined }')
    expect(clientSrc).toContain('throwIfMcpToolCallInterrupted(mcpResult)')
  })

  test('auto-bg waiter treats resolved interrupt as failure, not completed', () => {
    const autoBg = readFileSync(
      join(import.meta.dir, '../../../utils/mcpAutoBackground.ts'),
      'utf8',
    )
    expect(autoBg).toContain('result.interrupted === true')
    expect(autoBg).toContain('result.isError === true')
    expect(autoBg).toContain('finishBackgroundFailure')
    expect(autoBg).toContain('MCP task ${taskId} was interrupted')
    expect(autoBg).toContain('if (interrupted || result.isError === true)')
  })

  test('WZe expired arm uses hr.ConnectionClosed before the abort Q6 arm', () => {
    const expiredArm = clientSrc.slice(
      clientSrc.indexOf('Official WZe expired arm'),
      clientSrc.indexOf('densable 2.1.246 #10 WZe'),
    )
    expect(expiredArm).toContain('isMcpConnectionClosedError(e)')
    expect(expiredArm).toContain("config.type === 'http'")
    expect(expiredArm).toContain("config.type === 'claudeai-proxy'")
  })

  test('WZe also maps signal.aborted + instanceof SdkError (hr) to Q6', () => {
    const abortArm = clientSrc.slice(
      clientSrc.indexOf('densable 2.1.246 #10 WZe'),
      clientSrc.indexOf('content: MCP_TOOL_CALL_INTERRUPTED'),
    )
    expect(abortArm).toContain('signal.aborted === true')
    expect(abortArm).toContain('e instanceof SdkError')
    expect(abortArm).toContain("e.name === 'AbortError'")
    expect(abortArm).not.toContain("e.name === 'McpError'")
  })

  test('interrupted result throws AbortError(Q6); clean result is a no-op', () => {
    expect(() => throwIfMcpToolCallInterrupted({})).not.toThrow()
    expect(() =>
      throwIfMcpToolCallInterrupted({ interrupted: false }),
    ).not.toThrow()
    try {
      throwIfMcpToolCallInterrupted({ interrupted: true })
      throw new Error('expected AbortError')
    } catch (error) {
      expect(error).toBeInstanceOf(AbortError)
      expect((error as AbortError).message).toBe(MCP_TOOL_CALL_INTERRUPTED)
    }
  })
})
