/**
 * Structural source guard + pure densable a$f fold for mcp_set_servers.
 * toScopedConfig is module-local in print.ts; re-implement densable a$f here
 * and assert print.ts contains uUt fold.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

function toolPermissionsFromSetServersTools(
  tools:
    | ReadonlyArray<{
        name: string
        org_max_permission?: 'allow' | 'ask' | 'blocked' | string
      }>
    | undefined,
): Record<string, 'allow' | 'ask' | 'blocked'> | undefined {
  if (!tools?.length) return undefined
  // Mirror print.ts: null-proto so `constructor` is an own string key.
  const out = Object.create(null) as Record<string, 'allow' | 'ask' | 'blocked'>
  for (const t of tools) {
    if (!t.org_max_permission || t.org_max_permission === 'allow') continue
    if (t.org_max_permission === 'ask' || t.org_max_permission === 'blocked') {
      out[t.name] = t.org_max_permission
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

describe('densable a$f toolPermissionsFromSetServersTools', () => {
  test('skips allow; keeps ask/blocked', () => {
    expect(
      toolPermissionsFromSetServersTools([
        { name: 'a', org_max_permission: 'allow' },
        { name: 'b', org_max_permission: 'ask' },
        { name: 'c', org_max_permission: 'blocked' },
      ]),
    ).toEqual({ b: 'ask', c: 'blocked' })
  })

  test('empty when only allow', () => {
    expect(
      toolPermissionsFromSetServersTools([
        { name: 'a', org_max_permission: 'allow' },
      ]),
    ).toBeUndefined()
  })

  test('prototype-key tool names are own keys (221 #10)', () => {
    const map = toolPermissionsFromSetServersTools([
      { name: 'constructor', org_max_permission: 'blocked' },
      { name: 'toString', org_max_permission: 'ask' },
    ])
    expect(map).toBeDefined()
    expect(Object.getPrototypeOf(map)).toBe(null)
    expect(Object.hasOwn(map!, 'constructor')).toBe(true)
    expect(map!['constructor']).toBe('blocked')
    expect(map!['toString']).toBe('ask')
    expect(typeof map!['constructor']).toBe('string')
  })
})

describe('print.ts toScopedConfig densable uUt fold', () => {
  test('source folds tools org_max_permission into toolPermissions', () => {
    const src = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(src).toContain('toolPermissionsFromSetServersTools')
    expect(src).toContain('org_max_permission')
    expect(src).toContain("rec.type === 'http' || rec.type === 'sse'")
    expect(src).toContain("scope: 'dynamic'")
    // densable a$f wins: fromTools ?? existing (no merge that lets peer lower blocked)
    expect(src).toContain('const toolPermissions = fromTools ?? existing')
    // densable hpi/Ryl seed into toolPermissionContext
    expect(src).toContain('permissionPoliciesFromDynamicMcpConfigs')
    expect(src).toContain('withMcpServerPolicyRules')
    expect(src).toContain('mcpServerPolicy')
  })
})

describe('densable hpi permissionPoliciesFromDynamicMcpConfigs', () => {
  test('always_deny wins over always_allow; fq mcp names', async () => {
    const { permissionPoliciesFromDynamicMcpConfigs } = await import(
      '../print.js'
    )
    const r = permissionPoliciesFromDynamicMcpConfigs({
      a: {
        type: 'http',
        tools: [
          { name: 'rm', permission_policy: 'always_deny' },
          { name: 'read', permission_policy: 'always_allow' },
        ],
      },
      b: {
        type: 'sse',
        tools: [
          // stricter wins for same fq name when server+tool normalize collide — use different tools
          { name: 'write', permission_policy: 'always_ask' },
        ],
      },
    })
    expect(r.deny.some(n => n.endsWith('rm'))).toBe(true)
    expect(r.allow.some(n => n.endsWith('read'))).toBe(true)
    expect(r.ask.some(n => n.endsWith('write'))).toBe(true)
  })
})
