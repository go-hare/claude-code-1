/**
 * densable 2.1.212 #42:
 * Task/Agent `mode` parameter is deprecated (ignored); subagents inherit the
 * parent session's permission mode by default. Agent frontmatter may override.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/** densable worker pool: agent.permissionMode ?? parentMode */
function resolveWorkerPoolMode(
  agentPermissionMode: string | undefined,
  parentMode: string,
): string {
  return agentPermissionMode ?? parentMode
}

/** densable teammate plan_mode_required:_==="plan" (parent mode, not input mode). */
function planModeRequiredFromParent(parentMode: string): boolean {
  return parentMode === 'plan'
}

describe('densable #42 Agent mode deprecated / inherit parent', () => {
  test('schema describe marks mode deprecated+ignored', () => {
    const src = readFileSync(join(import.meta.dir, '../AgentTool.tsx'), 'utf8')
    expect(src).toContain(
      "Deprecated; ignored. Subagents inherit the parent session's permission mode",
    )
  })

  test('call voids input mode and never uses spawnMode for plan_mode_required', () => {
    const src = readFileSync(join(import.meta.dir, '../AgentTool.tsx'), 'utf8')
    expect(src).toContain('_deprecatedSpawnMode')
    expect(src).toContain('void _deprecatedSpawnMode')
    expect(src).toContain("plan_mode_required: permissionMode === 'plan'")
    expect(src).not.toContain('spawnMode ===')
  })

  test('worker pool mode: frontmatter ?? parent (not acceptEdits hardcode)', () => {
    const src = readFileSync(join(import.meta.dir, '../AgentTool.tsx'), 'utf8')
    expect(src).toMatch(
      /mode:\s*selectedAgent\.permissionMode\s*\?\?\s*permissionMode/,
    )
    expect(src).not.toMatch(
      /selectedAgent\.permissionMode\s*\?\?\s*['"]acceptEdits['"]/,
    )
  })

  test('policy: parent auto + no frontmatter → auto', () => {
    expect(resolveWorkerPoolMode(undefined, 'auto')).toBe('auto')
  })

  test('policy: frontmatter dontAsk overrides parent bypassPermissions for pool', () => {
    // assembleToolPool uses this mode; runAgent still has parent-precedence
    // for live toolPermissionContext overrides.
    expect(resolveWorkerPoolMode('dontAsk', 'bypassPermissions')).toBe(
      'dontAsk',
    )
  })

  test('policy: plan_mode_required follows parent only', () => {
    expect(planModeRequiredFromParent('plan')).toBe(true)
    expect(planModeRequiredFromParent('default')).toBe(false)
    expect(planModeRequiredFromParent('acceptEdits')).toBe(false)
  })

  test('userFacingName does not tag deprecated mode', () => {
    const src = readFileSync(join(import.meta.dir, '../AgentTool.tsx'), 'utf8')
    // old tag pattern used i.mode — must not reappear
    expect(src).not.toMatch(/i\.mode\s*\?\s*`mode=/)
    expect(src).not.toMatch(/mode=\$\{i\.mode\}/)
  })
})
