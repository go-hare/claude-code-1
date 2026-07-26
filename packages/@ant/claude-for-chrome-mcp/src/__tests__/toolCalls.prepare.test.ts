import { describe, expect, test } from 'bun:test'

import { BRIDGE_ONLY_BROWSER_TOOLS, BROWSER_TOOLS } from '../browserTools.js'
import { prepareToolArgsForChrome, sanitizeArgsForLog } from '../toolCalls.js'

describe('BRIDGE_ONLY_BROWSER_TOOLS', () => {
  test('three multi-browser tools and BROWSER_TOOLS is 23', () => {
    expect([...BRIDGE_ONLY_BROWSER_TOOLS].sort()).toEqual([
      'list_connected_browsers',
      'select_browser',
      'switch_browser',
    ])
    expect(BROWSER_TOOLS).toHaveLength(23)
    expect(
      BROWSER_TOOLS.filter(t => !BRIDGE_ONLY_BROWSER_TOOLS.has(t.name)),
    ).toHaveLength(20)
  })
})

describe('sanitizeArgsForLog', () => {
  test('redacts top-level files array base64', () => {
    const out = sanitizeArgsForLog({
      ref: 'r1',
      files: [{ name: 'a.txt', mimeType: 'text/plain', data: 'QUFB' }],
    })
    expect(JSON.stringify(out)).not.toContain('QUFB')
    expect((out.files as Array<{ data: string }>)[0].data).toBe(
      '[base64 4 chars]',
    )
  })

  test('redacts non-array string files', () => {
    const secret = 'SENSITIVE_BASE64_PAYLOAD_SHOULD_NOT_LEAK'
    const out = sanitizeArgsForLog({ files: secret })
    expect(JSON.stringify(out)).not.toContain(secret)
    expect(out.files).toBe(`[redacted string ${secret.length} chars]`)
  })

  test('redacts nested browser_batch actions[].input.files', () => {
    const out = sanitizeArgsForLog({
      actions: [
        {
          name: 'file_upload',
          input: {
            files: [
              { name: 'b.txt', mimeType: 'text/plain', data: 'SEVMTE8=' },
            ],
          },
        },
      ],
    })
    const nested = (
      out.actions as Array<{ input: { files: Array<{ data: string }> } }>
    )[0].input.files[0].data
    expect(nested).toBe('[base64 8 chars]')
    expect(JSON.stringify(out)).not.toContain('SEVMTE8=')
  })
})

describe('prepareToolArgsForChrome browser_batch bridge-only', () => {
  test('always rejects switch_browser sub-action (top-level only)', async () => {
    const result = await prepareToolArgsForChrome('browser_batch', {
      actions: [{ name: 'switch_browser', input: {} }],
    })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('switch_browser')
      expect(result.error).toContain('top-level only')
    }
  })

  test('rejects list/select (case-insensitive / trimmed)', async () => {
    for (const name of [
      'list_connected_browsers',
      'Select_Browser',
      'LIST_CONNECTED_BROWSERS',
      '  select_browser  ',
    ]) {
      const result = await prepareToolArgsForChrome('browser_batch', {
        actions: [{ name, input: {} }],
      })
      expect('error' in result).toBe(true)
    }
  })

  test('rejects bridge-only even mid-batch after navigate', async () => {
    const result = await prepareToolArgsForChrome('browser_batch', {
      actions: [
        { name: 'navigate', input: { url: 'https://example.com' } },
        { name: 'select_browser', input: { deviceId: 'x' } },
      ],
    })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('select_browser')
    }
  })

  test('still rejects nested browser_batch', async () => {
    const result = await prepareToolArgsForChrome('browser_batch', {
      actions: [{ name: 'browser_batch', input: { actions: [] } }],
    })
    expect('error' in result).toBe(true)
    if ('error' in result) {
      expect(result.error).toContain('cannot be nested')
    }
  })

  test('passes through non-upload actions without rewrite', async () => {
    const args = {
      actions: [{ name: 'navigate', input: { url: 'https://example.com' } }],
    }
    const result = await prepareToolArgsForChrome('browser_batch', args)
    expect(result).toEqual({ input: args })
  })

  test('trusts Host-pre-expanded files without paths', async () => {
    const args = {
      files: [
        {
          name: 'a.txt',
          mimeType: 'text/plain',
          data: Buffer.from('hi').toString('base64'),
        },
      ],
      ref: 'r1',
      tabId: 1,
    }
    const result = await prepareToolArgsForChrome('file_upload', args)
    expect(result).toEqual({ input: args })
  })
})

describe('prepareToolArgsForChrome tabs_context_mcp createIfEmpty', () => {
  test('defaults createIfEmpty to true when omitted', async () => {
    const result = await prepareToolArgsForChrome('tabs_context_mcp', {})
    expect(result).toEqual({ input: { createIfEmpty: true } })
  })

  test('preserves explicit false (probe without create)', async () => {
    const result = await prepareToolArgsForChrome('tabs_context_mcp', {
      createIfEmpty: false,
    })
    expect(result).toEqual({ input: { createIfEmpty: false } })
  })

  test('preserves explicit true', async () => {
    const result = await prepareToolArgsForChrome('tabs_context_mcp', {
      createIfEmpty: true,
    })
    expect(result).toEqual({ input: { createIfEmpty: true } })
  })
})
