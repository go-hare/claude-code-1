/**
 * densable 2.1.232 #9 — blockedMarketplaces url entries intercept bare git clones.
 * Pure helpers + Qob equivalence (no settings mock — avoids mock.module pollution).
 */
import { describe, expect, test } from 'bun:test'
import {
  areSourcesEquivalentForBlocklist,
  collapseUrlPathSegments,
  normalizeMarketplacePolicyHostname,
  normalizeMarketplaceUrlForBlocklist,
  stripTrailingSlashesAndGitSuffix,
} from '../marketplaceHelpers.js'
import type { MarketplaceSource } from '../schemas.js'

describe('URL normalize helpers (densable CWo/KOd/qOd)', () => {
  test('collapse path segments', () => {
    expect(collapseUrlPathSegments('/a/./b/../c')).toBe('a/c')
  })

  test('strip trailing slashes and .git', () => {
    expect(stripTrailingSlashesAndGitSuffix('owner/repo.git///')).toBe(
      'owner/repo',
    )
  })

  test('normalize hostname folds www and ssh.github.com', () => {
    expect(normalizeMarketplacePolicyHostname('www.GitHub.com')).toBe(
      'github.com',
    )
    expect(normalizeMarketplacePolicyHostname('ssh.github.com')).toBe(
      'github.com',
    )
  })

  test('CWo stripDotGit equates clone URL and bare https', () => {
    const a = normalizeMarketplaceUrlForBlocklist(
      'https://github.com/evil/plugins.git',
      { stripDotGit: true },
    )
    const b = normalizeMarketplaceUrlForBlocklist(
      'https://github.com/evil/plugins',
      { stripDotGit: true },
    )
    expect(a).toBe(b)
  })
})

describe('areSourcesEquivalentForBlocklist git vs url (densable Qob #9)', () => {
  test('blocked url intercepts git clone of same host/path + .git', () => {
    const blocked: MarketplaceSource = {
      source: 'url',
      url: 'https://github.com/evil/plugins',
    }
    const gitSource: MarketplaceSource = {
      source: 'git',
      url: 'https://github.com/evil/plugins.git',
    }
    expect(areSourcesEquivalentForBlocklist(gitSource, blocked)).toBe(true)
  })

  test('blocked url intercepts gitlab nested subgroup git clone', () => {
    const blocked: MarketplaceSource = {
      source: 'url',
      url: 'https://gitlab.com/org/team/marketplace',
    }
    const gitSource: MarketplaceSource = {
      source: 'git',
      url: 'https://gitlab.com/org/team/marketplace.git',
    }
    expect(areSourcesEquivalentForBlocklist(gitSource, blocked)).toBe(true)
  })

  test('different path is not blocked', () => {
    const blocked: MarketplaceSource = {
      source: 'url',
      url: 'https://github.com/evil/plugins',
    }
    const gitSource: MarketplaceSource = {
      source: 'git',
      url: 'https://github.com/evil/other.git',
    }
    expect(areSourcesEquivalentForBlocklist(gitSource, blocked)).toBe(false)
  })

  test('ssh git without :// is not compared via url branch (densable guard)', () => {
    const blocked: MarketplaceSource = {
      source: 'url',
      url: 'https://github.com/evil/plugins',
    }
    const gitSource: MarketplaceSource = {
      source: 'git',
      url: 'git@github.com:evil/plugins.git',
    }
    // densable: git vs url requires source.url includes "://"
    expect(areSourcesEquivalentForBlocklist(gitSource, blocked)).toBe(false)
  })

  test('www host still matches', () => {
    const blocked: MarketplaceSource = {
      source: 'url',
      url: 'https://www.github.com/evil/plugins',
    }
    const gitSource: MarketplaceSource = {
      source: 'git',
      url: 'https://github.com/evil/plugins.git',
    }
    expect(areSourcesEquivalentForBlocklist(gitSource, blocked)).toBe(true)
  })
})
