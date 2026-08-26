/**
 * densable 2.1.239 #3 — /claude-api upgrade + Python 1.x Timeout gold.
 */
import { describe, expect, test } from 'bun:test'
import { matchSubcommand } from '../claudeApi.js'
import {
  CLAUDE_API_SUBCOMMANDS,
  SKILL_FILES,
  SKILL_PROMPT,
} from '../claudeApiContent.js'

describe('claude-api upgrade densable 2.1.239', () => {
  test('matchSubcommand recognizes upgrade and trailing scope words', () => {
    expect(matchSubcommand('upgrade')).toBe('upgrade')
    expect(matchSubcommand('upgrade python')).toBe('upgrade')
    expect(matchSubcommand('upgrade python sdk src/')).toBe('upgrade')
    expect(matchSubcommand('UPGRADE')).toBe('upgrade')
  })

  test('CLAUDE_API_SUBCOMMANDS includes upgrade', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('upgrade')
  })

  test('SKILL_PROMPT has upgrade row pointing at python sdk-upgrade.md', () => {
    expect(SKILL_PROMPT).toContain('`upgrade`')
    expect(SKILL_PROMPT).toContain('python/claude-api/sdk-upgrade.md')
    expect(SKILL_PROMPT).toContain('This is not model migration')
    expect(SKILL_PROMPT).toContain('do not improvise one from the Python guide')
  })

  test('sdk-upgrade.md is inlined and executable', () => {
    const md = SKILL_FILES['python/claude-api/sdk-upgrade.md']
    expect(md).toBeDefined()
    expect(md!).toContain('# Upgrading the `anthropic` Python SDK: 0.x → 1.x')
    expect(md!).toContain('/claude-api upgrade')
    expect(md!).toContain('Step 0')
    expect(md!.length).toBeGreaterThan(10000)
  })

  test('Python README uses anthropic.Timeout / httpx2, not httpx.Timeout', () => {
    const readme = SKILL_FILES['python/claude-api/README.md']
    expect(readme).toContain('anthropic.Timeout')
    expect(readme).toContain('httpx2')
    expect(readme).toContain('/claude-api upgrade python')
    expect(readme).not.toContain('timeout=httpx.Timeout')
    expect(readme).not.toContain('import httpx\n')
  })
})
