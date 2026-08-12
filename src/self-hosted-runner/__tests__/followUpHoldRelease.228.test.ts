/**
 * densable 2.1.228 #7 hold-release wiring:
 * - dispose notifies busy callback when handlers provided
 * - rootRunner honors childExited force-release even if liveBgTasks>0
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = readFileSync(join(import.meta.dir, '../rootRunner.ts'), 'utf8')
const handler = readFileSync(
  join(import.meta.dir, '../sessionHandler.ts'),
  'utf8',
)
const activity = readFileSync(
  join(import.meta.dir, '../sessionActivity.ts'),
  'utf8',
)

describe('densable 2.1.228 #7 follow-up hold release wiring', () => {
  test('rootRunner onBgResultFollowUpBusy force-clears on childExited or busy=false', () => {
    expect(root).toContain('onBgResultFollowUpBusy: (busy, childExited)')
    expect(root).toContain('childExited === true')
    // busy=false clears hold without requiring liveBgTasks===0 (stale ledger)
    expect(root).toContain('busy === false')
    expect(root).toContain('stale ledger')
  })

  test('sessionHandler finish uses dispose with child exited (no duplicate hand-clear)', () => {
    expect(handler).toContain('disposeActivityPipeState(')
    expect(handler).toContain("'child exited'")
    // must not still hand-clear before dispose (converged)
    const finishSlice = handler.slice(
      handler.indexOf('const finish = (result: SessionChildResult)'),
      handler.indexOf('const finish = (result: SessionChildResult)') + 1200,
    )
    expect(finishSlice).toContain('disposeActivityPipeState')
    expect(finishSlice).toContain('child exited')
    // the old double path set flag false then dispose — ensure single dispose call
    expect(finishSlice.match(/disposeActivityPipeState/g)?.length).toBe(1)
  })

  test('disposeActivityPipeState accepts handlers + childExited', () => {
    expect(activity).toContain('export function disposeActivityPipeState(')
    expect(activity).toMatch(
      /disposeActivityPipeState\(\s*state: ActivityPipeState,\s*handlers\?: ActivityHandlers/,
    )
    expect(activity).toContain('clearFollowUpHold(state, handlers, reason')
  })
})
