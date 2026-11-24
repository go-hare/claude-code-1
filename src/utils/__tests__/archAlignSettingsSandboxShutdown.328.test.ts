import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getAllowedSettingSources,
  getIsInteractive,
  setAllowedSettingSources,
  setIsInteractive,
} from '../../bootstrap/state.js'
import {
  ALL_OAUTH_SCOPES,
  DESIGN_CLIENT_ID,
  filterIncrementalOauthScopes,
  getAllOauthScopes,
  getClaudeAiOauthScopes,
  getOauthConfig,
  getOauthScopesWithIncremental,
  PLUGINS_SCOPE,
  PRIVACY_CONSENTS_WRITE_SCOPE,
  PROJECTS_READ_SCOPE,
  PROJECTS_WRITE_SCOPE,
} from '../../constants/oauth.js'
import {
  getPendingTelemetryInitPromiseForTesting,
  initializeTelemetryAfterTrust,
  ProxyConfigError,
  registerRemoteManagedSettingsLoadPromise,
  resetSessionCountMetricForTesting,
  setTelemetryInitializerForTesting,
  validateStartupProxyConfig,
} from '../../entrypoints/init.js'
import {
  computeLimitsFromHeaders,
  extractRawUtilization,
  extractWindowReadings,
  parseRateLimitGraceHeaders,
  resetCurrentLimits,
} from '../../services/claudeAiLimits.js'
import type { Tool, ToolPermissionContext, ToolUseContext } from '../../Tool.js'
import {
  exitIfStartupNeverMounted,
  getFailsafeFiresAtMsForTesting,
  gracefulShutdown,
  handleSighupSignal,
  handleUncaughtException,
  handleUnhandledRejection,
  HTTP2_RECOVERY_BUDGET,
  isHttp2StreamTeardownError,
  isUncaughtBreakerTrippedForTesting,
  markOwnsControllingTerminal,
  markStartupActionStarted,
  markStartupUiMounted,
  recordHttp2RecoveryAndCheckBudget,
  recordUncaughtAndCheckBreaker,
  registerOwedSandboxCleanup,
  resetShutdownState,
  resolveOwedSandboxCleanup,
  SANDBOX_CLEANUP_WAIT_MS,
  SUPERVISED_UNCAUGHT_EXIT_CODE,
  UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD,
} from '../gracefulShutdown.js'
import {
  ALL_MODEL_CONFIGS,
  CANONICAL_MODEL_IDS,
  getOfficialMantleModelId,
  OFFICIAL_MANTLE_MODEL_IDS,
} from '../model/configs.js'
import {
  blockedOutsideReadFileToolMessage,
  checkBashArgvUnderOutsideReadsBlock,
  contextBlocksOutsideReads,
  FILE_TOOL_OUTSIDE_READS_BLOCKED_REASON,
  formatOutsideReadsBlockSettingNames,
  settingsHaveBlockFileToolReadsOutsideWorkingDirectories,
} from '../permissions/outsideReads.js'
import {
  getRemovalWaiverRulesClearForTesting,
  hasPermissionsToUseTool,
  isFileToolOutsideReadFenceActive,
  isRemovalWaiverAllowed,
  resetRemovalWaiverRulesClearForTesting,
  syncPermissionRulesFromDisk,
} from '../permissions/permissions.js'
import {
  applyLinuxNestedUsernsEnv,
  convertToSandboxRuntimeConfig,
  getSrtAllowNestedUsernsEnv,
  resolveTrustedSandboxSettings,
  SRT_ALLOW_NESTED_USERNS_ENV,
} from '../sandbox/sandbox-adapter.js'
import {
  getEnabledSettingSources,
  getSettingSourceDisplayNameCapitalized,
  getSettingSourceDisplayNameLowercase,
  parseSettingSourcesFlag,
  SETTING_SOURCES,
  type SettingSource,
} from '../settings/constants.js'
import { getManagedSettingsKeysForLogging } from '../settings/settings.js'
import {
  resetSettingsCache,
  setCachedSettingsForSource,
  setSessionSettingsCache,
} from '../settings/settingsCache.js'
import { type SettingsJson, SettingsSchema } from '../settings/types.js'

const SAVED_ENV_KEYS = [
  'CLAUDE_BG_BACKEND',
  'CLAUDE_CODE_SUPERVISED',
  'CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_CUSTOM_OAUTH_URL',
  'CLAUDE_CODE_OAUTH_CLIENT_ID',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_ENABLE_TELEMETRY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'http_proxy',
  'https_proxy',
  'TEST_REMOTE_TELEMETRY_ENV',
] as const

let savedAllowedSources: SettingSource[]
let savedIsInteractive: boolean
let savedEnv: Record<string, string | undefined>

function seedSources(bySource: Partial<Record<SettingSource, SettingsJson>>) {
  resetSettingsCache()
  for (const src of SETTING_SOURCES) {
    setCachedSettingsForSource(src, bySource[src] ?? null)
  }
}

function makePermissionContext(
  overrides: Partial<ToolPermissionContext> = {},
): ToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: true,
    ...overrides,
  }
}

beforeEach(() => {
  savedAllowedSources = [...getAllowedSettingSources()]
  savedIsInteractive = getIsInteractive()
  savedEnv = {}
  for (const key of SAVED_ENV_KEYS) {
    savedEnv[key] = process.env[key]
  }
  // Ensure host shell env vars (e.g. CLAUDE_CODE_CHILD_SESSION=1) don't leak into tests
  delete process.env.CLAUDE_CODE_CHILD_SESSION
  delete process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS
  delete process.env.CLAUDE_CODE_SUPERVISED
  delete process.env.CLAUDE_BG_BACKEND
  delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
  delete process.env.CLAUDE_CODE_OAUTH_CLIENT_ID
  delete process.env.TEST_REMOTE_TELEMETRY_ENV
  setAllowedSettingSources(['userSettings', 'projectSettings', 'localSettings'])
  seedSources({})
  resetShutdownState()
  resetSessionCountMetricForTesting()
  resetRemovalWaiverRulesClearForTesting()
  resetCurrentLimits()
})

