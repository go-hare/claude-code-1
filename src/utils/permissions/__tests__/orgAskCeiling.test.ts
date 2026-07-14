/**
 * Official 2.1.x: mcpInfo.effectiveMaxPermission org ceiling.
 * Pure mirrors of the permission + tool-list gates (no process-global mocks).
 */
import { describe, expect, test } from 'bun:test'

type EffectiveMax = 'allow' | 'ask' | 'blocked' | undefined

/**
 * Mirrors permissions.ts org_ask_ceiling gate:
 * when effectiveMaxPermission === 'ask', force interactive ask.
 */
function shouldForceOrgAsk(effectiveMaxPermission: EffectiveMax): boolean {
  return effectiveMaxPermission === 'ask'
}

/**
 * Mirrors auto-mode floor: org_ask_ceiling keeps ask (no classifier approve).
 */
function shouldKeepOrgAskFloor(
  mode: 'auto' | 'default' | 'plan',
  effectiveMaxPermission: EffectiveMax,
): boolean {
  if (mode !== 'auto' && mode !== 'plan') return false
  return effectiveMaxPermission === 'ask'
}

/**
 * Mirrors tools.ts filterToolsByDenyRules blocked strip.
 */
function isVisibleToModel(effectiveMaxPermission: EffectiveMax): boolean {
  return effectiveMaxPermission !== 'blocked'
}

/**
 * Official Pvf: only non-allow org_max_permission entries enter toolPermissions.
 */
function buildToolPermissions(
  tools: Array<{ name: string; org_max_permission?: EffectiveMax }>,
): Record<string, 'ask' | 'blocked'> | undefined {
  const out: Record<string, 'ask' | 'blocked'> = {}
  for (const t of tools) {
    if (t.org_max_permission === 'ask' || t.org_max_permission === 'blocked') {
      out[t.name] = t.org_max_permission
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

describe('org_ask_ceiling gate', () => {
  test('ask ceiling forces interactive ask', () => {
    expect(shouldForceOrgAsk('ask')).toBe(true)
    expect(shouldForceOrgAsk('allow')).toBe(false)
    expect(shouldForceOrgAsk('blocked')).toBe(false)
    expect(shouldForceOrgAsk(undefined)).toBe(false)
  })

  test('auto/plan keep ask floor for org ceiling', () => {
    expect(shouldKeepOrgAskFloor('auto', 'ask')).toBe(true)
    expect(shouldKeepOrgAskFloor('plan', 'ask')).toBe(true)
    expect(shouldKeepOrgAskFloor('default', 'ask')).toBe(false)
    expect(shouldKeepOrgAskFloor('auto', undefined)).toBe(false)
  })
})

describe('blocked effectiveMaxPermission', () => {
  test('blocked tools are not model-visible', () => {
    expect(isVisibleToModel('blocked')).toBe(false)
    expect(isVisibleToModel('ask')).toBe(true)
    expect(isVisibleToModel('allow')).toBe(true)
    expect(isVisibleToModel(undefined)).toBe(true)
  })
})

describe('toolPermissions builder (Pvf)', () => {
  test('drops allow and empty maps', () => {
    expect(
      buildToolPermissions([
        { name: 'a', org_max_permission: 'allow' },
        { name: 'b' },
      ]),
    ).toBeUndefined()
  })

  test('keeps ask and blocked', () => {
    expect(
      buildToolPermissions([
        { name: 'send', org_max_permission: 'ask' },
        { name: 'delete', org_max_permission: 'blocked' },
        { name: 'read', org_max_permission: 'allow' },
      ]),
    ).toEqual({ send: 'ask', delete: 'blocked' })
  })
})
