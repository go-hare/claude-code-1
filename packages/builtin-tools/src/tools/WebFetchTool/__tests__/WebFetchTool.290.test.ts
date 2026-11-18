import { describe, expect, test } from 'bun:test'
import { formatFetchedWebResult, WebFetchTool } from '../WebFetchTool.js'
import { wrapRawFetchedWebContent } from '../rawWrap.js'

describe('WebFetchTool 2.1.290 #16 offset + 100k unread', () => {
  test('inputSchema accepts optional nonnegative integer offset', () => {
    const ok = WebFetchTool.inputSchema.safeParse({
      url: 'https://example.com',
      prompt: 'summarize',
      offset: 100_000,
    })
    expect(ok.success).toBe(true)

    const neg = WebFetchTool.inputSchema.safeParse({
      url: 'https://example.com',
      prompt: 'summarize',
      offset: -1,
    })
    expect(neg.success).toBe(false)
  })

  test('formatFetchedWebResult returns past-end message when offset >= content.length', async () => {
    const res = await formatFetchedWebResult({
      url: 'https://example.com',
      prompt: 'summarize',
      offset: 500,
      content: 'hello world',
      contentType: 'text/plain',
      code: 200,
      bytes: 11,
      abortController: new AbortController(),
      isNonInteractiveSession: true,
    })
    expect(res).toBe(
      "Nothing left to read from offset 500: this page's text is 11 characters long.",
    )
  })

  test('wrapRawFetchedWebContent slices from offset and includes read-on offset when >100k remainder', async () => {
    const content = 'A'.repeat(250_000)
    const wrapped = await wrapRawFetchedWebContent({
      url: 'https://example.com/big',
      code: 200,
      contentType: 'text/markdown',
      content,
      offset: 10_000,
      isPreapproved: true,
      summarizeRemainder: async remainder => `summary of ${remainder.length}`,
    })
    expect(wrapped).toContain('250000 characters, truncated to the first')
    expect(wrapped).toContain('from character 10000')
    expect(wrapped).toContain('were not read')
    expect(wrapped).toContain(
      'to read on, call WebFetch again with the same url and offset:',
    )
  })

  test('permissionCheckFailureDecision denies when extra keys are attached', () => {
    const denied = WebFetchTool.permissionCheckFailureDecision?.(
      {
        url: 'https://example.com',
        prompt: 'read',
        offset: 0,
        extraDangerousArg: true,
      },
      {} as never,
    )
    expect(denied?.behavior).toBe('deny')
    if (denied?.behavior === 'deny') {
      expect(denied.message).toContain('send back only url, prompt and offset')
    }

    const allowed = WebFetchTool.permissionCheckFailureDecision?.(
      { url: 'https://example.com', prompt: 'read', offset: 0 },
      {} as never,
    )
    expect(allowed).toBeUndefined()
  })
})
