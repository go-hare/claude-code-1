import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #154 — stopHooks TeammateIdle guard', () => {
  test('guards TeammateIdle / TaskCompleted hooks against subagent/fork agentId mismatch', () => {
    const src = readFileSync(join(import.meta.dir, 'stopHooks.ts'), 'utf8')
    expect(src).toContain('isTeammate() &&')
    expect(src).toContain(
      '(!toolUseContext.agentId || toolUseContext.agentId === getAgentId())',
    )
  })
})
