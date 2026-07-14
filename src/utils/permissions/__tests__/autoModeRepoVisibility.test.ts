import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearRepoVisibilityCache,
  collectExfilRemoteRefs,
  extractGhRepoFlag,
  extractPushRemotes,
  extractRemoteMutateUrl,
  githubRestApiBase,
  isGithubDotComHost,
  parseGhExfilMatches,
  parseGitExfilCommands,
  parseRepoRef,
  resolveCurrentBranch,
  resolveOriginRepoState,
  sanitizeRepoVisibilityToken,
  seedRepoOriginCache,
} from '../autoModeRepoVisibility.js'

afterEach(() => {
  delete process.env.CLAUDE_CODE_AUTO_MODE_REPO_VISIBILITY
  clearRepoVisibilityCache()
})

describe('parseGitExfilCommands (official MDg)', () => {
  test('matches git push / remote set-url / add', () => {
    expect(parseGitExfilCommands('git push origin main')).toEqual([
      { kind: 'push', optsSpan: '', rest: 'origin main' },
    ])
    expect(
      parseGitExfilCommands('git remote set-url origin https://x/y/z.git'),
    ).toEqual([
      {
        kind: 'remote-mutate',
        optsSpan: '',
        rest: 'set-url origin https://x/y/z.git',
      },
    ])
    expect(
      parseGitExfilCommands('git -C /tmp/repo push --force origin HEAD'),
    ).toEqual([
      {
        kind: 'push',
        optsSpan: '-C /tmp/repo',
        rest: '--force origin HEAD',
      },
    ])
  })

  test('ignores non-exfil git', () => {
    expect(parseGitExfilCommands('git status')).toEqual([])
    expect(parseGitExfilCommands('git log')).toEqual([])
  })
})

describe('parseGhExfilMatches (official ODg)', () => {
  test('matches pr create / issue / release / fork', () => {
    const m = parseGhExfilMatches('gh pr create --title x')
    expect(m).toHaveLength(1)
    expect(m[0]!.sub).toBe('pr create')
  })
  test('ignores gh view', () => {
    expect(parseGhExfilMatches('gh pr view 1')).toEqual([])
  })
})

describe('extractors', () => {
  test('extractPushRemotes', () => {
    expect(extractPushRemotes('origin main')).toEqual(['origin'])
    expect(extractPushRemotes('--force origin HEAD')).toEqual(['origin'])
  })
  test('extractRemoteMutateUrl', () => {
    expect(
      extractRemoteMutateUrl('set-url origin https://github.com/a/b.git'),
    ).toBe('https://github.com/a/b.git')
  })
  test('extractGhRepoFlag', () => {
    expect(extractGhRepoFlag('--repo owner/repo --title x')).toBe('owner/repo')
    expect(extractGhRepoFlag('-R owner/repo')).toBe('owner/repo')
  })
})

describe('parseRepoRef / sanitize', () => {
  test('owner/repo and URLs', () => {
    expect(parseRepoRef('owner/repo')).toEqual({
      host: 'github.com',
      owner: 'owner',
      name: 'repo',
    })
    expect(parseRepoRef('git@github.com:o/r.git')).toEqual({
      host: 'github.com',
      owner: 'o',
      name: 'r',
    })
  })
  test('sanitize truncates and strips', () => {
    expect(sanitizeRepoVisibilityToken('a b!c').length).toBeLessThanOrEqual(128)
    expect(sanitizeRepoVisibilityToken('a b!c')).toBe('abc')
  })
})

describe('collectExfilRemoteRefs', () => {
  test('collects push + gh -R', () => {
    const refs = collectExfilRemoteRefs(
      'git push origin main; gh pr create -R o/r --title t',
    )
    expect(refs).toContain('origin')
    expect(refs).toContain('o/r')
  })
})

describe('github host helpers (official Fm/NAr)', () => {
  test('isGithubDotComHost strips www', () => {
    expect(isGithubDotComHost('github.com')).toBe(true)
    expect(isGithubDotComHost('www.github.com')).toBe(true)
    expect(isGithubDotComHost('ghe.example.com')).toBe(false)
  })
  test('githubRestApiBase', () => {
    expect(githubRestApiBase('github.com')).toBe('https://api.github.com')
    expect(githubRestApiBase('ghe.example.com')).toBe(
      'https://ghe.example.com/api/v3',
    )
  })
})

describe('YDg/JDg origin snapshot cache (official lXt)', () => {
  test('resolveCurrentBranch prefers seeded cache', async () => {
    seedRepoOriginCache('/tmp/seeded-repo', { branch: 'feature/x' })
    await expect(resolveCurrentBranch('/tmp/seeded-repo')).resolves.toBe(
      'feature/x',
    )
  })
  test('resolveOriginRepoState prefers seeded cache', async () => {
    seedRepoOriginCache('/tmp/seeded-origin', {
      host: 'github.com',
      slug: 'acme/app',
      visibility: 'private',
    })
    await expect(resolveOriginRepoState('/tmp/seeded-origin')).resolves.toEqual(
      {
        host: 'github.com',
        slug: 'acme/app',
        visibility: 'private',
      },
    )
  })
})
