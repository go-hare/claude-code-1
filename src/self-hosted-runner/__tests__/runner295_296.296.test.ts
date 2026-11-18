import { describe, expect, test } from 'bun:test'
import { buildSessionChildEnv } from '../sessionChild.js'
import { buildHookBaseEnv } from '../sessionHooks.js'
import {
  GIT_HARD_CAP_MS,
  GIT_SERVER_PROGRESS_CAP_DEFAULT_MS,
  GIT_SILENCE_BUDGET_MS,
  isServerForwardProgress,
  parseGitProgressChunk,
  resolveFetchServerProgressCapMs,
} from '../gitPrepare.js'
import { assertRunnerApiOk, formatRegisterRunnerRefusal } from '../runnerApi.js'
import {
  computeGovernedGitTls,
  createGitTlsSessionState,
  formatRunnerMountTlsWarning,
  prepareGitTlsTrustBundle,
} from '../gitConfigure.js'

describe('self-hosted-runner 2.1.295-2.1.296 alignment', () => {
  test('#471 strips CCR_AUTO_MODE_ALLOW, CCR_AUTO_MODE_ENVIRONMENT, CCR_AUTO_MODE_SOFT_DENY from session and hook env', () => {
    const prevAllow = process.env.CCR_AUTO_MODE_ALLOW
    const prevEnv = process.env.CCR_AUTO_MODE_ENVIRONMENT
    const prevDeny = process.env.CCR_AUTO_MODE_SOFT_DENY
    try {
      process.env.CCR_AUTO_MODE_ALLOW = 'a'
      process.env.CCR_AUTO_MODE_ENVIRONMENT = 'e'
      process.env.CCR_AUTO_MODE_SOFT_DENY = 'd'

      const childEnv = buildSessionChildEnv({
        sessionId: 'sess_1',
        workerEpoch: 1,
        apiBaseUrl: 'https://api.example.com',
        sessionToken: 'tok',
        configDir: '/tmp/sess_1/cfg',
        stageFileRoot: '/tmp/sess_1/stage',
        inferenceAccessToken: 'inf_tok',
        environmentVariables: {},
      })
      expect(childEnv.CCR_AUTO_MODE_ALLOW).toBeUndefined()
      expect(childEnv.CCR_AUTO_MODE_ENVIRONMENT).toBeUndefined()
      expect(childEnv.CCR_AUTO_MODE_SOFT_DENY).toBeUndefined()
      expect(childEnv.CCR_AUTO_MODE_APPLY).toBeUndefined()

      const hookEnv = buildHookBaseEnv({
        CCR_AUTO_MODE_ALLOW: 'a',
        CCR_AUTO_MODE_ENVIRONMENT: 'e',
        CCR_AUTO_MODE_SOFT_DENY: 'd',
        CCR_AUTO_MODE_APPLY: '1',
        KEEP_ME: 'ok',
      })
      expect(hookEnv.CCR_AUTO_MODE_ALLOW).toBeUndefined()
      expect(hookEnv.CCR_AUTO_MODE_ENVIRONMENT).toBeUndefined()
      expect(hookEnv.CCR_AUTO_MODE_SOFT_DENY).toBeUndefined()
      expect(hookEnv.CCR_AUTO_MODE_APPLY).toBeUndefined()
      expect(hookEnv.KEEP_ME).toBe('ok')
    } finally {
      if (prevAllow === undefined) delete process.env.CCR_AUTO_MODE_ALLOW
      else process.env.CCR_AUTO_MODE_ALLOW = prevAllow
      if (prevEnv === undefined) delete process.env.CCR_AUTO_MODE_ENVIRONMENT
      else process.env.CCR_AUTO_MODE_ENVIRONMENT = prevEnv
      if (prevDeny === undefined) delete process.env.CCR_AUTO_MODE_SOFT_DENY
      else process.env.CCR_AUTO_MODE_SOFT_DENY = prevDeny
    }
  })

  test('#472 resolves CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS and parses server progress', () => {
    expect(resolveFetchServerProgressCapMs({})).toEqual({
      capMs: GIT_SERVER_PROGRESS_CAP_DEFAULT_MS,
      invalid: undefined,
      clamped: undefined,
    })
    expect(
      resolveFetchServerProgressCapMs({
        CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS: 'off',
      }),
    ).toEqual({ capMs: 0, invalid: undefined, clamped: undefined })
    expect(
      resolveFetchServerProgressCapMs({
        CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS: '0',
      }),
    ).toEqual({ capMs: 0, invalid: undefined, clamped: undefined })
    expect(
      resolveFetchServerProgressCapMs({
        CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS: '5000',
      }),
    ).toEqual({
      capMs: GIT_SILENCE_BUDGET_MS,
      invalid: undefined,
      clamped: '5000',
    })
    expect(
      resolveFetchServerProgressCapMs({
        CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS: '9999999',
      }),
    ).toEqual({
      capMs: GIT_HARD_CAP_MS,
      invalid: undefined,
      clamped: '9999999',
    })
    expect(
      resolveFetchServerProgressCapMs({
        CLAUDE_RUNNER_FETCH_SERVER_PROGRESS_CAP_MS: 'bogus',
      }),
    ).toEqual({
      capMs: GIT_SERVER_PROGRESS_CAP_DEFAULT_MS,
      invalid: 'bogus',
      clamped: undefined,
    })

    const parsed = parseGitProgressChunk('remote: Enumerating objects: 42\n')
    expect(parsed.server).toEqual({
      sideband: true,
      label: 'Enumerating objects',
      pct: 0,
      done: 42,
      raw: 'remote: Enumerating objects: 42',
    })
    expect(parsed.client).toBeUndefined()

    const seen = new Set<string>()
    expect(isServerForwardProgress(undefined, seen, parsed.server!)).toBe(true)
    seen.add('Enumerating objects')
    expect(
      isServerForwardProgress(parsed.server, seen, {
        ...parsed.server!,
        done: 50,
      }),
    ).toBe(true)
    expect(
      isServerForwardProgress(parsed.server, seen, {
        ...parsed.server!,
        done: 42,
      }),
    ).toBe(false)
  })

  test('#506 formats RegisterRunner work-order refusals and org-disabled errors', () => {
    let caught: unknown
    try {
      assertRunnerApiOk(
        409,
        {
          error: {
            type: 'work_order_not_redeemable',
            reason: 'already_registered',
            message: 'already used',
          },
        },
        'RegisterRunner',
      )
    } catch (e) {
      caught = e
    }
    const refusal = formatRegisterRunnerRefusal(caught)
    expect(refusal?.exitCode).toBe(1)
    expect(refusal?.line).toContain(
      'A restarted runner needs a fresh work order',
    )
    expect(refusal?.line).toContain('already been used')

    let orgErr: unknown
    try {
      assertRunnerApiOk(
        403,
        {
          error: {
            reason: 'self_hosted_environments_disabled',
            message: 'disabled',
          },
        },
        'RegisterRunner',
      )
    } catch (e) {
      orgErr = e
    }
    expect(
      (orgErr as { isSelfHostedDisabledByOrg?: boolean })
        .isSelfHostedDisabledByOrg,
    ).toBe(true)
  })

  test('#507 marks trustBundle unavailable with shared_with_other_sessions when capacity > 1', async () => {
    const state = createGitTlsSessionState(
      { GIT_SSL_CAINFO: '/etc/ssl/corp.pem' },
      false,
      { mountBaseUrl: 'https://git.anthropic.com/mount' },
      '/tmp/sess/trust-bundle.pem',
      true,
    )
    await prepareGitTlsTrustBundle(state, async () => ({
      status: 'built',
      path: '/tmp/sess/trust-bundle.pem',
    }))
    expect(state.trustBundle).toEqual({
      status: 'unavailable',
      reason: 'shared_with_other_sessions',
    })
    const warning = formatRunnerMountTlsWarning(state)
    expect(warning).toContain('--capacity above 1')

    const prep = computeGovernedGitTls({
      role: 'prep',
      operator: state.operator,
      routing: state.routing,
      target: {
        url: 'https://git.anthropic.com/mount/repo',
        mountRouted: true,
      },
      trustBundle: state.trustBundle,
    })
    expect(prep.commandScopeEntries).toEqual([])
  })
})
