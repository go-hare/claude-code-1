/**
 * densable 2.1.234 #14 — strictKnownMarketplaces hostPattern SCP / ambiguous URL.
 * Pure helpers (no settings mock — avoids mock.module pollution).
 */
import { describe, expect, test } from 'bun:test'
import {
  canonicalizeHostForHostPattern,
  doesSourceMatchAllowlistEntry,
  doesSourceMatchHostPattern,
  extractHostFromSource,
  extractHostFromSourceForAllowlist,
  isGitUrlHostAmbiguous,
  isSafeRelativeMarketplacePath,
  isUnverifiableGitMarketplaceUrl,
  parseScpGitUrl,
} from '../marketplaceHelpers.js'
import type { MarketplaceSource } from '../schemas.js'

const githubAllow: MarketplaceSource & { source: 'hostPattern' } = {
  source: 'hostPattern',
  hostPattern: '^github\\.com$',
}

const companyAllow: MarketplaceSource & { source: 'hostPattern' } = {
  source: 'hostPattern',
  hostPattern: '^git\\.mycompany\\.com$',
}

describe('isGitUrlHostAmbiguous (densable pTt / x5o)', () => {
  test('plain https is not ambiguous', () => {
    expect(isGitUrlHostAmbiguous('https://github.com/org/repo.git')).toBe(false)
  })

  test('backslash in authority is ambiguous', () => {
    expect(isGitUrlHostAmbiguous('https://github.com\\evil.com/org/repo')).toBe(
      true,
    )
  })

  test('leading backslashes after :// are ambiguous (pTt u8y path)', () => {
    // JS string → https://\\github.com/org/repo
    expect(isGitUrlHostAmbiguous('https://\\\\github.com/org/repo')).toBe(true)
  })

  test('SCP form without :// is never ambiguous via pTt', () => {
    expect(isGitUrlHostAmbiguous('git@github.com:org/repo.git')).toBe(false)
  })

  test('leading C0/space is stripped before check', () => {
    expect(
      isGitUrlHostAmbiguous('\thttps://github.com\\evil.com/org/repo'),
    ).toBe(true)
  })
})

describe('parseScpGitUrl (densable I8s)', () => {
  test('parses strict user@host:path', () => {
    expect(parseScpGitUrl('git@github.com:org/repo.git')).toEqual({
      user: 'git',
      host: 'github.com',
      path: 'org/repo.git',
    })
  })

  test('rejects extra @ in userinfo (naive regex would mis-capture)', () => {
    expect(parseScpGitUrl('git@evil.com@github.com:org/repo.git')).toBeNull()
  })

  test('rejects brackets / slashes in host', () => {
    expect(parseScpGitUrl('git@[::1]:org/repo.git')).toBeNull()
    expect(parseScpGitUrl('git@host/name:org/repo.git')).toBeNull()
  })

  test('rejects URL forms with ://', () => {
    expect(parseScpGitUrl('ssh://git@github.com/org/repo.git')).toBeNull()
  })
})

describe('extractHostFromSource vs ForAllowlist (O7t / zAd)', () => {
  test('github shorthand → github.com on both paths', () => {
    const src: MarketplaceSource = { source: 'github', repo: 'org/repo' }
    expect(extractHostFromSource(src)).toBe('github.com')
    expect(extractHostFromSourceForAllowlist(src)).toBe('github.com')
  })

  test('strict SCP allowlist matches hostPattern', () => {
    const src: MarketplaceSource = {
      source: 'git',
      url: 'git@git.mycompany.com:team/marketplace.git',
    }
    expect(extractHostFromSourceForAllowlist(src)).toBe('git.mycompany.com')
    expect(doesSourceMatchHostPattern(src, companyAllow)).toBe(true)
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(false)
  })

  test('ambiguous SCP with extra @ fails closed on allowlist (zAd/I8s)', () => {
    const src: MarketplaceSource = {
      source: 'git',
      url: 'git@evil.com@github.com:org/repo.git',
    }
    // allowlist: I8s null → no host
    expect(extractHostFromSourceForAllowlist(src)).toBeNull()
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(false)
    // blocklistDirection still uses naive O7t/Utb capture
    expect(extractHostFromSource(src)).toBe(
      canonicalizeHostForHostPattern('evil.com@github.com'),
    )
  })

  test('ambiguous https backslash fails closed on both extractors', () => {
    const src: MarketplaceSource = {
      source: 'git',
      url: 'https://github.com\\evil.com/org/repo.git',
    }
    expect(extractHostFromSource(src)).toBeNull()
    expect(extractHostFromSourceForAllowlist(src)).toBeNull()
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(false)
  })

  test('www.github.com folds to github.com via SCn on allowlist', () => {
    const src: MarketplaceSource = {
      source: 'git',
      url: 'https://www.github.com/org/repo.git',
    }
    expect(extractHostFromSourceForAllowlist(src)).toBe('github.com')
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(true)
  })

  test('blocklistDirection dual-tests ssh.github.com against github.com', () => {
    const src: MarketplaceSource = {
      source: 'git',
      url: 'git@ssh.github.com:org/repo.git',
    }
    // allowlist SCn does NOT fold ssh.github.com → github.com
    expect(extractHostFromSourceForAllowlist(src)).toBe('ssh.github.com')
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(false)
    // blocklistDirection: WAd dual-tests [ssh.github.com, github.com]
    expect(
      doesSourceMatchHostPattern(src, githubAllow, {
        blocklistDirection: true,
      }),
    ).toBe(true)
  })
})

