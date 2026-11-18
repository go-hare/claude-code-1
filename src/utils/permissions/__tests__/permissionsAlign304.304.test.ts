import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { BAKED_AUTO_MODE_CONFIG } from '../autoModeFlags.js'

describe('2.1.304 permissions alignment (#959, #960, #961)', () => {
  test('#961: BAKED_AUTO_MODE_CONFIG includes envOnboarding: true and tagConnectorWrites: false', () => {
    expect(BAKED_AUTO_MODE_CONFIG.envOnboarding).toBe(true)
    expect(BAKED_AUTO_MODE_CONFIG.tagConnectorWrites).toBe(false)
  })

  test('#959 & #960: permissions.ts wires safeCheckIsReadOnly, getToolCheckApprover, and decider: person', () => {
    const src = readFileSync(
      join(import.meta.dir, '../permissions.ts'),
      'utf-8',
    )
    expect(src).toContain('function safeCheckIsReadOnly(')
    expect(src).toContain('tool.inputSchema?.safeParse?.(input)')
    expect(src).toContain('tool.isReadOnly(parsed.data)')
    expect(src).toContain('function getToolCheckApprover(')
    expect(src).toContain("decider === 'person'")
    expect(src).toContain('personOnly: true as const')
    expect(src).toContain('suppressAlwaysAllowRule: true')
  })
})
