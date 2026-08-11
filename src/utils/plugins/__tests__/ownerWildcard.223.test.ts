/**
 * densable 2.1.223 #1 — owner/* marketplace policy wildcards (F4u/MEo/B4u/U4u/DEo)
 */
import { describe, expect, test } from 'bun:test'
import {
  githubRepoPolicyMatches,
  isValidGithubNameSegment,
  normalizeGithubRepoPath,
  parseOwnerWildcardRepo,
} from '../marketplaceHelpers.js'

describe('densable 2.1.223 owner/* marketplace wildcards', () => {
  test('MEo rejects invalid name segments', () => {
    expect(isValidGithubNameSegment('anthropics')).toBe(true)
    expect(isValidGithubNameSegment('a.b_c-1')).toBe(true)
    expect(isValidGithubNameSegment('-leading')).toBe(false)
    expect(isValidGithubNameSegment('.')).toBe(false)
    expect(isValidGithubNameSegment('..')).toBe(false)
    expect(isValidGithubNameSegment('has/slash')).toBe(false)
  })

  test('B4u parses only valid owner/*', () => {
    expect(parseOwnerWildcardRepo('anthropics/*')).toBe('anthropics')
    expect(parseOwnerWildcardRepo('Anthropics/*')).toBe('Anthropics')
    expect(parseOwnerWildcardRepo('owner/repo')).toBeNull()
    expect(parseOwnerWildcardRepo('*/*')).toBeNull()
    expect(parseOwnerWildcardRepo('foo*')).toBeNull()
    expect(parseOwnerWildcardRepo('/*')).toBeNull()
  })

  test('U4u normalizes path / strips .git', () => {
    expect(normalizeGithubRepoPath('owner/repo.git')).toBe('owner/repo')
    expect(normalizeGithubRepoPath('owner//repo')).toBe('owner/repo')
    expect(normalizeGithubRepoPath('owner/./repo')).toBe('owner/repo')
    expect(normalizeGithubRepoPath('owner/foo/../repo')).toBe('owner/repo')
  })

  test('DEo matches every repo under owner (case-insensitive owner)', () => {
    expect(
      githubRepoPolicyMatches('anthropics/*', 'anthropics/claude-code'),
    ).toBe(true)
    expect(githubRepoPolicyMatches('Anthropics/*', 'anthropics/plugins')).toBe(
      true,
    )
    expect(githubRepoPolicyMatches('anthropics/*', 'other/claude-code')).toBe(
      false,
    )
    expect(githubRepoPolicyMatches('anthropics/*', 'anthropics/too/many')).toBe(
      false,
    )
  })

  test('DEo falls back to literal match for non-wildcard / invalid wildcard', () => {
    expect(
      githubRepoPolicyMatches(
        'anthropics/claude-code',
        'anthropics/claude-code',
      ),
    ).toBe(true)
    expect(
      githubRepoPolicyMatches('anthropics/claude-code', 'anthropics/other'),
    ).toBe(false)
    // invalid wildcard only matches literally identical string
    expect(githubRepoPolicyMatches('*/*', '*/*')).toBe(true)
    expect(githubRepoPolicyMatches('*/*', 'a/b')).toBe(false)
  })
})
