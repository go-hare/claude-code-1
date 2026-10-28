import { describe, expect, test } from 'bun:test'

import { call } from '../agents.js'
import agents from '../index.js'

describe('gold 2.1.289 /agents wizard removed', () => {
  test('command is a hidden local stub', () => {
    expect(agents.type).toBe('local')
    expect(agents.name).toBe('agents')
    expect(agents.isHidden).toBe(true)
    expect(agents.supportsNonInteractive).toBe(true)
    expect(agents.description).toBe(
      '(removed) Ask Claude to create/manage subagents, or edit .claude/agents/',
    )
  })

  test('call posts the wizard-removed copy', async () => {
    const result = await call()
    expect(result).toEqual({
      type: 'text',
      value: `The /agents wizard has been removed.

Ask Claude to create or update subagents for you (e.g. "create a code-reviewer subagent that ..."),
or edit the files directly:
  • .claude/agents/       (this project)
  • ~/.claude/agents/     (all projects)

Docs: https://code.claude.com/docs/en/sub-agents`,
    })
  })
})