afterEach(() => {
  setAllowedSettingSources(savedAllowedSources)
  setIsInteractive(savedIsInteractive)
  for (const key of SAVED_ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = savedEnv[key]
    }
  }
  resetSettingsCache()
  resetShutdownState()
  resetSessionCountMetricForTesting()
  resetRemovalWaiverRulesClearForTesting()
  resetCurrentLimits()
})

// ============================================================================
// Group 1 [P0-1]: Settings Precedence & Display Labels
// ============================================================================
describe('Group 1 [P0-1]: getEnabledSettingSources canonical precedence', () => {
  test('always returns flagSettings BEFORE policySettings regardless of --setting-sources', () => {
    setAllowedSettingSources(parseSettingSourcesFlag('user,project,local'))
    expect(getEnabledSettingSources()).toEqual([
      'userSettings',
      'projectSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])

    // Inverted CLI flag order `--setting-sources local,user` must NEVER invert
    // tier precedence or place flagSettings after policySettings.
    setAllowedSettingSources(parseSettingSourcesFlag('local,user'))
    expect(getEnabledSettingSources()).toEqual([
      'userSettings',
      'localSettings',
      'flagSettings',
      'policySettings',
    ])

    // Empty `--setting-sources ""` still keeps canonical flag -> policy order.
    setAllowedSettingSources(parseSettingSourcesFlag(''))
    expect(getEnabledSettingSources()).toEqual([
      'flagSettings',
      'policySettings',
    ])
  })

  test('aligns policySettings and mcpMount display names to official 2.1.328', () => {
    expect(getSettingSourceDisplayNameLowercase('policySettings')).toBe(
      'enterprise managed settings',
    )
    expect(getSettingSourceDisplayNameCapitalized('policySettings')).toBe(
      'Enterprise managed settings',
    )
    expect(getSettingSourceDisplayNameLowercase('mcpMount')).toBe(
      'Remote Control server mount',
    )
    expect(getSettingSourceDisplayNameCapitalized('mcpMount')).toBe(
      'Remote Control server mount',
    )
  })
})

// ============================================================================
// Group 2 [P0-2 + P0-3]: Sandbox Config Isolation, nG(e), SRT_ALLOW_NESTED_USERNS, Schema
// ============================================================================
describe('Group 2 [P0-2 + P0-3]: Sandbox isolation, nG(e), SRT_ALLOW_NESTED_USERNS, managed keys', () => {
  test('rejects project/local weakening flags while honoring trusted tiers (policy > flag > user)', () => {
    seedSources({
      projectSettings: {
        sandbox: {
          allowAppleEvents: true,
          allowNestedUserNamespaces: true,
          enableWeakerNestedSandbox: true,
          enableWeakerNetworkIsolation: true,
        },
      },
      localSettings: {
        sandbox: {
          allowAppleEvents: true,
          allowNestedUserNamespaces: true,
          enableWeakerNestedSandbox: true,
          enableWeakerNetworkIsolation: true,
        },
      },
    })

    const merged: SettingsJson = {
      sandbox: {
        allowAppleEvents: true,
        allowNestedUserNamespaces: true,
        enableWeakerNestedSandbox: true,
        enableWeakerNetworkIsolation: true,
      },
    }

    const resolved = resolveTrustedSandboxSettings(merged)
    expect(resolved.allowAppleEvents).toBeUndefined()
    expect(resolved.allowNestedUserNamespaces).toBeUndefined()
    expect(resolved.enableWeakerNestedSandbox).toBeUndefined()
    expect(resolved.enableWeakerNetworkIsolation).toBeUndefined()

    const runtimeCfg = convertToSandboxRuntimeConfig(merged) as Record<
      string,
      unknown
    >
    expect(runtimeCfg.allowAppleEvents).toBeUndefined()
    expect(runtimeCfg.allowNestedUserNamespaces).toBeUndefined()
    expect(runtimeCfg.enableWeakerNestedSandbox).toBeUndefined()
    expect(runtimeCfg.enableWeakerNetworkIsolation).toBeUndefined()

    // Trusted userSettings works, and policySettings overrides userSettings
    seedSources({
      userSettings: {
        sandbox: {
          allowAppleEvents: true,
          allowNestedUserNamespaces: true,
          enableWeakerNestedSandbox: true,
          enableWeakerNetworkIsolation: true,
        },
      },
      policySettings: {
        sandbox: {
          allowNestedUserNamespaces: false,
        },
      },
    })
    const trustedResolved = resolveTrustedSandboxSettings(merged)
    expect(trustedResolved.allowAppleEvents).toBe(true)
    expect(trustedResolved.allowNestedUserNamespaces).toBe(false)
    expect(trustedResolved.enableWeakerNestedSandbox).toBe(true)
    expect(trustedResolved.enableWeakerNetworkIsolation).toBe(true)
  })

  test('official nG(e): under admin sandbox mandate, drops all 6 network bypass keys from project/local', () => {
    seedSources({
      policySettings: {
        sandbox: { enabled: true },
      },
      userSettings: {
        sandbox: {
          network: {
            allowUnixSockets: ['/trusted/user.sock'],
            allowMachLookup: ['com.trusted.service'],
          },
        },
      },
      projectSettings: {
        sandbox: {
          network: {
            allowUnixSockets: ['/evil/project.sock'],
            allowAllUnixSockets: true,
            allowLocalBinding: true,
            allowMachLookup: ['com.evil.*'],
            httpProxyPort: 9999,
            socksProxyPort: 9998,
          },
        },
      },
    })

    const merged: SettingsJson = {
      sandbox: {
        enabled: true,
        network: {
          allowUnixSockets: ['/trusted/user.sock', '/evil/project.sock'],
          allowAllUnixSockets: true,
          allowLocalBinding: true,
          allowMachLookup: ['com.trusted.service', 'com.evil.*'],
          httpProxyPort: 9999,
          socksProxyPort: 9998,
        },
      },
    }

    const res = resolveTrustedSandboxSettings(merged)
    expect(res.adminMandated).toBe(true)
    expect(res.network.allowUnixSockets).toEqual(['/trusted/user.sock'])
    expect(res.network.allowMachLookup).toEqual(['com.trusted.service'])
    expect(res.network.allowAllUnixSockets).toBeUndefined()
    expect(res.network.allowLocalBinding).toBeUndefined()
    expect(res.network.httpProxyPort).toBeUndefined()
    expect(res.network.socksProxyPort).toBeUndefined()
  })

  test('official nG(e): under trusted deny/strictAllowlist blocks project/local proxy ports; under allowManagedDomainsOnly restricts proxy ports to policySettings only', () => {
    // 1. Trusted strictAllowlist blocks project/local proxy ports
    seedSources({
      userSettings: {
        sandbox: { network: { strictAllowlist: true } },
      },
      projectSettings: {
        sandbox: { network: { httpProxyPort: 8888, socksProxyPort: 8889 } },
      },
    })
    const strictRes = resolveTrustedSandboxSettings({
      sandbox: {
        network: {
          strictAllowlist: true,
          httpProxyPort: 8888,
          socksProxyPort: 8889,
          allowLocalBinding: true,
        },
      },
    })
    expect(strictRes.adminMandated).toBe(false)
    expect(strictRes.trustedNetworkRestricted).toBe(true)
    expect(strictRes.network.httpProxyPort).toBeUndefined()
    expect(strictRes.network.socksProxyPort).toBeUndefined()
    expect(strictRes.network.allowLocalBinding).toBe(true)

    // 2. allowManagedDomainsOnly restricts httpProxyPort/socksProxyPort to policySettings ONLY
    seedSources({
      policySettings: {
        sandbox: {
          network: { allowManagedDomainsOnly: true, httpProxyPort: 3128 },
        },
      },
      flagSettings: {
        sandbox: { network: { httpProxyPort: 7777, socksProxyPort: 7778 } },
      },
      userSettings: {
        sandbox: { network: { httpProxyPort: 6666, socksProxyPort: 6667 } },
      },
    })
    const managedOnlyRes = resolveTrustedSandboxSettings({
      sandbox: {
        network: {
          allowManagedDomainsOnly: true,
          httpProxyPort: 7777,
          socksProxyPort: 7778,
        },
      },
    })
    expect(managedOnlyRes.managedDomainsOnly).toBe(true)
    expect(managedOnlyRes.network.httpProxyPort).toBe(3128)
    expect(managedOnlyRes.network.socksProxyPort).toBeUndefined()
  })

  test('propagates SRT_ALLOW_NESTED_USERNS=0 by default and =1 only from trusted tiers', () => {
    seedSources({
      projectSettings: { sandbox: { allowNestedUserNamespaces: true } },
    })
    expect(getSrtAllowNestedUsernsEnv({})).toEqual({
      [SRT_ALLOW_NESTED_USERNS_ENV]: '0',
    })

    const bwrapCmd = 'bwrap --new-session --die-with-parent -- /bin/bash -c ls'
    const denied = applyLinuxNestedUsernsEnv(bwrapCmd, false)
    expect(denied).toContain('SRT_ALLOW_NESTED_USERNS=0')
    expect(denied).toContain('--setenv SRT_ALLOW_NESTED_USERNS 0 --')

    seedSources({
      userSettings: { sandbox: { allowNestedUserNamespaces: true } },
    })
    expect(getSrtAllowNestedUsernsEnv({})).toEqual({
      [SRT_ALLOW_NESTED_USERNS_ENV]: '1',
    })
    const allowed = applyLinuxNestedUsernsEnv(bwrapCmd, true)
    expect(allowed).toContain('SRT_ALLOW_NESTED_USERNS=1')
    expect(allowed).toContain('--setenv SRT_ALLOW_NESTED_USERNS 1 --')
  })

  test('settings schema accepts sandbox.windows, managedSourcesBehavior, parentSettingsBehavior, $schema, blockFileToolReadsOutsideWorkingDirectories, and logs all managed keys', () => {
    const parsed = SettingsSchema().parse({
      $schema: 'https://example.com/custom-claude-settings-schema.json',
      managedSourcesBehavior: 'merge',
      parentSettingsBehavior: 'first-wins',
      permissions: {
        blockReadsOutsideWorkingDirectories: true,
        blockWritesOutsideWorkingDirectories: true,
        blockFileToolReadsOutsideWorkingDirectories: true,
        denyInsteadOfPrompting: true,
      },
      sandbox: {
        enabled: true,
        allowAppleEvents: false,
        credentials: { envVars: [{ name: 'TOKEN', mode: 'deny' }] },
        windows: { backend: 'mxc' },
        bwrapPath: '/usr/bin/bwrap',
        socatPath: '/usr/bin/socat',
      },
    })
    expect(parsed.sandbox?.windows?.backend).toBe('mxc')
    expect(parsed.managedSourcesBehavior).toBe('merge')
    expect(parsed.parentSettingsBehavior).toBe('first-wins')
    expect(
      parsed.permissions?.blockFileToolReadsOutsideWorkingDirectories,
    ).toBe(true)

    const loggedKeys = getManagedSettingsKeysForLogging(parsed)
    for (const key of [
      'sandbox.allowAppleEvents',
      'sandbox.credentials',
      'sandbox.windows',
      'sandbox.bwrapPath',
      'sandbox.socatPath',
      'permissions.blockReadsOutsideWorkingDirectories',
      'permissions.blockWritesOutsideWorkingDirectories',
      'permissions.blockFileToolReadsOutsideWorkingDirectories',
      'permissions.denyInsteadOfPrompting',
    ]) {
      expect(loggedKeys).toContain(key)
    }
  })
})

// ============================================================================
// Group 3 [P0-4 + P1-2]: Graceful Shutdown, Circuit Breaker, Watchdog, Daemon SIGHUP
// ============================================================================
async function waitForMockCalls(
  spy: { mock: { calls: unknown[] } },
  minCalls = 1,
  timeoutMs = 1500,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (spy.mock.calls.length < minCalls && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('Group 3 [P0-4 + P1-2]: gracefulShutdown single removeWorktree, breaker, watchdog, SIGHUP', () => {
  test('executes removeWorktree strictly once and widens failsafe timeout to cover budgetMs', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      // no-op in test mode
    }) as never)
    try {
      let removeCount = 0
      let observedFailsafeAtMs: number | undefined
      const startMs = Date.now()

      await gracefulShutdown(0, 'other', {
        suppressResumeHint: true,
        removeWorktree: {
          path: '/tmp/test-wt-328',
          budgetMs: 60_000,
          run: async () => {
            removeCount++
            observedFailsafeAtMs = getFailsafeFiresAtMsForTesting()
            return 'Removed worktree'
          },
        },
      })

      expect(removeCount).toBe(1)
      expect(observedFailsafeAtMs).toBeDefined()
      expect(observedFailsafeAtMs! - startMs).toBeGreaterThanOrEqual(55_000)
      expect(exitSpy).toHaveBeenCalledWith(0)
    } finally {
      exitSpy.mockRestore()
    }
  })

  test('uncaught-exception loop circuit breaker trips on 10th exception within 5,000ms and calls process.exit(1)', () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      // no-op in test mode
    }) as never)
    try {
      const base = 1_000_000
      for (let i = 0; i < UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD - 1; i++) {
        expect(recordUncaughtAndCheckBreaker(base + i * 100)).toBe(false)
      }
      // After > 5,000ms window, counter resets
      expect(recordUncaughtAndCheckBreaker(base + 6_000)).toBe(false)

      // Now trigger 10 exceptions within 5,000ms via handleUncaughtException
      resetShutdownState()
      for (let i = 0; i < UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD - 1; i++) {
        const outcome = handleUncaughtException(
          new Error(`boom-${i}`),
          base + 10_000 + i * 50,
        )
        expect(outcome).toBe('logged')
        expect(exitSpy).not.toHaveBeenCalled()
      }
      handleUncaughtException(
        new Error('boom-final'),
        base + 10_000 + UNCAUGHT_EXCEPTION_BREAKER_THRESHOLD * 50,
      )
      expect(isUncaughtBreakerTrippedForTesting()).toBe(true)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
    }
  })

  test('HTTP/2 stream teardown recovery budget allows 50 recoveries per 60,000ms and stops at 51', () => {
    const h2Err = Object.assign(
      new Error('Stream closed with error code NGHTTP2_CANCEL'),
      {
        code: 'ERR_HTTP2_STREAM_ERROR',
        stack:
          'Error: Stream closed with error code NGHTTP2_CANCEL\n    at emitStreamErrorNT (node:http2:123:5)',
      },
    )
    expect(isHttp2StreamTeardownError(h2Err)).toBe(true)
    expect(isHttp2StreamTeardownError(new Error('regular error'))).toBe(false)

    const t0 = 2_000_000
    for (let i = 0; i < HTTP2_RECOVERY_BUDGET; i++) {
      expect(recordHttp2RecoveryAndCheckBudget(t0 + i * 100)).toBe(true)
    }
    expect(recordHttp2RecoveryAndCheckBudget(t0 + 10_000)).toBe(false)
    // Window resets after 60,000ms
    expect(recordHttp2RecoveryAndCheckBudget(t0 + 61_000)).toBe(true)
  })

  test('CLAUDE_CODE_SUPERVISED exits immediately with code 70 on uncaught errors (swallows AbortError)', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      // no-op in test mode
    }) as never)
    try {
      process.env.CLAUDE_CODE_SUPERVISED = '1'
      const abortErr = Object.assign(new Error('aborted'), {
        name: 'AbortError',
      })
      expect(handleUnhandledRejection(abortErr)).toBe('swallowed_abort')
      expect(exitSpy).not.toHaveBeenCalled()

      expect(handleUncaughtException(new TypeError('fatal'))).toBe(
        'supervised_exit',
      )
      expect(isUncaughtBreakerTrippedForTesting()).toBe(true)
      await waitForMockCalls(exitSpy, 1)
      expect(exitSpy).toHaveBeenCalledWith(SUPERVISED_UNCAUGHT_EXIT_CODE)
    } finally {
      exitSpy.mockRestore()
    }
  })

  test('exitIfStartupNeverMounted can be disarmed by markStartupUiMounted or non-UI subcommand', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      // no-op in test mode
    }) as never)
    try {
      // Non-UI subcommand skips watchdog
      markStartupActionStarted(false)
      expect(exitIfStartupNeverMounted('non-ui')).toBe(false)

      // Disarmed once UI mounts
      resetShutdownState()
      markStartupActionStarted(true)
      markStartupUiMounted()
      expect(exitIfStartupNeverMounted('after mount')).toBe(false)

      // Fires when UI never mounted
      resetShutdownState()
      setIsInteractive(true)
      markStartupActionStarted(true)
      expect(exitIfStartupNeverMounted('stuck before mount')).toBe(true)
      await waitForMockCalls(exitSpy, 1)
      expect(exitSpy).toHaveBeenCalledWith(1)
    } finally {
      exitSpy.mockRestore()
    }
  })

  test('daemon SIGHUP is ignored unless controlling terminal is owned, and SANDBOX_CLEANUP_WAIT_MS drains owed cleanup', async () => {
    const exitSpy = spyOn(process, 'exit').mockImplementation((() => {
      // no-op in test mode
    }) as never)
    try {
      process.env.CLAUDE_BG_BACKEND = 'daemon'
      expect(handleSighupSignal()).toBe('ignored_bg')
      expect(exitSpy).not.toHaveBeenCalled()

      markOwnsControllingTerminal()
      expect(handleSighupSignal()).toBe('shutdown')
      await waitForMockCalls(exitSpy, 1)
      expect(exitSpy).toHaveBeenCalledWith(129)

      // Sandbox cleanup drain wait constant & owed cleanup settlement
      resetShutdownState()
      expect(SANDBOX_CLEANUP_WAIT_MS).toBe(500)
      const token = {}
      let cleanupResolved = false
      registerOwedSandboxCleanup(token)
      setTimeout(() => {
        cleanupResolved = true
        resolveOwedSandboxCleanup(token)
      }, 20)
      await gracefulShutdown(0, 'other', { suppressResumeHint: true })
      expect(cleanupResolved).toBe(true)
    } finally {
      exitSpy.mockRestore()
    }
  })
})

