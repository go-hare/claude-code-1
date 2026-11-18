import { describe, expect, test } from 'bun:test'
import { CLAUDE_API_SUBCOMMANDS, matchSubcommand } from '../claudeApi.js'
import { SKILL_FILES, SKILL_PROMPT } from '../claudeApiContent.js'
import { SKILL_FILES as DATAVIZ_FILES } from '../datavizContent.js'

describe('#962, #1074, #1146, #1165, #1174 claude-api & #1167 dataviz', () => {
  test('#962 includes managed-agents-secure subcommand and shared doc', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('managed-agents-secure')
    expect(matchSubcommand('managed-agents-secure agent_123')).toBe(
      'managed-agents-secure',
    )
    expect(SKILL_FILES['shared/managed-agents-secure.md']).toContain(
      'Secure a Managed Agents deployment',
    )
  })

  test('#1074 includes api-version subcommand and 2026-10-21 migration doc', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('api-version')
    expect(matchSubcommand('api-version')).toBe('api-version')
    expect(SKILL_FILES['shared/api-version-migration.md']).toContain(
      '2026-10-21',
    )
  })

  test('#1146 opentelemetry.md does not claim --on-work passes trace context', () => {
    const otel = SKILL_FILES['shared/opentelemetry.md'] ?? ''
    expect(otel).toContain('a root span in `ant beta:worker poll`')
    expect(otel).not.toContain('--on-work')
  })

  test('#1165 SKILL.md and live-sources.md instruct checking live docs', () => {
    expect(SKILL_PROMPT).toContain('shared/live-sources.md')
    expect(SKILL_FILES['shared/live-sources.md']).toContain(
      'https://platform.claude.com/docs/en/release-notes/overview.md',
    )
  })

  test('#1174 managed-agents-multiagent.md uses multiagent_20261001 with dynamic workflows', () => {
    const doc = SKILL_FILES['shared/managed-agents-multiagent.md'] ?? ''
    expect(doc).toContain('multiagent_20261001')
    expect(doc).toContain('workflows:')
  })

  test('#1167 dataviz palette validators implement apca(text, background) and color-formula covers APCA', () => {
    const js = DATAVIZ_FILES['scripts/validate_palette.js'] ?? ''
    const py = DATAVIZ_FILES['scripts/validate_palette.py'] ?? ''
    const formula = DATAVIZ_FILES['references/color-formula.md'] ?? ''

    expect(js).toContain('export const apca = (text, background) =>')
    expect(py).toContain('def apca(')
    expect(formula).toContain('APCA')
  })
})
