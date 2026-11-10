import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { CLAUDE_CODE_GUIDE_AGENT } from '../built-in/claudeCodeGuideAgent.js'
import { EXPLORE_AGENT } from '../built-in/exploreAgent.js'
import { PLAN_AGENT } from '../built-in/planAgent.js'
import { STATUSLINE_SETUP_AGENT } from '../built-in/statuslineSetup.js'
import { formatAgentLine, getPrompt } from '../prompt.js'
import type { AgentDefinition } from '../loadAgentsDir.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const promptSource = readFileSync(join(__dirname, '..', 'prompt.ts'), 'utf-8')

describe('prompt.ts densable 2.1.289 kLo lock', () => {
  test('does not contain "omit `subagent_type`" guidance', () => {
    expect(promptSource).not.toMatch(/omit.*subagent_type/)
  })

  test('kLo has no fork-true flag; fork is subagent_type "fork"', () => {
    expect(promptSource).not.toMatch(/fork: true/)
    expect(promptSource).toContain('subagent_type: "fork"')
    expect(promptSource).toContain(
      'specify a subagent_type to select an agent:',
    )
    expect(promptSource).toContain(
      'forks yourself (the fork inherits your full conversation context',
    )
    expect(promptSource).toContain('override is ignored')
  })

  test('When to fork uses gold qualitative criterion, not inherit-cache opener', () => {
    expect(promptSource).toContain(
      "when the intermediate tool output isn't worth keeping in your context",
    )
    expect(promptSource).toContain(
      'The criterion is qualitative — "will I need this output again" — not task size',
    )
    expect(promptSource).toContain('Fork open-ended questions.')
    expect(promptSource).toContain('launch parallel forks in one message')
    expect(promptSource).toContain('A fork beats a fresh subagent for this')
    expect(promptSource).not.toContain(
      'Forks inherit context and share your cache.',
    )
  })

  test("gold Se&&!M: Don't race is gated on backgroundAvailable && !forkEnabled", () => {
    expect(promptSource).toContain('backgroundAvailable && !forkEnabled')
    expect(promptSource).toContain('isBackgroundAgentLaunchBlocked()')
    expect(promptSource).toContain('!isInProcessTeammate()')
  })

  test('gold Se&&!w: background-by-default is gated off when Yne product overlay is on', () => {
    expect(promptSource).toContain('isForkSubagentProductEnabled()')
    expect(promptSource).toContain('backgroundAvailable && !forkProductEnabled')
  })

  test('kLo ye Example usage lands ship-audit fork after When to fork', () => {
    expect(promptSource).toContain('Example usage:')
    expect(promptSource).toContain('name: "ship-audit"')
    expect(promptSource).toContain('subagent_type: "fork"')
    const when = promptSource.indexOf('## When to fork')
    const ye = promptSource.indexOf('Example usage:')
    expect(when).toBeGreaterThan(0)
    expect(ye).toBeGreaterThan(when)
  })

  test('kLo K interpolates after isolation worktree cleanup when Pqe&&TRe', () => {
    expect(promptSource).toContain(
      'isSharesCwdSiblingGateOn() && canStampSharesCwdNote()',
    )
    expect(promptSource).toContain(
      'When dispatching two or more agents that will write or edit files in the same repository, give EACH `isolation: "worktree"`',
    )
    expect(promptSource).toContain(
      'parallel agents sharing a working directory overwrite each other',
    )
    const isolation = promptSource.indexOf(
      'the worktree is automatically cleaned up if the agent makes no changes',
    )
    const interpolate = promptSource.indexOf(
      'sharesCwdDispatchNote ?',
      isolation,
    )
    expect(isolation).toBeGreaterThan(0)
    expect(interpolate).toBeGreaterThan(isolation)
  })

  test('kLo Ix/leanPrompt + unique English (289)', () => {
    expect(promptSource).toContain('shouldUseLeanAgentPrompt')
    expect(promptSource).toContain('availability?.leanPrompt')
    expect(promptSource).toContain('availability?.delegationCostsFirst')
    expect(promptSource).toContain('hasActiveBackgroundLaunchRule()')
    expect(promptSource).toContain(
      '**Do not spawn agents unless the user asks.**',
    )
    expect(promptSource).toContain(
      "The agent's final report is not shown to the user",
    )
    expect(promptSource).toContain(
      'its final report is not visible to the user',
    )
    expect(promptSource).toContain(
      'If the target is already known, use the direct tool:',
    )
    expect(promptSource).toContain(
      'A subagent runs in the background only if you pass `run_in_background: true`',
    )
    expect(promptSource).not.toContain('class Foo')
    expect(promptSource).not.toContain('find the match more quickly')
    expect(promptSource).not.toContain(
      'Launch multiple agents concurrently whenever possible',
    )
    expect(promptSource).not.toContain('export function kLo')
    expect(promptSource).not.toContain('export function Ix')
    const api = readFileSync(
      join(
        __dirname,
        '..',
        '..',
        '..',
        '..',
        '..',
        '..',
        'src',
        'utils',
        'api.ts',
      ),
      'utf-8',
    )
    expect(api).toContain('getDelegationCostsFirstText()')
    expect(api).toContain('delegationCostsFirstText')
    expect(api).toContain('isDelegationCostsFirst(options.model)')
  })

  test('leanPrompt true returns short prompt, not Usage notes', async () => {
    const agents = [
      {
        agentType: 'Explore',
        whenToUse: 'explore',
        tools: ['*'],
        source: 'built-in',
        baseDir: 'built-in',
        getSystemPrompt: () => '',
      } as AgentDefinition,
    ]
    const short = await getPrompt(agents, false, undefined, {
      forkAvailable: false,
      generalPurposeAvailable: true,
      leanPrompt: true,
    })
    expect(short).toContain('## When to use')
    expect(short).not.toContain('## Usage notes')
    expect(short).not.toContain('class Foo')
    const long = await getPrompt(agents, false, undefined, {
      forkAvailable: false,
      generalPurposeAvailable: true,
      leanPrompt: false,
    })
    expect(long).toContain('## Usage notes')
    expect(long).toContain(
      'If the target is already known, use the direct tool:',
    )
    expect(long).not.toContain('class Foo')
    expect(long).not.toContain(
      'Launch multiple agents concurrently whenever possible',
    )
  })

  test('leanPrompt + delegationCostsFirst uses lucky_cerf When to use', async () => {
    const agents = [
      {
        agentType: 'Explore',
        whenToUse: 'explore',
        tools: ['*'],
        source: 'built-in',
        baseDir: 'built-in',
        getSystemPrompt: () => '',
      } as AgentDefinition,
    ]
    const costs = await getPrompt(agents, false, undefined, {
      forkAvailable: false,
      generalPurposeAvailable: true,
      leanPrompt: true,
      delegationCostsFirst: true,
    })
    expect(costs).toContain('A fresh agent costs more than it looks.')
    expect(costs).not.toContain('## Usage notes')
    const lookup = await getPrompt(agents, false, undefined, {
      forkAvailable: false,
      generalPurposeAvailable: true,
      leanPrompt: true,
      delegationCostsFirst: false,
    })
    expect(lookup).toContain(
      'For a single-fact lookup where you already know the file, symbol, or value, search directly.',
    )
    expect(lookup).not.toContain('A fresh agent costs more than it looks.')
  })

  test('formatAgentLine uses whenToUseLean when lean is true (TKn)', () => {
    expect(EXPLORE_AGENT.whenToUse).toContain(
      'Fast read-only search agent for locating code.',
    )
    expect(EXPLORE_AGENT.whenToUseLean).toContain(
      'Read-only search agent for broad fan-out searches',
    )
    expect(formatAgentLine(EXPLORE_AGENT, false)).toContain(
      'Fast read-only search agent for locating code.',
    )
    expect(formatAgentLine(EXPLORE_AGENT, true)).toContain(
      'Read-only search agent for broad fan-out searches',
    )
  })

  test('non-Fork Example usage includes mid-wait example and post-call commentary (xe/ve)', async () => {
    const long = await getPrompt([], false, undefined, {
      forkAvailable: false,
      generalPurposeAvailable: true,
      leanPrompt: false,
    })
    expect(long).toContain('user: "so is the gate wired up or not"')
    expect(long).toContain(
      'The agent starts with no context from this conversation, so the prompt briefs it: what to assess, the relevant background, and what form the answer should take.',
    )
    expect(long).not.toContain('name: "migration-review"')
  })

  test('built-in agents align 2.1.289 prompts (Explore, Plan, Guide, Statusline)', () => {
    expect(
      PLAN_AGENT.getSystemPrompt({ toolUseContext: { options: {} as never } }),
    ).toContain('### Critical Files for Implementation')
    const guidePrompt = CLAUDE_CODE_GUIDE_AGENT.getSystemPrompt({
      toolUseContext: {
        options: {
          commands: [
            { name: 'foo', description: 'first', type: 'prompt' },
            { name: 'foo', description: 'dup', type: 'prompt' },
          ],
          agentDefinitions: { activeAgents: [] },
          mcpClients: [],
        } as never,
      } as never,
    })
    expect(guidePrompt).toContain('**Your expertise spans five domains:**')
    expect(guidePrompt).toContain(
      '# Plugin eval and /skill-doctor (embedded offline reference)',
    )
    expect(guidePrompt).toContain(
      'Note: The Agent SDK docs live in the Claude Code docs map (code.claude.com)',
    )
    expect(guidePrompt).not.toContain('- /foo: dup')

    const statuslinePrompt = STATUSLINE_SETUP_AGENT.getSystemPrompt({
      toolUseContext: { options: {} as never },
    })
    expect(statuslinePrompt).toContain('"prompt_id": "string"')
    expect(statuslinePrompt).toContain('"spend_limit": {')
    expect(statuslinePrompt).toContain('"prompt_cache": {')
    expect(statuslinePrompt).toContain('"VISUAL" | "VISUAL LINE"')
    expect(statuslinePrompt).toContain(
      'To display a Claude gateway spend limit when available:',
    )
  })
})
