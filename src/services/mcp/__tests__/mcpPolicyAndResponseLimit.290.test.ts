import { afterEach, describe, expect, test } from 'bun:test'
import {
  CLAUDE_AI_CONNECTOR_CAPABILITY,
  CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
  classifyConnectorsOffServer,
  isSdkServerWithConnectorsOff,
} from '../claudeai.js'
import { expandMcpPolicyUrlPredicate } from '../config.js'
import {
  HTTP_MCP_MAX_RESPONSE_BYTES,
  HttpBodyOverflowError,
  createResponseSizeLimitTransform,
  wrapFetchWithResponseLimit,
} from '../httpResponseLimit.js'

describe('MCP policy URL predicate expansion (official TCt / #46)', () => {
  test('allows safe hostname-position variable expansion', () => {
    const res = expandMcpPolicyUrlPredicate('https://${HOST}/mcp/*', {
      HOST: 'api.example.com',
    })
    expect(res.unsafeExpansion).toBe(false)
    expect(res.expanded).toBe('https://api.example.com/mcp/*')
  })

  test('fails closed when env var injects wildcard semantics', () => {
    const res = expandMcpPolicyUrlPredicate('https://${HOST}/mcp', {
      HOST: '*.evil.com',
    })
    expect(res.unsafeExpansion).toBe(true)
  })

  test('fails closed when env var restructures URL authority', () => {
    const res = expandMcpPolicyUrlPredicate('https://${HOST}/mcp', {
      HOST: 'good.com@evil.com',
    })
    expect(res.unsafeExpansion).toBe(true)
  })

  test('fails closed when expanded URL carries dot segment', () => {
    const res = expandMcpPolicyUrlPredicate('https://${HOST}/a/../b', {
      HOST: 'api.example.com',
    })
    expect(res.unsafeExpansion).toBe(true)
  })
})

describe('disableClaudeAiConnectors desktop SDK guard (official Igs/Kbr / #46)', () => {
  const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT
  afterEach(() => {
    if (prevEntrypoint === undefined) {
      delete process.env.CLAUDE_CODE_ENTRYPOINT
    } else {
      process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
    }
  })

  test('isSdkServerWithConnectorsOff is false outside claude-desktop', () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(
      isSdkServerWithConnectorsOff(
        { type: 'sdk' },
        {
          experimental: {
            [CLAUDE_AI_CONNECTOR_CAPABILITY]: { showsConnectorsOff: true },
          },
        },
      ),
    ).toBe(false)
  })

  test('classifyConnectorsOffServer returns kept when not disabled', () => {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    expect(
      classifyConnectorsOffServer({
        name: 'test-sdk',
        config: { type: 'sdk' },
        errorCode: CLAUDEAI_CONNECTORS_DISABLED_ERROR_CODE,
      }),
    ).toBe('kept')
  })
})

describe('HTTP MCP maxResponseSize (official Yn/cd/no / #94)', () => {
  test('HTTP_MCP_MAX_RESPONSE_BYTES is 16 MiB (16777216)', () => {
    expect(HTTP_MCP_MAX_RESPONSE_BYTES).toBe(16777216)
  })

  test('createResponseSizeLimitTransform throws HttpBodyOverflowError when body exceeds limit', async () => {
    const transform = createResponseSizeLimitTransform(1024, 1024)
    const writer = transform.writable.getWriter()
    const reader = transform.readable.getReader()
    const writePromise = writer.write(new Uint8Array(2048)).catch(() => {})
    await expect(reader.read()).rejects.toBeInstanceOf(HttpBodyOverflowError)
    await writePromise
  })

  test('wrapFetchWithResponseLimit rejects br/zstd responses', async () => {
    const fakeFetch = (async () =>
      new Response('hello', {
        status: 200,
        headers: { 'content-encoding': 'br' },
      })) as unknown as typeof fetch
    const wrapped = wrapFetchWithResponseLimit(fakeFetch)
    await expect(wrapped('https://example.com/mcp')).rejects.toThrow(
      'sent a response compressed with br or zstd',
    )
  })

  test('wrapFetchWithResponseLimit rejects any Content-Encoding when refusesCodings is true', async () => {
    const fakeFetch = (async () =>
      new Response('hello', {
        status: 200,
        headers: { 'content-encoding': 'gzip' },
      })) as unknown as typeof fetch
    const wrapped = wrapFetchWithResponseLimit(fakeFetch, {
      refusesCodings: true,
    })
    await expect(wrapped('https://example.com/mcp')).rejects.toThrow(
      'sent a response with a Content-Encoding',
    )
  })
})
