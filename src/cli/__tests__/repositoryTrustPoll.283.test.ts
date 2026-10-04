/**
 * densable 2.1.283 g7r/Ztr/f7r/u7r/mVt source-lock.
 *
 * Gold SEA `/tmp/official-283/package/claude`:
 * - `Ztr` @200266163
 * - `g7r` @200266839
 * - `f7r` @200266544
 * - `u7r` @200266196
 * - `mVt` @200266252
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

const body = readFileSync(join(import.meta.dir, '../cloudSession.ts'), 'utf8')

describe('repositoryTrustPoll 283 g7r/Ztr BODY', () => {
  test('source-lock config:repo-trusted, repository_trust_required, 30000', () => {
    expect(body).toContain('config:repo-trusted')
    expect(body).toContain('repository_trust_required')
    expect(body).toContain('30000')
    expect(body).toContain('parseRepositoryTrustToolError')
    expect(body).toContain('repositoryTrustVisible')
    expect(body).toContain('repositoryTrustFromSession')
    expect(body).toContain('startRepositoryTrustPoll')
    expect(body).toContain('repositoryTrustFromSession(s)')
  })

  test('Ztr/f7r/u7r/mVt/g7r wrap', async () => {
    const {
      repositoryTrustFromTags,
      repositoryTrustFromSession,
      repositoryTrustNeedsDecision,
      repositoryTrustVisible,
      parseRepositoryTrustToolError,
      coalescedSessionPoll,
      REPO_TRUST_POLL_MS,
    } = await import('../cloudSession.js')
    expect(repositoryTrustFromTags(['config:repo-trusted'])).toBe('trusted')
    expect(repositoryTrustFromTags(['config:no-git-repo'])).toBe(
      'no_repository',
    )
    expect(repositoryTrustFromTags(['config:repo-trust-declined'])).toBe(
      'declined',
    )
    expect(repositoryTrustFromTags([])).toBe('not_marked')
    expect(repositoryTrustFromSession({ tags: ['config:repo-trusted'] })).toBe(
      'trusted',
    )
    expect(repositoryTrustNeedsDecision('not_marked')).toBe(true)
    expect(repositoryTrustNeedsDecision('declined')).toBe(true)
    expect(repositoryTrustNeedsDecision('trusted')).toBe(false)
    expect(repositoryTrustVisible('not_marked', false)).toBeUndefined()
    expect(repositoryTrustVisible('not_marked', true)).toBe('not_marked')
    expect(repositoryTrustVisible('trusted', false)).toBe('trusted')
    expect(
      parseRepositoryTrustToolError(
        'request_computer_folder: [repository_trust_required]',
      ),
    ).toBe('required')
    expect(
      parseRepositoryTrustToolError(
        '<tool_use_error> request_computer_folder: [repository_trust_declined]',
      ),
    ).toBe('declined')
    expect(
      parseRepositoryTrustToolError(
        'request_computer_folder: [repository_trust_unavailable]',
      ),
    ).toBe('unavailable')
    expect(parseRepositoryTrustToolError('nope')).toBeUndefined()
    expect(REPO_TRUST_POLL_MS).toBe(30000)
    let reads = 0
    const poll = coalescedSessionPoll({
      read: async () => {
        reads += 1
        return reads
      },
      now: () => 0,
    })
    expect(await poll.refresh()).toBe(1)
    expect(await poll.refresh()).toBe(1)
    expect(reads).toBe(1)
  })
})