// ============================================================================
// Group 4 [P0-5 + P1-2 + P2]: init.ts Remote Telemetry Wait, Proxy Check, onSessionSwitch
// ============================================================================
describe('Group 4 [P0-5 + P1-2 + P2]: init.ts remote telemetry wait, proxy validation & scratchpad hook', () => {
  test('initializeTelemetryAfterTrust awaits remote settings settlement, re-applies env, then initializes telemetry', async () => {
    let resolveRemote!: () => void
    const remotePromise = new Promise<void>(resolve => {
      resolveRemote = resolve
    })
    registerRemoteManagedSettingsLoadPromise(remotePromise)

    let telemetryInitCalls = 0
    let envSeenAtTelemetryInit: string | undefined
    setTelemetryInitializerForTesting(async () => {
      telemetryInitCalls++
      envSeenAtTelemetryInit = process.env.TEST_REMOTE_TELEMETRY_ENV
    })

    initializeTelemetryAfterTrust({ timeoutMs: 2_000 })

    // Before remote promise settles, telemetry MUST NOT have initialized yet.
    await new Promise(resolve => setTimeout(resolve, 25))
    expect(telemetryInitCalls).toBe(0)

    // Simulate remote managed settings arriving with env vars, then settling.
    const remotePolicy: SettingsJson = {
      env: { TEST_REMOTE_TELEMETRY_ENV: 'from_remote_policy_328' },
    }
    seedSources({ policySettings: remotePolicy })
    setSessionSettingsCache({ settings: remotePolicy, errors: [] })
    resolveRemote()

    await getPendingTelemetryInitPromiseForTesting()
    expect(telemetryInitCalls).toBe(1)
    expect(envSeenAtTelemetryInit).toBe('from_remote_policy_328')

    // Bounded timeout: a stalled remote settings promise must NOT hang telemetry forever.
    resetSessionCountMetricForTesting()
    const stalledPromise = new Promise<void>(() => {})
    registerRemoteManagedSettingsLoadPromise(stalledPromise)
    let timedOutInitCalls = 0
    setTelemetryInitializerForTesting(async () => {
      timedOutInitCalls++
    })
    initializeTelemetryAfterTrust({ timeoutMs: 30 })
    await getPendingTelemetryInitPromiseForTesting()
    expect(timedOutInitCalls).toBe(1)
  })

  test('validateStartupProxyConfig throws ProxyConfigError on malformed proxy URLs and passes valid URLs', () => {
    expect(() =>
      validateStartupProxyConfig({ HTTPS_PROXY: 'not-a-valid-url' }),
    ).toThrow(ProxyConfigError)
    expect(() =>
      validateStartupProxyConfig({ HTTP_PROXY: 'proxy.internal:8080' }),
    ).toThrow(ProxyConfigError)
    expect(() =>
      validateStartupProxyConfig({ HTTPS_PROXY: 'http://proxy.example:8080' }),
    ).not.toThrow()
    expect(() => validateStartupProxyConfig({})).not.toThrow()
  })

  test('init.ts registers onSessionSwitch(() => ensureScratchpadDir())', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../entrypoints/init.ts'),
      'utf8',
    )
    expect(src).toContain('onSessionSwitch(')
    expect(src).toContain('ensureScratchpadDir()')
  })
})

