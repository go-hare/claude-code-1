/**
 * Official 2.1.206/207: EnterWorktree path confirmation for outside managed trees.
 */
import { describe, expect, test } from 'bun:test'
import { resolve } from 'path'

/**
 * Mirrors the checkPermissions gate without loading the full tool graph.
 */
function pathPermissionDecision(
  input: { path?: string },
  opts: {
    managed: boolean
    cwd: string
  },
): {
  behavior: 'allow' | 'ask'
  decisionReason?: { type: string; classifierApprovable?: boolean }
} {
  if (!input.path) {
    return { behavior: 'allow' }
  }
  if (opts.managed) {
    return { behavior: 'allow' }
  }
  void resolve(opts.cwd, input.path)
  return {
    behavior: 'ask',
    decisionReason: {
      type: 'safetyCheck',
      classifierApprovable: false,
    },
  }
}

describe('EnterWorktree path permission (2.1.207)', () => {
  test('create path (no path) allows without safetyCheck', () => {
    const d = pathPermissionDecision({}, { managed: false, cwd: '/repo' })
    expect(d.behavior).toBe('allow')
    expect(d.decisionReason).toBeUndefined()
  })

  test('managed Claude worktree allows', () => {
    const d = pathPermissionDecision(
      { path: '/repo/.claude/worktrees/feat' },
      {
        managed: true,
        cwd: '/repo',
      },
    )
    expect(d.behavior).toBe('allow')
  })

  test('outside managed tree asks with non-classifier-approvable safetyCheck', () => {
    const d = pathPermissionDecision(
      { path: '/tmp/other-worktree' },
      { managed: false, cwd: '/repo' },
    )
    expect(d.behavior).toBe('ask')
    expect(d.decisionReason?.type).toBe('safetyCheck')
    expect(d.decisionReason?.classifierApprovable).toBe(false)
  })
})
