import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('v2.1.290 #154 — AgentTool teammate_spawned uses agent_id', () => {
  test('mapToolResultToToolResultBlockParam formats spawnData.agent_id instead of teammate_id', () => {
    const src = readFileSync(join(import.meta.dir, 'AgentTool.tsx'), 'utf8')
    const idx = src.indexOf("internalData.status === 'teammate_spawned'")
    expect(idx).toBeGreaterThan(-1)
    const slice = src.slice(idx, idx + 450)
    expect(slice).toContain('agent_id: ${spawnData.agent_id}')
    expect(slice).not.toContain('agent_id: ${spawnData.teammate_id}')
  })
})
