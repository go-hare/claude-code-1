import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { hasOwnWorkKeepaliveReason } from '../agentToolUtils.js'

describe('Round 3 Fix 4: BH3-P0-2 keepaliveReasons Set iteration on SubagentHandback follow-up', () => {
  test('handles Set<string> without throwing TypeError', () => {
    expect(hasOwnWorkKeepaliveReason(new Set(['bash:b1']))).toBe(true)
    expect(hasOwnWorkKeepaliveReason(new Set(['workflow:w1']))).toBe(true)
    expect(hasOwnWorkKeepaliveReason(new Set(['monitor:m1']))).toBe(true)
    expect(hasOwnWorkKeepaliveReason(new Set(['agent:child-1']))).toBe(false)
    expect(hasOwnWorkKeepaliveReason(new Set())).toBe(false)
    expect(hasOwnWorkKeepaliveReason(undefined)).toBe(false)
  })

  test('agentToolUtils.ts does not cast keepaliveReasons as string[] or call .some() on it', () => {
    const src = readFileSync(
      join(import.meta.dir, '../agentToolUtils.ts'),
      'utf8',
    )
    expect(src).not.toContain('keepaliveReasons?: string[]')
    expect(src).not.toContain('liveTaskBeforeFinalize.keepaliveReasons ?? []')
    expect(src).toContain('hasOwnWorkKeepaliveReason(')
  })
})
