/**
 * Official 2.1.207: clear extensions.worktreeConfig after last sparse worktree.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'path'
import { hasRemainingClaudeLinkedWorktrees } from '../worktree.js'

const marker = join('.claude', 'worktrees')

describe('hasRemainingClaudeLinkedWorktrees (2.1.207)', () => {
  test('false when only main repo remains after remove', () => {
    const porcelain = [
      'worktree /repo',
      'HEAD abc',
      '',
      `worktree /repo/${marker}/gone`,
      'HEAD def',
      '',
    ].join('\n')
    expect(
      hasRemainingClaudeLinkedWorktrees(
        porcelain,
        `/repo/${marker}/gone`,
        marker,
      ),
    ).toBe(false)
  })

  test('true when another Claude worktree remains', () => {
    const porcelain = [
      'worktree /repo',
      '',
      `worktree /repo/${marker}/a`,
      '',
      `worktree /repo/${marker}/b`,
      '',
    ].join('\n')
    expect(
      hasRemainingClaudeLinkedWorktrees(porcelain, `/repo/${marker}/a`, marker),
    ).toBe(true)
  })

  test('ignores non-claude worktrees', () => {
    const porcelain = [
      'worktree /repo',
      '',
      'worktree /repo/other-worktree',
      '',
      `worktree /repo/${marker}/gone`,
      '',
    ].join('\n')
    expect(
      hasRemainingClaudeLinkedWorktrees(
        porcelain,
        `/repo/${marker}/gone`,
        marker,
      ),
    ).toBe(false)
  })
})
