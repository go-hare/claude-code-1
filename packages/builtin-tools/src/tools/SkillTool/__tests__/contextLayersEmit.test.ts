/**
 * densable SkillTool contextLayers residual — emit allowed_tools / model / effort
 * alongside contextModifier (behavior only).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  applyContextLayers,
  applyPermissionLayers,
  resolveEffortValue,
  resolveMainLoopModel,
  type ContextLayer,
} from 'src/utils/contextLayers.js'

describe('SkillTool densable contextLayers emit', () => {
  test('source emits allowed_tools / model / effort layers', () => {
    const src = readFileSync(
      join(import.meta.dir, '../SkillTool.ts'),
      'utf8',
    )
    expect(src).toContain("kind: 'allowed_tools'")
    expect(src).toContain("kind: 'model'")
    expect(src).toContain("kind: 'effort'")
    expect(src).toContain('contextLayers')
    expect(src).toContain('contextModifier')
  })

  test('emitted layers fold via Ter + Tn + P_/X$', () => {
    const layers: ContextLayer[] = [
      { kind: 'allowed_tools', allowedTools: ['Bash', 'Read'] },
      { kind: 'model', mainLoopModel: 'opus' },
      { kind: 'effort', effort: 'high' },
    ]
    const base = {
      options: {
        mainLoopModel: 'sonnet',
        thinkingConfig: { type: 'disabled' as const },
      },
      permissionLayers: undefined as ContextLayer[] | undefined,
      getAppState: () => ({ effortValue: 'medium' as const }),
    }
    const afterTer = applyContextLayers(base, layers)
    expect(afterTer.options.mainLoopModel).toBe('opus')
    expect(afterTer.permissionLayers).toEqual(layers)

    const perm = applyPermissionLayers(
      {
        mode: 'default',
        additionalWorkingDirectories: new Map(),
        alwaysAllowRules: {},
        alwaysDenyRules: {},
        alwaysAskRules: {},
        isBypassPermissionsModeAvailable: true,
      },
      afterTer.permissionLayers,
    )
    expect(perm.alwaysAllowRules.command).toEqual(['Bash', 'Read'])

    // densable P_ / X$ on stacked layers (Skill emit residual)
    expect(resolveMainLoopModel(afterTer)).toBe('opus')
    expect(
      resolveEffortValue({
        permissionLayers: afterTer.permissionLayers,
        getAppState: () => ({ effortValue: 'medium' }),
      }),
    ).toBe('high')
  })
})
