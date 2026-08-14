/**
 * densable 2.1.232 #7 — GitLab marketplace URLs (nested subgroups) clone like GitHub.
 */
import { describe, expect, test } from 'bun:test'
import {
  isExactMarketplaceHost,
  isGitlabComHost,
  parseMarketplaceInput,
  urlHostContainsBackslash,
} from '../parseMarketplaceInput.js'

describe('isExactMarketplaceHost / isGitlabComHost', () => {
  test('strips www and matches gitlab.com', () => {
    expect(isGitlabComHost('gitlab.com')).toBe(true)
    expect(isGitlabComHost('www.gitlab.com')).toBe(true)
    expect(isGitlabComHost('gitlab.example.com')).toBe(false)
  })

  test('github host match', () => {
    expect(isExactMarketplaceHost('github.com', 'github.com')).toBe(true)
    expect(isExactMarketplaceHost('www.github.com', 'github.com')).toBe(true)
  })
})

describe('urlHostContainsBackslash (densable WSr)', () => {
  test('detects backslash in host', () => {
    expect(urlHostContainsBackslash('https://evil\\@gitlab.com/a/b')).toBe(true)
  })

  test('clean https is fine', () => {
    expect(urlHostContainsBackslash('https://gitlab.com/a/b')).toBe(false)
  })
})

describe('parseMarketplaceInput GitLab nested (densable QDi/I9S)', () => {
  test('https://gitlab.com/group/project → git + .git', async () => {
    const r = await parseMarketplaceInput('https://gitlab.com/group/project')
    expect(r).toEqual({
      source: 'git',
      url: 'https://gitlab.com/group/project.git',
    })
  })

  test('nested subgroup path clones as git', async () => {
    const r = await parseMarketplaceInput(
      'https://gitlab.com/org/team/sub/marketplace',
    )
    expect(r).toEqual({
      source: 'git',
      url: 'https://gitlab.com/org/team/sub/marketplace.git',
    })
  })

  test('already ends with .git stays git source', async () => {
    const r = await parseMarketplaceInput(
      'https://gitlab.com/org/team/repo.git',
    )
    expect(r).toEqual({
      source: 'git',
      url: 'https://gitlab.com/org/team/repo.git',
    })
  })

  test('ref fragment preserved', async () => {
    const r = await parseMarketplaceInput('https://gitlab.com/g/p#v1')
    expect(r).toEqual({
      source: 'git',
      url: 'https://gitlab.com/g/p.git',
      ref: 'v1',
    })
  })

  test('www.gitlab.com accepted', async () => {
    const r = await parseMarketplaceInput(
      'https://www.gitlab.com/group/project',
    )
    expect(r).toMatchObject({ source: 'git' })
    if (r && 'url' in r) {
      expect(r.url).toContain('gitlab.com')
      expect(r.url.endsWith('.git')).toBe(true)
    }
  })

  test('gitlab api path is not treated as repo clone', async () => {
    const r = await parseMarketplaceInput('https://gitlab.com/api/v4/projects')
    // segments start with "api" → densable rejects → falls to source url
    expect(r).toEqual({
      source: 'url',
      url: 'https://gitlab.com/api/v4/projects',
    })
  })

  test('single path segment is not a repo', async () => {
    const r = await parseMarketplaceInput('https://gitlab.com/onlygroup')
    expect(r).toEqual({
      source: 'url',
      url: 'https://gitlab.com/onlygroup',
    })
  })

  test('github.com still clones owner/repo', async () => {
    const r = await parseMarketplaceInput('https://github.com/owner/repo')
    expect(r).toEqual({
      source: 'git',
      url: 'https://github.com/owner/repo.git',
    })
  })

  test('bare nested shorthand is rejected with densable guidance', async () => {
    const r = await parseMarketplaceInput('org/team/repo')
    expect(r).not.toBeNull()
    expect(r && 'error' in r).toBe(true)
    if (r && 'error' in r) {
      expect(typeof r.error).toBe('string')
      expect(r.error.includes('shorthand')).toBe(true)
      expect(r.error.includes('https://')).toBe(true)
      expect(r.error.includes('clone URL')).toBe(true)
    }
  })

  test('valid github shorthand still works', async () => {
    const r = await parseMarketplaceInput('owner/repo')
    expect(r).toEqual({ source: 'github', repo: 'owner/repo' })
  })
})