// ============================================================================
// Group 5 [P1-4]: blockFileToolReadsOutsideWorkingDirectories & Removal Waiver Guard
// ============================================================================
describe('Group 5 [P1-4]: file-tool outside reads fence & CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS', () => {
  test('blockFileToolReadsOutsideWorkingDirectories honors flagSettings only and does not alter Bash outside-read checks', () => {
    // Ignored in user/project/local/policy settings
    seedSources({
      userSettings: {
        permissions: { blockFileToolReadsOutsideWorkingDirectories: true },
      },
      projectSettings: {
        permissions: { blockFileToolReadsOutsideWorkingDirectories: true },
      },
      policySettings: {
        permissions: { blockFileToolReadsOutsideWorkingDirectories: true },
      },
    })
    expect(settingsHaveBlockFileToolReadsOutsideWorkingDirectories()).toBe(
      false,
    )

    // Honored in launch `--settings` (`flagSettings`)
    seedSources({
      flagSettings: {
        permissions: { blockFileToolReadsOutsideWorkingDirectories: true },
      },
    })
    expect(settingsHaveBlockFileToolReadsOutsideWorkingDirectories()).toBe(true)
    const ctx = makePermissionContext()
    expect(contextBlocksOutsideReads(ctx)).toBe(true)
    expect(isFileToolOutsideReadFenceActive(ctx)).toBe(true)
    expect(formatOutsideReadsBlockSettingNames(ctx)).toBe(
      'permissions.blockFileToolReadsOutsideWorkingDirectories',
    )
    expect(blockedOutsideReadFileToolMessage('/etc/passwd', ctx)).toContain(
      'permissions.blockFileToolReadsOutsideWorkingDirectories',
    )
    expect(FILE_TOOL_OUTSIDE_READS_BLOCKED_REASON).toContain(
      'permissions.blockFileToolReadsOutsideWorkingDirectories',
    )

    // Must NOT alter Bash non-file-tool behavior when blockReadsOutsideWorkingDirectories is off
    expect(
      checkBashArgvUnderOutsideReadsBlock(['cat', '/etc/passwd'], '/tmp', ctx),
    ).toBeUndefined()
  })

  test('CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS waives dangerousRemoval only when rules clear & no PermissionRequest hook, and never waives unwaivable checks', async () => {
    const makeMockTool = (
      circuitBreaker: 'dangerousRemoval' | 'unfinishedCheck',
      also?: readonly string[],
    ): Tool =>
      ({
        name: 'Bash',
        inputSchema: { parse: (v: unknown) => v },
        checkPermissions: async () => ({
          behavior: 'ask',
          message: `safety check: ${circuitBreaker}`,
          decisionReason: {
            type: 'safetyCheck',
            reason: `safety check: ${circuitBreaker}`,
            classifierApprovable: false,
            circuitBreaker,
            ...(also ? { also } : {}),
          },
        }),
      }) as unknown as Tool

    const makeToolUseCtx = (
      permCtx: ToolPermissionContext,
      sessionHooks?: Map<string, { hooks: Record<string, unknown[]> }>,
    ): ToolUseContext =>
      ({
        abortController: new AbortController(),
        getAppState: () => ({
          toolPermissionContext: permCtx,
          ...(sessionHooks ? { sessionHooks } : {}),
        }),
        setAppState: () => {},
        options: { isNonInteractiveSession: false, tools: [] },
      }) as unknown as ToolUseContext

    const bypassCtx = makePermissionContext({ mode: 'bypassPermissions' })

    // 1. Without env var: dangerousRemoval still prompts in bypassPermissions
    const withoutEnv = await hasPermissionsToUseTool(
      makeMockTool('dangerousRemoval'),
      { command: 'rm -rf /' },
      makeToolUseCtx(bypassCtx),
      {} as never,
      'tu-1',
    )
    expect(withoutEnv.behavior).toBe('ask')

    // 2. With env var, clean rules, no PermissionRequest hook: dangerousRemoval is WAIVED
    process.env.CLAUDE_CODE_EVEN_MORE_DANGEROUSLY_SKIP_PERMISSIONS = '1'
    resetRemovalWaiverRulesClearForTesting()
    const waived = await hasPermissionsToUseTool(
      makeMockTool('dangerousRemoval'),
      { command: 'rm -rf /' },
      makeToolUseCtx(bypassCtx),
      {} as never,
      'tu-2',
    )
    expect(waived.behavior).toBe('allow')

    // 2b. Child sessions (`CLAUDE_CODE_CHILD_SESSION=1`) NEVER get the waiver (official `tes()`)
    process.env.CLAUDE_CODE_CHILD_SESSION = '1'
    const childSessionBlocked = await hasPermissionsToUseTool(
      makeMockTool('dangerousRemoval'),
      { command: 'rm -rf /' },
      makeToolUseCtx(bypassCtx),
      {} as never,
      'tu-2b',
    )
    expect(childSessionBlocked.behavior).toBe('ask')
    delete process.env.CLAUDE_CODE_CHILD_SESSION

    // 3. Unwaivable check (`unfinishedCheck` or `also: ['outsideReadsBlocked']`) is NEVER waived
    const unwaivable = await hasPermissionsToUseTool(
      makeMockTool('unfinishedCheck'),
      { command: 'echo hi' },
      makeToolUseCtx(bypassCtx),
      {} as never,
      'tu-3',
    )
    expect(unwaivable.behavior).toBe('ask')

    const withAlsoUnwaivable = await hasPermissionsToUseTool(
      makeMockTool('dangerousRemoval', ['outsideReadsBlocked']),
      { command: 'rm -rf /' },
      makeToolUseCtx(bypassCtx),
      {} as never,
      'tu-4',
    )
    expect(withAlsoUnwaivable.behavior).toBe('ask')

    // 4. Active PermissionRequest hook disables waiver
    resetRemovalWaiverRulesClearForTesting()
    const hooksMap = new Map([
      [
        'sess-1',
        {
          hooks: {
            PermissionRequest: [{ matcher: 'Bash', hooks: [] }],
          },
        },
      ],
    ])
    const blockedByHook = await hasPermissionsToUseTool(
      makeMockTool('dangerousRemoval'),
      { command: 'rm -rf /' },
      makeToolUseCtx(bypassCtx, hooksMap),
      {} as never,
      'tu-5',
    )
    expect(blockedByHook.behavior).toBe('ask')
    expect(getRemovalWaiverRulesClearForTesting()).toBe(false)

    // 5. Monotonic removalWaiverRulesClear latch: clearing deny rules via syncPermissionRulesFromDisk
    // MUST NOT unlock waiver after a disqualifying rule was present.
    resetRemovalWaiverRulesClearForTesting()
    const ctxWithDeny = makePermissionContext({
      mode: 'bypassPermissions',
      alwaysDenyRules: { userSettings: ['Bash(rm:*)'] },
    })
    const clearedCtx = syncPermissionRulesFromDisk(ctxWithDeny, [])
    expect(getRemovalWaiverRulesClearForTesting()).toBe(false)
    expect(isRemovalWaiverAllowed(clearedCtx)).toBe(false)
  })
})

