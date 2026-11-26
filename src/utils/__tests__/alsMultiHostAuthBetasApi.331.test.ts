import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import { randomUUID } from 'crypto'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  analyticsMock,
  pushAnalyticsLogEvent,
  restoreAnalyticsMock,
} from '../../../tests/mocks/analytics.js'
import {
  setFlagSettingsInline,
  setOauthScopesFromFd,
  setOauthTokenFromFd,
  setSdkBetas,
} from '../../bootstrap/state.js'
import {
  CONTEXT_1M_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
} from '../../constants/betas.js'
import { asAgentId } from '../../types/ids.js'

mock.module('../../services/analytics/index.ts', analyticsMock)
mock.module('../../services/analytics/index.js', analyticsMock)
mock.module('src/services/analytics/index.ts', analyticsMock)
mock.module('src/services/analytics/index.js', analyticsMock)

import { getEventMetadata } from '../../services/analytics/metadata.js'
import {
  addApiRequestToCache,
  clearApiRequestCache,
  getLastApiRequests,
} from '../../services/api/dumpPrompts.js'
import {
  checkResponseForCacheBreak,
  type PromptStateSnapshot,
  recordPromptState,
  resetPromptCacheBreakDetection,
} from '../../services/api/promptCacheBreakDetection.js'
import {
  clearRequestReplayChainsForTest,
  recordApiRequestForReplay,
} from '../../services/api/requestReplay.js'
import { clearAllSessions } from '../../services/api/sessionIngress.js'
import {
  clearApiKeyHelperCache,
  getApiKeyFromApiKeyHelper,
  getApiKeyFromApiKeyHelperCached,
  getApiKeyFromConfigOrMacOSKeychain,
} from '../auth.js'
import {
  clearBetasCaches,
  getAllModelBetas,
  getMergedBetas,
  getModelBetas,
} from '../betas.js'
import {
  clearGatewayAuth,
  ensureGatewayAuthApplied,
  GATEWAY_SECURE_STORAGE_MISS_TTL_MS,
  getGatewayAuth,
  maybeRefreshGatewayIdp,
  resetGatewaySecureStorageRestoreCache_FOR_TESTS,
  setGatewaySecureStorageNowMs_FOR_TESTS,
  setTestGatewayIdpPostToken_FOR_TESTS,
  setTestGatewaySecureStorageRead_FOR_TESTS,
  tryRestoreGatewayAuthFromSecureStorage,
} from '../gatewayEnv.js'
import { createUserMessage } from '../messages.js'
import {
  getSessionOnceLatches,
  runWithNewHostSession,
  runWithSession,
} from '../sessionRoot.js'
import {
  flushSessionStorage,
  getAgentTranscriptPath,
  recordTranscript,
  resetProjectForTesting,
} from '../sessionStorage.js'
import { resetSettingsCache } from '../settings/settingsCache.js'

// Ensure MACRO globals exist when running standalone under bun test.
;(
  globalThis as unknown as {
    MACRO?: { VERSION: string; BUILD_TIME: string; FEEDBACK_CHANNEL: string }
  }
).MACRO ??= {
  VERSION: '0.0.0-test',
  BUILD_TIME: '2026-01-01T00:00:00Z',
  FEEDBACK_CHANNEL: 'test',
}

const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_BETAS',
  'ANTHROPIC_UNIX_SOCKET',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_API_KEY_FILE_DESCRIPTOR',
  'CLAUDE_CODE_USE_GATEWAY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS',
  'CLAUDE_CODE_SIMPLE',
  'CLAUDE_CONFIG_DIR',
  'TEST_ENABLE_SESSION_PERSISTENCE',
  'USER_TYPE',
] as const

