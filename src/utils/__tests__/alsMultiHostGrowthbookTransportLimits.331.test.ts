import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'
import { randomUUID } from 'crypto'
import { chmod, mkdtemp, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { setupAxiosMock } from '../../../tests/mocks/axios.js'
import {
  getSessionId,
  setFlagSettingsInline,
  setOauthTokenFromFd,
  setSessionTrustAccepted,
} from '../../bootstrap/state.js'
import {
  getAllGrowthBookFeatures,
  getFeatureValue_CACHED_MAY_BE_STALE,
  getFeatureValueWithSource,
  initializeGrowthBook,
  onGrowthBookRefresh,
  refreshGrowthBookAfterAuthChange,
  resetGrowthBook,
  setupPeriodicGrowthBookRefresh,
  stopPeriodicGrowthBookRefresh,
} from '../../services/analytics/growthbook.js'
import {
  peekUserServerClassifierSwitch,
  readUserServerClassifierSwitch,
  resetAutoModeClassifierTransportForTests,
  thirdPartyServerClassifierOn,
} from '../../services/api/autoModeClassifierTransport.js'
import {
  buildClassifierContextJson,
  setArtifactConsentGrantedReader,
} from '../../services/api/autoModeServerContext.js'
import {
  serverCheckDeclined,
  setServerCheckDeclined,
} from '../../services/api/autoModeServerFallbackNotice.js'
import {
  clearGrokClientCache,
  getGrokClient,
} from '../../services/api/grok/client.js'
import {
  getGroveNoticeConfig,
  getGroveSettings,
} from '../../services/api/grove.js'
import { checkMetricsEnabled } from '../../services/api/metricsOptOut.js'
import {
  clearOpenAIClientCache,
  getOpenAIClient,
} from '../../services/api/openai/client.js'
import { getOpenAIPromptCacheKey } from '../../services/api/openai/openaiShared.js'
import { fetchAndStorePassesEligibility } from '../../services/api/referral.js'
import {
  getBedrockInferenceProfiles,
  getInferenceProfileBackingModel,
} from '../model/bedrock.js'
import {
  areLimitsObserved,
  type ClaudeAILimits,
  currentLimits,
  emitQuotaRejected,
  emitStatusChange,
  getLimitsAccountEpoch,
  quotaRejectedListeners,
  resetCurrentLimits,
  statusListeners,
} from '../../services/claudeAiLimits.js'
import {
  getProviderUsage,
  resetProviderUsage,
  subscribeProviderUsage,
  updateProviderBuckets,
} from '../../services/providerUsage/store.js'
import {
  armQuotaAutoResume,
  getQuotaAutoResumeState,
  resetQuotaAutoResumeForTests,
  subscribeQuotaAutoResumeChanged,
} from '../../services/quotaAutoResume.js'
import { getDefaultAppState } from '../../state/AppStateStore.js'
import type { ToolUseContext } from '../../Tool.js'
import {
  clearOtelHeadersCache,
  getApiKeyFromConfigOrMacOSKeychain,
  getDefaultAwsProviderChain,
  getOtelHeadersFromHelperAsync,
  invalidateDefaultAwsProviderChainDebounced,
  notifyAuthStateChanged,
  subscribeAuthStateChanged,
} from '../auth.js'
import { clearBetasCaches, getAllModelBetas } from '../betas.js'
import { enableConfigs, saveGlobalConfig } from '../config.js'
import { createFileStateCacheWithSizeLimit } from '../fileStateCache.js'
import {
  createCacheSafeParams,
  runForkedAgent,
  saveCacheSafeParams,
} from '../forkedAgent.js'
import {
  applyHostCredsFromFileIfManaged,
  refreshHostCredsToken,
  resetHostCredsModuleStateForTests,
  setHostAuthTokenRefreshCallback,
  tryHostAuth401Recovery,
} from '../hostCredsFile.js'
import { getProcessStartTimeMs } from '../genericProcessUtils.js'
import {
  applySafeConfigEnvironmentVariables,
  clearFrozenStartupEnvForTests,
  clearHostManagedSettingsEnvStripWarnsForTests,
  getAppliedGlobalConfigEnv,
  getFrozenStartupEnv,
} from '../managedEnv.js'
import { createUserMessage } from '../messages.js'
import {
  type DensableModelCatalog,
  getActivePublishedModelCatalogSource,
  getDensableCatalogModel,
  getDensableModelCatalog,
  setActivePublishedModelCatalogForTesting,
} from '../model/modelCatalogCapabilities.js'
import {
  clearMTLSCache,
  getDroppedCrossCertificatesCount,
  getMTLSConfig,
  resetMtlsCachesForTests,
  setDroppedCrossCertificatesStateForTesting,
} from '../mtls.js'
import {
  _resetKeepAliveForTesting,
  clearProxyCache,
  disableKeepAlive,
  enableClosesAfterServerError,
  getCompletedBareProxyRepairUrl,
  getProxyFetchOptions,
  repairBareProxySchemeAtStartup,
  resetBareProxyRepairStateForTests,
  shouldCloseAfterServerError,
} from '../proxy.js'
import {
  getActiveSessionFromAls,
  getActiveSubconversationFromAls,
  runWithNewHostSession,
  runWithSession,
  runWithSubconversationContext,
} from '../sessionRoot.js'
import { resetSettingsCache } from '../settings/settingsCache.js'
import { asSystemPrompt } from '../systemPromptType.js'
import { getCoreUserData, resetUserCache } from '../user.js'

;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME: string; FEEDBACK_CHANNEL: string }
  }
).MACRO ??= {
  VERSION: '2.1.331-test',
  BUILD_TIME: '2026-01-01T00:00:00Z',
  FEEDBACK_CHANNEL: 'test',
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_CUSTOM_HEADERS',
  'CLAUDE_CODE_AUTO_MODE_SERVER',
  'CLAUDE_CODE_DISABLE_FEATURE_FLAGS',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'CLAUDE_CODE_GB_REFRESH_INTERVAL_MS',
  'CLAUDE_CODE_HOST',
  'CLAUDE_CODE_HOST_AUTH_ENV_VAR',
  'CLAUDE_CODE_HOST_CREDS_FILE',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_ORGANIZATION_UUID',
  'CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_SDK_HAS_HOST_AUTH_REFRESH',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CONFIG_DIR',
  'CLAUDE_GB_ADAPTER_KEY',
  'CLAUDE_GB_ADAPTER_URL',
  'CLAUDE_INTERNAL_FC_OVERRIDES',
  'DISABLE_GROWTHBOOK',
  'DISABLE_TELEMETRY',
  'DO_NOT_TRACK',
  'GROK_API_KEY',
  'HTTPS_PROXY',
  'https_proxy',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'TEST_MANAGED_ENV_TAG',
] as const

