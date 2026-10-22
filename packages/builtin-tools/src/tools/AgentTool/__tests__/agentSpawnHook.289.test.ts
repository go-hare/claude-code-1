/**
 * densable 2.1.289 `bn` / `Cc("agent.spawn")` / `wis` / `Rat`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dir, '../AgentTool.tsx')

describe('densable 2.1.289 agent.spawn hook', () => {
  test('AgentTool.call gates on hasMatchingFunctionHook then Rat', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain("hasMatchingFunctionHook('agent.spawn')")
    expect(src).toContain("runFunctionHookChain('agent.spawn'")
    expect(src).toContain(
      'agent.spawn: a hook answered without passing the spawn on',
    )
    expect(src).toContain('Subagent spawn denied by a plugin:')
  })

  test('AgentTool.call applies D.arrived spawn fields (gold Eis/fn)', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain(
      'let arrivedSpawn: Record<string, unknown> | undefined',
    )
    expect(src).toContain('prompt = arrived.prompt')
    expect(src).toContain(
      "description = arrived.description.replace(/\\s+/g, ' ').trim()",
    )
    expect(src).toContain('cwd = arrived.cwd as string | undefined')
    expect(src).toContain('run_in_background = arrived.background')
    expect(src).toContain(
      "A plugin's agent.spawn hook rewrote this spawn into one a permission rule",
    )
    expect(src).toContain(
      'named another agent for a web-fetch dispatch admitted without classifier review',
    )
    expect(src).toContain(
      'set cwd on a spawn isolated in a worktree; cwd and isolation: "worktree" are mutually exclusive.',
    )
    expect(src).toContain("a plugin's agent.spawn hook backgrounded this one.")
    expect(src).toContain('rewritten by a hook')
    expect(src).toContain('names no agent this call can dispatch')
    expect(src).toContain('!isInsideAgentSpawnLaunch()')
  })
})
