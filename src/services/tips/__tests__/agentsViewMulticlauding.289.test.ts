/**
 * densable 2.1.289 Agents View P2 — tip id + GlobalConfig tip gates.
 * Source-level lock (same style as customAgentsTipRemoved.232).
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_GLOBAL_CONFIG,
  GLOBAL_CONFIG_KEYS,
} from '../../../utils/config.js'

const tipRegistrySrc = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../tipRegistry.ts'),
  'utf8',
)

describe('densable 2.1.289 agents-view-multiclauding', () => {
  test('registers agents-view-multiclauding tip after color-when-multi-clauding', () => {
    expect(tipRegistrySrc).toMatch(/id:\s*['"]agents-view-multiclauding['"]/)
    const colorIdx = tipRegistrySrc.indexOf("id: 'color-when-multi-clauding'")
    const agentsIdx = tipRegistrySrc.indexOf("id: 'agents-view-multiclauding'")
    expect(colorIdx).toBeGreaterThan(-1)
    expect(agentsIdx).toBeGreaterThan(colorIdx)
  })

  test('tip gates on hasOpenedAgentsView / hasUsedAgentsFleet', () => {
    expect(tipRegistrySrc).toContain('hasOpenedAgentsView')
    expect(tipRegistrySrc).toContain('hasUsedAgentsFleet')
    expect(tipRegistrySrc).toContain('leftArrowOpensAgents')
    expect(tipRegistrySrc).toContain("feature('BG_SESSIONS')")
  })

  test('GlobalConfig keys + defaults exist for tip gates', () => {
    expect(GLOBAL_CONFIG_KEYS).toContain('hasOpenedAgentsView')
    expect(GLOBAL_CONFIG_KEYS).toContain('hasUsedAgentsFleet')
    expect(DEFAULT_GLOBAL_CONFIG.hasOpenedAgentsView).toBe(false)
    expect(DEFAULT_GLOBAL_CONFIG.hasUsedAgentsFleet).toBe(false)
  })

  test('gold CLI stamps hasOpenedAgentsView only (no hasUsedAgentsFleet writer)', () => {
    const agentViewSrc = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../screens/AgentView.tsx',
      ),
      'utf8',
    )
    expect(agentViewSrc).toContain('hasOpenedAgentsView: true')
    // densable 2.1.289: first fleet open Ae stamps hasOpenedAgentsView:!0 only
    expect(agentViewSrc).not.toMatch(/hasUsedAgentsFleet:\s*true/)
  })
})
