/**
 * densable 2.1.221 #4 — claude-api `prompt-audit` subcommand.
 */
import { describe, expect, test } from 'bun:test'
import { matchSubcommand, processSkillMarkdown } from '../claudeApi.js'
import {
  CLAUDE_API_SUBCOMMANDS,
  SKILL_FILES,
  SKILL_PROMPT,
} from '../claudeApiContent.js'

describe('claude-api prompt-audit densable 2.1.221', () => {
  test('matchSubcommand recognizes prompt-audit / migrate / managed-agents-onboard', () => {
    expect(matchSubcommand('prompt-audit')).toBe('prompt-audit')
    expect(matchSubcommand('prompt-audit ./skills')).toBe('prompt-audit')
    expect(matchSubcommand('PROMPT-AUDIT')).toBe('prompt-audit')
    expect(matchSubcommand('migrate')).toBe('migrate')
    expect(matchSubcommand('managed-agents-onboard')).toBe(
      'managed-agents-onboard',
    )
    expect(matchSubcommand('hello world')).toBe('none')
    expect(matchSubcommand('')).toBe('none')
  })

  test('CLAUDE_API_SUBCOMMANDS includes prompt-audit (densable X5T)', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('prompt-audit')
    expect(CLAUDE_API_SUBCOMMANDS).toContain('migrate')
  })

  test('SKILL_PROMPT has Subcommands table with prompt-audit + migrate cross-ref', () => {
    expect(SKILL_PROMPT).toContain('## Subcommands')
    expect(SKILL_PROMPT).toContain('`prompt-audit`')
    expect(SKILL_PROMPT).toContain('shared/prompt-audit.md')
    expect(SKILL_PROMPT).toContain(
      'After the per-target changes are applied, audit the in-scope prompt text',
    )
    // Language Detection non-interactive exception
    expect(SKILL_PROMPT).toContain(
      "for the `prompt-audit` subcommand, skip this section's ask steps",
    )
    // Before You Start exception
    expect(SKILL_PROMPT).toContain(
      'Exception: the `prompt-audit` subcommand is non-interactive',
    )
  })

  test('shared/prompt-audit.md is inlined in SKILL_FILES', () => {
    const md = SKILL_FILES['shared/prompt-audit.md']
    expect(md).toBeDefined()
    expect(md!).toContain('# Prompt Audit')
    expect(md!).toContain('Step 0')
    expect(md!.length).toBeGreaterThan(1000)
  })

  test('processSkillMarkdown strips HTML comments and substitutes model vars', () => {
    const out = processSkillMarkdown('<!-- hide -->Hello {{OPUS_NAME}}', {
      OPUS_NAME: 'Claude Opus 5',
    })
    expect(out).not.toContain('<!--')
    expect(out).toContain('Claude Opus 5')
  })
})
