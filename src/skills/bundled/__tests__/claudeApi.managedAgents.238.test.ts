/**
 * densable 2.1.238 #35 — bundled claude-api Aug 19:
 * web search/fetch domain settings + memory stores on self-hosted sandboxes.
 *
 * Gold is SEA extract of Uoy / $oy, not invented prose. Remaining
 * managed-agents-*.md files stay unbundled (invent-ban).
 */
import { describe, expect, test } from 'bun:test'
import { SKILL_FILES } from '../claudeApiContent.js'

describe('claude-api managed-agents densable 2.1.238 #35', () => {
  test('SKILL_FILES inlines shared/managed-agents-tools.md (Uoy)', () => {
    const md = SKILL_FILES['shared/managed-agents-tools.md']
    expect(md).toBeDefined()
    expect(md!).toContain('# Managed Agents — Tools & Skills')
    expect(md!).toContain(
      '### Web search & web fetch settings (domain filters)',
    )
    expect(md!).toContain('allowed_domains')
    expect(md!).toContain('blocked_domains')
    expect(md!).toContain('never both on one entry')
    expect(md!).toContain('user_location')
    expect(md!).toContain('max_content_tokens')
    expect(md!).toContain('url_not_allowed')
    expect(md!.length).toBeGreaterThan(10000)
  })

  test('SKILL_FILES inlines shared/managed-agents-self-hosted-sandboxes.md ($oy)', () => {
    const md = SKILL_FILES['shared/managed-agents-self-hosted-sandboxes.md']
    expect(md).toBeDefined()
    expect(md!).toContain('# Managed Agents — Self-Hosted Sandboxes')
    expect(md!).toContain('## Memory stores')
    expect(md!).toContain('memory_store_id')
    expect(md!).toContain('/mnt/memory/')
    expect(md!).toContain('EnvironmentWorker')
    expect(md!).toContain('Not available on Claude Platform on AWS')
    expect(md!.length).toBeGreaterThan(10000)
  })
})
