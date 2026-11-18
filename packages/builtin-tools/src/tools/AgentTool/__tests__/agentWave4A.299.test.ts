import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('AgentTool & swarm Wave 4A (#589, #683)', () => {
  test('#589 spawnInProcess redacts credentials before truncating prompt for task description', () => {
    const src = readFileSync(
      join(process.cwd(), 'src/utils/swarm/spawnInProcess.ts'),
      'utf8',
    )
    expect(src).toContain('redactSecretsForDisplay(prompt)')
  })

  test('#683 resumeAgent dispatches agent.spawn with resume: Object.freeze({ agentId }) and refuses on deny', () => {
    const src = readFileSync(
      join(
        process.cwd(),
        'packages/builtin-tools/src/tools/AgentTool/resumeAgent.ts',
      ),
      'utf8',
    )
    expect(src).toContain("hasMatchingFunctionHook('agent.spawn')")
    expect(src).toContain("runFunctionHookChain(\n      'agent.spawn'")
    expect(src).toContain('resume: Object.freeze({ agentId })')
    expect(src).toContain('a plugin declined the resume:')
  })
})
