/**
 * densable 2.1.212 #15–18 unit tests for pure helpers in reviewRemote.ts
 */
import { describe, expect, test } from 'bun:test'
import {
  baseRefArgDiagnostics,
  damerauLevenshtein,
  EMPTY_TREE_SHA,
  formatEmptyDiffAgainstBaseError,
  formatLargestDiffFiles,
  formatLocalDiffTooLargeError,
  getUltrareviewDiffLimits,
  isAnthropicMonorepoBlocked,
  isCwdHome,
  isDesktopLikeEntrypoint,
  isEmptyTreeFallbackEnabled,
  isGithubComHost,
  isRepoPackTooLarge,
  normalizeReviewHost,
  normalizeUltrareviewPrArg,
  notGitRepoHint,
  parseGithubPullUrl,
  parseGitNumstat,
  parseGitShortstat,
  pluralizeCount,
  reviewHostsEqual,
} from '../reviewRemote.js'

describe('parseGithubPullUrl (densable yqr)', () => {
  test('parses github.com PR URL', () => {
    const r = parseGithubPullUrl(
      'https://github.com/anthropics/claude-code/pull/12345',
    )
    expect(r).toEqual({
      url: 'https://github.com/anthropics/claude-code/pull/12345',
      host: 'github.com',
      owner: 'anthropics',
      repo: 'claude-code',
      num: 12345,
    })
  })

  test('rejects non-https or non-PR paths', () => {
    expect(parseGithubPullUrl('http://github.com/a/b/pull/1')).toBeNull()
    expect(parseGithubPullUrl('https://github.com/a/b/issues/1')).toBeNull()
    expect(parseGithubPullUrl('not-a-url')).toBeNull()
  })
})

describe('normalizeUltrareviewPrArg (densable YOo)', () => {
  test('accepts bare digits', () => {
    const r = normalizeUltrareviewPrArg('42')
    expect(r.prNumber).toBe('42')
    expect(r.normalizedFrom).toBe('digits')
  })

  test('accepts #123', () => {
    const r = normalizeUltrareviewPrArg('#123')
    expect(r.prNumber).toBe('123')
    expect(r.normalizedFrom).toBe('prefix')
  })

  test('accepts PR 123 / PR#123 / pr123', () => {
    expect(normalizeUltrareviewPrArg('PR 123').prNumber).toBe('123')
    expect(normalizeUltrareviewPrArg('PR#456').prNumber).toBe('456')
    expect(normalizeUltrareviewPrArg('pr789').prNumber).toBe('789')
  })

  test('accepts pasted PR URL', () => {
    const r = normalizeUltrareviewPrArg('https://github.com/foo/bar/pull/99')
    expect(r.prNumber).toBe('99')
    expect(r.parsedUrl?.owner).toBe('foo')
    expect(r.normalizedFrom).toBe('url')
  })

  test('non-PR args stay null prNumber (branch mode)', () => {
    const r = normalizeUltrareviewPrArg('feature/auth')
    expect(r.prNumber).toBeNull()
    expect(r.trimmed).toBe('feature/auth')
  })
})

describe('damerauLevenshtein (densable nst)', () => {
  test('identity is 0', () => {
    expect(damerauLevenshtein('main', 'main')).toBe(0)
  })

  test('adjacent transposition costs 1', () => {
    // densable nst: Damerau adjacent swap
    expect(damerauLevenshtein('ab', 'ba')).toBe(1)
    expect(damerauLevenshtein('main', 'mian')).toBe(1)
  })

  test('single insertion', () => {
    expect(damerauLevenshtein('feat', 'featt')).toBe(1)
  })

  test('main vs master is outside default threshold 3 (XI_ uses main↔master swap)', () => {
    // densable XI_ special-cases main↔master before nst; raw distance is >3
    expect(damerauLevenshtein('main', 'master')).toBeGreaterThanOrEqual(3)
  })
})

describe('Desktop not-git hint (densable Ibp/WW/Ghl)', () => {
  test('desktop entrypoints get folder message', () => {
    expect(isDesktopLikeEntrypoint('claude-desktop')).toBe(true)
    expect(isDesktopLikeEntrypoint('claude-desktop-3p')).toBe(true)
    expect(isDesktopLikeEntrypoint('local-agent')).toBe(true)
    expect(notGitRepoHint('claude-desktop')).toBe(
      "Open your project's repository folder and try again.",
    )
  })

  test('cli entrypoints get git init message', () => {
    expect(isDesktopLikeEntrypoint('cli')).toBe(false)
    expect(isDesktopLikeEntrypoint(undefined)).toBe(false)
    expect(notGitRepoHint('cli')).toContain('git init')
  })
})

