/**
 * densable 2.1.224 #1 — session hooks (H2h/M2h/D2h/vKn) + source map (pjv legacy).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyGitHostRewrites,
  applyGitSshRewrites,
  buildHookBaseEnv,
  extractRepoSlugFromUrl,
  isCheckoutHookSourceType,
  isSshFormGitUrl,
  mapSourcesForCheckout,
  parseGovernedGitConfig,
  resolveHookPath,
  rewriteToAnthropicGitProxy,
  rewriteToGovernedGitMount,
  runCheckoutHook,
  runPostSessionHook,
  sourceCanonicalPath,
  sourceCheckoutSlug,
  stripGitSuffix,
} from '../sessionHooks.js'

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
    `shr-hooks-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 hook env + resolve (D2h/vKn)', () => {
  test('buildHookBaseEnv strips pool secrets', () => {
    const env = buildHookBaseEnv({
      FOO: '1',
      SELF_HOSTED_RUNNER_POOL_SECRET: 's',
      SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET: 'e',
    })
    expect(env.FOO).toBe('1')
    expect(env.SELF_HOSTED_RUNNER_POOL_SECRET).toBeUndefined()
    expect(env.SELF_HOSTED_RUNNER_ENVIRONMENT_SECRET).toBeUndefined()
  })

  test('resolveHookPath requires executable file', async () => {
    const dir = tmp()
    expect(await resolveHookPath(undefined, 'checkout')).toBeNull()
    expect(await resolveHookPath(dir, 'checkout')).toBeNull()
    const path = join(dir, 'checkout')
    writeFileSync(path, '#!/bin/sh\nexit 0\n')
    expect(await resolveHookPath(dir, 'checkout')).toBeNull() // not +x
    chmodSync(path, 0o755)
    expect(await resolveHookPath(dir, 'checkout')).toBe(path)
  })
})

describe('densable 2.1.224 #1 source map helpers (G7s/dWd/J7s/Ljv/pjv)', () => {
  test('isCheckoutHookSourceType (G7s)', () => {
    expect(isCheckoutHookSourceType('github')).toBe(true)
    expect(isCheckoutHookSourceType('github-ssh')).toBe(true)
    expect(isCheckoutHookSourceType('test-file')).toBe(true)
    expect(isCheckoutHookSourceType('git_repository')).toBe(false)
  })

  test('extractRepoSlugFromUrl (Ljv) + stripGitSuffix (K2h)', () => {
    // densable K2h: strip .git$ first, then trailing slashes (order matters)
    expect(stripGitSuffix('a/b.git')).toBe('a/b')
    expect(stripGitSuffix('a/b.git/')).toBe('a/b.git')
    expect(extractRepoSlugFromUrl('https://github.com/org/repo.git')).toBe(
      'org/repo',
    )
    expect(extractRepoSlugFromUrl('git@github.com:org/repo.git')).toBe(
      'org/repo',
    )
    expect(isSshFormGitUrl('git@github.com:org/repo.git')).toBe(true)
    expect(isSshFormGitUrl('https://github.com/org/repo')).toBe(false)
  })

  test('sourceCheckoutSlug (dWd) + sourceCanonicalPath (J7s)', () => {
    expect(sourceCheckoutSlug({ repo: 'org/repo' })).toBe('org-repo')
    expect(sourceCheckoutSlug({ repo: 'org/../x' })).toBe('')
    expect(
      sourceCanonicalPath('/base', { type: 'github', repo: 'org/repo' }),
    ).toBe(join('/base', 'org', 'repo'))
    expect(
      sourceCanonicalPath('/base', { type: 'test-file', repo: 'foo/bar.txt' }),
    ).toBe(join('/base', 'bar.txt'))
  })

  test('applyGitHostRewrites (wjv) / applyGitSshRewrites (Ejv)', () => {
    expect(
      applyGitHostRewrites('https://ext.example.com/a/b', [
        ['ext.example.com', 'int.example.com'],
      ]),
    ).toBe('https://int.example.com/a/b')
    expect(
      applyGitSshRewrites('https://github.com/a/b.git', ['github.com']),
    ).toBe('git@github.com:a/b')
  })

  test('mapSourcesForCheckout (pjv legacy)', () => {
    const mapped = mapSourcesForCheckout(
      [
        {
          type: 'git_repository',
          url: 'https://github.com/acme/app.git',
          revision: 'main',
        },
      ],
      {},
    )
    expect(mapped).toHaveLength(1)
    expect(mapped[0]!.type).toBe('github')
    expect(mapped[0]!.repo).toBe('acme/app')
    expect(mapped[0]!.ref).toBe('main')
  })

  test('rewriteToAnthropicGitProxy (fjv)', () => {
    const r = rewriteToAnthropicGitProxy('https://github.com/acme/app.git', {
      apiBaseUrl: 'https://api.anthropic.com/',
      sessionId: 'ses_1',
    })
    expect(r).toEqual({
      url: 'https://api.anthropic.com/v1/session_ingress/session/ses_1/git_proxy/acme/app.git',
      owner: 'acme',
      repo: 'app',
    })
    expect(
      rewriteToAnthropicGitProxy('https://github.com/../x/y', {
        apiBaseUrl: 'https://api.anthropic.com',
        sessionId: 's',
      }),
    ).toBeUndefined()
    expect(
      rewriteToAnthropicGitProxy('git@github.com:a/b.git', {
        apiBaseUrl: 'https://api.anthropic.com',
        sessionId: 's',
      }),
    ).toBeUndefined()
  })

  test('rewriteToGovernedGitMount (mjv)', () => {
    const r = rewriteToGovernedGitMount(
      'https://github.com/acme/app.git',
      'https://mount.example/git',
    )
    expect(r).toEqual({
      url: 'https://mount.example/git/github.com/acme/app',
      owner: 'acme',
      repo: 'app',
      upstreamUrl: 'https://github.com/acme/app',
    })
    // host regex is [a-z0-9.-] after toLowerCase — underscore rejected; case folded OK
    expect(
      rewriteToGovernedGitMount('https://Bad_Host/x/y', 'https://m'),
    ).toBeUndefined()
    expect(
      rewriteToGovernedGitMount('https://GitHub.com/x/y', 'https://m')?.url,
    ).toBe('https://m/github.com/x/y')
    // "." / ".." hosts rejected
    expect(
      rewriteToGovernedGitMount('https://./x/y', 'https://m'),
    ).toBeUndefined()
    expect(
      rewriteToGovernedGitMount('https://../x/y', 'https://m'),
    ).toBeUndefined()
  })

  test('parseGovernedGitConfig (djv)', () => {
    const warns: string[] = []
    const ok = parseGovernedGitConfig(
      {
        git_mount_base_url: 'https://mount.example/git/',
        tool_config: { git_config: true, gh_path_shim: false },
      },
      () => 'tok',
      m => warns.push(m),
    )
    expect(ok?.mountBaseUrl).toBe('https://mount.example/git')
    expect(ok?.toolConfig).toEqual({ gitConfig: true, ghPathShim: false })
    expect(ok?.getSessionToken()).toBe('tok')

    const bad = parseGovernedGitConfig(
      { git_mount_base_url: 'ftp://nope' },
      () => 't',
      m => warns.push(m),
    )
    expect(bad).toBeUndefined()
    expect(warns.some(w => w.includes('unusable git mount URL'))).toBe(true)

    const local = parseGovernedGitConfig(
      { git_mount_base_url: 'http://127.0.0.1:9000/git' },
      () => 't',
      () => {},
    )
    expect(local?.mountBaseUrl).toBe('http://127.0.0.1:9000/git')
  })

  test('mapSourcesForCheckout (pjv) prefers governed then proxy', () => {
    const gov = mapSourcesForCheckout(
      [
        {
          type: 'git_repository',
          url: 'https://github.com/acme/app.git',
          revision: 'main',
        },
      ],
      {
        governedGit: {
          mountBaseUrl: 'https://mount.example/git',
          getSessionToken: () => 'gov-tok',
        },
        anthropicGitProxy: {
          apiBaseUrl: 'https://api.anthropic.com',
          sessionId: 'ses',
        },
      },
    )
    expect(gov[0]!.governedMount).toBe(true)
    expect(gov[0]!.url).toContain('mount.example')
    expect(gov[0]!.getAuthToken?.()).toBe('gov-tok')

    const proxy = mapSourcesForCheckout(
      [
        {
          type: 'git_repository',
          url: 'https://github.com/acme/app.git',
        },
      ],
      {
        anthropicGitProxy: {
          apiBaseUrl: 'https://api.anthropic.com',
          sessionId: 'ses',
        },
      },
    )
    expect(proxy[0]!.url).toContain('git_proxy/acme/app.git')
    // densable fjv path attaches getAuthToken reading CLAUDE_CODE_SESSION_ACCESS_TOKEN
    expect(typeof proxy[0]!.getAuthToken).toBe('function')
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN = 'sess-tok'
    expect(proxy[0]!.getAuthToken?.()).toBe('sess-tok')
    delete process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN
  })
})

describe('densable 2.1.224 #1 runCheckoutHook (H2h)', () => {
  test('success requires dir + .git', async () => {
    const dir = tmp()
    const hook = join(dir, 'checkout')
    const checkoutPath = join(dir, 'repo')
    writeFileSync(hook, `#!/bin/sh\nmkdir -p "${checkoutPath}/.git"\nexit 0\n`)
    chmodSync(hook, 0o755)
    await runCheckoutHook({
      hookPath: hook,
      sessionId: 'cse_01test',
      repoUrl: 'https://github.com/a/b',
      checkoutPath,
      apiBaseUrl: 'https://api.anthropic.com',
      gitMountUrl: '',
      sessionAccessToken: 'tok',
      cwd: dir,
      onStatus: () => {},
      onDebug: () => {},
    })
  })

  test('fails when .git missing unless skip', async () => {
    const dir = tmp()
    const hook = join(dir, 'checkout')
    const checkoutPath = join(dir, 'repo')
    writeFileSync(hook, `#!/bin/sh\nmkdir -p "${checkoutPath}"\nexit 0\n`)
    chmodSync(hook, 0o755)
    await expect(
      runCheckoutHook({
        hookPath: hook,
        sessionId: 's1',
        repoUrl: 'https://github.com/a/b',
        checkoutPath,
        apiBaseUrl: 'https://api.anthropic.com',
        gitMountUrl: '',
        sessionAccessToken: 'tok',
        cwd: dir,
        onStatus: () => {},
        onDebug: () => {},
      }),
    ).rejects.toThrow(/\.git is missing/)
    await runCheckoutHook({
      hookPath: hook,
      sessionId: 's1',
      repoUrl: 'https://github.com/a/b',
      checkoutPath,
      apiBaseUrl: 'https://api.anthropic.com',
      gitMountUrl: '',
      sessionAccessToken: 'tok',
      cwd: dir,
      onStatus: () => {},
      onDebug: () => {},
      skipGitVerify: true,
    })
  })
})

describe('densable 2.1.224 #1 runPostSessionHook (M2h)', () => {
  test('best-effort never throws on nonzero', async () => {
    const dir = tmp()
    const hook = join(dir, 'post-session')
    writeFileSync(hook, '#!/bin/sh\nexit 7\n')
    chmodSync(hook, 0o755)
    await runPostSessionHook({
      hookPath: hook,
      sessionId: 's1',
      exitReason: 'completed',
      debugLogPath: join(dir, 'debug.txt'),
      workspacePaths: [dir],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionAccessToken: 'tok',
      cwd: dir,
      timeoutMs: 5_000,
      onStatus: () => {},
      onDebug: () => {},
    })
  })
})
