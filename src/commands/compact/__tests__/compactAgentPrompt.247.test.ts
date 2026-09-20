/**
 * densable 2.1.247 #14 — --agent /compact looks up appState.agent;
 * Summarize from here passes snapshot mainThreadAgentDefinition.
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'
import type { AgentDefinition } from '@claude-code/builtin-tools/tools/AgentTool/loadAgentsDir.js'
import { resolveMainThreadAgentDefinition } from '../compact.js'

const ROOT = join(import.meta.dir, '../../../../')

describe('densable 2.1.247 #14 --agent compact / summarize prompt', () => {
  test('Ce lookup: appState.agent → activeAgents definition', () => {
    // Only agentType matters to the Ce lookup.
    const def = { agentType: 'explore' } as unknown as AgentDefinition
    expect(
      resolveMainThreadAgentDefinition({
        agent: 'explore',
        agentDefinitions: {
          activeAgents: [def],
          allAgents: [def],
        },
      }),
    ).toBe(def)
    expect(
      resolveMainThreadAgentDefinition({
        agent: undefined,
        agentDefinitions: { activeAgents: [def], allAgents: [def] },
      }),
    ).toBeUndefined()
  })

  test('compact getCacheSharingParams uses the Ce lookup', () => {
    const src = readFileSync(
      join(ROOT, 'src/commands/compact/compact.ts'),
      'utf8',
    )
    expect(src).toContain(
      'mainThreadAgentDefinition: resolveMainThreadAgentDefinition(appState)',
    )
    expect(src).not.toContain('mainThreadAgentDefinition: undefined')
  })

  test('Summarize from here passes REPL mainThreadAgentDefinition', () => {
    const src = readFileSync(join(ROOT, 'src/screens/REPL.tsx'), 'utf8')
    expect(src).toContain('const systemPrompt = buildEffectiveSystemPrompt({')
    expect(src).toContain('mainThreadAgentDefinition,')
    expect(src).not.toContain('mainThreadAgentDefinition: undefined')
  })
})