describe('getUltrareviewDiffLimits (densable qqi)', () => {
  test('defaults 500 files / 8000 lines', () => {
    expect(getUltrareviewDiffLimits(null)).toEqual({
      maxFiles: 500,
      maxLines: 8000,
    })
  })

  test('reads max_diff_files / max_diff_lines from config', () => {
    expect(
      getUltrareviewDiffLimits({
        max_diff_files: 100,
        max_diff_lines: 2000,
      }),
    ).toEqual({ maxFiles: 100, maxLines: 2000 })
  })

  test('ignores non-positive numbers', () => {
    expect(
      getUltrareviewDiffLimits({ max_diff_files: 0, max_diff_lines: -1 }),
    ).toEqual({ maxFiles: 500, maxLines: 8000 })
  })
})

describe('densable #35 empty-tree fallback helpers (IXs / Wau)', () => {
  test('EMPTY_TREE_SHA is git empty tree object id', () => {
    expect(EMPTY_TREE_SHA).toBe('4b825dc642cb6eb9a060e54bf8d69288fbee4904')
  })

  test('isEmptyTreeFallbackEnabled defaults ON (null / missing)', () => {
    expect(isEmptyTreeFallbackEnabled(null)).toBe(true)
    expect(isEmptyTreeFallbackEnabled({})).toBe(true)
    expect(
      isEmptyTreeFallbackEnabled({ empty_tree_fallback_enabled: true }),
    ).toBe(true)
  })

  test('isEmptyTreeFallbackEnabled only false when explicitly false', () => {
    expect(
      isEmptyTreeFallbackEnabled({ empty_tree_fallback_enabled: false }),
    ).toBe(false)
  })
})

describe('parseGitShortstat (densable Dro)', () => {
  test('parses full shortstat', () => {
    expect(
      parseGitShortstat(' 3 files changed, 10 insertions(+), 2 deletions(-)'),
    ).toEqual({ filesCount: 3, linesAdded: 10, linesRemoved: 2 })
  })

  test('parses singular file / missing deletions', () => {
    expect(parseGitShortstat('1 file changed, 5 insertions(+)')).toEqual({
      filesCount: 1,
      linesAdded: 5,
      linesRemoved: 0,
    })
  })

  test('returns null for empty', () => {
    expect(parseGitShortstat('')).toBeNull()
  })
})

describe('pluralizeCount / numstat / DHp (2.1.216 #32)', () => {
  test('pluralizeCount', () => {
    expect(pluralizeCount(1, 'file')).toBe('file')
    expect(pluralizeCount(2, 'file')).toBe('files')
    expect(pluralizeCount(1, 'line')).toBe('line')
    expect(pluralizeCount(8000, 'line')).toBe('lines')
  })

  test('parseGitNumstat ranks binary as 0 lines', () => {
    const n = parseGitNumstat(
      ['10\t2\tsrc/a.ts', '-\t-\tbin/img.png', '1\t0\tsrc/b.ts'].join('\n'),
    )
    expect(n.filesCount).toBe(3)
    expect(n.linesAdded).toBe(11)
    expect(n.linesRemoved).toBe(2)
    expect(n.perFileStats.get('bin/img.png')).toEqual({
      added: 0,
      removed: 0,
      isBinary: true,
    })
  })

  test('formatLargestDiffFiles top 3 by total lines', () => {
    const numstat = [
      '100\t0\tbig.ts',
      '5\t5\tmid.ts',
      '1\t0\tsmall.ts',
      '50\t50\thuge.ts',
    ].join('\n')
    const s = formatLargestDiffFiles(numstat, 3)
    expect(s.startsWith(' Largest files: ')).toBe(true)
    expect(s).toContain('huge.ts (100 lines)')
    expect(s).toContain('big.ts (100 lines)')
    expect(s).toContain('mid.ts (10 lines)')
    expect(s).not.toContain('small.ts')
    expect(s.endsWith('.')).toBe(true)
  })

  test('formatLocalDiffTooLargeError densable shape', () => {
    const msg = formatLocalDiffTooLargeError({
      filesCount: 600,
      totalLines: 12000,
      maxFiles: 500,
      maxLines: 8000,
      largestFilesSuffix: ' Largest files: a.ts (9,000 lines).',
      invocation: '/code-review ultra',
    })
    expect(msg).toContain(
      'Diff is too large for ultrareview: 600 files, 12,000 lines changed',
    )
    expect(msg).toContain('(limits: 500 files, 8,000 lines).')
    expect(msg).toContain('Largest files: a.ts (9,000 lines).')
    expect(msg).toContain(
      'Pass a closer base branch (`/code-review ultra <branch>`)',
    )
  })
})