function makeMinimalToolUseContext(
  abortController: AbortController,
): ToolUseContext {
  const appState = getDefaultAppState()
  return {
    options: {
      commands: [],
      debug: false,
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      verbose: false,
      thinkingConfig: { type: 'disabled' },
      mcpClients: [],
      mcpResources: {},
      ideInstallationStatus: null,
      isNonInteractiveSession: true,
      customSystemPrompt: undefined,
      appendSystemPrompt: undefined,
      agentDefinitions: { activeAgents: [], allAgents: [] },
      theme: 'dark',
    },
    abortController,
    readFileState: createFileStateCacheWithSizeLimit(10),
    getAppState: () => appState,
    setAppState: () => {},
    setToolPermissionContext: () => {},
    setSessionToolPermissionContext: () => {},
    nestedMemoryAttachmentTriggers: new Set(),
    loadedNestedMemoryPaths: new Set(),
    dynamicSkillDirTriggers: new Set(),
    discoveredSkillNames: new Set(),
    messages: [],
    setMessages: () => {},
    updateFileHistoryState: () => {},
    updateAttributionState: () => {},
    setInProgressToolUseIDs: () => {},
    setResponseLength: () => {},
    pushApiMetricsEntry: () => {},
  } as unknown as ToolUseContext
}

describe('Official 2.1.331 Wave 4 multi-host ALS isolation: GrowthBook, Auth, ManagedEnv, Transport, RateLimits & Model Catalog', () => {
  const savedEnv: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {}
  const tempDirs: string[] = []
  const axiosHandle = setupAxiosMock()

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    enableConfigs()
  })

  beforeEach(async () => {
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    process.env.CLAUDE_CONFIG_DIR = await makeTempDir('als-w4-cfg-')
    axiosHandle.useStubs = false
    axiosHandle.stubs.get = undefined
    axiosHandle.stubs.post = undefined
  })

  afterEach(() => {
    axiosHandle.useStubs = false
    resetGrowthBook()
    resetCurrentLimits()
    resetQuotaAutoResumeForTests()
    resetProviderUsage()
    resetHostCredsModuleStateForTests()
    clearFrozenStartupEnvForTests()
    clearHostManagedSettingsEnvStripWarnsForTests()
    clearBetasCaches()
    clearOtelHeadersCache()
    resetUserCache()
    resetMtlsCachesForTests()
    _resetKeepAliveForTesting()
    resetBareProxyRepairStateForTests()
    clearProxyCache()
    clearOpenAIClientCache()
    clearGrokClientCache()
    setActivePublishedModelCatalogForTesting(null)
    resetAutoModeClassifierTransportForTests()
    setArtifactConsentGrantedReader(undefined)
    setServerCheckDeclined(false)
    setOauthTokenFromFd(null)
  })

  afterAll(async () => {
    axiosHandle.useStubs = false
    for (const key of ENV_KEYS) {
      const prev = savedEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('growthbook [W-115]: Org A remoteEvalFeatureValues/ownSavedFlags, refresh listeners & resetGrowthBook never leak or tear down Org B', async () => {
    const originalFetch = globalThis.fetch
    const cwdA = await makeTempDir('als-gb-a-')
    const cwdB = await makeTempDir('als-gb-b-')

    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-gb-isolation'
    process.env.CLAUDE_CODE_GB_REFRESH_INTERVAL_MS = '600000'

    // Return distinct remote-eval payloads keyed by organizationUUID attribute
    const sessionIdA = randomUUID()
    const sessionIdB = randomUUID()
    const orgA = 'org-alpha-331'
    const orgB = 'org-beta-331'
    globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
      const bodyStr = typeof init?.body === 'string' ? init.body : '{}'
      const parsed = JSON.parse(bodyStr) as {
        attributes?: { organizationUUID?: string; sessionId?: string }
      }
      const isHostA =
        parsed.attributes?.organizationUUID === orgA ||
        parsed.attributes?.sessionId === sessionIdA
      const features = isHostA
        ? {
            org_alpha_feature: { defaultValue: 'alpha-live' },
            shared_org_flag: { defaultValue: 'from-org-a' },
          }
        : {
            org_beta_feature: { defaultValue: 'beta-live' },
            shared_org_flag: { defaultValue: 'from-org-b' },
          }
      return new Response(JSON.stringify({ status: 200, features }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch

    try {
      let hostARefreshes = 0
      let hostBRefreshes = 0
      let hostASessionRef: ReturnType<typeof getActiveSessionFromAls>
      let hostBSessionRef: ReturnType<typeof getActiveSessionFromAls>

      // Initialize Org A and Org B with distinct organizationUUIDs (so GB SDK FeatureRepository keys them independently)
      await runWithNewHostSession(
        { id: sessionIdA, cwd: cwdA, isInteractive: false },
        async sessionA => {
          hostASessionRef = sessionA
          process.env.CLAUDE_CODE_ORGANIZATION_UUID = orgA
          setSessionTrustAccepted(true)
          const unsub = onGrowthBookRefresh(() => {
            hostARefreshes++
          })
          const clientA = await initializeGrowthBook()
          expect(clientA).not.toBeNull()
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_alpha_feature', 'none'),
          ).toBe('alpha-live')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('shared_org_flag', 'none'),
          ).toBe('from-org-a')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_beta_feature', 'none'),
          ).toBe('none')
          unsub()
        },
      )

      await runWithNewHostSession(
        { id: sessionIdB, cwd: cwdB, isInteractive: false },
        async sessionB => {
          hostBSessionRef = sessionB
          process.env.CLAUDE_CODE_ORGANIZATION_UUID = orgB
          setSessionTrustAccepted(true)
          const unsub = onGrowthBookRefresh(() => {
            hostBRefreshes++
          })
          const clientB = await initializeGrowthBook()
          expect(clientB).not.toBeNull()
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_beta_feature', 'none'),
          ).toBe('beta-live')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('shared_org_flag', 'none'),
          ).toBe('from-org-b')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_alpha_feature', 'none'),
          ).toBe('none')
          unsub()
        },
      )

      // Concurrently rotate Org A (carrying ownSavedFlags) while reading Org B's live payload
      await Promise.all([
        runWithSession(hostASessionRef!, async () => {
          process.env.CLAUDE_CODE_ORGANIZATION_UUID = orgA
          refreshGrowthBookAfterAuthChange({ keepsOwnSavedFlags: true })
          expect(getAllGrowthBookFeatures().org_alpha_feature).toBe(
            'alpha-live',
          )
          await Bun.sleep(10)
        }),
        runWithSession(hostBSessionRef!, async () => {
          await Bun.sleep(5)
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_beta_feature', 'none'),
          ).toBe('beta-live')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('shared_org_flag', 'none'),
          ).toBe('from-org-b')
          expect(
            getFeatureValue_CACHED_MAY_BE_STALE('org_alpha_feature', 'none'),
          ).toBe('none')
        }),
      ])

      // Verify resetGrowthBook() on Host A does NOT tear down Host B's live payload or periodic timer
      runWithSession(hostBSessionRef!, () => {
        setupPeriodicGrowthBookRefresh()
      })
      runWithSession(hostASessionRef!, () => {
        resetGrowthBook()
        expect(
          getFeatureValueWithSource('org_alpha_feature', 'none').source,
        ).not.toBe('payload')
        // Verify .cache = new Map() setter stays bound to Host A's slot
        const customMap = new Map()
        initializeGrowthBook.cache = customMap
        expect(initializeGrowthBook.cache).toBe(customMap)
      })
      runWithSession(hostBSessionRef!, () => {
        expect(getFeatureValueWithSource('org_beta_feature', 'none')).toEqual({
          value: 'beta-live',
          source: 'payload',
        })
        expect(initializeGrowthBook.cache.size).toBeGreaterThan(0)
        stopPeriodicGrowthBookRefresh()
      })

      expect(hostARefreshes).toBeGreaterThanOrEqual(1)
      expect(hostBRefreshes).toBeGreaterThanOrEqual(1)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  test('managedEnv [W-062] & hostCredsFile [W-058]: Host A lockedHostEndpoints / appliedGlobalConfigEnv / 401 counter never leak into Host B', async () => {
    const dirA = await makeTempDir('als-hcf-a-')
    const dirB = await makeTempDir('als-hcf-b-')
    const credsA = join(dirA, 'creds-a.json')
    const credsB = join(dirB, 'creds-b.json')
    const procStart = (await getProcessStartTimeMs(process.pid)) ?? Date.now()

    await writeFile(
      credsA,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://host-a.example.test',
          ANTHROPIC_AUTH_TOKEN: 'tok-a-1',
        },
        expiresAt: Date.now() + 60_000,
        pid: process.pid,
        procStart,
      }),
      'utf8',
    )
    await chmod(credsA, 0o600)

    await writeFile(
      credsB,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: 'https://host-b.example.test',
          ANTHROPIC_AUTH_TOKEN: 'tok-b-1',
        },
        expiresAt: Date.now() + 60_000,
        pid: process.pid,
        procStart,
      }),
      'utf8',
    )
    await chmod(credsB, 0o600)

    let sessionARef: ReturnType<typeof getActiveSessionFromAls>
    let sessionBRef: ReturnType<typeof getActiveSessionFromAls>

    // Host A freezes startup env with TAG=alpha and locks endpoint host-a.example.test
    await runWithNewHostSession({ cwd: dirA }, async sessionA => {
      sessionARef = sessionA
      process.env.TEST_MANAGED_ENV_TAG = 'alpha'
      saveGlobalConfig(c => ({ ...c, env: { FOO_HOST_A: 'from-a' } }))
      applySafeConfigEnvironmentVariables()
      expect(getFrozenStartupEnv().TEST_MANAGED_ENV_TAG).toBe('alpha')
      expect(getAppliedGlobalConfigEnv()?.FOO_HOST_A).toBe('from-a')

      process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
      process.env.CLAUDE_CODE_HOST_CREDS_FILE = credsA
      const appliedA = await applyHostCredsFromFileIfManaged()
      expect(appliedA?.ANTHROPIC_AUTH_TOKEN).toBe('tok-a-1')

      // Exhaust 401 same-token counter on Host A
      setHostAuthTokenRefreshCallback(async () => 'tok-a-1')
      expect(await tryHostAuth401Recovery()).toBe('same')
      expect(await tryHostAuth401Recovery()).toBe('exhausted')
    })

    // Host B starts with TAG=beta and a DIFFERENT endpoint host-b.example.test — must NOT be blocked by Host A's endpoint lock or 401 exhaustion
    await runWithNewHostSession({ cwd: dirB }, async sessionB => {
      sessionBRef = sessionB
      process.env.TEST_MANAGED_ENV_TAG = 'beta'
      saveGlobalConfig(c => ({ ...c, env: { FOO_HOST_B: 'from-b' } }))
      applySafeConfigEnvironmentVariables()
      expect(getFrozenStartupEnv().TEST_MANAGED_ENV_TAG).toBe('beta')
      expect(getAppliedGlobalConfigEnv()?.FOO_HOST_B).toBe('from-b')
      expect(getAppliedGlobalConfigEnv()?.FOO_HOST_A).toBeUndefined()

      process.env.CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST = '1'
      process.env.CLAUDE_CODE_HOST_CREDS_FILE = credsB
      const appliedB = await applyHostCredsFromFileIfManaged()
      expect(appliedB?.ANTHROPIC_AUTH_TOKEN).toBe('tok-b-1')

      // Refreshing Host B against host-b.example.test succeeds despite Host A having locked host-a.example.test
      const refreshedB = await refreshHostCredsToken()
      expect(refreshedB).toBe('tok-b-1')

      // Host B's 401 counter starts at 0 (not exhausted by Host A)
      setHostAuthTokenRefreshCallback(async () => 'tok-b-1')
      expect(await tryHostAuth401Recovery()).toBe('same')
    })

    // Host A still retains its own frozen startup env & endpoint lock
    await runWithSession(sessionARef!, async () => {
      expect(getFrozenStartupEnv().TEST_MANAGED_ENV_TAG).toBe('alpha')
      process.env.CLAUDE_CODE_HOST_CREDS_FILE = credsB
      // Host A locked host-a.example.test, so reading credsB (host-b.example.test) is rejected!
      expect(await refreshHostCredsToken()).toBeNull()
    })

    runWithSession(sessionBRef!, () => {
      expect(getFrozenStartupEnv().TEST_MANAGED_ENV_TAG).toBe('beta')
    })
  })

  test('claudeAiLimits [W-169], quotaAutoResume [W-256] & providerUsage/store: Host A hitting rate limit never flips Host B status or fires Host B listeners', async () => {
    const cwdA = await makeTempDir('als-lim-a-')
    const cwdB = await makeTempDir('als-lim-b-')

    const statusEventsA: string[] = []
    const statusEventsB: string[] = []
    const rejectedEventsA: string[] = []
    const rejectedEventsB: string[] = []
    const usageEventsA: string[] = []
    const usageEventsB: string[] = []
    let autoResumeChangesA = 0
    let autoResumeChangesB = 0

    await Promise.all([
      runWithNewHostSession({ cwd: cwdA, isInteractive: true }, async () => {
        const onStatus = (l: ClaudeAILimits) => statusEventsA.push(l.status)
        const onReject = (l: ClaudeAILimits) => rejectedEventsA.push(l.status)
        statusListeners.add(onStatus)
        quotaRejectedListeners.add(onReject)
        const unsubUsage = subscribeProviderUsage(u =>
          usageEventsA.push(u.providerId),
        )
        const unsubAuto = subscribeQuotaAutoResumeChanged(() => {
          autoResumeChangesA++
        })

        const resetsAt = Math.floor(Date.now() / 1000) + 600
        emitStatusChange({
          status: 'rejected',
          unifiedRateLimitFallbackAvailable: false,
          resetsAt,
          isUsingOverage: false,
        })
        emitQuotaRejected(
          {
            status: 'rejected',
            unifiedRateLimitFallbackAvailable: false,
            resetsAt,
          },
          'main_thread',
        )
        armQuotaAutoResume(resetsAt, Date.now(), 'dialog', null, null)
        updateProviderBuckets('anthropic', [
          {
            kind: 'session',
            label: '5-hour',
            utilization: 100,
            resetsAt,
          },
        ])

        await Bun.sleep(10)

        expect(currentLimits.status).toBe('rejected')
        expect(areLimitsObserved()).toBe(true)
        expect(getQuotaAutoResumeState().phase).toBe('armed')
        expect(getProviderUsage().providerId).toBe('anthropic')
        expect(getProviderUsage().buckets).toHaveLength(1)

        resetCurrentLimits()
        expect(getLimitsAccountEpoch()).toBe(1)

        statusListeners.delete(onStatus)
        quotaRejectedListeners.delete(onReject)
        unsubUsage()
        unsubAuto()
      }),
      runWithNewHostSession({ cwd: cwdB, isInteractive: true }, async () => {
        const onStatus = (l: ClaudeAILimits) => statusEventsB.push(l.status)
        const onReject = (l: ClaudeAILimits) => rejectedEventsB.push(l.status)
        statusListeners.add(onStatus)
        quotaRejectedListeners.add(onReject)
        const unsubUsage = subscribeProviderUsage(u =>
          usageEventsB.push(u.providerId),
        )
        const unsubAuto = subscribeQuotaAutoResumeChanged(() => {
          autoResumeChangesB++
        })

        await Bun.sleep(5)

        // Host B must remain completely clean while Host A hits rejected + arms + updates usage
        expect(currentLimits.status).toBe('allowed')
        expect(areLimitsObserved()).toBe(false)
        expect(getLimitsAccountEpoch()).toBe(0)
        expect(getQuotaAutoResumeState().phase).toBe('idle')
        expect(getProviderUsage().providerId).toBe('unknown')
        expect(getProviderUsage().buckets).toHaveLength(0)

        statusListeners.delete(onStatus)
        quotaRejectedListeners.delete(onReject)
        unsubUsage()
        unsubAuto()
      }),
    ])

    expect(statusEventsA).toEqual(['rejected'])
    expect(rejectedEventsA).toEqual(['rejected'])
    expect(usageEventsA).toEqual(['anthropic'])
    expect(autoResumeChangesA).toBe(1)

    expect(statusEventsB).toEqual([])
    expect(rejectedEventsB).toEqual([])
    expect(usageEventsB).toEqual([])
    expect(autoResumeChangesB).toBe(0)
  })

  test('auth.ts, betas.ts, user.ts & forkedAgent.ts: listeners, CLAUDE_CODE_HOST otel sub-keying, .cache=new Map() setters, subconversation sessionId, and cross-host runForkedAgent re-entry', async () => {
    const cwdA = await makeTempDir('als-abuf-a-')
    const cwdB = await makeTempDir('als-abuf-b-')

    // 1. authStateChangeListeners per-host isolation
    let authCallsA = 0
    let authCallsB = 0
    let unsubA: (() => void) | undefined
    let unsubB: (() => void) | undefined

    runWithNewHostSession({ cwd: cwdA }, () => {
      unsubA = subscribeAuthStateChanged(() => {
        authCallsA++
      })
      notifyAuthStateChanged()
    })
    runWithNewHostSession({ cwd: cwdB }, () => {
      unsubB = subscribeAuthStateChanged(() => {
        authCallsB++
      })
      // Host B did not fire notifyAuthStateChanged yet; Host A's notify did not hit Host B
      expect(authCallsB).toBe(0)
      notifyAuthStateChanged()
      notifyAuthStateChanged()
    })
    unsubA?.()
    unsubB?.()
    expect(authCallsA).toBe(1)
    expect(authCallsB).toBe(2)

    // 2. otelHeadersHelper CLAUDE_CODE_HOST sub-keying within the SAME host AND across two hosts
    await runWithNewHostSession(
      { cwd: cwdA, isInteractive: false },
      async () => {
        process.env.CLAUDE_CODE_OTEL_HEADERS_HELPER_DEBOUNCE_MS = '60000'
        setFlagSettingsInline({
          otelHeadersHelper:
            'node -e "console.log(JSON.stringify({host: process.env.CLAUDE_CODE_HOST || \\"none\\"}))"',
        })
        resetSettingsCache()

        process.env.CLAUDE_CODE_HOST = 'tenant-one'
        const h1 = await getOtelHeadersFromHelperAsync()
        expect(h1).toEqual({ host: 'tenant-one' })

        // Switching CLAUDE_CODE_HOST within same SessionHost uses a separate sub-key (does not return tenant-one's cached headers!)
        process.env.CLAUDE_CODE_HOST = 'tenant-two'
        const h2 = await getOtelHeadersFromHelperAsync()
        expect(h2).toEqual({ host: 'tenant-two' })

        // Switching back to tenant-one hits tenant-one's cached entry
        process.env.CLAUDE_CODE_HOST = 'tenant-one'
        const h1Again = await getOtelHeadersFromHelperAsync()
        expect(h1Again).toEqual({ host: 'tenant-one' })
      },
    )

    // 3. auth.ts & betas.ts `.cache = new Map()` setter + full Map iterator methods
    runWithNewHostSession({ cwd: cwdA }, () => {
      const replacementKeychain = new Map<
        unknown,
        { key: string; source: '/login managed key' } | null
      >([
        [undefined, { key: 'sk-ant-replaced-a', source: '/login managed key' }],
      ])
      getApiKeyFromConfigOrMacOSKeychain.cache = replacementKeychain
      expect(getApiKeyFromConfigOrMacOSKeychain.cache).toBe(replacementKeychain)
      expect(getApiKeyFromConfigOrMacOSKeychain()?.key).toBe(
        'sk-ant-replaced-a',
      )

      // Full Map iteration support (forEach / keys / values / entries / Symbol.iterator)
      const iteratedKeys: unknown[] = []
      getApiKeyFromConfigOrMacOSKeychain.cache.forEach((_v, k) => {
        iteratedKeys.push(k)
      })
      expect(iteratedKeys).toEqual([undefined])
      expect([...getApiKeyFromConfigOrMacOSKeychain.cache.keys()]).toEqual([
        undefined,
      ])
      expect([
        ...getApiKeyFromConfigOrMacOSKeychain.cache.values(),
      ]).toHaveLength(1)
      expect([
        ...getApiKeyFromConfigOrMacOSKeychain.cache.entries(),
      ]).toHaveLength(1)
      expect([...getApiKeyFromConfigOrMacOSKeychain.cache]).toHaveLength(1)

      // getDefaultAwsProviderChain `.cache = new Map()` & debounced invalidation
      const awsMap = new Map()
      getDefaultAwsProviderChain.cache = awsMap
      expect(getDefaultAwsProviderChain.cache).toBe(awsMap)
      expect(invalidateDefaultAwsProviderChainDebounced('us-east-1')).toBe(true)
      expect(invalidateDefaultAwsProviderChainDebounced('us-east-1')).toBe(
        false,
      )

      // betas.ts `.cache = new Map()` never detaches from RootSessionSlot
      const betasMap = new Map<string, string[]>([
        ['claude-sonnet-4-6', ['custom-beta-a']],
      ])
      getAllModelBetas.cache = betasMap
      expect(getAllModelBetas.cache).toBe(betasMap)
      expect(getAllModelBetas('claude-sonnet-4-6')).toEqual(['custom-beta-a'])
    })

    runWithNewHostSession({ cwd: cwdB }, () => {
      // Host B was NOT detached or polluted by Host A's `.cache = new Map()` assignments
      expect(getApiKeyFromConfigOrMacOSKeychain.cache.size).toBe(0)
      expect(getAllModelBetas.cache.size).toBe(0)
      expect(invalidateDefaultAwsProviderChainDebounced('us-east-1')).toBe(true)
    })

    // 4. user.ts: subconversation `sessionId` isolation in `getCoreUserData`
    runWithNewHostSession({ id: 'parent-session-id-331', cwd: cwdA }, () => {
      const parentData = getCoreUserData(true)
      expect(parentData.sessionId).toBe('parent-session-id-331')

      const subData = runWithSubconversationContext(
        { sessionId: 'subconv-session-id-331' },
        () => getCoreUserData(true),
      )
      expect(subData.sessionId).toBe('subconv-session-id-331')

      // Parent's cached CoreUserData must NOT have been poisoned by subconversation
      expect(getCoreUserData(true).sessionId).toBe('parent-session-id-331')
    })

    // 5. forkedAgent.ts: executing Host A's CacheSafeParams (with subconversation) while Host B's ALS is active re-enters Host A!
    const hostAId = randomUUID()
    const hostBId = randomUUID()
    const subconvAId = randomUUID()

    const paramsFromHostA = runWithNewHostSession(
      { id: hostAId, cwd: cwdA },
      () =>
        runWithSubconversationContext({ sessionId: subconvAId }, () => {
          const ac = new AbortController()
          ac.abort()
          const ctx = makeMinimalToolUseContext(ac)
          const params = createCacheSafeParams({
            systemPrompt: asSystemPrompt(['host-a-prompt']),
            userContext: {},
            systemContext: {},
            toolUseContext: ctx,
            messages: [],
          })
          saveCacheSafeParams(params)
          return params
        }),
    )

    let observedSessionId = ''
    let observedSubconvId: string | undefined
    let observedBootstrapSessionId = ''

    await runWithNewHostSession({ id: hostBId, cwd: cwdB }, async () => {
      expect(getActiveSessionFromAls()?.id).toBe(hostBId)
      const ac = new AbortController()
      ac.abort()
      await runForkedAgent({
        promptMessages: [createUserMessage({ content: 'fork from host A' })],
        cacheSafeParams: paramsFromHostA,
        canUseTool: async () => ({ behavior: 'allow', updatedInput: {} }),
        querySource: 'session_memory',
        forkLabel: 'cross_host_reentry_test',
        skipTranscript: true,
        overrides: {
          abortController: ac,
          getAppState: () => {
            observedSessionId = getActiveSessionFromAls()?.id ?? ''
            observedSubconvId = getActiveSubconversationFromAls()?.sessionId
            observedBootstrapSessionId = getSessionId()
            return getDefaultAppState()
          },
        },
      })
      // After runForkedAgent returns, Host B's ALS is intact
      expect(getActiveSessionFromAls()?.id).toBe(hostBId)
    })

    expect(observedSessionId).toBe(hostAId)
    expect(observedSubconvId).toBe(subconvAId)
    expect(observedBootstrapSessionId).toBe(subconvAId)
  })

  test('mtls, proxy, openai/grok clients, openaiShared, metricsOptOut, grove, modelCatalogCapabilities & autoMode* isolation across two hosts', async () => {
    const cwdA = await makeTempDir('als-tr-a-')
    const cwdB = await makeTempDir('als-tr-b-')

    // 1. mtls & proxy per-host isolation
    runWithNewHostSession({ cwd: cwdA, isInteractive: false }, () => {
      getMTLSConfig.cache = new Map([[undefined, { passphrase: 'secret-a' }]])
      expect(getMTLSConfig()?.passphrase).toBe('secret-a')
      setDroppedCrossCertificatesStateForTesting({
        dropped: [{} as never],
      })
      expect(getDroppedCrossCertificatesCount()).toBe(1)

      disableKeepAlive()
      enableClosesAfterServerError()
      expect(shouldCloseAfterServerError()).toBe(true)
      expect(getProxyFetchOptions().keepalive).toBe(false)

      const fakeEnv: Record<string, string | undefined> = {
        https_proxy: 'proxy-a.internal:8080',
      }
      repairBareProxySchemeAtStartup({
        env: fakeEnv,
        stdinIsTTY: false,
        stdoutIsTTY: false,
        isNonInteractiveSession: true,
        argv: [],
      })
      expect(getCompletedBareProxyRepairUrl()).toBe(
        'http://proxy-a.internal:8080',
      )
    })

    runWithNewHostSession({ cwd: cwdB, isInteractive: false }, () => {
      expect(getMTLSConfig.cache.size).toBe(0)
      expect(getDroppedCrossCertificatesCount()).toBe(0)
      expect(shouldCloseAfterServerError()).toBe(false)
      expect(getProxyFetchOptions().keepalive).toBeUndefined()
      expect(getCompletedBareProxyRepairUrl()).toBeUndefined()
    })

    // 2. openai client, grok client, openaiShared sticky key (RootSessionSlot)
    process.env.OPENAI_API_KEY = 'sk-openai-test'
    process.env.GROK_API_KEY = 'xai-grok-test'

    const clientInfoA = runWithNewHostSession({ cwd: cwdA }, sessionA => {
      const openaiA = getOpenAIClient()
      const grokA = getGrokClient()
      const keyA = getOpenAIPromptCacheKey()
      // withProject fork shares root session's prompt_cache_key
      const keyAFork = runWithSession(sessionA.withProject({ cwd: cwdB }), () =>
        getOpenAIPromptCacheKey(),
      )
      expect(keyAFork).toBe(keyA)
      return { openaiA, grokA, keyA }
    })

    const clientInfoB = runWithNewHostSession({ cwd: cwdB }, () => ({
      openaiB: getOpenAIClient(),
      grokB: getGrokClient(),
      keyB: getOpenAIPromptCacheKey(),
    }))

    expect(clientInfoA.openaiA).not.toBe(clientInfoB.openaiB)
    expect(clientInfoA.grokA).not.toBe(clientInfoB.grokB)
    expect(clientInfoA.keyA).not.toBe(clientInfoB.keyB)

    // 3. metricsOptOut [W-408/409] & grove.ts per-host memoization isolation
    axiosHandle.useStubs = true
    let metricsCallCount = 0
    process.env.ANTHROPIC_API_KEY = 'sk-ant-metrics-test'
    axiosHandle.stubs.get = (async (url: string) => {
      if (url.includes('/metrics_enabled')) {
        metricsCallCount++
        return {
          status: 200,
          statusText: 'OK',
          data: { metrics_logging_enabled: metricsCallCount === 1 },
        }
      }
      if (url.includes('/api/oauth/account/settings')) {
        return {
          status: 200,
          data: { grove_enabled: true, grove_notice_viewed_at: null },
        }
      }
      if (url.includes('/api/claude_code_grove')) {
        return {
          status: 200,
          data: {
            grove_enabled: true,
            domain_excluded: false,
            notice_is_grace_period: true,
            notice_reminder_frequency: null,
          },
        }
      }
      throw new Error(`Unexpected URL: ${url}`)
    }) as typeof axiosHandle.stubs.get

    await runWithNewHostSession({ cwd: cwdA }, async () => {
      saveGlobalConfig(c => ({ ...c, metricsStatusCache: undefined }))
      const m1 = await checkMetricsEnabled()
      expect(m1).toEqual({ enabled: true, hasError: false })
      // Clear disk cache to prove Host A's in-memory HostSlot memo still serves without refetching
      saveGlobalConfig(c => ({ ...c, metricsStatusCache: undefined }))
      const m1Again = await checkMetricsEnabled()
      expect(m1Again).toEqual({ enabled: true, hasError: false })
      expect(metricsCallCount).toBe(1)

      const gs = await getGroveSettings()
      const gn = await getGroveNoticeConfig()
      expect(gs.success).toBe(true)
      expect(gn.success).toBe(true)
      expect(getGroveSettings.cache.size).toBe(1)
      expect(getGroveNoticeConfig.cache.size).toBe(1)
    })

    await runWithNewHostSession({ cwd: cwdB }, async () => {
      saveGlobalConfig(c => ({ ...c, metricsStatusCache: undefined }))
      // Host B must NOT inherit Host A's in-memory metricsOptOut or grove caches
      expect(getGroveSettings.cache.size).toBe(0)
      expect(getGroveNoticeConfig.cache.size).toBe(0)
      const m2 = await checkMetricsEnabled()
      expect(m2).toEqual({ enabled: false, hasError: false })
      expect(metricsCallCount).toBe(2)
    })

    // 4. bedrock.ts & referral.ts [W-436] per-host isolation
    runWithNewHostSession({ cwd: cwdA }, () => {
      const profilesMap = new Map<unknown, Promise<string[]>>([
        [undefined, Promise.resolve(['us.anthropic.claude-sonnet-4-6'])],
      ])
      getBedrockInferenceProfiles.cache = profilesMap
      expect(getBedrockInferenceProfiles.cache).toBe(profilesMap)
      const backingMap = new Map<string, Promise<string | null>>([
        ['prof-a', Promise.resolve('anthropic.claude-sonnet-4-6-v1:0')],
      ])
      getInferenceProfileBackingModel.cache = backingMap
      expect(getInferenceProfileBackingModel.cache).toBe(backingMap)
    })

    runWithNewHostSession({ cwd: cwdB }, () => {
      expect(getBedrockInferenceProfiles.cache.size).toBe(0)
      expect(getInferenceProfileBackingModel.cache.size).toBe(0)
    })

    // referral.ts: Host A in-flight fetchInProgress does not hijack Host B
    delete process.env.ANTHROPIC_API_KEY
    saveGlobalConfig(c => ({
      ...c,
      oauthAccount: {
        accountUuid: 'acct-ref',
        emailAddress: 'ref@example.test',
        organizationUuid: 'org-ref-1',
      },
    }))
    let releaseRefA: (() => void) | undefined
    let referralGetCalls = 0
    const prevStubGet = axiosHandle.stubs.get
    axiosHandle.stubs.get = (async (url: string) => {
      if (url.includes('/referral/eligibility')) {
        referralGetCalls++
        const callNum = referralGetCalls
        if (callNum === 1) {
          await new Promise<void>(resolve => {
            releaseRefA = resolve
          })
          return {
            status: 200,
            data: { eligible: true, remaining_passes: 3 },
          }
        }
        return {
          status: 200,
          data: { eligible: false, remaining_passes: 0 },
        }
      }
      return prevStubGet ? prevStubGet(url as never) : { status: 200, data: {} }
    }) as typeof axiosHandle.stubs.get

    const refPromiseA = runWithNewHostSession({ cwd: cwdA }, () => {
      setOauthTokenFromFd('oauth-tok-ref-a')
      return fetchAndStorePassesEligibility()
    })
    // Wait a tick so Host A's fetch is in-flight
    await Bun.sleep(10)
    // Host B must NOT await or reuse Host A's in-flight promise
    const refResultB = await runWithNewHostSession({ cwd: cwdB }, () => {
      setOauthTokenFromFd('oauth-tok-ref-b')
      return fetchAndStorePassesEligibility()
    })
    expect(refResultB?.eligible).toBe(false)
    expect(referralGetCalls).toBe(2)
    releaseRefA?.()
    const refResultA = await refPromiseA
    expect(refResultA?.eligible).toBe(true)

    // 5. modelCatalogCapabilities [$e-007] per-root-session isolation (shared across withProject forks)
    const customCatalog: DensableModelCatalog = {
      ...getDensableModelCatalog(),
      models: [
        {
          id: 'claude-custom-host-a',
          family: 'sonnet',
          display_name: 'Custom Host A Model',
          provider_ids: { first_party: 'claude-custom-host-a' },
          capabilities: ['custom_cap'],
        },
      ],
    }

    runWithNewHostSession({ cwd: cwdA }, sessionA => {
      setActivePublishedModelCatalogForTesting(
        customCatalog,
        'host-a-published',
      )
      expect(getActivePublishedModelCatalogSource()).toBe('host-a-published')
      expect(
        getDensableCatalogModel('claude-custom-host-a')?.display_name,
      ).toBe('Custom Host A Model')
      // Fork shares RootSessionSlot
      runWithSession(sessionA.withProject({ cwd: cwdB }), () => {
        expect(getActivePublishedModelCatalogSource()).toBe('host-a-published')
        expect(getDensableCatalogModel('claude-custom-host-a')).toBeDefined()
      })
    })

    runWithNewHostSession({ cwd: cwdB }, () => {
      expect(getActivePublishedModelCatalogSource()).toBeNull()
      expect(getDensableCatalogModel('claude-custom-host-a')).toBeUndefined()
    })

    // 5. autoModeClassifierTransport, autoModeServerContext & autoModeServerFallbackNotice isolation
    await runWithNewHostSession({ cwd: cwdA }, async () => {
      expect(
        readUserServerClassifierSwitch({ CLAUDE_CODE_AUTO_MODE_SERVER: '0' }),
      ).toBe(false)
      expect(thirdPartyServerClassifierOn()).toBe(false)
      setServerCheckDeclined(true)
      expect(serverCheckDeclined()).toBe(true)

      setArtifactConsentGrantedReader(() => false)
      const ctxJsonA = await buildClassifierContextJson(
        getDefaultAppState().toolPermissionContext,
      )
      expect(ctxJsonA.artifact_consent_holdback).toBe(true)
    })

    await runWithNewHostSession({ cwd: cwdB }, async () => {
      expect(peekUserServerClassifierSwitch({})).toBeNull()
      expect(
        readUserServerClassifierSwitch({ CLAUDE_CODE_AUTO_MODE_SERVER: '1' }),
      ).toBe(true)
      expect(thirdPartyServerClassifierOn()).toBe(true)
      expect(serverCheckDeclined()).toBe(false)

      const ctxJsonB = await buildClassifierContextJson(
        getDefaultAppState().toolPermissionContext,
      )
      expect(ctxJsonB.artifact_consent_holdback).toBe(false)
    })
  })
})
