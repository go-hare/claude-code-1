import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

describe('densable 2.1.289 TeamCreate/TeamDelete never model-facing', () => {
  // Gold SEA 2.1.289: TeamCreate/TeamDelete strings exist ONLY in Xc's d_e
  // classifier Set — no tool BODY / getTeamCreateTool / tengu_team_*.
  // Lo() still gates swarm surfaces (mailbox/team_context) but is NOT
  // TeamCreate.isEnabled. Fork keeps internals; isEnabled false = gold expose.
  test('TeamCreate isEnabled returns false (gold tool BODY absent)', () => {
    const src = readFileSync(
      join(__dirname, '..', 'TeamCreateTool.ts'),
      'utf-8',
    )
    expect(src).toMatch(/isEnabled\(\)\s*\{\s*return false/)
    expect(src).not.toMatch(
      /isEnabled\(\)\s*\{\s*return isAgentSwarmsEnabled\(\)/,
    )
  })

  test('TeamDelete isEnabled returns false (gold tool BODY absent)', () => {
    const src = readFileSync(
      join(__dirname, '..', '..', 'TeamDeleteTool', 'TeamDeleteTool.ts'),
      'utf-8',
    )
    expect(src).toMatch(/isEnabled\(\)\s*\{\s*return false/)
    expect(src).not.toMatch(
      /isEnabled\(\)\s*\{\s*return isAgentSwarmsEnabled\(\)/,
    )
  })
})
