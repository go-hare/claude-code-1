import { describe, expect, test } from 'bun:test'
import { BROWSER_TOOLS } from '../../../../packages/@ant/claude-for-chrome-mcp/src/browserTools.js'
import { BASE_CHROME_PROMPT } from '../prompt.js'

describe('densable 2.1.221 #35 Chrome close tabs when done', () => {
  test('tabs_create_mcp description embeds close-when-done cleanup gold', () => {
    const tool = BROWSER_TOOLS.find(t => t.name === 'tabs_create_mcp')
    expect(tool).toBeDefined()
    const d = tool!.description
    expect(d).toContain('Tabs you create are yours to clean up')
    expect(d).toContain('tabs_close_mcp')
    expect(d).toContain('as soon as you no longer need it')
    expect(d).toContain(
      'Leave a tab open only if the user asked to see it or wants it kept open',
    )
  })

  test('BASE_CHROME_PROMPT instructs close-when-done', () => {
    expect(BASE_CHROME_PROMPT).toContain('tabs_close_mcp')
    expect(BASE_CHROME_PROMPT).toContain('as soon as you no longer need it')
    expect(BASE_CHROME_PROMPT).toContain(
      'Leave a tab open only if the user asked to see it or wants it kept open',
    )
  })
})