describe('Official 2.1.331 multi-host ALS isolation: betas, auth, gatewayEnv, and API diagnostics', () => {
  const savedEnv: Partial<
    Record<(typeof ENV_KEYS)[number], string | undefined>
  > = {}
  const tempDirs: string[] = []
  const analyticsEvents: Array<{
    name: string
    meta: Record<string, unknown>
  }> = []
  let popAnalyticsLogEvent: (() => void) | undefined

  async function makeTempDir(prefix: string): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), prefix))
    tempDirs.push(dir)
    return dir
  }

  beforeAll(() => {
    for (const key of ENV_KEYS) {
      savedEnv[key] = process.env[key]
    }
    popAnalyticsLogEvent = pushAnalyticsLogEvent((name, metadata) => {
      analyticsEvents.push({
        name,
        meta: (metadata ?? {}) as Record<string, unknown>,
      })
    })
  })

  beforeEach(async () => {
    mock.module('../../services/analytics/index.ts', analyticsMock)
    mock.module('../../services/analytics/index.js', analyticsMock)
    mock.module('src/services/analytics/index.ts', analyticsMock)
    mock.module('src/services/analytics/index.js', analyticsMock)
    for (const key of ENV_KEYS) {
      delete process.env[key]
    }
    const configDir = await makeTempDir('als-331-cfg-')
    process.env.CLAUDE_CONFIG_DIR = configDir
    analyticsEvents.length = 0
  })

  afterEach(async () => {
    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    clearGatewayAuth()
    resetPromptCacheBreakDetection()
    clearRequestReplayChainsForTest()
    clearApiRequestCache()
    clearAllSessions()
    clearBetasCaches()
    clearApiKeyHelperCache()
    getApiKeyFromConfigOrMacOSKeychain.cache.clear()
    await flushSessionStorage()
    resetProjectForTesting()
  })

  afterAll(async () => {
    popAnalyticsLogEvent?.()
    mock.module('../../services/analytics/index.ts', restoreAnalyticsMock)
    mock.module('../../services/analytics/index.js', restoreAnalyticsMock)
    mock.module('src/services/analytics/index.ts', restoreAnalyticsMock)
    mock.module('src/services/analytics/index.js', restoreAnalyticsMock)
    for (const key of ENV_KEYS) {
      const prev = savedEnv[key]
      if (prev === undefined) delete process.env[key]
      else process.env[key] = prev
    }
    for (const dir of tempDirs) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('betas: interactive vs headless REDACT_THINKING_BETA_HEADER, SDK 1m beta, and .cache RootSessionSlot isolation', async () => {
    const cwdA = await makeTempDir('als-betas-a-')
    const cwdB = await makeTempDir('als-betas-b-')

    await Promise.all([
      runWithNewHostSession(
        { cwd: cwdA, isInteractive: true },
        async sessionA => {
          setFlagSettingsInline({ showThinkingSummaries: false })
          resetSettingsCache()

          const betasA = getAllModelBetas('claude-sonnet-4-6')
          expect(betasA).toContain(REDACT_THINKING_BETA_HEADER)
          expect(getModelBetas('claude-sonnet-4-6')).toContain(
            REDACT_THINKING_BETA_HEADER,
          )
          expect(getMergedBetas('claude-sonnet-4-6')).not.toContain(
            CONTEXT_1M_BETA_HEADER,
          )
          expect(getAllModelBetas.cache.has('claude-sonnet-4-6')).toBe(true)
          expect(getAllModelBetas.cache.size).toBe(1)

          // RootSessionSlot shares across withProject forks on the same root session
          const forkA = sessionA.withProject({ cwd: cwdA })
          runWithSession(forkA, () => {
            expect(getAllModelBetas.cache.has('claude-sonnet-4-6')).toBe(true)
            expect(getAllModelBetas.cache.get('claude-sonnet-4-6')).toBe(betasA)
          })

          // Flipping showThinkingSummaries + clearBetasCaches updates Host A
          setFlagSettingsInline({ showThinkingSummaries: true })
          resetSettingsCache()
          clearBetasCaches()
          expect(getAllModelBetas.cache.size).toBe(0)
          expect(getAllModelBetas('claude-sonnet-4-6')).not.toContain(
            REDACT_THINKING_BETA_HEADER,
          )
        },
      ),
      runWithNewHostSession({ cwd: cwdB, isInteractive: false }, async () => {
        setFlagSettingsInline({ showThinkingSummaries: false })
        resetSettingsCache()
        setSdkBetas([CONTEXT_1M_BETA_HEADER])

        // Headless host never sends REDACT_THINKING_BETA_HEADER even when showThinkingSummaries is false
        const betasB = getAllModelBetas('claude-sonnet-4-6')
        expect(betasB).not.toContain(REDACT_THINKING_BETA_HEADER)
        expect(getModelBetas('claude-sonnet-4-6')).not.toContain(
          REDACT_THINKING_BETA_HEADER,
        )

        // SDK 1m beta stays isolated to Host B
        expect(getMergedBetas('claude-sonnet-4-6')).toContain(
          CONTEXT_1M_BETA_HEADER,
        )

        // .cache Map methods operate strictly on Host B's RootSessionSlot
        getAllModelBetas.cache.set('custom-model', ['custom-beta'])
        expect(getAllModelBetas('custom-model')).toEqual(['custom-beta'])
        expect(getAllModelBetas.cache.delete('custom-model')).toBe(true)
        expect(getAllModelBetas.cache.has('custom-model')).toBe(false)
      }),
    ])

    // Default bootstrap session was untouched by either host
    expect(getAllModelBetas.cache.size).toBe(0)
  })

  test('auth: apiKeyHelper and getApiKeyFromConfigOrMacOSKeychain caches are isolated per SessionHost', async () => {
    const cwdA = await makeTempDir('als-auth-a-')
    const cwdB = await makeTempDir('als-auth-b-')

    const [resultA, resultB] = await Promise.all([
      runWithNewHostSession(
        { cwd: cwdA, isInteractive: false },
        async sessionA => {
          setFlagSettingsInline({
            apiKeyHelper: 'printf sk-ant-helper-host-alpha',
          })
          resetSettingsCache()

          const token = await getApiKeyFromApiKeyHelper(true)
          const cached = getApiKeyFromApiKeyHelperCached()

          getApiKeyFromConfigOrMacOSKeychain.cache.set(undefined, {
            key: 'sk-ant-keychain-alpha',
            source: '/login managed key',
          })

          return {
            sessionA,
            token,
            cached,
            keychainKey: getApiKeyFromConfigOrMacOSKeychain()?.key,
          }
        },
      ),
      runWithNewHostSession(
        { cwd: cwdB, isInteractive: false },
        async sessionB => {
          setFlagSettingsInline({
            apiKeyHelper: 'printf sk-ant-helper-host-bravo',
          })
          resetSettingsCache()

          const token = await getApiKeyFromApiKeyHelper(true)
          const cached = getApiKeyFromApiKeyHelperCached()

          return {
            sessionB,
            token,
            cached,
            hasKeychainCache:
              getApiKeyFromConfigOrMacOSKeychain.cache.has(undefined),
          }
        },
      ),
    ])

    expect(resultA.token).toBe('sk-ant-helper-host-alpha')
    expect(resultA.cached).toBe('sk-ant-helper-host-alpha')
    expect(resultA.keychainKey).toBe('sk-ant-keychain-alpha')

    expect(resultB.token).toBe('sk-ant-helper-host-bravo')
    expect(resultB.cached).toBe('sk-ant-helper-host-bravo')
    expect(resultB.hasKeychainCache).toBe(false)

    // Clearing Host A's apiKeyHelper cache never wipes Host B's cached helper token
    runWithSession(resultA.sessionA, () => {
      clearApiKeyHelperCache()
      expect(getApiKeyFromApiKeyHelperCached()).toBeNull()
    })
    runWithSession(resultB.sessionB, () => {
      expect(getApiKeyFromApiKeyHelperCached()).toBe('sk-ant-helper-host-bravo')
    })
  })

  test('gatewayEnv: Host A invalid_grant permanent skip latch does not block Host B secure-storage restore', async () => {
    const cwdA = await makeTempDir('als-gw-a-')
    const cwdB = await makeTempDir('als-gw-b-')

    let nowMs = 5_000_000
    setGatewaySecureStorageNowMs_FOR_TESTS(() => nowMs)

    setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: `jwt-at-${nowMs}`,
        expiresAtMs: nowMs - 1,
        idpRefreshToken: 'refresh-token-shared',
        tokenEndpoint: 'https://idp.example/token',
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }))

    setTestGatewayIdpPostToken_FOR_TESTS(async () => {
      throw {
        isAxiosError: true,
        response: { data: { error: 'invalid_grant' } },
      }
    })

    await runWithNewHostSession(
      { cwd: cwdA, isInteractive: false },
      async () => {
        const initialA = tryRestoreGatewayAuthFromSecureStorage({ quiet: true })
        expect(initialA.status).toBe('restored')

        const refreshA = await maybeRefreshGatewayIdp({
          nowMs,
          autoPersist: false,
        })
        expect(refreshA).toEqual({
          status: 'invalid_grant',
          clearedRefresh: true,
        })

        // Even past normal miss TTL, Host A stays permanently skipped until invalidate
        nowMs += GATEWAY_SECURE_STORAGE_MISS_TTL_MS * 2
        expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true })).toEqual(
          {
            status: 'skipped',
            reason: 'miss_ttl',
          },
        )
      },
    )

    // Host B has an independent HostSlot: its cold restore succeeds without hitting Host A's skip
    await runWithNewHostSession(
      { cwd: cwdB, isInteractive: false },
      async () => {
        const appliedB = ensureGatewayAuthApplied()
        expect(appliedB?.url).toBe('https://gw.example')
        expect(getGatewayAuth()?.idpRefreshToken).toBe('refresh-token-shared')
      },
    )
  })

  test('promptCacheBreakDetection & requestReplay: interleaved concurrent sdk sessions stay isolated', async () => {
    process.env.TEST_ENABLE_SESSION_PERSISTENCE = '1'
    const cwdA = await makeTempDir('als-api-a-')
    const cwdB = await makeTempDir('als-api-b-')
    const sessionIdA = randomUUID()
    const sessionIdB = randomUUID()
    const sharedAgentId = asAgentId(`a${'1'.repeat(16)}`)

    function sdkSnapshot(
      model: string,
      systemText: string,
    ): PromptStateSnapshot {
      return {
        system: [{ type: 'text', text: systemText }],
        toolSchemas: [],
        querySource: 'sdk',
        model,
      }
    }

    let stepA1Done!: () => void
    const waitStepA1 = new Promise<void>(r => {
      stepA1Done = r
    })
    let stepB2Done!: () => void
    const waitStepB2 = new Promise<void>(r => {
      stepB2Done = r
    })

    const [agentPathA, agentPathB] = await Promise.all([
      runWithNewHostSession(
        {
          id: sessionIdA,
          cwd: cwdA,
          originalCwd: cwdA,
          projectRoot: cwdA,
          isInteractive: false,
        },
        async () => {
          await recordTranscript([createUserMessage({ content: 'alpha-init' })])

          // Turn 1 on Host A (stable opus-4-7)
          recordPromptState(sdkSnapshot('claude-opus-4-7', 'system-alpha'))
          await checkResponseForCacheBreak(
            'sdk',
            20_000,
            0,
            [],
            undefined,
            'req_a_1',
          )
          await recordApiRequestForReplay({
            querySource: 'sdk',
            agentId: sharedAgentId,
            params: {
              model: 'claude-opus-4-7',
              system: [{ type: 'text', text: 'system-alpha' }],
              tools: [],
              messages: [
                { role: 'user', content: 'alpha-1' },
                { role: 'assistant', content: 'alpha-reply-1' },
              ],
            },
          })
          stepA1Done()

          // Wait until Host B switches models and triggers its cache break
          await waitStepB2

          // Turn 2 on Host A (unchanged prompt & healthy cache read)
          recordPromptState(sdkSnapshot('claude-opus-4-7', 'system-alpha'))
          await checkResponseForCacheBreak(
            'sdk',
            19_800,
            0,
            [],
            undefined,
            'req_a_2',
          )
          await recordApiRequestForReplay({
            querySource: 'sdk',
            agentId: sharedAgentId,
            params: {
              model: 'claude-opus-4-7',
              system: [{ type: 'text', text: 'system-alpha' }],
              tools: [],
              messages: [
                { role: 'user', content: 'alpha-1' },
                { role: 'assistant', content: 'alpha-reply-1' },
                { role: 'user', content: 'alpha-2' },
              ],
            },
          })
          await flushSessionStorage()
          return getAgentTranscriptPath(sharedAgentId)
        },
      ),
      runWithNewHostSession(
        {
          id: sessionIdB,
          cwd: cwdB,
          originalCwd: cwdB,
          projectRoot: cwdB,
          isInteractive: false,
        },
        async () => {
          await waitStepA1
          await recordTranscript([createUserMessage({ content: 'bravo-init' })])

          // Turn 1 on Host B
          recordPromptState(sdkSnapshot('claude-opus-4-7', 'system-bravo'))
          await checkResponseForCacheBreak(
            'sdk',
            20_000,
            0,
            [],
            undefined,
            'req_b_1',
          )
          await recordApiRequestForReplay({
            querySource: 'sdk',
            agentId: sharedAgentId,
            params: {
              model: 'claude-opus-4-7',
              system: [{ type: 'text', text: 'system-bravo' }],
              tools: [],
              messages: [
                { role: 'user', content: 'bravo-1' },
                { role: 'assistant', content: 'bravo-reply-1' },
              ],
            },
          })

          // Turn 2 on Host B: flips model -> triggers cache break ONLY for Host B
          recordPromptState(sdkSnapshot('claude-sonnet-4-6', 'system-bravo'))
          await checkResponseForCacheBreak(
            'sdk',
            1_000,
            0,
            [],
            undefined,
            'req_b_2',
          )
          await recordApiRequestForReplay({
            querySource: 'sdk',
            agentId: sharedAgentId,
            params: {
              model: 'claude-sonnet-4-6',
              system: [{ type: 'text', text: 'system-bravo' }],
              tools: [],
              messages: [
                { role: 'user', content: 'bravo-1' },
                { role: 'assistant', content: 'bravo-reply-1' },
                { role: 'user', content: 'bravo-2' },
              ],
            },
          })
          stepB2Done()
          await flushSessionStorage()
          return getAgentTranscriptPath(sharedAgentId)
        },
      ),
    ])

    const breaks = analyticsEvents.filter(
      e => e.name === 'tengu_prompt_cache_break',
    )
    expect(breaks).toHaveLength(1)
    expect(breaks[0]?.meta.requestId).toBe('req_b_2')
    expect(breaks[0]?.meta.modelChanged).toBe(true)

    // Verify both sessions preserved independent requestReplay prefix chains (`keep: 2` + distinct `base`)
    const entriesA = (await readFile(agentPathA, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(entry => entry.type === 'api-request')
    const entriesB = (await readFile(agentPathB, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line) as Record<string, unknown>)
      .filter(entry => entry.type === 'api-request')

    expect(entriesA).toHaveLength(2)
    expect(entriesB).toHaveLength(2)
    expect(entriesA[1]?.keep).toBe(2)
    expect(entriesA[1]?.base).toBe(entriesA[0]?.id)
    expect(entriesB[1]?.keep).toBe(2)
    expect(entriesB[1]?.base).toBe(entriesB[0]?.id)
    expect(entriesA[0]?.id).not.toBe(entriesB[0]?.id)
  })

  test('dumpPrompts, sessionIngress, and analytics buildEnvContext are isolated per session/host', async () => {
    process.env.USER_TYPE = 'ant'
    const cwdA = await makeTempDir('als-meta-a-')
    const cwdB = await makeTempDir('als-meta-b-')

    const [metaA, metaB] = await Promise.all([
      runWithNewHostSession({ cwd: cwdA, isInteractive: true }, async () => {
        // Host A is a Claude.ai OAuth subscriber
        setOauthTokenFromFd('oauth-subscriber-token-a')
        setOauthScopesFromFd(['user:inference', 'user:profile'])

        addApiRequestToCache({ host: 'alpha' })
        getSessionOnceLatches().lastIngressUuidBySession.set(
          'sess-shared',
          'uuid-alpha',
        )

        const metadata = await getEventMetadata({ model: 'claude-sonnet-4-6' })
        return {
          isClaudeAiAuth: metadata.envContext.isClaudeAiAuth,
          requests: getLastApiRequests(),
          lastUuid:
            getSessionOnceLatches().lastIngressUuidBySession.get('sess-shared'),
        }
      }),
      runWithNewHostSession({ cwd: cwdB, isInteractive: false }, async () => {
        // Host B uses apiKeyHelper (not a Claude.ai subscriber)
        setFlagSettingsInline({ apiKeyHelper: 'printf sk-ant-meta-b' })
        resetSettingsCache()

        addApiRequestToCache({ host: 'bravo' })
        getSessionOnceLatches().lastIngressUuidBySession.set(
          'sess-shared',
          'uuid-bravo',
        )

        const metadata = await getEventMetadata({ model: 'claude-sonnet-4-6' })
        clearAllSessions()
        return {
          isClaudeAiAuth: metadata.envContext.isClaudeAiAuth,
          requests: getLastApiRequests(),
          clearedUuid:
            getSessionOnceLatches().lastIngressUuidBySession.get('sess-shared'),
        }
      }),
    ])

    expect(metaA.isClaudeAiAuth).toBe(true)
    expect(metaB.isClaudeAiAuth).toBe(false)
    expect(metaA.requests.map(r => r.request)).toEqual([{ host: 'alpha' }])
    expect(metaB.requests.map(r => r.request)).toEqual([{ host: 'bravo' }])
    expect(metaA.lastUuid).toBe('uuid-alpha')
    expect(metaB.clearedUuid).toBeUndefined()
  })
})
