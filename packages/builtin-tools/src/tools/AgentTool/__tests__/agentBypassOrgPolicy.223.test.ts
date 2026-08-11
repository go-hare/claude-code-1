/**
 * densable 2.1.223 #7 — agent definition bypassPermissions honors org disable
 * Source-contract: runAgent gates agentPermissionMode === 'bypassPermissions'
 * with isBypassPermissionsModeDisabled() || !isBypassPermissionsModeAvailable.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(import.meta.dir, '../../../../../../')

describe('densable 2.1.223 agent bypassPermissions org policy', () => {
  test('runAgent gates agent bypassPermissions on policy + availability', () => {
    const src = readFileSync(
      join(ROOT, 'packages/builtin-tools/src/tools/AgentTool/runAgent.ts'),
      'utf8',
    ).replace(/\r\n/g, '\n')
    expect(src).toContain('isBypassPermissionsModeDisabled')
    expect(src).toContain("agentPermissionMode === 'bypassPermissions'")
    expect(src).toContain(
      '!state.toolPermissionContext.isBypassPermissionsModeAvailable',
    )
    expect(src).toContain(
      'Subagent declared permissionMode: bypassPermissions but this session is not running in a contained no-internet environment (or bypass is policy-disabled); keeping parent mode',
    )
  })
})
