/**
 * densable 2.1.216 #14 — Agent list Ctrl+X×2 delete + tombstone so dead-worker
 * sessions do not reappear on refresh.
 *
 * densable gold:
 *   wL = useRef(new Set) — filter refresh: .filter(yl => !wL.current.has(yl.id))
 *   yte — full sessionId tombstone for attach/resume guards
 *   cO(id, justKilled, …) + Oc(null, 2000ms)
 *   R4e first X on active/blocked: stop action + arm justKilled; second X: delete
 *   FSS delete: optimistic remove + C2e force + finally release tombstone
 *   UI: "stopped · ctrl+x again to delete" / "ctrl+x again to delete · esc to keep"
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  buildFleetFooterHints,
  FLEET_DELETE_ARM_MS,
} from '../fleetView/helpers.js'

const ROOT = join(import.meta.dir, '..')

describe('agent list Ctrl+X delete tombstone (2.1.216 #14)', () => {
  test('FLEET_DELETE_ARM_MS is densable 2000', () => {
    expect(FLEET_DELETE_ARM_MS).toBe(2000)
  })

  test('footer justKilled / esc to keep strings', () => {
    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: true,
        ungroupPending: false,
        justKilled: true,
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toBe('stopped \u00b7 ctrl+x again to delete \u00b7 esc to keep')

    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: true,
        ungroupPending: false,
        justKilled: false,
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toBe('ctrl+x again to delete \u00b7 esc to keep')

    expect(
      buildFleetFooterHints({
        focusArea: 'list',
        viewMode: 'list',
        deletePending: true,
        ungroupPending: true,
        canPin: false,
        canGroup: false,
        canRename: false,
        openSlots: 0,
        exitArmed: false,
        runningCount: 0,
        helpOpen: false,
      }),
    ).toBe('ctrl+x again to ungroup')
  })

  test('AgentView wires densable wL tombstone + justKilled arm + force delete', () => {
    const src = readFileSync(join(ROOT, 'AgentView.tsx'), 'utf8')
    expect(src).toContain('deletedJobIdsRef')
    expect(src).toContain('deletedSessionIdsRef')
    expect(src).toContain('escCancelledDeleteIdsRef')
    expect(src).toContain('justKilledSessionId')
    expect(src).toContain('FLEET_DELETE_ARM_MS')
    expect(src).toContain('armDeleteConfirm')
    expect(src).toContain('tombstoneJob')
    expect(src).toContain('handleStopThenArmDelete')
    expect(src).toContain('deleteJob(short, { force: true })')
    expect(src).toContain('killJobConfirmed')
    // refresh filter
    expect(src).toContain('deletedJobIdsRef.current.has(short)')
    expect(src).toContain('deletedSessionIdsRef.current.has(s.sessionId)')
    // UI strings
    expect(src).toContain('stopped \\u00b7 ctrl+x again to delete')
    expect(src).toContain('isJustKilled')
    // densable active/blocked first X path
    expect(src).toMatch(/band === 'blocked' \|\| band === 'active'/)
  })

  test('helpers export FLEET_DELETE_ARM_MS and justKilled footer option', () => {
    const src = readFileSync(join(ROOT, 'fleetView/helpers.ts'), 'utf8')
    expect(src).toContain('export const FLEET_DELETE_ARM_MS = 2000')
    expect(src).toContain('justKilled?: boolean')
    expect(src).toContain('esc to keep')
  })
})
