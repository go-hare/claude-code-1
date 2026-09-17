/**
 * densable 2.1.246 #16 — official FMs ephemeral slug list.
 *
 * Official:
 *   FMs=[/^agent-a[0-9a-f]{16}$/, /^agent-a[0-9a-f]{7}$/,
 *        /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/, /^wf-\d+$/,
 *        /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/,
 *        /^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
 *        /^bg-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/]
 *
 * User-named EnterWorktree slugs (wf-myfeature, feature) still miss.
 *
 * Slu / vjr / xMs / $jr / zr: reapJobWorktree.246.test.ts.
 * Do not wire Slu into cleanupStaleAgentWorktrees.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const src = readFileSync(join(import.meta.dir, '../worktree.ts'), 'utf8')

const FMs = [
  /^agent-a[0-9a-f]{16}$/,
  /^agent-a[0-9a-f]{7}$/,
  /^wf_[0-9a-f]{8}-[0-9a-f]{3}-\d+$/,
  /^wf-\d+$/,
  /^bridge-[A-Za-z0-9_]+(-[A-Za-z0-9_]+)*$/,
  /^job-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
  /^bg-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/,
]

function isEphemeral(slug: string): boolean {
  return FMs.some(p => p.test(slug))
}

describe('worktree ephemeral slugs (2.1.246 FMs)', () => {
  test('source-locks official FMs extras', () => {
    expect(src).toContain('/^agent-a[0-9a-f]{16}$/')
    expect(src).toContain('/^agent-a[0-9a-f]{7}$/')
    expect(src).toContain('/^bg-[a-zA-Z0-9._-]{1,55}-[0-9a-f]{8}$/')
    expect(src).toContain('cleanupStaleAgentWorktrees')
    expect(src).toContain('reapJobWorktreeIfSafe')
    expect(src).toContain('resetResumedWorktreeIfFullyUpstream')
    expect(src).toContain('CLAUDE_BASE')
    const blu = src.indexOf('export async function cleanupStaleAgentWorktrees(')
    expect(src.slice(blu)).not.toContain('reapJobWorktreeIfSafe(')
    expect(src.slice(blu)).toContain('isJobWorktreeSafeToReap(')
    expect(src.slice(blu)).toContain('releaseStaleClaudeWorktreeLocks(')
    expect(src.slice(blu)).toContain('restoreWorktreeConfigExtension(')
    expect(src.slice(blu)).toContain("'stale_cleanup'")
    expect(src).toContain('removeAgentWorktreeWithoutGitRoot(')
    expect(src).toContain('isWorktreePathRemovable(')
    expect(src).toContain('findWorktreePathSymlinkComponent(')
    expect(src).toContain('hasWorktreeRemoveHook()')
    expect(src).toContain('async function deleteWorktreeBranch(')
    expect(src).toContain('teardownFailedWorktreeCreate(')
    expect(src).toContain('isProcessGone(')
  })

  test('official ephemeral slugs match; user EnterWorktree slugs do not', () => {
    expect(isEphemeral(`agent-a${'a'.repeat(16)}`)).toBe(true)
    expect(isEphemeral('agent-a1b2c3d4')).toBe(true)
    expect(isEphemeral('wf_deadbeef-abc-1')).toBe(true)
    expect(isEphemeral('wf-3')).toBe(true)
    expect(isEphemeral('bridge-session_id')).toBe(true)
    expect(isEphemeral('job-template.v1-abcd1234')).toBe(true)
    expect(isEphemeral('bg-my-session-abcd1234')).toBe(true)
    expect(isEphemeral('wf-myfeature')).toBe(false)
    expect(isEphemeral('feature')).toBe(false)
    expect(isEphemeral('my-worktree')).toBe(false)
  })
})
