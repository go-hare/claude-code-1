/**
 * densable 2.1.224 #1 residual — aWd/Fjy pure helpers + push_targets map + sanitize gate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_FETCH_DEPTH,
  GIT_H0T_ENV,
  GIT_HARD_CAP_MS,
  GIT_SAFE_CONFIG_ARGS,
  GIT_SILENCE_BUDGET_MS,
  embedTokenInGitUrl,
  errText,
  failFastFetchEnabled,
  fetchDepthArgs,
  formatGitStderr,
  hardenedGitAuth,
  isPermanentFetchRefError,
  isProgressLine,
  isResolvingDeltasComplete,
  isForwardProgress,
  mapOutcomeBranchLists,
  mapOutcomeBranches,
  mapPushTargetsFromRemote,
  maskUrlCredentials,
  parseGitProgressChunk,
  preferFatalLines,
  prepClonePhaseEvent,
  prepStepEvent,
  proxyCredHelperArgs,
  proxySslArgs,
  redactGitArg,
  unsetGitProxyRepoLocalCredHelper,
  redactGitOutput,
  redactSecretsInText,
  resolveFetchDepth,
  resolveSourceGitUrl,
  shouldSanitizeCanonical,
  withCanonicalLock,
} from '../gitPrepare.js'

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
    `shr-gitprep-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(d, { recursive: true })
  dirs.push(d)
  return d
}

describe('densable 2.1.224 #1 gitPrepare pure (aWd/Fjy helpers)', () => {
  test('constants + resolveFetchDepth', () => {
    expect(DEFAULT_FETCH_DEPTH).toBe(50)
    expect(GIT_SILENCE_BUDGET_MS).toBe(120_000)
    expect(GIT_HARD_CAP_MS).toBe(1_800_000)
    // densable h0t (2.1.229 #23 GCM fail-fast)
    expect(GIT_H0T_ENV).toEqual({
      GIT_TERMINAL_PROMPT: '0',
      GIT_ASKPASS: '',
      GCM_INTERACTIVE: 'never',
    })
    expect(GIT_SAFE_CONFIG_ARGS).toContain('core.hooksPath=/dev/null')
    expect(resolveFetchDepth({}).depth).toBe(50)
    expect(
      resolveFetchDepth({ CLAUDE_RUNNER_FETCH_DEPTH: 'full' }).depth,
    ).toBeUndefined()
    expect(
      resolveFetchDepth({ CLAUDE_RUNNER_FETCH_DEPTH: '0' }).depth,
    ).toBeUndefined()
    expect(resolveFetchDepth({ CLAUDE_RUNNER_FETCH_DEPTH: '12' }).depth).toBe(
      12,
    )
    expect(
      resolveFetchDepth({ CLAUDE_RUNNER_FETCH_DEPTH: 'nope' }).invalid,
    ).toBe('nope')
    expect(fetchDepthArgs(false)).toEqual(['--depth', '50'])
    expect(fetchDepthArgs(true)).toEqual([])
  })

  test('redact + mask helpers', () => {
    expect(errText(new Error('boom'))).toBe('boom')
    expect(errText('x')).toBe('x')
    expect(redactSecretsInText('token=abc123secret')).toMatch(/token=/)
    expect(maskUrlCredentials('https://user:pass@host/r.git')).toBe(
      'https://<token>@host/r.git',
    )
    expect(maskUrlCredentials('https://host/r.git')).toBe('https://host/r.git')
    expect(
      redactGitArg(
        'https://user:sekret@gh.com/a/b.git',
        'https://user:sekret@gh.com/a/b.git',
        'https://gh.com/a/b.git',
        'sekret',
      ),
    ).not.toContain('sekret')
    expect(
      redactGitOutput('fatal: auth sekret failed', 'https://x', 'sekret'),
    ).not.toContain('sekret')
  })

  test('url + auth helpers', () => {
    expect(
      resolveSourceGitUrl({
        type: 'github',
        repo: 'o/r',
        url: 'https://github.com/o/r.git',
      }),
    ).toBe('https://github.com/o/r.git')
    expect(
      embedTokenInGitUrl('https://github.com/o/r.git', 'SECRET'),
    ).toContain('SECRET')
    expect(proxyCredHelperArgs('https://api.example.com/proxy/o/r')).toContain(
      '-c',
    )
    expect(proxySslArgs('https://api.example.com/x').length).toBeGreaterThan(0)
    const auth = hardenedGitAuth({
      type: 'github',
      repo: 'o/r',
      url: 'https://github.com/o/r.git',
      token: 't',
    })
    expect(auth.args).toContain('-c')
    expect(auth.authURL).toContain('github.com')
  })

  test('progress parse + fail-fast flags', () => {
    expect(isProgressLine('Receiving objects: 50% (1/2)')).toBe(true)
    expect(isProgressLine('hello')).toBe(false)
    const { display, client } = parseGitProgressChunk(
      'Receiving objects: 50% (5/10), 1.2 MiB\n',
      false,
    )
    expect(display?.label).toBe('Receiving objects')
    expect(display?.pct).toBe(50)
    expect(client?.done).toBe(5)
    expect(client?.total).toBe(10)
    expect(
      isResolvingDeltasComplete({
        label: 'Resolving deltas',
        pct: 100,
        raw: 'x',
      }),
    ).toBe(true)
    expect(
      isForwardProgress(
        { label: 'Receiving objects', pct: 10, raw: 'a' },
        { label: 'Receiving objects', pct: 20, raw: 'b' },
      ),
    ).toBe(true)
    expect(preferFatalLines('info\nfatal: nope\nmore')).toContain('fatal')
    expect(
      formatGitStderr('fatal: x', false, 'https://x', undefined),
    ).toContain('fatal')
    expect(isPermanentFetchRefError("couldn't find remote ref main")).toBe(true)
    expect(failFastFetchEnabled({ CLAUDE_RUNNER_FAIL_FAST_FETCH: '1' })).toBe(
      true,
    )
  })

  test('push_targets maps (Ajv/Rjv/Jjy)', () => {
    const targets = mapPushTargetsFromRemote([
      {
        type: 'git_repository',
        git_info: { repo: 'o/r', branches: ['out-a', 'out-b', 'out-a'] },
      },
      { type: 'other', git_info: { repo: 'x' } },
      {
        type: 'git_repository',
        git_info: { repo: 'o/s', branches: ['..evil', 'ok'] },
      },
    ])
    expect(targets).toEqual([
      { repo: 'o/r', branches: ['out-a', 'out-b', 'out-a'] },
      { repo: 'o/s', branches: ['..evil', 'ok'] },
    ])
    const lists = mapOutcomeBranchLists(targets)
    expect(lists.get('o/r')).toEqual(['out-a', 'out-b'])
    expect(lists.get('o/s')).toEqual(['ok'])
    expect(() =>
      mapOutcomeBranches([{ repo: 'o/r', branches: ['a', 'b'] }]),
    ).toThrow(/expected 0 or 1/)
    expect(
      mapOutcomeBranches([{ repo: 'o/r', branches: ['only'] }]).get('o/r'),
    ).toBe('only')
  })

  test('prep events (sBh/Ujv)', () => {
    const step = prepStepEvent('clone', 'started', 'Preparing o/r', {
      step_detail: 'o/r',
    })
    expect(step.type).toBe('env_manager_log')
    expect(step.data.extra.step_id).toBe('clone')
    expect(step.data.extra.step_status).toBe('started')
    const phase = prepClonePhaseEvent('o/r', 'validateAccess', 12, {
      foo: 'bar',
    })
    expect(phase.data.content).toContain('validateAccess')
    expect(phase.data.extra.clone_phase).toBe('validateAccess')
    expect(phase.data.extra.duration_ms).toBe('12')
  })

  test('shouldSanitizeCanonical (hjv)', () => {
    const logs: string[] = []
    expect(shouldSanitizeCanonical(m => logs.push(m), '/canon', {})).toBe(true)
    logs.length = 0
    expect(
      shouldSanitizeCanonical(m => logs.push(m), '/canon', {
        CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM: '1',
        SELF_HOSTED_RUNNER_DRAIN_GRACE_MS: '0',
      }),
    ).toBe(false)
    expect(logs.some(m => m.includes('TRUST_CANONICAL_PREWARM'))).toBe(true)
    logs.length = 0
    expect(
      shouldSanitizeCanonical(m => logs.push(m), '/canon', {
        CLAUDE_RUNNER_TRUST_CANONICAL_PREWARM: '1',
        SELF_HOSTED_RUNNER_DRAIN_GRACE_MS: '5000',
      }),
    ).toBe(true)
    expect(logs.some(m => m.includes('ignored'))).toBe(true)
  })

  test('withCanonicalLock serializes same key', async () => {
    const locks = new Map<string, Promise<unknown>>()
    const order: number[] = []
    await Promise.all([
      withCanonicalLock(locks, 'a', async () => {
        order.push(1)
        await new Promise(r => setTimeout(r, 20))
        order.push(2)
      }),
      withCanonicalLock(locks, 'a', async () => {
        order.push(3)
      }),
    ])
    expect(order).toEqual([1, 2, 3])
  })

  test('prepareSources skip unsupported type (smoke)', async () => {
    const base = tmp()
    writeFileSync(join(base, 'marker'), '1')
    const { prepareSources } = await import('../gitPrepare.js')
    const debug: string[] = []
    await prepareSources({
      baseDir: base,
      sources: [{ type: 'unsupported', repo: 'o/r', url: 'https://x/o/r' }],
      onDebug: m => debug.push(m),
    })
    expect(debug.some(m => m.includes('Skipping unsupported'))).toBe(true)
  })

  test('unsetGitProxyRepoLocalCredHelper (Be) unsets helper + origin helper', async () => {
    const dir = tmp()
    const init = Bun.spawnSync(['git', 'init', dir], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    expect(init.exitCode).toBe(0)
    const origin = 'https://api.example.com'
    Bun.spawnSync(
      [
        'git',
        '-C',
        dir,
        'config',
        '--local',
        '--replace-all',
        'credential.helper',
        '',
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    )
    Bun.spawnSync(
      [
        'git',
        '-C',
        dir,
        'config',
        '--local',
        '--replace-all',
        `credential.${origin}.helper`,
        '!f() { :; }; f',
      ],
      { stdout: 'ignore', stderr: 'ignore' },
    )
    const beforeHelper = Bun.spawnSync(
      ['git', '-C', dir, 'config', '--local', '--get-all', 'credential.helper'],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    expect(beforeHelper.exitCode).toBe(0)
    const debug: string[] = []
    await unsetGitProxyRepoLocalCredHelper(dir, `${origin}/v1/proxy`, m =>
      debug.push(m),
    )
    const afterHelper = Bun.spawnSync(
      ['git', '-C', dir, 'config', '--local', '--get-all', 'credential.helper'],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    // densable: --unset-all credential.helper '^$' — empty helper gone
    expect(afterHelper.exitCode).not.toBe(0)
    const afterOrigin = Bun.spawnSync(
      [
        'git',
        '-C',
        dir,
        'config',
        '--local',
        '--get-all',
        `credential.${origin}.helper`,
      ],
      { stdout: 'pipe', stderr: 'ignore' },
    )
    expect(afterOrigin.exitCode).not.toBe(0)
    expect(
      debug.some(m => m.includes('unset git-proxy local credential.helper')),
    ).toBe(true)
  })

  test('killProcessTree Ane guards + listProcessDescendants (VE_)', async () => {
    const {
      killProcessTree,
      listProcessDescendants,
      KILL_PROCESS_TREE_ENUM_TIMEOUT_MS,
    } = await import('../gitPrepare.js')
    expect(KILL_PROCESS_TREE_ENUM_TIMEOUT_MS).toBe(500)
    // densable Ane: pid<=1 no-op
    await killProcessTree(0)
    await killProcessTree(1)
    await killProcessTree(1.5 as unknown as number)
    // self has no descendants that are not self
    const desc = await listProcessDescendants(process.pid)
    expect(desc instanceof Set).toBe(true)
    expect(desc.has(process.pid)).toBe(false)
    // killing a long-gone pid must not throw
    await killProcessTree(2_147_483_646)
  })
})
