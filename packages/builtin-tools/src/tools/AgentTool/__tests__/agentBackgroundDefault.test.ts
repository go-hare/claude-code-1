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

describe('Agent background-by-default (official 208)', () => {
  test('schema describe says background by default / set false for sync', () => {
    expect(agentToolSource).toContain('Agents run in the background by default')
    expect(agentToolSource).toContain(
      'Set to false only when your very next action depends on this agent',
    )
    expect(agentToolSource).not.toContain(
      'Set to true to run this agent in the background',
    )
  })

  test('shouldRunAsync uses run_in_background !== false default for non-teammates', () => {
    expect(agentToolSource).toContain(
      '(!isInProcessTeammate() && run_in_background !== false)',
    )
  })

  test('prompt says Subagents run in the background by default', () => {
    expect(promptSource).toContain('Subagents run in the background by default')
    expect(promptSource).toContain('run_in_background: false')
    expect(promptSource).not.toContain('Foreground (default)')
    expect(promptSource).not.toContain('Use foreground (default)')
  })
})
