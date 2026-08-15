/**
 * densable 2.1.233 #1 — GitLab MR / Bitbucket PR URL parse for --worktree.
 */
import { describe, expect, test } from 'bun:test'
import {
  codeChangeNumberPrefix,
  codeChangeProviderFromHostname,
  codeChangeProviderFromUrl,
  gitRemoteHostname,
  parseCodeChangeUrl,
  parsePRReference,
  prFetchSpecsForProvider,
} from '../worktree.js'

describe('parseCodeChangeUrl densable rVo/tVo', () => {
  test('GitHub pull URL', () => {
    const r = parseCodeChangeUrl('https://github.com/owner/repo/pull/42')
    expect(r).toEqual({
      prNumber: 42,
      prUrl: 'https://github.com/owner/repo/pull/42',
      prRepository: 'owner/repo',
      provider: 'github',
    })
  })

  test('GitLab merge_requests URL (nested group)', () => {
    const r = parseCodeChangeUrl(
      'https://gitlab.com/group/sub/project/-/merge_requests/7',
    )
    expect(r?.prNumber).toBe(7)
    expect(r?.provider).toBe('gitlab')
    expect(r?.prRepository).toBe('group/sub/project')
  })

  test('Bitbucket pull-requests URL', () => {
    const r = parseCodeChangeUrl(
      'https://bitbucket.org/team/repo/pull-requests/9',
    )
    expect(r?.prNumber).toBe(9)
    expect(r?.provider).toBe('bitbucket')
  })
})

describe('parsePRReference densable 233 worktree', () => {
  test('GitLab MR URL → number', () => {
    expect(
      parsePRReference('https://gitlab.com/org/proj/-/merge_requests/15'),
    ).toBe(15)
  })

  test('!N GitLab shorthand', () => {
    expect(parsePRReference('!88')).toBe(88)
  })

  test('#N GitHub shorthand', () => {
    expect(parsePRReference('#12')).toBe(12)
  })

  test('GitHub URL still works', () => {
    expect(parsePRReference('https://github.com/a/b/pull/3')).toBe(3)
  })
})

describe('codeChangeNumberPrefix densable agents !N', () => {
  test('gitlab → ! ; others → #', () => {
    expect(codeChangeNumberPrefix('gitlab')).toBe('!')
    expect(codeChangeNumberPrefix('github')).toBe('#')
    expect(codeChangeNumberPrefix('bitbucket')).toBe('#')
  })

  test('provider from URL', () => {
    expect(
      codeChangeProviderFromUrl('https://gitlab.com/a/b/-/merge_requests/1'),
    ).toBe('gitlab')
    expect(codeChangeProviderFromUrl('https://github.com/a/b/pull/1')).toBe(
      'github',
    )
  })
})

describe('prFetchSpecsForProvider densable Oxr fetch list', () => {
  test('gitlab only merge-requests', () => {
    expect(prFetchSpecsForProvider('gitlab', 7)).toEqual([
      'merge-requests/7/head',
    ])
  })

  test('github only pull', () => {
    expect(prFetchSpecsForProvider('github', 42)).toEqual(['pull/42/head'])
  })

  test('other tries pull then mr (densable)', () => {
    expect(prFetchSpecsForProvider('other', 3)).toEqual([
      'pull/3/head',
      'merge-requests/3/head',
    ])
  })
})

describe('gitRemoteHostname densable Hod', () => {
  test('https and scp-like', () => {
    expect(gitRemoteHostname('https://github.com/o/r.git')).toBe('github.com')
    expect(gitRemoteHostname('git@gitlab.com:group/proj.git')).toBe(
      'gitlab.com',
    )
  })
})

describe('codeChangeProviderFromHostname densable Oxr', () => {
  test('forge hosts', () => {
    expect(codeChangeProviderFromHostname('github.com')).toBe('github')
    expect(codeChangeProviderFromHostname('www.gitlab.com')).toBe('gitlab')
    expect(codeChangeProviderFromHostname('bitbucket.org')).toBe('bitbucket')
    expect(codeChangeProviderFromHostname('ghe.corp.example')).toBe('other')
  })
})
