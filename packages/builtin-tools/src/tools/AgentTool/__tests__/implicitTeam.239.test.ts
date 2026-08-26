/**
 * densable 2.1.239 leftover — implicit single team schema/call/prompt.
 * Source-lock only. WIe / Tno isolation landed separately; storageV5 still off.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const agentToolSource = readFileSync(
  join(__dirname, '..', 'AgentTool.tsx'),
  'utf-8',
)
const promptSource = readFileSync(join(__dirname, '..', 'prompt.ts'), 'utf-8')
const spawnSource = readFileSync(
  join(__dirname, '..', '..', 'shared', 'spawnMultiAgent.ts'),
  'utf-8',
)
const repoRoot = join(__dirname, '..', '..', '..', '..', '..', '..')
const sessionTeamSource = readFileSync(
  join(repoRoot, 'src', 'utils', 'swarm', 'sessionTeam.ts'),
  'utf-8',
)
const mainSource = readFileSync(join(repoRoot, 'src', 'main.tsx'), 'utf-8')

describe('densable 2.1.239 implicit session team leftover', () => {
  test('name schema uses B4f regex + reserved main refine', () => {
    expect(agentToolSource).toContain('AGENT_NAME_REGEX')
    expect(agentToolSource).toContain(
      'name must start with a letter or digit and contain only letters, digits, underscores, or hyphens (max 64 chars)',
    )
    expect(agentToolSource).toContain(
      'is reserved — SendMessage routes it to the main conversation',
    )
    expect(agentToolSource).toContain(
      'Name for the spawned agent. Makes it addressable via SendMessage({to: name}) while running.',
    )
  })

  test('team_name / model / run_in_background match official describes', () => {
    expect(agentToolSource).toContain(
      'Deprecated; ignored. The session has a single implicit team.',
    )
    expect(agentToolSource).toContain("'fable'")
    expect(agentToolSource).toContain(
      'Ignored for subagent_type: "fork" — forks always inherit the parent model.',
    )
    expect(agentToolSource).toContain(
      'Set to false only when your very next action depends on this agent',
    )
    expect(agentToolSource).not.toContain(
      'Team name for spawning. Uses current team context if omitted.',
    )
  })

  test('call ignores team_name and spawns from session teamContext', () => {
    expect(agentToolSource).toContain('void team_name')
    expect(agentToolSource).toContain(
      'const teamContext = isAgentSwarmsEnabled() ? appState.teamContext : undefined',
    )
    expect(agentToolSource).toContain('if (isTeammate() && name)')
    expect(agentToolSource).toContain(
      'if (isInProcessTeammate() && run_in_background === true)',
    )
    expect(agentToolSource).toContain(
      '!shouldSkipTeammateSpawnForWebFetch(subagent_type, toolUseContext.options.agentDefinitions.activeAgents)',
    )
    expect(agentToolSource).toContain('teamContext &&')
    expect(agentToolSource).toContain('!isForkType &&')
    expect(agentToolSource).toContain('!isolation &&')
    expect(agentToolSource).toContain('!cwd')
    expect(agentToolSource).not.toContain('team_name: teamName')
    expect(agentToolSource).not.toContain(
      'Agent Teams is not yet available on your plan.',
    )
    expect(agentToolSource).not.toContain('function resolveTeamName')
  })

  test('prompt drops team_name/mode from context restrictions', () => {
    expect(promptSource).toContain(
      'The run_in_background and name parameters are not available in this context. Only synchronous subagents are supported.',
    )
    expect(promptSource).toContain(
      'The name parameter is not available in this context — teammates cannot spawn other teammates. Omit it to spawn a subagent.',
    )
    expect(promptSource).not.toContain('name, team_name, and mode')
  })

  test('spawn reads only teamContext and uses official errors', () => {
    expect(spawnSource).toContain(
      'Internal error: session team not initialized. This should have happened at startup when agent swarms are enabled.',
    )
    expect(spawnSource).toContain(
      'The session team should have been initialized at startup.',
    )
    expect(spawnSource).toContain('subagent_teammate_no_team_name')
    expect(spawnSource).not.toContain('input.team_name ||')
    expect(spawnSource).not.toContain('Call TeamCreate first')
  })

  test('sessionTeam + main.tsx startup hook', () => {
    expect(sessionTeamSource).toContain('session-${')
    expect(sessionTeamSource).toContain('CLAUDE_INTERNAL_ASSISTANT_TEAM_NAME')
    expect(sessionTeamSource).toContain('existingTeamName')
    expect(sessionTeamSource).toContain("backendType: 'in-process'")
    expect(sessionTeamSource).not.toContain('resetTaskList')
    expect(mainSource).toContain('initializeSessionTeam')
    expect(mainSource).toContain(
      'existingTeamName: assistantTeamContext?.teamName',
    )
    expect(mainSource).toContain('!storedTeammateOpts?.agentId')
  })
})
