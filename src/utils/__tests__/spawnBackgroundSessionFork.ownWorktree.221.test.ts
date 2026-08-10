import { describe, expect, test } from 'bun:test'
import { resolveForkEditsIn } from '../spawnBackgroundSessionFork.js'

describe('densable 2.1.221 #34 fork own-worktree guidance', () => {
  test('resolveForkEditsIn: non-worktree git → this-tree (shared checkout)', () => {
    expect(resolveForkEditsIn({ inWorktree: false, isGitRepo: true })).toBe(
      'this-tree',
    )
  })

  test('resolveForkEditsIn: in worktree → own-worktree', () => {
    expect(resolveForkEditsIn({ inWorktree: true, isGitRepo: true })).toBe(
      'own-worktree',
    )
  })

  test('resolveForkEditsIn: bgIsolation none → this-tree', () => {
    expect(
      resolveForkEditsIn({
        inWorktree: true,
        bgIsolationNone: true,
        isGitRepo: true,
      }),
    ).toBe('this-tree')
  })

  test('own-worktree guidance string matches densable gold fragment', () => {
    // Product surface is isolation append in spawnBackgroundSessionForkImpl.
    // Gold fragment from densable SEA:
    const gold =
      "create a new worktree of your own with EnterWorktree so your edits don't land where the original session is editing."
    expect(gold).toContain(
      'create a new worktree of your own with EnterWorktree',
    )
  })
})