describe('formatEmptyDiffAgainstBaseError (2.1.216 #33)', () => {
  test('names ref + short merge-base and suggests explicit base', () => {
    const msg = formatEmptyDiffAgainstBaseError({
      diffAgainstRef: 'origin/main',
      mergeBaseSha: 'abcdef1234567890',
      hadExplicitBase: false,
      invocation: '/code-review ultra',
    })
    expect(msg).toContain(
      'No changes to review: the diff against origin/main (merge-base abcdef1) is empty',
    )
    expect(msg).toContain(
      'pass one explicitly, e.g. `/code-review ultra <branch>`',
    )
  })

  test('hadExplicitBase suggests different base', () => {
    const msg = formatEmptyDiffAgainstBaseError({
      diffAgainstRef: 'develop',
      mergeBaseSha: 'deadbeef',
      hadExplicitBase: true,
      invocation: '/ultrareview',
    })
    expect(msg).toContain('try a different base, e.g. `/ultrareview <branch>`')
  })
})

describe('isRepoPackTooLarge (densable QCu formula)', () => {
  const max = 100 * 1024 * 1024 // H1g
  test('below 3x max is fine even if large', () => {
    expect(isRepoPackTooLarge(2.5 * max, 10_000_000, max)).toBe(false)
  })
  test('>3x and >100x is too large', () => {
    expect(isRepoPackTooLarge(101 * max, 0, max)).toBe(true)
  })
  test('>3x and inPack > 5e6 is too large', () => {
    expect(isRepoPackTooLarge(4 * max, 5_000_001, max)).toBe(true)
  })
  test('>3x but inPack low and not >100x is ok', () => {
    expect(isRepoPackTooLarge(4 * max, 100, max)).toBe(false)
  })
})

describe('isGithubComHost / reviewHostsEqual (densable fm/KJe/kPr)', () => {
  test('fm strips www and matches github.com only', () => {
    expect(isGithubComHost('github.com')).toBe(true)
    expect(isGithubComHost('www.github.com')).toBe(true)
    expect(isGithubComHost('WWW.GitHub.com')).toBe(true)
    expect(isGithubComHost('ghe.example.com')).toBe(false)
    expect(isGithubComHost('github.enterprise.com')).toBe(false)
  })

  test('kPr / KJe host equality', () => {
    expect(normalizeReviewHost('GitHub.com')).toBe('github.com')
    expect(reviewHostsEqual('github.com', 'GitHub.com')).toBe(true)
    expect(reviewHostsEqual('github.com', 'ghe.example.com')).toBe(false)
    expect(reviewHostsEqual(null, 'github.com')).toBe(false)
  })
})

describe('isCwdHome (densable hde)', () => {
  test('true when cwd equals home', () => {
    expect(isCwdHome('/Users/me', '/Users/me')).toBe(true)
  })
  test('false when cwd is a subdir of home', () => {
    expect(isCwdHome('/Users/me/proj', '/Users/me')).toBe(false)
  })
  test('windows comparison is case-insensitive via getPlatform path', () => {
    // pure equality path still holds on non-windows runners
    expect(isCwdHome('C:\\Users\\Me', 'C:\\Users\\Me')).toBe(true)
  })
})

describe('baseRefArgDiagnostics (densable base_ref_not_found flags)', () => {
  test('flags url / sha / hash / slash / whitespace', () => {
    expect(baseRefArgDiagnostics('https://example.com/x')).toMatchObject({
      looks_like_url: true,
      has_slash: true,
    })
    expect(baseRefArgDiagnostics('abc1234')).toMatchObject({
      looks_like_sha: true,
    })
    expect(baseRefArgDiagnostics('#123')).toMatchObject({
      starts_with_hash: true,
    })
    expect(baseRefArgDiagnostics('feat branch')).toMatchObject({
      has_whitespace: true,
    })
    expect(baseRefArgDiagnostics('main')).toEqual({
      looks_like_url: false,
      looks_like_sha: false,
      starts_with_hash: false,
      has_slash: false,
      has_whitespace: false,
    })
  })
})

describe('isAnthropicMonorepoBlocked (densable monorepo_blocked)', () => {
  test('blocks anthropics/anthropic on github.com (fm)', () => {
    expect(
      isAnthropicMonorepoBlocked({
        host: 'github.com',
        owner: 'anthropics',
        name: 'anthropic',
      }),
    ).toBe(true)
    expect(
      isAnthropicMonorepoBlocked({
        host: 'www.github.com',
        owner: 'Anthropics',
        name: 'anthropic',
      }),
    ).toBe(true)
  })
  test('allows other repos and non-github.com hosts', () => {
    expect(
      isAnthropicMonorepoBlocked({
        host: 'github.com',
        owner: 'anthropics',
        name: 'claude-code',
      }),
    ).toBe(false)
    // densable fm only — GHE monorepo clone is NOT blocked
    expect(
      isAnthropicMonorepoBlocked({
        host: 'ghe.example.com',
        owner: 'anthropics',
        name: 'anthropic',
      }),
    ).toBe(false)
  })
})
