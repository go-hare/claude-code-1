import { afterEach, describe, expect, test } from 'bun:test'

describe('densable 2.1.289 CLAUDE_CODE_DISABLE_WEB_FETCH', () => {
  const key = 'CLAUDE_CODE_DISABLE_WEB_FETCH'
  const saved = process.env[key]

  afterEach(() => {
    if (saved === undefined) delete process.env[key]
    else process.env[key] = saved
  })

  test('isEnabled is false when CLAUDE_CODE_DISABLE_WEB_FETCH is truthy', async () => {
    process.env[key] = '1'
    const { WebFetchTool } = await import('../WebFetchTool.js')
    expect(WebFetchTool.isEnabled()).toBe(false)
  })

  test('isEnabled is true when CLAUDE_CODE_DISABLE_WEB_FETCH is unset', async () => {
    delete process.env[key]
    const { WebFetchTool } = await import('../WebFetchTool.js')
    expect(WebFetchTool.isEnabled()).toBe(true)
  })
})
