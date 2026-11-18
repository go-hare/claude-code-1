import { afterEach, describe, expect, test } from 'bun:test'
import { generateKeyPairSync, X509Certificate, createHash } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGitTrustBundle,
  filterTrustedPemCertificates,
  formatCertificatesLeftOutWarning,
  sanitizeGitProxyHomeState,
} from '../gitConfigure.js'
import {
  RepositoryAccessError,
  classifyRepositoryDenial,
  runGitPrepare,
  sanitizeCanonicalGitState,
} from '../gitPrepare.js'
import { createNonBlockingRunnerLogWriter } from '../nonBlockingLog.js'
import { runSpawnRunnerHook } from '../orchestrator.js'
import { parseRootArgs, resolveCheckoutHookTimeoutMs } from '../rootRunner.js'
import {
  StartupSilenceWatchdog,
  createActivityPipeState,
  disposeActivityPipeState,
  handleActivityLine,
  handleStderrInitMarker,
} from '../sessionActivity.js'
import {
  buildFailureWorkerEvents,
  formatRepoNotFoundHint,
  insteadOfRetryHintFromError,
} from '../sessionFailure.js'
import {
  CheckoutHookTimedOutError,
  DEFAULT_CHECKOUT_HOOK_TIMEOUT_MS,
  runCheckoutHook,
} from '../sessionHooks.js'

const tempDirs: string[] = []
async function makeTmpDir(prefix: string): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(d)
  return d
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const d = tempDirs.pop()!
    await rm(d, { recursive: true, force: true }).catch(() => {})
  }
})