describe('isUnverifiableGitMarketplaceUrl (densable Obn)', () => {
  test('http(s) with ambiguous authority is unverifiable', () => {
    expect(
      isUnverifiableGitMarketplaceUrl('https://github.com\\evil.com/org/repo'),
    ).toBe(true)
  })

  test('plain https is verifiable', () => {
    expect(
      isUnverifiableGitMarketplaceUrl('https://github.com/org/repo.git'),
    ).toBe(false)
  })

  test('SCP with colon before @ is unverifiable', () => {
    expect(isUnverifiableGitMarketplaceUrl('host:user@path')).toBe(true)
  })
})

describe('isSafeRelativeMarketplacePath (densable BAd)', () => {
  test('relative marketplace.json path ok', () => {
    expect(
      isSafeRelativeMarketplacePath('.claude-plugin/marketplace.json'),
    ).toBe(true)
  })

  test('rejects absolute / drive / .. segments', () => {
    expect(isSafeRelativeMarketplacePath('/etc/passwd')).toBe(false)
    expect(isSafeRelativeMarketplacePath('C:\\Windows\\a')).toBe(false)
    expect(isSafeRelativeMarketplacePath('plugins/../../etc/passwd')).toBe(
      false,
    )
  })

  test('hostPattern allowlist rejects unsafe github path (JAd/BAd)', () => {
    const src: MarketplaceSource = {
      source: 'github',
      repo: 'org/repo',
      path: '../evil/marketplace.json',
    }
    expect(isSafeRelativeMarketplacePath(src.path!)).toBe(false)
    // WAd alone still matches host; JAd fails closed on unsafe path
    expect(doesSourceMatchHostPattern(src, githubAllow)).toBe(true)
    expect(doesSourceMatchAllowlistEntry(src, githubAllow)).toBe(false)
  })

  test('hostPattern allowlist accepts safe relative github path', () => {
    const src: MarketplaceSource = {
      source: 'github',
      repo: 'org/repo',
      path: '.claude-plugin/marketplace.json',
    }
    expect(doesSourceMatchAllowlistEntry(src, githubAllow)).toBe(true)
  })
})

describe('doesSourceMatchAllowlistEntry github owner/* (densable JAd/ztb)', () => {
  test('owner/* with no policy path allows missing or safe source path', () => {
    const allowed: MarketplaceSource = {
      source: 'github',
      repo: 'Acme/*',
    }
    expect(
      doesSourceMatchAllowlistEntry(
        { source: 'github', repo: 'Acme/plugins' },
        allowed,
      ),
    ).toBe(true)
    expect(
      doesSourceMatchAllowlistEntry(
        {
          source: 'github',
          repo: 'Acme/plugins',
          path: '.claude-plugin/marketplace.json',
        },
        allowed,
      ),
    ).toBe(true)
  })

  test('owner/* is case-sensitive (ztb)', () => {
    expect(
      doesSourceMatchAllowlistEntry(
        { source: 'github', repo: 'acme/plugins' },
        { source: 'github', repo: 'Acme/*' },
      ),
    ).toBe(false)
  })

  test('owner/* rejects repo name starting with hyphen (w5o)', () => {
    expect(
      doesSourceMatchAllowlistEntry(
        { source: 'github', repo: 'acme/-x' },
        { source: 'github', repo: 'acme/*' },
      ),
    ).toBe(false)
  })

  test('owner/* with policy path requires exact path match', () => {
    const allowed: MarketplaceSource = {
      source: 'github',
      repo: 'acme/*',
      path: 'plugins/marketplace.json',
    }
    expect(
      doesSourceMatchAllowlistEntry(
        {
          source: 'github',
          repo: 'acme/x',
          path: 'plugins/marketplace.json',
        },
        allowed,
      ),
    ).toBe(true)
    expect(
      doesSourceMatchAllowlistEntry(
        {
          source: 'github',
          repo: 'acme/x',
          path: 'other/marketplace.json',
        },
        allowed,
      ),
    ).toBe(false)
  })
})
