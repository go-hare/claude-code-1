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
    expect(src).toContain('prompt = arrivedSpawn.prompt')
    expect(src).toContain(
      "description = arrivedSpawn.description.replace(/\\s+/g, ' ').trim()",
    )
    expect(src).toContain('cwd = arrivedSpawn.cwd as string | undefined')
    expect(src).toContain('run_in_background = arrivedSpawn.background')
    expect(src).toContain('rewritten by a hook')
    expect(src).toContain('names no agent this call can dispatch')
    expect(src).toContain('!isInsideAgentSpawnLaunch()')
  })
})
