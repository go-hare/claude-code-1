/**
 * densable 2.1.239 leftover — `xd` / isAgentSwarmsEnabled opt-in gate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { isAgentSwarmsEnabled } from '../agentSwarmsEnabled.js'

const TEAMS_ENV = 'CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS'
const source = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'agentSwarmsEnabled.ts'),
  'utf-8',
)

const previousTeams = process.env[TEAMS_ENV]
const previousArgv = process.argv

function restoreGate(): void {
  if (previousTeams === undefined) {
    delete process.env[TEAMS_ENV]
  } else {
    process.env[TEAMS_ENV] = previousTeams
  }
  process.argv = previousArgv
}

afterEach(() => {
  restoreGate()
})

describe('densable 2.1.239 isAgentSwarmsEnabled xd', () => {
  test('source locks official env / --agent-teams / tengu_amber_flint', () => {
    expect(source).toContain("process.argv.includes('--agent-teams')")
    expect(source).toContain('CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS')
    expect(source).toContain(
      "getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_flint', true)",
    )
    expect(source).not.toContain('isExperimentalAgentTeamsDisabled')
    expect(source).not.toContain('Fork build')
  })

  test('default off without env or --agent-teams', () => {
    delete process.env[TEAMS_ENV]
    process.argv = process.argv.filter(arg => arg !== '--agent-teams')
    expect(isAgentSwarmsEnabled()).toBe(false)
  })

  test('env opt-in enables when flint default stays on', () => {
    process.env[TEAMS_ENV] = '1'
    process.argv = process.argv.filter(arg => arg !== '--agent-teams')
    expect(isAgentSwarmsEnabled()).toBe(true)
  })

  test('--agent-teams enables without env', () => {
    delete process.env[TEAMS_ENV]
    process.argv = [
      ...process.argv.filter(arg => arg !== '--agent-teams'),
      '--agent-teams',
    ]
    expect(isAgentSwarmsEnabled()).toBe(true)
  })
})
