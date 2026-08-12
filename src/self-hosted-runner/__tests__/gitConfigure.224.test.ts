/**
 * densable 2.1.224 #1 — git proxy/signing allowlists + pure helpers + yjv.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  GOVERNED_HTTP_GIT_KEYS,
  GIT_PROXY_CRED_HELPER_CONTENT,
  HOOK_STUB_GENERIC,
  MIN_GIT_VERSION_FOR_SSH_SIGN,
  codeSignArtifacts,
  codeSignShimScript,
  coauthorHookStubs,
  gitProxyCredHelperPath,
  gitSupportsSshSign,
  governedSigningEntries,
  isGovernedGitConfigAllowed,
  parseGitVersion,
  restoreGitHookStubs,
  sanitizeGitProxyHomeState,
  shellSingleQuote,
} from '../gitConfigure.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
})

function tmp(): string {
  const d = join(
    tmpdir(),
    `shr-gitcfg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 gitConfigure pure ($2h/d2h/p2h)', () => {
  test('parseGitVersion + gitSupportsSshSign (MJl 2.34)', () => {
    expect(parseGitVersion('git version 2.39.2')).toEqual([2, 39])
    expect(gitSupportsSshSign('git version 2.34.0')).toBe(true)
    expect(gitSupportsSshSign('git version 2.33.1')).toBe(false)
    expect(gitSupportsSshSign('not git')).toBeNull()
    expect(MIN_GIT_VERSION_FOR_SSH_SIGN).toEqual([2, 34])
  })

  test('shellSingleQuote + codeSignShimScript', () => {
    expect(shellSingleQuote("a'b")).toBe(`a'\\''b`)
    const shim = codeSignShimScript('/usr/bin/claude')
    expect(shim).toContain("BIN='/usr/bin/claude'")
    expect(shim).toContain('self-hosted-runner code-sign')
  })

  test('gitProxyCredHelperPath + governedSigningEntries', () => {
    expect(gitProxyCredHelperPath('/ws')).toBe('/ws/.runner/git-proxy-cred')
    const entries = governedSigningEntries('/ws')
    expect(entries).toContainEqual(['user.name', 'Claude'])
    expect(entries).toContainEqual(['gpg.format', 'ssh'])
    expect(
      entries.some(
        ([k, v]) => k === 'gpg.ssh.program' && v.endsWith('/code-sign'),
      ),
    ).toBe(true)
  })

  test('isGovernedGitConfigAllowed ($2h) allowlist', () => {
    expect(isGovernedGitConfigAllowed('user.email', 'a@b.c')).toBe(true)
    expect(isGovernedGitConfigAllowed('core.autocrlf', 'input')).toBe(true)
    expect(isGovernedGitConfigAllowed('alias.st', 'status')).toBe(true)
    expect(isGovernedGitConfigAllowed('alias.x', '!rm -rf /')).toBe(false)
    expect(
      isGovernedGitConfigAllowed('url.https://gh.com/.insteadof', 'git@gh:'),
    ).toBe(true)
    expect(
      isGovernedGitConfigAllowed(
        'url.https://user@gh.com/.insteadof',
        'git@gh:',
      ),
    ).toBe(false)
    for (const k of GOVERNED_HTTP_GIT_KEYS) {
      expect(isGovernedGitConfigAllowed(`http.${k}`, '1')).toBe(true)
    }
    expect(isGovernedGitConfigAllowed('http.proxy', 'http://x')).toBe(false)
    expect(isGovernedGitConfigAllowed('credential.helper', 'store')).toBe(false)
  })

  test('codeSignArtifacts (Fqv) + coauthorHookStubs (Uqv)', () => {
    const arts = codeSignArtifacts('/ws', '/usr/bin/claude')
    expect(arts).toHaveLength(2)
    expect(arts[0]!.path).toBe('/ws/.runner/code-sign')
    expect(arts[0]!.mode).toBe(0o755)
    expect(arts[0]!.content).toContain('self-hosted-runner code-sign')
    expect(arts[1]!.path).toBe('/ws/.runner/commit_signing_key.pub')
    expect(arts[1]!.content).toBe('')

    const stubs = coauthorHookStubs('/ws')
    expect(stubs.some(s => s.path.endsWith('/pre-commit'))).toBe(true)
    expect(stubs.some(s => s.path.endsWith('/commit-msg'))).toBe(true)
    const co = stubs.find(s => s.path.endsWith('/commit-msg'))
    expect(co!.content).not.toBe(HOOK_STUB_GENERIC)
    expect(co!.mode).toBe(0o755)
  })

  test('restoreGitHookStubs (yjv) clean-slates hooks dir', async () => {
    const base = tmp()
    const stubs = coauthorHookStubs(base)
    const signing = codeSignArtifacts(base, '/bin/claude')
    // plant stale hook that must disappear after restore
    const hooksDir = join(base, '.runner', 'git-hooks')
    mkdirSync(hooksDir, { recursive: true })
    const stale = join(hooksDir, 'stale-evil')
    await Bun.write(stale, '#!/bin/sh\necho evil\n')

    const debug: string[] = []
    await restoreGitHookStubs(stubs, signing, m => debug.push(m))
    expect(statSync(join(base, '.runner', 'code-sign')).isFile()).toBe(true)
    expect(statSync(join(hooksDir, 'pre-commit')).isFile()).toBe(true)
    expect(statSync(join(hooksDir, 'commit-msg')).isFile()).toBe(true)
    expect(() => statSync(stale)).toThrow()
    expect(readFileSync(join(hooksDir, 'pre-commit'), 'utf8')).toBe(
      HOOK_STUB_GENERIC,
    )
    expect(debug.some(m => m.includes('clean-slated'))).toBe(true)
  })

  test('sanitizeGitProxyHomeState (bjv)', async () => {
    const base = tmp()
    const xdg = join(base, 'xdg', 'git', 'config')
    mkdirSync(dirname(xdg), { recursive: true })
    await Bun.write(xdg, 'stale-xdg')
    const homeGc = join(base, 'home', '.gitconfig')
    mkdirSync(dirname(homeGc), { recursive: true })
    await Bun.write(homeGc, 'stale-home')
    const globalGc = join(base, 'global.gitconfig')
    const helper = gitProxyCredHelperPath(base)
    const signing = codeSignArtifacts(base, '/bin/claude')
    const debug: string[] = []
    await sanitizeGitProxyHomeState(
      {
        xdgConfigPath: xdg,
        homeGitconfigPath: homeGc,
        globalConfigPath: globalGc,
        globalConfigSnapshot: '[user]\n\tname = Claude\n',
        credHelper: {
          path: helper,
          content: GIT_PROXY_CRED_HELPER_CONTENT,
        },
        signingArtifacts: signing,
      },
      m => debug.push(m),
    )
    expect(() => statSync(xdg)).toThrow()
    expect(() => statSync(homeGc)).toThrow()
    expect(readFileSync(globalGc, 'utf8')).toContain('Claude')
    expect(readFileSync(helper, 'utf8')).toBe(GIT_PROXY_CRED_HELPER_CONTENT)
    expect(statSync(join(base, '.runner', 'code-sign')).isFile()).toBe(true)
    expect(debug.some(m => m.includes('restored ~/.gitconfig'))).toBe(true)
  })
})
