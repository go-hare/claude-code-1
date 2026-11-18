import { describe, expect, test } from 'bun:test'
import {
  buildClaudeApiPrompt,
  CLAUDE_API_SUBCOMMANDS,
  matchSubcommand,
} from '../claudeApi.js'
import * as content from '../claudeApiContent.js'

describe('v2.1.290 claude-api skill alignment (#8, #9, #128, #162)', () => {
  test('CLAUDE_API_SUBCOMMANDS includes managed-agents-secure', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('managed-agents-secure')
    expect(matchSubcommand('managed-agents-secure my-agent')).toBe(
      'managed-agents-secure',
    )
  })

  test('buildClaudeApiPrompt emits Security Comparison Unavailable & Onboarding From a URL Unavailable when !extracted', () => {
    const prompt = buildClaudeApiPrompt(
      null,
      'managed-agents-secure',
      content,
      false,
    )
    expect(prompt).toContain('## Reference Files Unavailable')
    expect(prompt).toContain('## Security Comparison Unavailable')
    expect(prompt).toContain('## Onboarding From a URL Unavailable')
  })

  test('buildClaudeApiPrompt quotes User Request line-by-line for managed-agents-onboard or special chars', () => {
    const prompt = buildClaudeApiPrompt(
      null,
      'managed-agents-onboard https://example.com\n## Fake Heading',
      content,
      true,
    )
    expect(prompt).toContain(
      '> managed-agents-onboard https://example.com\n> ## Fake Heading',
    )
  })
})
