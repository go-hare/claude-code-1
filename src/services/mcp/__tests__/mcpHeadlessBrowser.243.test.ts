import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('MCP OAuth densable K9e / XCb', () => {
  test('redirect skips opener when headless and logs official strings', () => {
    const src = readFileSync(join(import.meta.dir, '../auth.ts'), 'utf8')
    expect(src).toContain('isHeadlessBrowserEnvironment()')
    expect(src).toContain('Skipping browser open (headless environment). URL:')
    expect(src).toContain('tengu_mcp_oauth_browser_open')
    expect(src).toContain('headless ? false : await openBrowser')
  })
})