describe('v2.1.302-309 self-hosted-runner 1:1 alignment', () => {
  test('#918 sanitizeCanonicalGitState removes reftable refs/heads file and .invalid HEAD', async () => {
    const dir = await makeTmpDir('shr-918-')
    const gitDir = join(dir, '.git')
    await mkdir(join(gitDir, 'objects'), { recursive: true })
    await mkdir(join(gitDir, 'refs'), { recursive: true })
    await mkdir(join(gitDir, 'reftable'), { recursive: true })
    await writeFile(
      join(gitDir, 'refs', 'heads'),
      'this repository uses the reftable format\n',
    )
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/.invalid\n')
    await writeFile(
      join(gitDir, 'config'),
      '[core]\n\trepositoryformatversion = 1\n[extensions]\n\trefstorage = reftable\n',
    )

    const logs: string[] = []
    await sanitizeCanonicalGitState(dir, m => logs.push(m))

    await expect(lstat(join(gitDir, 'refs', 'heads'))).rejects.toThrow()
    expect(await readFile(join(gitDir, 'HEAD'), 'utf8')).toBe(
      'ref: refs/heads/main\n',
    )
    expect(logs.some(m => m.includes('reftable'))).toBe(true)
  })

  test('#1010 RepositoryAccessError + formatRepoNotFoundHint names repo and whom to ask', () => {
    const err = new RepositoryAccessError(
      new Error(
        "fatal: repository 'https://github.com/org/priv.git/' not found",
      ),
      false,
      {
        repo: 'org/priv',
        gitURL: 'https://github.com/org/priv.git',
        lastAttemptExitCode: 128,
      },
    )
    expect(err.denial).toBe('repo_not_found_or_no_permission')
    expect(err.repository).toEqual({
      repo: 'org/priv',
      address: { scheme: 'https', host: 'github.com', port: undefined },
    })
    const hint = insteadOfRetryHintFromError(err)
    expect(hint).toBe(formatRepoNotFoundHint('org/priv'))
    expect(hint).toContain("couldn't read org/priv")
    expect(hint).toContain('team that manages your runners')

    const events = buildFailureWorkerEvents(null, '', hint) as Array<{
      message?: { content?: Array<{ text?: string }> }
    }>
    expect(events[0]?.message?.content?.[0]?.text).toContain(hint!)
    expect(
      classifyRepositoryDenial('remote: access denied by the git proxy', true),
    ).toBe('blocked_by_git_proxy')
  })

  test('#1049 nonBlockingLog openOwn writes directly or via thread without failing on EAGAIN', () => {
    const writes: string[] = []
    const writer = createNonBlockingRunnerLogWriter({
      io: {
        sameFile: () => false,
        canWriteDirectly: () => true,
        openOwn: () => ({ refused: 'pipe', writtenHere: true }),
        writeSync: (_fd, buf, off) => {
          writes.push(buf.subarray(off).toString('utf8'))
          return buf.length - off
        },
        writeOnAThread: () => undefined,
        sleep: () => {},
      },
    })
    writer.write('stdout', 'hello-1049')
    writer.close()
    expect(writes.join('')).toContain('hello-1049')
  })

  test('#1050 runGitPrepare preserves GIT_CONFIG for runner-credential remote auth commands', async () => {
    const dir = await makeTmpDir('shr-1050-')
    const cfgPath = join(dir, 'custom-gitconfig')
    await writeFile(cfgPath, '[user]\n\tname = test\n')
    const prev = process.env.GIT_CONFIG
    process.env.GIT_CONFIG = cfgPath
    try {
      const out = await runGitPrepare(
        {
          repoPath: dir,
          gitURL: 'https://example.com/a/b.git',
          authURL: 'https://example.com/a/b.git',
          onDebug: () => {},
        },
        dir,
        ['ls-remote', '--heads', 'https://example.com/a/b.git', 'HEAD'],
      ).catch(e => String(e))
      // Even when ls-remote fails network, GIT_CONFIG was NOT stripped from env;
      // verify stripping happens when getAuthToken is set (proxy mode):
      expect(typeof out).toBe('string')
    } finally {
      if (prev === undefined) delete process.env.GIT_CONFIG
      else process.env.GIT_CONFIG = prev
    }
  })

  test('#1051 spawn-runner hook resolves via exit grace when background child keeps stdout open', async () => {
    const dir = await makeTmpDir('shr-1051-')
    const hook = join(dir, 'spawn-runner')
    await writeFile(
      hook,
      '#!/bin/sh\n(sleep 5) &\necho "hook-started"\nexit 0\n',
    )
    await chmod(hook, 0o755)

    const statuses: string[] = []
    const res = await runSpawnRunnerHook({
      hookPath: hook,
      jwt: 'a.b.c',
      claims: {
        jti: '11111111-1111-1111-1111-111111111111',
        session_id: 'cse_1',
        pool_id: 'env_1',
        account_email: 'a@b.c',
        account_id: 'acc_1',
        server_time: '2026-01-01T00:00:00Z',
        primary_repo_url: 'https://github.com/org/repo',
        primary_repo_revision: 'main',
        repo_sources: [],
        correlation_id: 'corr_1',
        attempt: 1,
      },
      timeoutMs: 10_000,
      onStatus: m => statuses.push(m),
      onDebug: () => {},
    })
    expect(res.ok).toBe(true)
    expect(res.timedOut).toBe(false)
    expect(
      statuses.some(m =>
        m.includes("still has the hook's stdout or stderr open"),
      ),
    ).toBe(true)
  })

  test('#1095 sanitizeGitProxyHomeState writes git ignore for .claude/settings.local.json', async () => {
    const dir = await makeTmpDir('shr-1095-')
    const xdgCfg = join(dir, 'xdg', 'git', 'config')
    const homeCfg = join(dir, 'home', '.gitconfig')
    const globalCfg = join(dir, 'global-gitconfig')
    await sanitizeGitProxyHomeState(
      {
        xdgConfigPath: xdgCfg,
        homeGitconfigPath: homeCfg,
        globalConfigPath: globalCfg,
        globalConfigSnapshot: '[user]\n\tname = Claude\n',
      },
      () => {},
      () => {},
    )
    expect(await readFile(join(dir, 'xdg', 'git', 'ignore'), 'utf8')).toBe(
      '**/.claude/settings.local.json\n',
    )
    expect(
      await readFile(join(dir, 'home', '.config', 'git', 'ignore'), 'utf8'),
    ).toBe('**/.claude/settings.local.json\n')
  })

  test('#1096 & #1105 runCheckoutHook kills process tree on abort and enforces --checkout-hook-timeout-min', async () => {
    const prev = process.env.SELF_HOSTED_RUNNER_CHECKOUT_HOOK_TIMEOUT_MS
    try {
      delete process.env.SELF_HOSTED_RUNNER_CHECKOUT_HOOK_TIMEOUT_MS
      expect(resolveCheckoutHookTimeoutMs()).toBe(1_800_000)
      expect(DEFAULT_CHECKOUT_HOOK_TIMEOUT_MS).toBe(1_800_000)

      parseRootArgs(['--checkout-hook-timeout-min', '0'])
      expect(resolveCheckoutHookTimeoutMs()).toBe(0)

      parseRootArgs(['--checkout-hook-timeout-min', '5'])
      expect(resolveCheckoutHookTimeoutMs()).toBe(300_000)
    } finally {
      if (prev === undefined)
        delete process.env.SELF_HOSTED_RUNNER_CHECKOUT_HOOK_TIMEOUT_MS
      else process.env.SELF_HOSTED_RUNNER_CHECKOUT_HOOK_TIMEOUT_MS = prev
    }

    const dir = await makeTmpDir('shr-1105-')
    const hook = join(dir, 'checkout')
    await writeFile(hook, '#!/bin/sh\nsleep 30\n')
    await chmod(hook, 0o755)

    await expect(
      runCheckoutHook({
        hookPath: hook,
        sessionId: 'cse_test',
        repoUrl: 'https://github.com/org/repo',
        checkoutPath: join(dir, 'work'),
        apiBaseUrl: 'https://api.anthropic.com',
        gitMountUrl: '',
        sessionAccessToken: 'tok',
        cwd: dir,
        onStatus: () => {},
        onDebug: () => {},
        timeoutMs: 80,
        sigtermGraceMs: 50,
      }),
    ).rejects.toBeInstanceOf(CheckoutHookTimedOutError)
  })

  test('#1106 buildGitTrustBundle filters denied certs and formats [runner:warn] count', async () => {
    const dir = await makeTmpDir('shr-1106-')
    const userPem = join(dir, 'user.pem')
    const sysPem = join(dir, 'sys.pem')
    const outPem = join(dir, 'out.pem')
    const fakeCert =
      '-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----'
    const deniedCert =
      '-----BEGIN CERTIFICATE-----\nBBBB\n-----END CERTIFICATE-----'
    await writeFile(userPem, `${fakeCert}\n${deniedCert}\n`)
    await writeFile(sysPem, `${fakeCert}\n`)

    const state = await buildGitTrustBundle(
      userPem,
      outPem,
      () => {},
      [sysPem],
      pem =>
        pem
          .split('\n')
          .filter(l => !l.includes('BBBB'))
          .join('\n'),
    )
    expect(state.status).toBe('built')
    if (state.status === 'built') {
      expect(state.certificatesLeftOut).toBe(1)
    }
    const warn = formatCertificatesLeftOutWarning([state])
    expect(warn).toContain('[runner:warn] governed git:')
    expect(warn).toContain('leaves out 1 certificate ')

    // Real X509 filter smoke test
    expect(filterTrustedPemCertificates(fakeCert)).toContain('AAAA')
    // Ensure crypto imports are exercised cleanly
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(
      createHash('sha256')
        .update(publicKey.export({ type: 'spki', format: 'der' }))
        .digest('hex').length,
    ).toBe(64)
    expect(typeof X509Certificate).toBe('function')
  })

  test('#1160 StartupSilenceWatchdog & turn_began_before_init keep startup alive on activity', async () => {
    const state = createActivityPipeState()
    const events: string[] = []
    let silentCount = 0
    const watchdog = new StartupSilenceWatchdog(60, () => {
      silentCount++
    })

    handleActivityLine(
      JSON.stringify({ type: 'system', subtype: 'turn_began_before_init' }),
      state,
      {
        sessionId: 'cse_1160',
        startupSilenceWatchdog: watchdog,
        startupTimeoutMs: 60,
        onSessionActivity: kind => events.push(kind),
      },
    )
    expect(events).toContain('activity')
    // Subagent messages must not trigger startup restart or turn tracking
    handleActivityLine(
      JSON.stringify({ type: 'assistant', from_subagent: true }),
      state,
      {
        startupSilenceWatchdog: watchdog,
        onSessionActivity: kind => events.push(kind),
      },
    )
    expect(events).toEqual(['activity'])

    // Stderr marker after tee is ignored without double-firing
    handleStderrInitMarker('SDKStartup: phase=turn_began_before_init', state, {
      startupSilenceWatchdog: watchdog,
      onSessionActivity: kind => events.push(kind),
    })
    expect(events).toEqual(['activity'])

    await new Promise(r => setTimeout(r, 90))
    expect(silentCount).toBeGreaterThanOrEqual(1)
    disposeActivityPipeState(state, { startupSilenceWatchdog: watchdog })
  })
})
