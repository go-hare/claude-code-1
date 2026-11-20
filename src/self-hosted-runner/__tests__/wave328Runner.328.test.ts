import { afterEach, describe, expect, test } from 'bun:test'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  buildGovernedGitHostConfigBlock,
  isAnthropicManagedGitActiveForPhase,
  shouldSkipAgentProxyGitSetupInChildSession,
  stripAnthropicManagedGitEnv,
} from 'src/utils/agentProxy/ghShim.js'
import {
  reconstructTasksFromTranscriptMessages,
  restoreTaskListOnSelfHostedRunnerResume,
} from 'src/utils/tasks.js'
import {
  areGitHubToolsRestrictedBySettings,
  evaluateSessionBuiltInGhDecision,
} from '../ghStandin.js'
import {
  GOVERNED_GIT_DISABLE_PROACTIVE_AUTH_KEY,
  isGovernedGitConfigAllowed,
  wipeHomeGitConfigForProxy,
} from '../gitConfigure.js'
import {
  assertPushTargetRepoPathNotSymlink,
  parseRepositoryFolderSpec,
  prepareSources,
  resolveRepositoryFolderPath,
  sanitizeCanonicalGitState,
  validateRepositoryFolderSpecs,
  withCanonicalLock,
} from '../gitPrepare.js'
import {
  formatIgnoredHostDefaultModeWarning,
  SELF_HOSTED_ACCEPTED_HOST_DEFAULT_MODES,
  type HostConfigSnapshot,
} from '../hostConfig.js'
import {
  buildHookLabelEnv,
  classifyOrchestratorSpawnReason,
  emptySessionQueueWaits,
  emptySessionQueueWaitsByReason,
  emptySessionsGivenUp,
  emptySpawnHookDurations,
  extractSpawnHintClaims,
  HookLabelDisallowedError,
  isHookLabelValueAllowed,
  observeSessionQueueWait,
  ORCH_SPAWN_REASONS,
  parseHookLabelSpec,
  parseOrchestratorArgs,
  renderOrchestratorMetrics,
  runOrchestratorLoop,
  type OrchestratorHealthState,
} from '../orchestrator.js'
import {
  parseRootArgs,
  reportAndDeregisterOnPostRegisterFailure,
  StartupFatalError,
} from '../rootRunner.js'
import {
  createSelfHostedRunnerApi,
  emptyRunnerErrorCounts,
  type SelfHostedRunnerApi,
  type SpawnHint,
} from '../runnerApi.js'
import {
  buildSessionChildArgs,
  buildSessionChildEnv,
  isSessionRetryWatchdogActive,
  stripSessionRetryEnvForChildSubprocess,
} from '../sessionChild.js'
import {
  buildFailureWorkerEvents,
  trimFailureOutputPreservingLead,
} from '../sessionFailure.js'
import {
  buildHookBaseEnv,
  computePostSessionDiskProbeTimeoutMs,
  POST_SESSION_DISK_PROBE_BASE_MS,
  POST_SESSION_DISK_PROBE_MAX_MS,
  POST_SESSION_FINAL_SAVE_BUDGET_MS,
  runnerSessionUuidEnv,
} from '../sessionHooks.js'
import { ensureReadableSessionClaudeJson } from '../sessionSeed.js'
import {
  buildSelfHostedSessionAppendPrompt,
  formatMissingRepositoriesPromptNote,
  RESUMED_SELF_HOSTED_WORK_CHECK_NOTE,
} from '../sessionText.js'
import { buildSetupSystemPrompt } from '../setupDoctor.js'
import { createTokenRefreshScheduler } from '../tokenRefresh.js'
import { subprocessEnv } from '../../utils/subprocessEnv.js'

const tempDirs: string[] = []
async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
})

