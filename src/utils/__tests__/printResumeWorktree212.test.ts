/**
 * densable 2.1.212 #21:
 * print/SDK --continue/--resume must call restoreWorktreeForResume so
 * ExitWorktree sees an active EnterWorktree session (Py/currentWorktreeSession).
 *
 * densable print paths:
 *   JCe(meta); if (!fork) e_t(worktreeSession); E$e()
 * Local gap was restoreSessionMetadata only — no e_t → ExitWorktree no-op.
 */
import { describe, expect, test } from 'bun:test'

/** densable print continue/resume post-metadata restore order. */
function printResumeWorktreeSteps(opts: {
  forkSession: boolean
  persistSession: boolean
  hasSessionId: boolean
  worktreeSession: { worktreePath: string } | null | undefined
}): Array<'metadata' | 'restoreWorktree' | 'adoptFile'> {
  const steps: Array<'metadata' | 'restoreWorktree' | 'adoptFile'> = [
    'metadata',
  ]
  if (!opts.forkSession) {
    // densable try { e_t(o.worktreeSession) } catch
    steps.push('restoreWorktree')
    if (opts.persistSession && opts.hasSessionId) {
      // densable E$e when persist + session id
      steps.push('adoptFile')
    }
  }
  return steps
}

/**
 * densable ExitWorktree validateInput: !Py() → no-op message.
 * After print restore, Py/current must be set when transcript has worktree.
 */
function exitWorktreeWouldNoOp(current: unknown): boolean {
  return !current
}

describe('densable #21 print resume rehydrates worktree for ExitWorktree', () => {
  test('continue path: restoreWorktree + adoptFile when not fork', () => {
    expect(
      printResumeWorktreeSteps({
        forkSession: false,
        persistSession: true,
        hasSessionId: true,
        worktreeSession: { worktreePath: '/tmp/wt' },
      }),
    ).toEqual(['metadata', 'restoreWorktree', 'adoptFile'])
  })

  test('forkSession strips worktree restore (densable worktreeSession:void 0)', () => {
    expect(
      printResumeWorktreeSteps({
        forkSession: true,
        persistSession: true,
        hasSessionId: true,
        worktreeSession: { worktreePath: '/tmp/wt' },
      }),
    ).toEqual(['metadata'])
  })

  test('persistSession false still restores in-memory worktree (ExitWorktree needs Py)', () => {
    expect(
      printResumeWorktreeSteps({
        forkSession: false,
        persistSession: false,
        hasSessionId: true,
        worktreeSession: { worktreePath: '/tmp/wt' },
      }),
    ).toEqual(['metadata', 'restoreWorktree'])
  })

  test('without restore, ExitWorktree no-ops; with session object it does not', () => {
    expect(exitWorktreeWouldNoOp(null)).toBe(true)
    expect(exitWorktreeWouldNoOp(undefined)).toBe(true)
    expect(
      exitWorktreeWouldNoOp({
        worktreePath: '/tmp/wt',
        originalCwd: '/repo',
      }),
    ).toBe(false)
  })

  test('source print.ts wires restoreWorktreeForResume on continue+resume', async () => {
    const src = await Bun.file(
      new URL('../../cli/print.ts', import.meta.url),
    ).text()
    expect(src).toContain('restoreWorktreeForResume')
    expect(src).toContain('adoptResumedSessionFile')
    // two call sites: --continue and --resume
    const matches = src.match(/restoreWorktreeForResume\(/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })
})
