/**
 * densable 2.1.247 #4 / #5 — official /claude-api cost-optimize + Admin API / CMEK.
 * Gold is SEA-peeled skill markdown (not changelog prose).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import { matchSubcommand } from '../../claudeApi.js'
import { CLAUDE_API_SUBCOMMANDS, SKILL_FILES } from '../../claudeApiContent.js'

const ROOT = join(import.meta.dir, '..')

function readSkill(rel: string): string {
  return readFileSync(join(ROOT, rel), 'utf8')
}

describe('claude-api cost-optimize densable 2.1.247 #4', () => {
  test('SKILL.md Subcommands table has official cost-optimize row', () => {
    const skill = readSkill('SKILL.md')
    expect(skill).toContain('| `cost-optimize` |')
    expect(skill).toContain(
      '**Read `shared/cost-optimization.md` immediately**',
    )
    expect(skill).toContain(
      'Reduce what existing Claude API code costs to run, without sacrificing output quality.',
    )
    expect(skill).toContain('"no changes recommended" is a valid outcome')
    expect(skill).toContain(
      'this workflow is not expected to one-shot the audit',
    )
  })

  test('SKILL.md Quick Task Reference points at cost-optimization.md', () => {
    const skill = readSkill('SKILL.md')
    expect(skill).toContain(
      '**Reducing or reviewing API spend ("the bill is too high", "make this cheaper", "am I overspending", cost per completed task, cheapest model or effort that holds quality):**',
    )
    expect(skill).toContain(
      'Read `shared/cost-optimization.md` - baseline and token profile first',
    )
  })

  test('shared/cost-optimization.md is the official executable guide', () => {
    const md = readSkill('shared/cost-optimization.md')
    expect(
      md.startsWith('# Cost Optimization - Cutting Spend per Completed Task'),
    ).toBe(true)
    expect(md).toContain(
      '> **If you arrived via `/claude-api cost-optimize`:** this is the right file.',
    )
    expect(md).toContain(
      '## Step 0: Establish scope, quality bar, and baseline',
    )
    expect(md).toContain('## Step 1: Profile where the tokens go')
    expect(md).toContain('GET /v1/organizations/usage_report/messages')
    expect(md).toContain('GET /v1/organizations/cost_report')
    expect(md).toContain('## Workload shape -> lever')
    expect(md).toContain('## Step 4: Deliverables')
    expect(md).toContain(
      'https://platform.claude.com/cookbook/cost-optimization-cost-optimization',
    )
    expect(md.length).toBeGreaterThan(40000)
  })
})

describe('claude-api Admin API / CMEK densable 2.1.247 #5', () => {
  test('SKILL.md Other API Surfaces has official Admin API QR', () => {
    const skill = readSkill('SKILL.md')
    expect(skill).toContain('**Admin API (beta, since 2026-08-26):**')
    expect(skill).toContain('client.beta.organization')
    expect(skill).toContain('ant beta:organization')
    expect(skill).toContain('CMEK external keys')
    expect(skill).toContain('See `shared/admin-api.md`.')
  })

  test('SKILL.md Quick Task Reference has Organization administration row', () => {
    const skill = readSkill('SKILL.md')
    expect(skill).toContain(
      '**Organization administration (members, invites, workspaces, API keys, rate limit reports, service accounts, WIF resources, CMEK):**',
    )
    expect(skill).toContain(
      'Read `shared/admin-api.md` - `client.beta.organization` endpoint/method table',
    )
  })

  test('shared/admin-api.md is the official Admin API / CMEK guide', () => {
    const md = readSkill('shared/admin-api.md')
    expect(md.startsWith('# Admin API (Organization Management)')).toBe(true)
    expect(md).toContain('customer-managed encryption keys (CMEK)')
    expect(md).toContain('https://api.anthropic.com/v1/organizations/*')
    expect(md).toContain('As of **August 26, 2026**')
    expect(md).toContain('client.beta.organization')
    expect(md).toContain('ant beta:organization')
    expect(md).toContain('sk-ant-admin...')
    expect(md).toContain('/v1/organizations/external_keys')
    expect(md).toContain('external_key_id="ekey_..."')
    expect(md).toContain('## Live Docs')
    expect(md.length).toBeGreaterThan(10000)
  })

  test('shared/live-sources.md has official Admin API and cost URLs', () => {
    const md = readSkill('shared/live-sources.md')
    expect(md).toContain('| Cost Optimization |')
    expect(md).toContain(
      'https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence.md',
    )
    expect(md).toContain('### Admin API (Organization Management)')
    expect(md).toContain(
      'https://platform.claude.com/docs/en/manage-claude/admin-api.md',
    )
    expect(md).toContain('| Usage and Cost Admin API |')
  })

  test('assembler inlines official files and recognizes cost-optimize', () => {
    expect(CLAUDE_API_SUBCOMMANDS).toContain('cost-optimize')
    expect(SKILL_FILES['shared/cost-optimization.md']).toContain(
      '> **If you arrived via `/claude-api cost-optimize`:** this is the right file.',
    )
    expect(SKILL_FILES['shared/admin-api.md']).toContain(
      '# Admin API (Organization Management)',
    )
    for (const cmd of CLAUDE_API_SUBCOMMANDS) {
      expect(matchSubcommand(cmd)).toBe(cmd)
    }
    expect(matchSubcommand('cost-optimize python')).toBe('cost-optimize')
    expect(matchSubcommand('COST-OPTIMIZE')).toBe('cost-optimize')
    const matcher = readFileSync(
      join(import.meta.dir, '../../claudeApi.ts'),
      'utf8',
    )
    expect(matcher).toContain(
      'subcommands: readonly string[] = CLAUDE_API_SUBCOMMANDS',
    )
  })
})