function makeJwt(payload: Record<string, unknown>): string {
  const h = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const p = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${h}.${p}.sig`
}

describe('Wave 327-328 Self-Hosted Runner & Cloud Session', () => {
  test('#377 wipeHomeGitConfigForProxy keeps non-empty GIT_CONFIG_GLOBAL dir and ancestors', async () => {
    const root = await makeTempDir('shr-377-')
    const homeDir = join(root, 'home')
    const xdgGit = join(homeDir, '.config', 'git')
    const runnerDir = join(root, 'ws', '.runner')
    const nonEmptyDir = join(root, 'custom-dir')
    await mkdir(xdgGit, { recursive: true })
    await mkdir(runnerDir, { recursive: true })
    await mkdir(nonEmptyDir, { recursive: true })
    await writeFile(join(nonEmptyDir, 'keep.txt'), 'keep')
    await writeFile(join(homeDir, '.gitconfig'), '[user]\nname=a\n')

    const outcome = await wipeHomeGitConfigForProxy({
      globalCfgPath: nonEmptyDir,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcome).toBe('kept')
    expect(await readFile(join(nonEmptyDir, 'keep.txt'), 'utf8')).toBe('keep')

    // Ancestor directory (homeDir holds ~/.gitconfig) must also be kept
    const outcomeAncestor = await wipeHomeGitConfigForProxy({
      globalCfgPath: homeDir,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeAncestor).toBe('kept')
    expect((await lstat(homeDir)).isDirectory()).toBe(true)

    // Regular file at GIT_CONFIG_GLOBAL is wiped cleanly
    const cfgFile = join(root, 'my.gitconfig')
    await writeFile(cfgFile, '[core]\n')
    const outcomeFile = await wipeHomeGitConfigForProxy({
      globalCfgPath: cfgFile,
      homeGitconfigPath: join(homeDir, '.gitconfig'),
      xdgGitDirs: [xdgGit],
      runnerDir,
    })
    expect(outcomeFile).toBe('wiped')
  })

  test('#442 retry watchdog scope & nested child subprocess env stripping', () => {
    const env = buildSessionChildEnv({
      sessionId: 'cse_01ABCDEF',
      sessionToken: makeJwt({ sub: 'user' }),
      workerEpoch: 1,
      configDir: '/tmp/cfg',
      stageFileRoot: '/tmp/stage',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'tok',
    })
    expect(env.CLAUDE_CODE_RETRY_WATCHDOG).toBe('1')
    expect(env.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE).toBeUndefined()
    expect(isSessionRetryWatchdogActive(env)).toBe(true)
    expect(
      isSessionRetryWatchdogActive({
        CLAUDE_CODE_RETRY_WATCHDOG: '1',
        CLAUDE_CODE_RETRY_WATCHDOG_SCOPE: 'capacity',
      }),
    ).toBe(false)

    const scrubbed = stripSessionRetryEnvForChildSubprocess(env)
    expect(scrubbed.CLAUDE_CODE_RETRY_WATCHDOG).toBeUndefined()
    expect(scrubbed.CLAUDE_CODE_RETRY_WATCHDOG_SCOPE).toBeUndefined()
    expect(scrubbed.CLAUDE_CODE_MAX_RETRIES).toBeUndefined()

    const prevWatchdog = process.env.CLAUDE_CODE_RETRY_WATCHDOG
    process.env.CLAUDE_CODE_RETRY_WATCHDOG = '1'
    try {
      const childSubEnv = subprocessEnv()
      expect(childSubEnv.CLAUDE_CODE_RETRY_WATCHDOG).toBeUndefined()
    } finally {
      if (prevWatchdog === undefined) {
        delete process.env.CLAUDE_CODE_RETRY_WATCHDOG
      } else {
        process.env.CLAUDE_CODE_RETRY_WATCHDOG = prevWatchdog
      }
    }
  })

  test('#548 --repository-folder parsing, validation, and path resolution', async () => {
    const root = await realpath(await makeTempDir('shr-548-'))
    const baseDir = join(root, 'workspace')
    const homeDir = join(root, 'home')
    const homeRepoDir = join(homeDir, 'repos', 'app')
    const homeDotDir = join(homeDir, '.config', 'app')
    const homeLibraryDir = join(homeDir, 'Library', 'app')
    const customDir = join(root, 'repos', 'app')
    const symlinkDir = join(root, 'repos', 'link')
    await mkdir(baseDir, { recursive: true })
    await mkdir(homeRepoDir, { recursive: true })
    await mkdir(homeDotDir, { recursive: true })
    await mkdir(homeLibraryDir, { recursive: true })
    await mkdir(customDir, { recursive: true })
    await symlink(customDir, symlinkDir)

    const parsed = parseRootArgs([
      '--capacity',
      '1',
      '--base-dir',
      baseDir,
      '--repository-folder',
      `acme/app=${customDir}`,
    ])
    expect(parsed.repositoryFolders).toEqual([
      { repository: 'acme/app', dir: customDir },
    ])

    await expect(
      validateRepositoryFolderSpecs(parsed.repositoryFolders!, {
        capacity: 1,
        baseDir,
        homeDir,
      }),
    ).resolves.toBeUndefined()

    // Normal subdirectories under $HOME are allowed (official Dc)
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${homeRepoDir}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).resolves.toBeUndefined()

    // $HOME itself and home settings dirs (.*, Library, AppData) are rejected
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${homeDir}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/home directory/)
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${homeDotDir}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/settings/)
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${homeLibraryDir}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/settings/)

    await expect(
      validateRepositoryFolderSpecs(parsed.repositoryFolders!, {
        capacity: 2,
        baseDir,
        homeDir,
      }),
    ).rejects.toThrow(/--capacity 1/)

    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${symlinkDir}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/symbolic link/)

    expect(
      resolveRepositoryFolderPath(
        'acme/app',
        parsed.repositoryFolders,
        join(baseDir, 'app'),
      ),
    ).toBe(customDir)
    expect(
      resolveRepositoryFolderPath(
        'acme/sub',
        [parseRepositoryFolderSpec(`acme/*=${join(root, 'repos')}`)],
        join(baseDir, 'sub'),
      ),
    ).toBe(join(root, 'repos', 'sub'))
  })

  test('#549 warns once when host settings.json sets an ignored defaultMode', () => {
    expect(SELF_HOSTED_ACCEPTED_HOST_DEFAULT_MODES.includes('default')).toBe(
      true,
    )
    const makeSnap = (
      settingsObj: Record<string, unknown>,
    ): HostConfigSnapshot => ({
      sourceDir: '/host/.claude',
      files: new Map([
        [
          'settings.json',
          {
            buf: Buffer.from(JSON.stringify(settingsObj)),
            mode: 0o600,
          },
        ],
      ]),
    })
    expect(
      formatIgnoredHostDefaultModeWarning(
        makeSnap({ permissions: { defaultMode: 'bypassPermissions' } }),
      ),
    ).toContain('defaultMode')
    expect(
      formatIgnoredHostDefaultModeWarning(
        makeSnap({ permissions: { defaultMode: 'plan' } }),
      ),
    ).toBeUndefined()
  })

  test('#550 --hook-label parsing, env export, and disallowed value rejection', () => {
    const args = parseOrchestratorArgs([
      '--hook-label',
      'size=small,large',
      '--hook-label',
      'cpus=1..64',
    ])
    expect(args.hookLabels?.size).toBe(2)

    expect(() =>
      parseOrchestratorArgs(['--hook-label', 'size=small', '--min-idle', '1']),
    ).toThrow(/--min-idle/)
    expect(() =>
      parseOrchestratorArgs([
        '--hook-label',
        'size=small',
        '--hook-label',
        'size=large',
      ]),
    ).toThrow(/twice/)
    expect(() => parseHookLabelSpec('size=any')).toThrow(/--hook-label/)
    expect(() => parseHookLabelSpec('cpus=64..1')).toThrow(/--hook-label/)

    expect(isHookLabelValueAllowed({ min: 1, max: 64 }, '16')).toBe(true)
    expect(isHookLabelValueAllowed({ min: 1, max: 64 }, '01')).toBe(false)
    expect(isHookLabelValueAllowed({ min: 1, max: 64 }, '128')).toBe(false)

    const env = buildHookLabelEnv(args.hookLabels!, {
      size: { value: 'large' },
      cpus: { value: '8' },
    })
    expect(env).toEqual({
      CLAUDE_RUNNER_META_SIZE: 'large',
      CLAUDE_RUNNER_META_CPUS: '8',
    })

    expect(() =>
      buildHookLabelEnv(args.hookLabels!, { size: { value: 'xl' } }),
    ).toThrow(HookLabelDisallowedError)
  })

  test('#551 & #641 --metadata and --correlation-id validation + orchestrator extraction', async () => {
    const { parseCloudLaunch } = await import('src/cli/cloudSession.js')
    const missingEnv = await parseCloudLaunch(
      { metadata: ['size=large'] },
      {
        hasSdkUrl: false,
        nonInteractive: false,
        hasConnect: false,
        hasSSH: false,
      },
    )
    expect(missingEnv.ok).toBe(false)
    if (!missingEnv.ok) expect(missingEnv.error).toContain('--environment')

    const dup = await parseCloudLaunch(
      {
        environment: 'ccpool_1',
        correlationId: 'cid-1',
        metadata: ['correlation_id=cid-2'],
      },
      {
        hasSdkUrl: false,
        nonInteractive: false,
        hasConnect: false,
        hasSSH: false,
      },
    )
    expect(dup.ok).toBe(false)
    if (!dup.ok)
      expect(dup.error).toBe('Error: the label correlation_id is given twice')

    const ok = await parseCloudLaunch(
      {
        environment: 'ccpool_1',
        correlationId: 'req-42',
        metadata: ['size=large', 'cpus=8'],
      },
      {
        hasSdkUrl: false,
        nonInteractive: false,
        hasConnect: false,
        hasSSH: false,
      },
    )
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.value.correlationId).toBe('req-42')
      expect(ok.value.sessionMetadata).toEqual({
        correlation_id: 'req-42',
        size: 'large',
        cpus: '8',
      })
    }

    const hint: SpawnHint = {
      session_uuid: 'sess_1',
      attempt: 1,
      work_order_jwt: makeJwt({ jti: 'jti-1', 'ccr:pool_id': 'ccpool_1' }),
      sources: [],
      metadata: { correlation_id: { value: 'corr-from-meta' } },
    }
    const claims = extractSpawnHintClaims(hint)
    expect(claims.correlation_id).toBe('corr-from-meta')
  })

  test('#552 & #553 orchestrator queue wait by reason + sessions_given_up_total metrics & loop accounting', async () => {
    expect(classifyOrchestratorSpawnReason('session_created')).toBe(
      'session_created',
    )
    expect(classifyOrchestratorSpawnReason('resumed')).toBe('resumed')
    expect(classifyOrchestratorSpawnReason('')).toBe('none')
    expect(classifyOrchestratorSpawnReason('brand_new_reason')).toBe('other')

    const state: OrchestratorHealthState = {
      orchestratorUuid: 'orch-1',
      hostname: 'host-1',
      version: '2.1.328',
      pool_id: 'ccpool_1',
      connected: true,
      last_poll_at: Date.now(),
      last_hint_at: 0,
      last_hook_ok_at: 0,
      last_warm_hook_ok_at: 0,
      last_error: null,
      clock_skew_ms: null,
      queue_counts: null,
      pool_pending_session_count: null,
      pool_active_session_count: null,
      warm_hints_dispatched: 0,
      spawnHooks: { ok: 0, retryable: 0, nonRetryable: 0 },
      pollErrors: emptyRunnerErrorCounts(),
      spawnHookDurations: emptySpawnHookDurations(),
      sessionQueueWaits: emptySessionQueueWaits(),
      sessionQueueWaitsByReason: emptySessionQueueWaitsByReason(),
      sessionsGivenUp: emptySessionsGivenUp(),
      scm_connector: null,
    }

    const ac = new AbortController()
    const nacked: Array<{ retryable: boolean }> = []
    let polls = 0
    const apiClient = {
      pollSpawnHints: async () => {
        polls++
        if (polls > 1) {
          ac.abort()
          throw new Error('aborted')
        }
        return {
          hints: [
            {
              session_uuid: 'sess_bad_label',
              attempt: 1,
              jti: 'jti_1',
              work_order_jwt: makeJwt({
                jti: 'jti_1',
                'ccr:pool_id': 'ccpool_1',
              }),
              sources: [],
              spawn_reason: 'resumed',
              queue_wait_started_at: '2026-01-01T00:00:00.000Z',
              metadata: { size: { value: 'forbidden' } },
            },
          ],
          warm_hints: [],
          pending_count: 0,
          backing_off_count: 0,
          circuit_broken_count: 0,
          pool_pending_session_count: 0,
          pool_active_session_count: 0,
          given_up_count: 3,
          server_date: '2026-01-01T00:00:05.000Z',
        }
      },
      nackSpawnHint: async (body: { retryable: boolean }) => {
        nacked.push({ retryable: body.retryable })
        ac.abort()
        return { gave_up: true }
      },
    } as unknown as SelfHostedRunnerApi

    const args = parseOrchestratorArgs(['--hook-label', 'size=small,large'])
    await runOrchestratorLoop(
      {
        apiClient,
        healthState: state,
        onStatus: () => {},
        onDebug: () => {},
        args,
        hookPath: '/unused',
        pollIntervalMs: 1,
        runHook: async () => {
          throw new Error('should not run hook for disallowed label')
        },
      },
      ac.signal,
    )

    expect(nacked).toEqual([{ retryable: false }])
    expect(state.sessionsGivenUp?.lease_expiry).toBe(3)
    expect(state.sessionsGivenUp?.hook_declined).toBe(1)
    expect(state.sessionQueueWaitsByReason?.resumed.count).toBe(1)
    expect(state.sessionQueueWaitsByReason?.resumed.sum).toBe(5)

    // Render metrics and verify both new metric families
    observeSessionQueueWait(state.sessionQueueWaitsByReason!.session_created, 2)
    const metrics = renderOrchestratorMetrics(state)
    for (const reason of ORCH_SPAWN_REASONS) {
      expect(metrics).toContain(
        `claude_code_self_hosted_orchestrator_session_queue_wait_by_reason_seconds_count{reason="${reason}"}`,
      )
    }
    expect(metrics).toContain(
      'claude_code_self_hosted_orchestrator_sessions_given_up_total{cause="lease_expiry"} 3',
    )
    expect(metrics).toContain(
      'claude_code_self_hosted_orchestrator_sessions_given_up_total{cause="hook_declined"} 1',
    )
    expect(metrics).toContain(
      'claude_code_self_hosted_orchestrator_sessions_given_up_total{cause="retries_exhausted"} 0',
    )
  })

  test('#629 pollWork rejects HTTP 200 {} empty/malformed responses', async () => {
    const http = {
      post: async () => ({ status: 200, data: {}, headers: {} }),
    }
    const api = createSelfHostedRunnerApi({
      baseUrl: 'https://api.example.test',
      poolSecret: 'sec',
      http: http as never,
    })
    await expect(api.pollWork('tok', 'runner_1', 1)).rejects.toThrow(
      /malformed poll response/i,
    )
  })

  test('#630 sanitizeCanonicalGitState surfaces non-ENOENT lstat errors instead of swallowing', async () => {
    const root = await makeTempDir('shr-630-')
    const repo = join(root, 'repo')
    const gitDir = join(repo, '.git')
    await mkdir(gitDir, { recursive: true })
    await writeFile(join(gitDir, 'HEAD'), 'ref: refs/heads/main\n')
    // Make .git unreadable so lstat inside .git fails with EACCES (on non-root)
    if (process.getuid?.() !== 0) {
      await chmod(gitDir, 0o000)
      try {
        await expect(
          sanitizeCanonicalGitState(repo, () => {}),
        ).rejects.toThrow()
      } finally {
        await chmod(gitDir, 0o700)
      }
    }
  })

  test('#631 createTokenRefreshScheduler uses dual wall+monotonic deadline loop', async () => {
    const refreshed: string[] = []
    const nowSec = Math.floor(Date.now() / 1000)
    const soonToken = makeJwt({ iat: nowSec - 10, exp: nowSec + 5 })
    const scheduler = createTokenRefreshScheduler({
      getAccessToken: async () => makeJwt({ iat: nowSec, exp: nowSec + 3600 }),
      onRefresh: (_sid, tok) => refreshed.push(tok),
      label: 'test',
      refreshBufferMs: 10_000,
    })
    scheduler.schedule('sess_mono', soonToken)
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(refreshed.length).toBe(1)
    scheduler.cancelAll()
  })

  test('#632, #633, #679 governed git proactiveAuth=none, child session skip, and phase-gated stripping', () => {
    expect(GOVERNED_GIT_DISABLE_PROACTIVE_AUTH_KEY).toBe('http.proactiveAuth')
    const block = buildGovernedGitHostConfigBlock({
      host: 'github.com',
      proxyUrl: 'http://127.0.0.1:8123',
      caBundlePath: '/tmp/ca.pem',
    })
    expect(block).toContain('proactiveAuth = none')

    expect(
      shouldSkipAgentProxyGitSetupInChildSession({
        CLAUDE_CODE_CHILD_SESSION: '1',
      }),
    ).toBe(true)
    expect(shouldSkipAgentProxyGitSetupInChildSession({})).toBe(false)

    expect(isAnthropicManagedGitActiveForPhase('session_claude_active')).toBe(
      true,
    )
    expect(isAnthropicManagedGitActiveForPhase('before_session_claude')).toBe(
      false,
    )
    expect(isAnthropicManagedGitActiveForPhase('after_session_claude')).toBe(
      false,
    )

    const stripped = stripAnthropicManagedGitEnv({
      CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG: '1',
      CLAUDE_CODE_AGENT_PROXY_GH_SHIM: '1',
      CCR_AGENT_PROXY_ENABLED: '1',
      OTHER: 'keep',
    })
    expect(stripped.CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG).toBeUndefined()
    expect(stripped.CLAUDE_CODE_AGENT_PROXY_GH_SHIM).toBeUndefined()
    expect(stripped.CCR_AGENT_PROXY_ENABLED).toBeUndefined()
    expect(stripped.OTHER).toBe('keep')
  })

  test('#634 reportAndDeregisterOnPostRegisterFailure reports session failure and deregisters with reason', async () => {
    const calls: string[] = []
    const apiClient = {
      pollWork: async () => {
        calls.push('pollWork')
        return {
          assignment_ids: ['sess_on_demand'],
          lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
          session_assignments: [],
        }
      },
      reportSessionFailure: async (_t: string, sid: string) => {
        calls.push(`report:${sid}`)
        return { excluded_count: 1, stuck: false }
      },
      deregisterRunner: async (_t: string, body?: { reason?: string }) => {
        calls.push(`deregister:${body?.reason ?? ''}`)
      },
    } as unknown as SelfHostedRunnerApi

    const res = await reportAndDeregisterOnPostRegisterFailure(
      new StartupFatalError('configure_git_failed', 'git failed'),
      {
        apiClient,
        runnerId: 'r_1',
        getRunnerToken: () => 'tok',
        mayHoldSession: true,
        stopRequested: () => false,
        abort: () => calls.push('abort'),
        onStatus: () => {},
        onDebug: () => {},
        settleDelayMs: 0,
      },
    )
    expect(res).toEqual({
      reported: true,
      deregistered: true,
      reason: 'startup_configure_git_failed',
    })
    expect(calls).toEqual([
      'abort',
      'pollWork',
      'report:sess_on_demand',
      'deregister:startup_configure_git_failed',
    ])
  })

  test('#635 withCanonicalLock unblocks queued waiter on AbortSignal without breaking chain', async () => {
    const locks = new Map<string, Promise<unknown>>()
    let releaseFirst!: () => void
    const first = withCanonicalLock(
      locks,
      '/repo',
      () =>
        new Promise<string>(resolve => {
          releaseFirst = () => resolve('first-done')
        }),
    )

    const ac = new AbortController()
    const waiter = withCanonicalLock(
      locks,
      '/repo',
      async () => 'should-not-run',
      ac.signal,
    )
    ac.abort(new Error('shutdown'))
    await expect(waiter).rejects.toThrow()

    releaseFirst()
    expect(await first).toBe('first-done')
    const after = await withCanonicalLock(
      locks,
      '/repo',
      async () => 'after-ok',
    )
    expect(after).toBe('after-ok')
  })

  test('#636 ensureReadableSessionClaudeJson repairs damaged .claude.json with MCP servers disabled', async () => {
    const dir = await makeTempDir('shr-636-')
    const cfgPath = join(dir, '.claude.json')
    await writeFile(cfgPath, '{not valid json!!!')

    const res = await ensureReadableSessionClaudeJson({
      configDir: dir,
      trustWorkspace: false,
      configSuffix: '',
      onStatus: () => {},
    })
    expect(res.repaired).toBe(true)
    const parsed = JSON.parse(await readFile(cfgPath, 'utf8')) as {
      mcpServers?: Record<string, unknown>
    }
    expect(parsed.mcpServers).toEqual({})
  })

  test('#637 trimFailureOutputPreservingLead preserves headline when hook/git stderr is long', () => {
    const lead = 'HEADLINE: git push rejected by pre-receive hook'
    const longBody = `${lead}\n${'x'.repeat(2000)}\nTAIL: exit 1`
    const trimmed = trimFailureOutputPreservingLead(longBody, 200)
    expect(trimmed.length).toBeLessThan(longBody.length)
    expect(trimmed.startsWith(lead)).toBe(true)
    expect(trimmed).toContain('TAIL: exit 1')

    const events = buildFailureWorkerEvents(1, longBody)
    expect(JSON.stringify(events)).toContain('HEADLINE: git push rejected')
  })

  test('#638 computePostSessionDiskProbeTimeoutMs scales cleanly up to 60s cap', () => {
    expect(POST_SESSION_FINAL_SAVE_BUDGET_MS).toBe(25_000)
    expect(computePostSessionDiskProbeTimeoutMs(30_000, false)).toBe(
      POST_SESSION_DISK_PROBE_BASE_MS,
    )
    expect(computePostSessionDiskProbeTimeoutMs(30_000, true)).toBe(15_000)
    expect(computePostSessionDiskProbeTimeoutMs(180_000, true)).toBe(
      POST_SESSION_DISK_PROBE_MAX_MS,
    )
    expect(computePostSessionDiskProbeTimeoutMs(55_000, true)).toBe(27_500)
  })

  test('#639 reconstructTasksFromTranscriptMessages & restoreTaskListOnSelfHostedRunnerResume', async () => {
    const transcript = [
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'TaskCreate',
              input: { subject: 'Build feature', description: 'Details' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok' }],
        },
        toolUseResult: { task: { id: '1', subject: 'Build feature' } },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu2',
              name: 'TaskUpdate',
              input: { taskId: '1', status: 'in_progress' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok' }],
        },
      },
    ]
    const reconstructed = reconstructTasksFromTranscriptMessages(transcript)
    expect(reconstructed.tasks).toHaveLength(1)
    expect(reconstructed.tasks[0]?.subject).toBe('Build feature')
    expect(reconstructed.tasks[0]?.status).toBe('in_progress')

    // Regression (#639): failed TaskUpdate (is_error: true) is ignored, and
    // deleting a task still bumps highestId so deleted IDs are never reused.
    const withFailedAndDelete = reconstructTasksFromTranscriptMessages([
      ...transcript,
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'tu3',
              name: 'TaskUpdate',
              input: { taskId: '1', status: 'completed' },
            },
            {
              type: 'tool_use',
              id: 'tu4',
              name: 'TaskUpdate',
              input: { taskId: '5', status: 'deleted' },
            },
          ],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu3',
              is_error: true,
              content: 'Task update failed',
            },
            { type: 'tool_result', tool_use_id: 'tu4', content: 'deleted' },
          ],
        },
      },
    ])
    expect(withFailedAndDelete.tasks).toHaveLength(1)
    expect(withFailedAndDelete.tasks[0]?.status).toBe('in_progress')
    expect(withFailedAndDelete.highestId).toBe(5)

    const prevEnv = process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE
    const prevConfig = process.env.CLAUDE_CONFIG_DIR
    const dir = await makeTempDir('shr-639-')
    process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE = 'self_hosted'
    process.env.CLAUDE_CONFIG_DIR = dir
    try {
      const restored = await restoreTaskListOnSelfHostedRunnerResume({
        sessionId: 'list-328-test',
        messages: transcript,
        isSelfHostedRunner: true,
      })
      expect(restored.restored).toBe(true)
      expect(restored.writtenCount).toBe(1)
      // Running again when tasks already exist on disk is a no-op
      const second = await restoreTaskListOnSelfHostedRunnerResume({
        sessionId: 'list-328-test',
        messages: transcript,
        isSelfHostedRunner: true,
      })
      expect(second.restored).toBe(false)
      expect(second.writtenCount).toBe(0)
    } finally {
      if (prevEnv === undefined) {
        delete process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE
      } else {
        process.env.CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE = prevEnv
      }
      if (prevConfig === undefined) {
        delete process.env.CLAUDE_CONFIG_DIR
      } else {
        process.env.CLAUDE_CONFIG_DIR = prevConfig
      }
    }
  })

  test('#640 & #661 missing repositories note, resumed work check note, and --append-system-prompt', () => {
    const missingNote = formatMissingRepositoriesPromptNote([
      { repo: 'acme/context-lib', reason: 'checkout hook failed' },
    ])
    expect(missingNote).toContain('acme/context-lib')
    expect(missingNote).toContain('checkout hook failed')

    expect(RESUMED_SELF_HOSTED_WORK_CHECK_NOTE).toContain(
      'another machine or in a fresh checkout',
    )

    const appended = buildSelfHostedSessionAppendPrompt({
      isResumed: true,
      skippedRepositories: [
        { repo: 'acme/context-lib', reason: 'ref not found' },
      ],
    })
    expect(appended).toContain('acme/context-lib')
    expect(appended).toContain(RESUMED_SELF_HOSTED_WORK_CHECK_NOTE)

    const childArgs = buildSessionChildArgs({
      execArgs: [],
      apiBaseUrl: 'https://api.anthropic.com',
      sessionId: 'cse_01XYZ',
      debugFile: '/tmp/d.log',
      appendSystemPrompt: appended,
      onDebug: () => {},
    })
    const idx = childArgs.indexOf('--append-system-prompt')
    expect(idx).toBeGreaterThan(-1)
    expect(appended).toBeDefined()
    expect(childArgs[idx + 1]).toBe(appended!)
  })

  test('#642 setup-doctor warns that revoking an environment key stops runners and risks unpushed work', () => {
    const prompt = buildSetupSystemPrompt('https://claude.ai')
    expect(prompt).toContain('stops every runner')
    expect(prompt).toContain('unpushed work')
  })

  test('#678 built-in gh stand-in is off by default when GitHub tools are denied, on when explicitly requested', () => {
    expect(
      areGitHubToolsRestrictedBySettings([
        { permissions: { deny: ['Bash(gh:*)'] } },
      ]),
    ).toBe(true)
    expect(
      areGitHubToolsRestrictedBySettings([
        { permissions: { deny: ['Read(/etc/shadow)'] } },
      ]),
    ).toBe(false)

    const baseCtx = {
      flag: true,
      windows: false,
      capacity: 1,
      standaloneProxy: false,
      childIsOwnBinary: true,
      essentialTrafficOnly: false,
      thirdPartyProvider: false,
      startedByClaudeCode: false,
      managedGit: false,
      olderGitProxy: false,
      childKind: 'agent-loop' as const,
      review: false,
      githubToolsDenied: true,
    }
    expect(
      evaluateSessionBuiltInGhDecision({ ...baseCtx, isDefaultOffer: true }),
    ).toBe('github_tools_denied')
    expect(
      evaluateSessionBuiltInGhDecision({ ...baseCtx, isDefaultOffer: false }),
    ).toBe('on')
  })

  test('#680 sets both CLAUDE_RUNNER_SESSION_UUID and CLAUDE_CODE_REMOTE_SESSION_UUID', () => {
    const hookEnv = runnerSessionUuidEnv('uuid-123')
    expect(hookEnv).toEqual({
      CLAUDE_RUNNER_SESSION_UUID: 'uuid-123',
      CLAUDE_CODE_REMOTE_SESSION_UUID: 'uuid-123',
    })

    const childEnv = buildSessionChildEnv({
      sessionId: 'session_011111111111111111111111',
      sessionToken: makeJwt({ sub: 'u' }),
      workerEpoch: 1,
      configDir: '/tmp/c',
      stageFileRoot: '/tmp/s',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'tok',
    })
    expect(childEnv.CLAUDE_RUNNER_SESSION_UUID).toBeDefined()
    expect(childEnv.CLAUDE_CODE_REMOTE_SESSION_UUID).toBe(
      childEnv.CLAUDE_RUNNER_SESSION_UUID,
    )
  })

  test('#681 refuses symbolic-link push-target repo path early at capacity 1', async () => {
    const root = await makeTempDir('shr-681-')
    const baseDir = join(root, 'workspace')
    const realTarget = join(root, 'outside')
    await mkdir(baseDir, { recursive: true })
    await mkdir(realTarget, { recursive: true })
    const linkRepo = join(baseDir, 'my-repo')
    await symlink(realTarget, linkRepo)

    await expect(
      assertPushTargetRepoPathNotSymlink(linkRepo, baseDir),
    ).rejects.toThrow(/symbolic link/i)

    const regularRepo = join(baseDir, 'plain-repo')
    await mkdir(regularRepo, { recursive: true })
    await expect(
      assertPushTargetRepoPathNotSymlink(regularRepo, baseDir),
    ).resolves.toBeUndefined()
  })

  test('#548 regression: prepareSources clones into mapped --repository-folder and rejects parent/child overlap', async () => {
    const root = await realpath(await makeTempDir('shr-548-prep-'))
    const baseDir = join(root, 'workspace')
    const homeDir = join(root, 'home')
    const nestedInBase = join(baseDir, 'nested')
    const mappedDir = join(root, 'custom-repos', 'app')
    const bareOrigin = join(root, 'origin.git')
    const seedDir = join(root, 'seed')
    await mkdir(nestedInBase, { recursive: true })
    await mkdir(homeDir, { recursive: true })
    await mkdir(seedDir, { recursive: true })

    // Parent/child containment checks (#548 P2)
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${nestedInBase}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/overlaps/)
    await expect(
      validateRepositoryFolderSpecs(
        [parseRepositoryFolderSpec(`acme/app=${root}`)],
        { capacity: 1, baseDir, homeDir },
      ),
    ).rejects.toThrow(/overlaps/)

    // Create a local bare git origin repo with one commit
    const run = (cmd: string[], cwd?: string) => {
      const proc = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' })
      if (proc.exitCode !== 0) {
        throw new Error(
          `${cmd.join(' ')} failed: ${proc.stderr.toString()} ${proc.stdout.toString()}`,
        )
      }
    }
    run(['git', 'init', '--bare', bareOrigin])
    run(['git', 'init', seedDir])
    run(['git', '-C', seedDir, 'config', 'user.email', 'test@example.com'])
    run(['git', '-C', seedDir, 'config', 'user.name', 'Test'])
    await writeFile(join(seedDir, 'README.md'), 'mapped repo ok\n', 'utf8')
    run(['git', '-C', seedDir, 'add', 'README.md'])
    run(['git', '-C', seedDir, 'commit', '-m', 'init'])
    run(['git', '-C', seedDir, 'remote', 'add', 'origin', bareOrigin])
    run(['git', '-C', seedDir, 'push', 'origin', 'HEAD:refs/heads/main'])

    await prepareSources({
      baseDir,
      repositoryFolders: [{ repository: bareOrigin, dir: mappedDir }],
      sources: [
        {
          type: 'test-file',
          repo: bareOrigin,
          ref: 'main',
        },
      ],
      skipValidation: true,
      alwaysFetch: true,
      skipReset: false,
      onDebug: () => {},
    })

    const content = await readFile(join(mappedDir, 'README.md'), 'utf8')
    expect(content).toContain('mapped repo ok')
    await expect(lstat(join(baseDir, 'origin.git'))).rejects.toThrow()
  })

  test('#377/#632/#633/#679 regression: empty-dir rmdir, governed git proactiveAuth block, and hook/child env wiring', async () => {
    const root = await makeTempDir('shr-wire-')
    const emptyGlobalDir = join(root, 'empty-global-cfg')
    await mkdir(emptyGlobalDir, { recursive: true })
    const res = await wipeHomeGitConfigForProxy({
      globalCfgPath: emptyGlobalDir,
      homeGitconfigPath: join(root, '.gitconfig'),
      xdgGitDirs: [join(root, '.config', 'git')],
      runnerDir: join(root, '.runner'),
    })
    expect(res).toBe('wiped')
    await expect(lstat(emptyGlobalDir)).rejects.toThrow()

    expect(
      isGovernedGitConfigAllowed(
        GOVERNED_GIT_DISABLE_PROACTIVE_AUTH_KEY,
        'basic',
      ),
    ).toBe(false)
    expect(
      isGovernedGitConfigAllowed(
        'http.https://github.com/.proactiveAuth',
        'basic',
      ),
    ).toBe(false)

    // #679: buildHookBaseEnv strips Anthropic-managed git env in non-active phases
    const hookEnv = buildHookBaseEnv(
      {
        CCR_AGENT_PROXY_ENABLED: '1',
        CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG: '1',
        GIT_CONFIG_GLOBAL: '/tmp/session.gitconfig',
        SAFE_VAR: 'keep',
      },
      'before_session_claude',
    )
    expect(hookEnv.CCR_AGENT_PROXY_ENABLED).toBeUndefined()
    expect(hookEnv.CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG).toBeUndefined()
    expect(hookEnv.GIT_CONFIG_GLOBAL).toBeUndefined()
    expect(hookEnv.SAFE_VAR).toBe('keep')

    // #632: buildSessionChildEnv skips re-arming agent-proxy git setup inside nested child session
    const nestedChildEnv = buildSessionChildEnv({
      sessionId: 'session_011111111111111111111111',
      sessionToken: makeJwt({ sub: 'u' }),
      workerEpoch: 1,
      configDir: '/tmp/c',
      stageFileRoot: '/tmp/s',
      apiBaseUrl: 'https://api.anthropic.com',
      inferenceAccessToken: 'tok',
      governedGitConfig: true,
      governedGitConfigPath: '/tmp/should-not-overwrite.gitconfig',
      environmentVariables: {
        CLAUDE_CODE_CHILD_SESSION: '1',
        GIT_CONFIG_GLOBAL: '/tmp/parent.gitconfig',
      },
    })
    expect(nestedChildEnv.GIT_CONFIG_GLOBAL).toBe('/tmp/parent.gitconfig')
    expect(nestedChildEnv.CLAUDE_CODE_AGENT_PROXY_GIT_CONFIG).toBeUndefined()
  })
})