// ============================================================================
// Group 6 [P1-5]: Unified Rate Limits (all 33 headers), OAuth FedStart Guard, Models
// ============================================================================
describe('Group 6 [P1-5]: Unified rate limits, OAuth FedStart guard & model catalog', () => {
  test('parses all 18 newly added unified rate-limit headers (grace, slow-lane, overage, window status, upgrade paths)', () => {
    const futureSec = Math.floor(Date.now() / 1000) + 3600
    const headers = new Headers({
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-reset': String(futureSec),
      'anthropic-ratelimit-unified-representative-claim': 'five_hour',
      'anthropic-ratelimit-unified-5h-utilization': '0.98',
      'anthropic-ratelimit-unified-5h-reset': String(futureSec),
      'anthropic-ratelimit-unified-5h-status': 'rejected',
      'anthropic-ratelimit-unified-7d-utilization': '0.45',
      'anthropic-ratelimit-unified-7d-reset': String(futureSec + 86400),
      'anthropic-ratelimit-unified-7d-status': 'allowed_warning',
      'anthropic-ratelimit-unified-overage-status': 'allowed',
      'anthropic-ratelimit-unified-overage-reset': String(futureSec + 7200),
      'anthropic-ratelimit-unified-overage-utilization': '0.3',
      'anthropic-ratelimit-unified-overage-daily-cap-paused': 'true',
      'anthropic-ratelimit-unified-overage-in-use': 'true',
      'anthropic-ratelimit-unified-overage-period': 'monthly',
      'anthropic-ratelimit-unified-overage-period-channel-utilization': '0.62',
      'anthropic-ratelimit-unified-overage-period-monthly-utilization': '0.78',
      'anthropic-ratelimit-unified-overage-scope': 'group_pool',
      'anthropic-ratelimit-unified-upgrade-paths': 'overage, max_20x',
      'anthropic-ratelimit-unified-grace-status': 'active',
      'anthropic-ratelimit-unified-grace-5h-utilization': '0.5',
      'anthropic-ratelimit-unified-grace-7d-utilization': '0.1',
      'anthropic-ratelimit-unified-slow-status': 'slot_busy',
      'anthropic-ratelimit-unified-slow-offer': 'treatment',
      'anthropic-ratelimit-unified-slow-retry-after': '15',
      'anthropic-ratelimit-unified-slow-max-wait': '300',
      'anthropic-ratelimit-unified-slow-budget-utilization': '0.42',
      'anthropic-ratelimit-unified-slow-budget-reset': String(futureSec + 9000),
    })

    const limits = computeLimitsFromHeaders(headers)
    expect(limits.isUsingOverage).toBe(true)
    expect(limits.dailyCapPaused).toBe(true)
    expect(limits.overageInUse).toBe(true)
    expect(limits.overagePeriod).toBe('monthly')
    expect(limits.overagePeriodChannel).toEqual({ utilization: 0.62 })
    expect(limits.overagePeriodMonthly).toEqual({ utilization: 0.78 })
    expect(limits.overageScope).toBe('group_pool')
    expect(limits.upgradePaths).toEqual(['overage', 'max_20x'])
    expect(limits.graceStatus).toBe('active')
    expect(limits.graceFiveHourUtilization).toBe(0.5)
    expect(limits.graceSevenDayUtilization).toBe(0.1)
    expect(limits.rateLimitGraceActive).toBe(true)
    expect(limits.rateLimitGracePaidBy).toBe('credits')
    expect(limits.lowPriorityStatus).toBe('slot_busy')
    expect(limits.lowPriorityOffer).toBe('treatment')
    expect(limits.lowPriorityRetryAfterSeconds).toBe(15)
    expect(limits.lowPriorityMaxWaitSeconds).toBe(300)
    expect(limits.lowPriorityBudgetUtilization).toBe(0.42)
    expect(limits.lowPriorityBudgetResetsAt).toBe(futureSec + 9000)
    expect(limits.fiveHourStatus).toBe('rejected')
    expect(limits.sevenDayStatus).toBe('allowed_warning')

    // group_pool drops overage from window readings & raw utilization (official De)
    const raw = extractRawUtilization(headers)
    expect(raw.overage).toBeUndefined()
    expect(raw.five_hour?.status).toBe('rejected')
    expect(raw.seven_day?.status).toBe('allowed_warning')
    const readings = extractWindowReadings(headers)
    expect(readings.overage).toBeUndefined()
    expect(readings.five_hour?.status).toBe('rejected')

    // memberSpendLimit (`Bt(e)`): org_spend_cap_reached without overage-scope
    const spendCapHeaders = new Headers({
      'anthropic-ratelimit-unified-status': 'rejected',
      'anthropic-ratelimit-unified-overage-disabled-reason':
        'org_spend_cap_reached',
      'anthropic-ratelimit-unified-overage-period': 'weekly',
    })
    expect(computeLimitsFromHeaders(spendCapHeaders).memberSpendLimit).toEqual({
      period: 'weekly',
    })

    // grace-status === 'eligible' -> zone: null (not yet in wrap-up)
    const eligibleGrace = parseRateLimitGraceHeaders(
      new Headers({
        'anthropic-ratelimit-unified-status': 'allowed',
        'anthropic-ratelimit-unified-grace-status': 'eligible',
        'anthropic-ratelimit-unified-grace-5h-utilization': '0.5',
      }),
    )
    expect(eligibleGrace).toEqual({ limiterRan: true, zone: null })
  })

  test('OAuth exports new scopes + DESIGN_CLIENT_ID and guards unregistered scopes off under FedStart', () => {
    expect(PLUGINS_SCOPE).toBe('user:plugins')
    expect(PROJECTS_READ_SCOPE).toBe('user:projects:read')
    expect(PROJECTS_WRITE_SCOPE).toBe('user:projects:write')
    expect(DESIGN_CLIENT_ID).toBe('59637612-477b-4836-a601-b0589eda7704')
    expect(ALL_OAUTH_SCOPES).toContain(PLUGINS_SCOPE)
    expect(ALL_OAUTH_SCOPES).toContain(PRIVACY_CONSENTS_WRITE_SCOPE)

    // Default prod config includes plugins + privacy_consents + projects
    delete process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL
    delete process.env.CLAUDE_CODE_OAUTH_CLIENT_ID
    const prodCfg = getOauthConfig()
    expect(prodCfg.DESIGN_CLIENT_ID).toBe(DESIGN_CLIENT_ID)
    expect(prodCfg.PLUGINS_SCOPE_REGISTERED).toBe(true)
    expect(prodCfg.PROJECTS_SCOPES_REGISTERED).toBe(true)
    expect(prodCfg.PRIVACY_CONSENTS_SCOPE_REGISTERED).toBe(true)
    expect(getClaudeAiOauthScopes()).toContain(PLUGINS_SCOPE)
    expect(getAllOauthScopes()).toContain(PRIVACY_CONSENTS_WRITE_SCOPE)
    expect(
      filterIncrementalOauthScopes([PROJECTS_READ_SCOPE, PROJECTS_WRITE_SCOPE]),
    ).toEqual([PROJECTS_READ_SCOPE, PROJECTS_WRITE_SCOPE])
    expect(getOauthScopesWithIncremental([PROJECTS_READ_SCOPE])).toContain(
      PROJECTS_READ_SCOPE,
    )

    // FedStart (`CLAUDE_CODE_CUSTOM_OAUTH_URL`) clears unregistered scope flags
    process.env.CLAUDE_CODE_CUSTOM_OAUTH_URL = 'https://claude.fedstart.com'
    const fedCfg = getOauthConfig()
    expect(fedCfg.PLUGINS_SCOPE_REGISTERED).toBe(false)
    expect(fedCfg.PROJECTS_SCOPES_REGISTERED).toBe(false)
    expect(fedCfg.PRIVACY_CONSENTS_SCOPE_REGISTERED).toBe(false)
    expect(fedCfg.HYBRID_SETTINGS_SCOPE_REGISTERED).toBe(false)
    expect(fedCfg.SCOPES_CLEARED_BY).toEqual(['CLAUDE_CODE_CUSTOM_OAUTH_URL'])
    expect(getClaudeAiOauthScopes()).not.toContain(PLUGINS_SCOPE)
    expect(getAllOauthScopes()).not.toContain(PLUGINS_SCOPE)
    expect(getAllOauthScopes()).not.toContain(PRIVACY_CONSENTS_WRITE_SCOPE)
    expect(
      filterIncrementalOauthScopes([
        PROJECTS_READ_SCOPE,
        PROJECTS_WRITE_SCOPE,
        PRIVACY_CONSENTS_WRITE_SCOPE,
      ]),
    ).toEqual([])
  })

  test('model catalog registers claude-mythos-5* and aligns official Mantle IDs', () => {
    expect(ALL_MODEL_CONFIGS.mythos5.firstParty).toBe('claude-mythos-5')
    expect(ALL_MODEL_CONFIGS.mythos51.firstParty).toBe('claude-mythos-5-1')
    expect(ALL_MODEL_CONFIGS.mythos52.firstParty).toBe('claude-mythos-5-2')
    expect(CANONICAL_MODEL_IDS).toContain('claude-mythos-5')
    expect(CANONICAL_MODEL_IDS).toContain('claude-mythos-5-1')
    expect(CANONICAL_MODEL_IDS).toContain('claude-mythos-5-2')

    expect(ALL_MODEL_CONFIGS.haiku45.mantle).toBe('anthropic.claude-haiku-4-5')
    expect(ALL_MODEL_CONFIGS.sonnet5.mantle).toBe('anthropic.claude-sonnet-5')
    expect(ALL_MODEL_CONFIGS.opus47.mantle).toBe('anthropic.claude-opus-4-7')

    expect(getOfficialMantleModelId('haiku45')).toBe(
      'anthropic.claude-haiku-4-5',
    )
    expect(getOfficialMantleModelId('sonnet5')).toBe(
      'anthropic.claude-sonnet-5',
    )
    expect(getOfficialMantleModelId('opus47')).toBe('anthropic.claude-opus-4-7')
    for (const nullKey of [
      'haiku35',
      'sonnet35',
      'sonnet37',
      'sonnet40',
      'sonnet45',
      'sonnet46',
      'opus40',
      'opus41',
      'opus45',
      'opus46',
      'mythos5',
      'mythos51',
      'mythos52',
    ] as const) {
      expect(OFFICIAL_MANTLE_MODEL_IDS[nullKey]).toBeNull()
    }
  })
})
