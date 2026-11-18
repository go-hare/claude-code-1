import { describe, expect, test } from 'bun:test'
import {
  isGitCommitCommand,
  resolveGitCommitCwd,
  resolveGitCommitIdForTelemetry,
} from '../toolExecution.js'

describe('v2.1.296 #529 — git_commit_id telemetry for git commit -q and git -C <dir> commit', () => {
  test('isGitCommitCommand matches git commit, git -C <dir> commit, and git -c k=v commit', () => {
    expect(isGitCommitCommand('git commit -m "hi"')).toBe(true)
    expect(isGitCommitCommand('git -C /tmp/repo commit -q -m "hi"')).toBe(true)
    expect(isGitCommitCommand('git -c user.name=bot commit -m "hi"')).toBe(true)
    expect(isGitCommitCommand('git status')).toBe(false)
  })

  test('resolveGitCommitCwd resolves -C <dir> relative to baseCwd', () => {
    expect(resolveGitCommitCwd('git commit -m "x"', '/repo')).toBe('/repo')
    expect(resolveGitCommitCwd('git -C sub/pkg commit -m "x"', '/repo')).toBe(
      '/repo/sub/pkg',
    )
    expect(resolveGitCommitCwd('git -C "/abs/other" commit', '/repo')).toBe(
      '/abs/other',
    )
  })

  test('resolveGitCommitIdForTelemetry falls back to HEAD SHA on git commit -q with empty stdout', async () => {
    const seenCwds: string[] = []
    const fullSha = '0123456789abcdef0123456789abcdef01234567'
    const sha = await resolveGitCommitIdForTelemetry(
      'git -C sub/repo commit -q -m "quiet"',
      '',
      '/workspace',
      false,
      async cwd => {
        seenCwds.push(cwd)
        return fullSha
      },
    )
    expect(seenCwds).toEqual(['/workspace/sub/repo'])
    expect(sha).toBe(fullSha)
  })

  test('resolveGitCommitIdForTelemetry expands short stdout SHA to full HEAD SHA when prefix matches', async () => {
    const fullSha = 'abcdef1234567890abcdef1234567890abcdef12'
    const sha = await resolveGitCommitIdForTelemetry(
      'git commit -m "msg"',
      '[main abcdef1] msg\n',
      '/workspace',
      false,
      async () => fullSha,
    )
    expect(sha).toBe(fullSha)
  })

  test('resolveGitCommitIdForTelemetry skips HEAD fallback when backgrounded or interrupted', async () => {
    let called = false
    const sha = await resolveGitCommitIdForTelemetry(
      'git commit -q -m "msg"',
      '',
      '/workspace',
      true,
      async () => {
        called = true
        return 'deadbeef'
      },
    )
    expect(called).toBe(false)
    expect(sha).toBeUndefined()
  })
})
