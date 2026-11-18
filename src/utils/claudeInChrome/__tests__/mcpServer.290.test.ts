import { describe, expect, test } from 'bun:test'
import { createChromeContext } from '../mcpServer.js'

describe('v2.1.290 mcpServer onToolCallDisconnected & browser_batch timeout (#108, #137)', () => {
  test('getToolCallTimeoutMs returns 90_000 for browser_batch and 30_000 otherwise', () => {
    const ctx = createChromeContext({
      CLAUDE_CODE_ENABLE_CFC: '1',
    })
    expect(ctx.getToolCallTimeoutMs?.('browser_batch')).toBe(90_000)
    expect(ctx.getToolCallTimeoutMs?.('navigate')).toBe(30_000)
  })

  test('onToolCallDisconnected returns non-empty guidance string', () => {
    const ctx = createChromeContext({})
    const msg = ctx.onToolCallDisconnected()
    expect(msg.length).toBeGreaterThan(20)
    expect(msg).toContain('Browser extension is not connected')
  })
})
