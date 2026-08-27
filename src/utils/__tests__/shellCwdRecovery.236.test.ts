/**
 * densable 2.1.236 #4 — deleted-cwd recovery: fe>0 fail+reissue, fe===0 continue.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { shellCwdRecoveredReissueMessage } from '../Shell.js'

describe('densable shell cwd recovery copy (236 #4)', () => {
  test('fe>0 user copy matches official gold', () => {
    expect(
      shellCwdRecoveredReissueMessage('/tmp/gone-session', '/home/u'),
    ).toBe(
      'Working directory "/tmp/gone-session" was deleted; shell cwd recovered to "/home/u". Re-issue your command (it will run from the recovered directory).',
    )
  })

  test('Shell.ts fails the command only when recoveredIdx > 0', () => {
    const src = readFileSync(join(import.meta.dir, '../Shell.ts'), 'utf8')
    expect(src).toContain('shellCwdRecoveredReissueMessage(cwd, recovered)')
    expect(src).toContain('if (recoveredIdx > 0)')
    const idx = src.indexOf('if (recoveredIdx > 0)')
    const msg = src.indexOf('shellCwdRecoveredReissueMessage', idx)
    expect(msg).toBeGreaterThan(idx)
  })
})
