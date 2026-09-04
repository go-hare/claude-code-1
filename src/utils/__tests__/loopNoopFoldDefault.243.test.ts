import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, expect, test } from 'bun:test'

describe('loop noop-fold 243', () => {
  test('Cfr defaults ON (SEA dropped tengu_loop_noop_fold GB)', () => {
    const src = readFileSync(join(import.meta.dir, '../loopDynamic.ts'), 'utf8')
    expect(src).toContain("'tengu_loop_noop_fold', true")
    expect(src).not.toContain("'tengu_loop_noop_fold', false")
  })

  test('ScheduleWakeup prompt Cfr default matches loopDynamic', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/ScheduleWakeupTool/prompt.ts',
      ),
      'utf8',
    )
    expect(src).toContain("'tengu_loop_noop_fold', true")
  })
})
