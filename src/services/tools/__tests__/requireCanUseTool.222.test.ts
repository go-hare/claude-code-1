/**
 * densable 2.1.222 #2 — PreToolUse auto-allow must not bypass bg agent
 * canUseTool restrictions (summaries / compaction / renames).
 * SEA: O3 requireCanUseTool:i?.requireCanUseTool??!0 + pdn gate.
 *
 * Pure helpers + source wire-up checks (avoid heavy forkedAgent import graph).
 */
import { describe, expect, mock, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * densable pdn fragment: when hook returns allow and requireCanUseTool is set,
 * must still call canUseTool (not return hook allow).
 */
async function resolveAllowGate(opts: {
  requireCanUseTool?: boolean
  requiresUserInteraction?: boolean
  interactionSatisfied?: boolean
  ruleCheck: 'null' | 'deny' | 'ask'
  canUseTool: () => Promise<'allow' | 'deny' | 'ask'>
}): Promise<'hook-allow' | 'canUseTool' | 'rule-deny' | 'rule-ask-pipeline'> {
  const requiresInteraction = opts.requiresUserInteraction ?? false
  const interactionSatisfied = opts.interactionSatisfied ?? false
  const requireCanUseTool = opts.requireCanUseTool

  if ((requiresInteraction && !interactionSatisfied) || requireCanUseTool) {
    await opts.canUseTool()
    return 'canUseTool'
  }
  if (opts.ruleCheck === 'null') return 'hook-allow'
  if (opts.ruleCheck === 'deny') return 'rule-deny'
  return 'rule-ask-pipeline'
}

/**
 * densable O3: requireCanUseTool:i?.requireCanUseTool??!0
 * Applied when building createSubagentContext overrides in runForkedAgent.
 */
function o3RequireCanUseTool(override?: boolean): boolean {
  return override ?? true
}

describe('pdn requireCanUseTool gate (densable 2.1.222 #2)', () => {
  test('hook allow without requireCanUseTool → hook-allow (bypass prompt)', async () => {
    const canUseTool = mock(async () => 'deny' as const)
    const path = await resolveAllowGate({
      requireCanUseTool: false,
      ruleCheck: 'null',
      canUseTool,
    })
    expect(path).toBe('hook-allow')
    expect(canUseTool).not.toHaveBeenCalled()
  })

  test('hook allow WITH requireCanUseTool → canUseTool (bg gate)', async () => {
    const canUseTool = mock(async () => 'deny' as const)
    const path = await resolveAllowGate({
      requireCanUseTool: true,
      ruleCheck: 'null',
      canUseTool,
    })
    expect(path).toBe('canUseTool')
    expect(canUseTool).toHaveBeenCalled()
  })

  test('requireCanUseTool wins even when ruleCheck would be null', async () => {
    const canUseTool = mock(async () => 'deny' as const)
    const path = await resolveAllowGate({
      requireCanUseTool: true,
      ruleCheck: 'null',
      canUseTool,
    })
    expect(path).toBe('canUseTool')
  })
})

describe('O3 runForkedAgent default (densable 2.1.222 #2)', () => {
  test('?? !0 → true when override omitted', () => {
    expect(o3RequireCanUseTool(undefined)).toBe(true)
  })

  test('explicit false still honors override', () => {
    expect(o3RequireCanUseTool(false)).toBe(false)
  })

  test('explicit true stays true', () => {
    expect(o3RequireCanUseTool(true)).toBe(true)
  })

  test('wire-up: runForkedAgent defaults requireCanUseTool to true', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../../utils/forkedAgent.ts'),
      'utf8',
    )
    expect(src).toContain(
      'requireCanUseTool: overrides?.requireCanUseTool ?? true',
    )
    // createSubagentContext remains pass-through (no invented default inside iMo)
    expect(src).toMatch(
      /requireCanUseTool:\s*overrides\?\.requireCanUseTool,?\s*\n/,
    )
  })

  test('wire-up: resolveHookPermissionDecision gates on requireCanUseTool', () => {
    const src = readFileSync(join(import.meta.dir, '../toolHooks.ts'), 'utf8')
    expect(src).toContain('toolUseContext.requireCanUseTool')
    expect(src).toContain(
      'Hook approved tool use for ${tool.name}, but canUseTool is required',
    )
  })
})
