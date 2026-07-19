/**
 * densable Auo multiphase residual — H9e server-fallback-tombstone cancel
 * checkpoints at validate_input / permission / pre_call / call (+ entry via
 * buildToolUseCancelledUpdate).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

describe('toolExecution densable Auo multiphase cancel residual', () => {
  const src = readFileSync(join(import.meta.dir, '../toolExecution.ts'), 'utf8')

  test('buildToolUseCancelledUpdate helper densable Auo', () => {
    expect(src).toContain('function buildToolUseCancelledUpdate')
    expect(src).toContain("logEvent('tengu_tool_use_cancelled'")
    expect(src).toContain('classifyAbortKindForAnalytics')
    expect(src).toContain('phase:')
    expect(src).toContain('abortKind:')
  })

  test('entry phase uses shared Auo helper', () => {
    expect(src).toContain("phase: 'entry'")
    expect(src).toContain('buildToolUseCancelledUpdate')
  })

  test('validate_input phase after validateInput, H9e gated', () => {
    expect(src).toContain("phase: 'validate_input'")
    const vi = src.indexOf("phase: 'validate_input'")
    const window = src.slice(Math.max(0, vi - 300), vi + 80)
    expect(window).toContain('isServerFallbackTombstoneAbort')
  })

  test('permission phase on non-allow + H9e', () => {
    expect(src).toContain("phase: 'permission'")
    // densable: non-allow branch → H9e → Auo phase permission
    const allow = src.indexOf("permissionDecision.behavior !== 'allow'")
    const idx = src.indexOf("phase: 'permission'")
    expect(allow).toBeGreaterThan(-1)
    expect(idx).toBeGreaterThan(allow)
    expect(src).toContain('isServerFallbackTombstoneAbort')
    expect(src).toContain("'cancelled'")
    expect(src).toContain('server_fallback_tombstone')
    const window = src.slice(Math.max(0, idx - 500), idx + 40)
    expect(window).toContain('isServerFallbackTombstoneAbort')
    expect(window).toContain('buildToolUseCancelledUpdate')
  })

  test('pre_call phase after updatedInput handling', () => {
    expect(src).toContain("phase: 'pre_call'")
    const pre = src.indexOf("phase: 'pre_call'")
    const permUpdated = src.indexOf("'PERMISSION_UPDATED_INPUT'")
    expect(pre).toBeGreaterThan(permUpdated)
  })

  test('call phase on catch when H9e', () => {
    expect(src).toContain("phase: 'call'")
    expect(src).toContain('tombstoneDuringCall')
    expect(src).toContain('isServerFallbackTombstoneAbort')
    const call = src.indexOf("phase: 'call'")
    const tomb = src.indexOf('tombstoneDuringCall')
    expect(tomb).toBeGreaterThan(-1)
    expect(tomb).toBeLessThan(call)
  })

  test('imports isServerFallbackTombstoneAbort densable H9e', () => {
    expect(src).toContain('isServerFallbackTombstoneAbort')
    expect(src).toContain("from '../../utils/abortController.js'")
  })

  test('phase order entry < validate_input < permission < pre_call < call', () => {
    const e = src.indexOf("phase: 'entry'")
    const v = src.indexOf("phase: 'validate_input'")
    const p = src.indexOf("phase: 'permission'")
    const pre = src.indexOf("phase: 'pre_call'")
    const c = src.indexOf("phase: 'call'")
    expect(e).toBeGreaterThan(-1)
    expect(v).toBeGreaterThan(e)
    expect(p).toBeGreaterThan(v)
    expect(pre).toBeGreaterThan(p)
    expect(c).toBeGreaterThan(pre)
  })
})
