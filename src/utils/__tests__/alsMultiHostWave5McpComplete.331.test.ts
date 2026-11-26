import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { APIError } from '@anthropic-ai/sdk'
import type { Client } from '@modelcontextprotocol/client'
import axios from 'axios'
import * as analyticsMod from '../../services/analytics/index.js'
import {
  ClaudeAuthProvider,
  emitMcpAuthRecovered,
  readMcpCredentialStore,
  resetCredentialStoreStrictProbeState,
  subscribeMcpAuthRecovered,
} from '../../services/mcp/auth.js'
import {
  isHearthbotBareElicitationPinned,
  maybePinHearthbotBareElicitation,
  resetHearthbotBareElicitationPinForTests,
} from '../../services/mcp/ccrInjectedMcp.js'
import { fetchClaudeAIMcpConfigsIfEligible } from '../../services/mcp/claudeai.js'
import {
  filterMcpToolsByNameLength,
  MAX_MCP_TOOL_NAME_LENGTH,
  resetReportedLongToolNamesForTest,
} from '../../services/mcp/clientHelpers.js'
import {
  clearMcpAuthCache,
  clearRejectedClaudeAiBearerToken,
  hasClaudeAiBearerRecoveredAfterLogin,
  isMcpAuthCached,
  recordRejectedClaudeAiBearerToken,
  setMcpAuthCacheEntry,
} from '../../services/mcp/connectionHelpers.js'
import {
  clearMcpElicitationDeclinedState,
  consumeMcpElicitationDeclinedDuringCall,
  recordMcpElicitationDeclinedForServer,
} from '../../services/mcp/elicitationHandler.js'
import {
  clearRememberedLegacyStdio,
  flushRememberedLegacyStdioWritesForTest,
  getCapturedCcrIngressBase,
  isMcpCcrProxyUrl,
  isRememberedLegacyStdio,
  loadRememberedLegacyStdioFromDisk,
  recordRememberedLegacyStdio,
  resetMcpCcrIngressCapture,
  resetStdioDiscoverVerdictCacheForTest,
} from '../../services/mcp/mcpConnectTimeout.js'
import {
  approveSessionMcpServers,
  getSessionApprovedMcpServers,
  getSessionRejectedMcpServers,
  isSessionRejectedMcpServer,
  rejectSessionMcpServers,
  resetSessionApprovedMcpServersForTests,
} from '../../services/mcp/mcpSessionApprovedServers.js'
import {
  EMPTY_OBJECT_TOOL_SCHEMA,
  getMcpDraft202012Validator,
  getRefusedToolSchemas,
  RefusedToolSchemaResolver,
  replaceRefusedToolSchemas,
  resetMcpDraft202012ValidatorForTests,
  resetRefusedToolSchemas,
} from '../../services/mcp/mcpToolSchema.js'
import {
  getMcpSdkGeneration,
  isMcpV1CompatMode,
  resetMcpSdkGenerationForTests,
} from '../../services/mcp/mcpV2Client.js'
import {
  claimOAuthRedirectPort,
  releaseOAuthRedirectPort,
  resetOAuthRedirectPortAborts,
  setOAuthRedirectPortRelease,
  waitForOAuthRedirectPortRelease,
} from '../../services/mcp/oauthPort.js'
import {
  isOfficialMcpUrl,
  prefetchOfficialMcpUrls,
  resetOfficialMcpUrlsForTesting,
  setOfficialMcpUrlsForTesting,
} from '../../services/mcp/officialRegistry.js'
import {
  _resetPendingMcpElicitationsForTests,
  beginMcpElicitation,
  endMcpElicitation,
  hasPendingMcpElicitation,
} from '../../services/mcp/transportErrorState.js'
import type {
  ConnectedMCPServer,
  McpHTTPServerConfig,
} from '../../services/mcp/types.js'
import {
  notifyVscodeFileUpdated,
  resetVscodeSdkMcpForTests,
  setupVscodeSdkMcp,
} from '../../services/mcp/vscodeSdkMcp.js'
import * as logMod from '../log.js'
import * as secureStorageMod from '../secureStorage/index.js'
import type {
  SecureStorage,
  SecureStorageData,
} from '../secureStorage/types.js'
import {
  getActiveSessionFromAls,
  hasActiveSessionAls,
  runWithNewHostSession,
  runWithSession,
  type Session,
} from '../sessionRoot.js'

function createDeferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err?: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const SAMPLE_HTTP_CONFIG: McpHTTPServerConfig = {
  type: 'http',
  url: 'https://mcp.example.com/rpc',
}

describe('Wave 5 Multi-Host MCP Complete Isolation + ClaudeAuthProvider Fixes (2.1.331)', () => {
  const spies: Array<{ mockRestore(): void }> = []
  const tempDirs: string[] = []
  const prevConfigDir = process.env.CLAUDE_CONFIG_DIR
  const prevUserType = process.env.USER_TYPE
  const prevDisableNonessential =
    process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC

  function makeTempConfigDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'mcp-wave5-'))
    tempDirs.push(dir)
    return dir
  }

  afterEach(() => {
    while (spies.length > 0) {
      spies.pop()?.mockRestore()
    }
    if (prevConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = prevConfigDir
    }
    if (prevUserType === undefined) {
      delete process.env.USER_TYPE
    } else {
      process.env.USER_TYPE = prevUserType
    }
    if (prevDisableNonessential === undefined) {
      delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    } else {
      process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC =
        prevDisableNonessential
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()
      if (dir) {
        try {
          rmSync(dir, { recursive: true, force: true })
        } catch {
          // ignore cleanup failure
        }
      }
    }
    resetCredentialStoreStrictProbeState()
    resetSessionApprovedMcpServersForTests()
    clearRejectedClaudeAiBearerToken()
    resetMcpDraft202012ValidatorForTests()
    resetRefusedToolSchemas()
    resetOfficialMcpUrlsForTesting()
    resetMcpCcrIngressCapture()
    resetStdioDiscoverVerdictCacheForTest()
    clearMcpElicitationDeclinedState()
    _resetPendingMcpElicitationsForTests()
    resetOAuthRedirectPortAborts()
    resetHearthbotBareElicitationPinForTests()
    resetReportedLongToolNamesForTest()
    resetMcpSdkGenerationForTests()
    resetVscodeSdkMcpForTests()
  })

  test('auth.ts: ClaudeAuthProvider constructed outside ALS keeps hasActiveSessionAls() === false; constructed inside sessionA re-enters sessionA even from sessionB', async () => {
    const observations: Array<{
      label: string
      hasAls: boolean
      sessionId: string | undefined
    }> = []

    const fakeStorage: SecureStorage = {
      name: 'test-storage',
      read: () => null,
      readAsync: async () => {
        observations.push({
          label: 'readAsync',
          hasAls: hasActiveSessionAls(),
          sessionId: getActiveSessionFromAls()?.id,
        })
        return null
      },
      update: () => ({ success: true }),
      delete: () => true,
    }
    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(fakeStorage),
    )

    // 1. Single-host CLI mode (outside ALS)
    expect(hasActiveSessionAls()).toBe(false)
    const cliProvider = new ClaudeAuthProvider('cli-srv', SAMPLE_HTTP_CONFIG)
    await cliProvider.tokens()
    expect(observations).toEqual([
      { label: 'readAsync', hasAls: false, sessionId: undefined },
    ])
    expect(hasActiveSessionAls()).toBe(false)

    // 2. Multi-host mode: constructed in sessionA, invoked inside sessionB and outside ALS
    let providerA!: ClaudeAuthProvider
    let sessionA!: Session
    runWithNewHostSession({ id: 'auth-host-a', diskless: true }, s => {
      sessionA = s
      providerA = new ClaudeAuthProvider('host-a-srv', SAMPLE_HTTP_CONFIG)
    })

    observations.length = 0
    await runWithNewHostSession(
      { id: 'auth-host-b', diskless: true },
      async () => {
        await providerA.tokens()
        // Outer sessionB ALS remains intact after providerA.tokens() returns
        expect(getActiveSessionFromAls()?.id).toBe('auth-host-b')
      },
    )
    expect(observations).toEqual([
      { label: 'readAsync', hasAls: true, sessionId: sessionA.id },
    ])

    // Invoked outside ALS still re-enters sessionA
    observations.length = 0
    await providerA.tokens()
    expect(observations).toEqual([
      { label: 'readAsync', hasAls: true, sessionId: sessionA.id },
    ])
    expect(hasActiveSessionAls()).toBe(false)
  })

  test('auth.ts: subscribeMcpAuthRecovered deduplicates identical listeners inside ALS, preserves host isolation, and guards stale unsubscribes', async () => {
    const callsA: Array<{ name: string; sid: string | undefined }> = []
    const callsB: Array<{ name: string; sid: string | undefined }> = []

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'recov-host-a', diskless: true },
        async sessionA => {
          const listenerA = (name: string) => {
            callsA.push({ name, sid: getActiveSessionFromAls()?.id })
          }
          // Subscribing the exact same listener twice inside ALS must deduplicate!
          const unsub1 = subscribeMcpAuthRecovered(listenerA)
          const unsub2 = subscribeMcpAuthRecovered(listenerA)

          emitMcpAuthRecovered('srv-a', SAMPLE_HTTP_CONFIG)
          expect(callsA).toEqual([{ name: 'srv-a', sid: sessionA.id }])

          barrierA.resolve()
          await barrierB.promise

          // Unsubscribing via first handle removes the deduplicated listener
          unsub1()
          emitMcpAuthRecovered('srv-a-after-unsub', SAMPLE_HTTP_CONFIG)
          expect(callsA).toHaveLength(1)

          // Re-subscribing and calling stale unsub1 again must NOT clobber the new subscription
          const unsub3 = subscribeMcpAuthRecovered(listenerA)
          unsub1()
          emitMcpAuthRecovered('srv-a-resub', SAMPLE_HTTP_CONFIG)
          expect(callsA).toEqual([
            { name: 'srv-a', sid: sessionA.id },
            { name: 'srv-a-resub', sid: sessionA.id },
          ])

          unsub2()
          unsub3()
        },
      ),
      runWithNewHostSession(
        { id: 'recov-host-b', diskless: true },
        async sessionB => {
          await barrierA.promise
          const listenerB = (name: string) => {
            callsB.push({ name, sid: getActiveSessionFromAls()?.id })
          }
          const unsubB1 = subscribeMcpAuthRecovered(listenerB)
          const unsubB2 = subscribeMcpAuthRecovered(listenerB)

          emitMcpAuthRecovered('srv-b', SAMPLE_HTTP_CONFIG)
          expect(callsB).toEqual([{ name: 'srv-b', sid: sessionB.id }])
          // Host A must never have seen Host B's emission
          expect(callsA.map(c => c.name)).toEqual(['srv-a'])

          barrierB.resolve()
          unsubB1()
          unsubB2()
        },
      ),
    ])
  })

  test('auth.ts: strictReadProbeState is isolated per host across readMcpCredentialStore and resetCredentialStoreStrictProbeState', async () => {
    let strictCallsA = 0
    let strictCallsB = 0

    const fakeStorage: SecureStorage = {
      name: 'probe-test-storage',
      read: () => null,
      readAsync: async () => null,
      readAsyncStrict: async () => {
        const sid = getActiveSessionFromAls()?.id
        if (sid === 'probe-host-a') {
          strictCallsA++
          return null
        }
        if (sid === 'probe-host-b') {
          strictCallsB++
          const data: SecureStorageData = {
            mcpOAuth: {
              'srv-b|key': {
                serverName: 'srv-b',
                serverUrl: 'https://b.example.com',
                accessToken: 'tok-b',
                expiresAt: Date.now() + 60_000,
              },
            },
          }
          return data
        }
        return null
      },
      update: () => ({ success: true }),
      delete: () => true,
    }
    spies.push(
      spyOn(secureStorageMod, 'getSecureStorage').mockReturnValue(fakeStorage),
    )

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'probe-host-a', diskless: true },
        async () => {
          // First read populates empty verdict for Host A
          const res1 = await readMcpCredentialStore()
          expect(res1).toBeNull()
          expect(strictCallsA).toBe(1)

          // Second read hits Host A's cached empty verdict (no second strict probe)
          const res2 = await readMcpCredentialStore()
          expect(res2).toBeNull()
          expect(strictCallsA).toBe(1)

          barrierA.resolve()
          await barrierB.promise

          // Resetting Host A allows Host A to probe again without disturbing Host B
          resetCredentialStoreStrictProbeState()
          await readMcpCredentialStore()
          expect(strictCallsA).toBe(2)
        },
      ),
      runWithNewHostSession(
        { id: 'probe-host-b', diskless: true },
        async () => {
          await barrierA.promise
          // Host A's cached empty verdict must NOT suppress Host B's strict probe!
          const resB = await readMcpCredentialStore()
          expect(strictCallsB).toBe(1)
          expect(resB).not.toBeNull()
          expect(resB).not.toBe(secureStorageMod.SECURE_STORAGE_READ_FAILED)
          barrierB.resolve()
        },
      ),
    ])
  })

  test('mcpSessionApprovedServers.ts: RootSessionSlot isolates approvals/rejections across hosts and shares within withProject forks', async () => {
    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'appr-host-a', diskless: true },
        async sessionA => {
          approveSessionMcpServers('/shared-workspace', ['srv-a'])
          rejectSessionMcpServers('/shared-workspace', ['bad-a'])

          expect(getSessionApprovedMcpServers()).toEqual([
            { name: 'srv-a', workspaceKey: '/shared-workspace' },
          ])
          expect(isSessionRejectedMcpServer('/shared-workspace', 'bad-a')).toBe(
            true,
          )

          // withProject fork shares root session's RootSessionSlot
          const forkA = sessionA.withProject({ cwd: '/shared-workspace/sub' })
          runWithSession(forkA, () => {
            expect(getSessionApprovedMcpServers()).toEqual([
              { name: 'srv-a', workspaceKey: '/shared-workspace' },
            ])
            expect(
              isSessionRejectedMcpServer('/shared-workspace', 'bad-a'),
            ).toBe(true)
            approveSessionMcpServers('/shared-workspace', ['srv-a-fork'])
          })
          expect(getSessionApprovedMcpServers().map(r => r.name)).toEqual([
            'srv-a',
            'srv-a-fork',
          ])

          barrierA.resolve()
          await barrierB.promise

          // Host B's approvals/rejections must NEVER leak into Host A
          expect(getSessionApprovedMcpServers().map(r => r.name)).not.toContain(
            'srv-b',
          )
          expect(isSessionRejectedMcpServer('/shared-workspace', 'bad-b')).toBe(
            false,
          )

          // Resetting Host A must not affect Host B
          resetSessionApprovedMcpServersForTests()
          expect(getSessionApprovedMcpServers()).toEqual([])
          expect(getSessionRejectedMcpServers()).toEqual([])
        },
      ),
      runWithNewHostSession({ id: 'appr-host-b', diskless: true }, async () => {
        await barrierA.promise
        // Host A's approvals/rejections must NEVER leak into Host B
        expect(getSessionApprovedMcpServers()).toEqual([])
        expect(getSessionRejectedMcpServers()).toEqual([])
        expect(isSessionRejectedMcpServer('/shared-workspace', 'bad-a')).toBe(
          false,
        )

        approveSessionMcpServers('/shared-workspace', ['srv-b'])
        rejectSessionMcpServers('/shared-workspace', ['bad-b'])
        expect(getSessionApprovedMcpServers().map(r => r.name)).toEqual([
          'srv-b',
        ])
        expect(isSessionRejectedMcpServer('/shared-workspace', 'bad-b')).toBe(
          true,
        )

        barrierB.resolve()
        // Wait a tick for Host A to run its reset, then confirm Host B is intact
        await new Promise(r => setTimeout(r, 10))
        expect(getSessionApprovedMcpServers().map(r => r.name)).toEqual([
          'srv-b',
        ])
        expect(isSessionRejectedMcpServer('/shared-workspace', 'bad-b')).toBe(
          true,
        )
      }),
    ])
  })

  test('connectionHelpers.ts: authCachePromise, writeChain, and lastRejectedClaudeAiBearerToken are isolated per host', async () => {
    const configDir = makeTempConfigDir()
    process.env.CLAUDE_CONFIG_DIR = configDir
    const cacheFile = join(configDir, 'mcp-needs-auth-cache.json')
    writeFileSync(
      cacheFile,
      JSON.stringify({ 'srv-a': { timestamp: Date.now() } }),
    )

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession({ id: 'conn-host-a', diskless: true }, async () => {
        // Populate Host A's authCachePromise with srv-a
        expect(await isMcpAuthCached('srv-a')).toBe(true)
        // Record rejected bearer token on Host A
        recordRejectedClaudeAiBearerToken('tok-a-old')
        expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'tok-a-new')).toBe(
          true,
        )

        // Update file on disk to only srv-b; Host A still holds its memoized authCachePromise
        writeFileSync(
          cacheFile,
          JSON.stringify({ 'srv-b': { timestamp: Date.now() } }),
        )
        expect(await isMcpAuthCached('srv-a')).toBe(true)
        expect(await isMcpAuthCached('srv-b')).toBe(false)

        barrierA.resolve()
        await barrierB.promise

        // Host B's clearMcpAuthCache() & clearRejectedClaudeAiBearerToken() did NOT affect Host A
        expect(await isMcpAuthCached('srv-a')).toBe(true)
        expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'tok-a-new')).toBe(
          true,
        )

        // Write via Host A's writeChain works cleanly
        setMcpAuthCacheEntry('srv-a-written')
        clearMcpAuthCache()
        clearRejectedClaudeAiBearerToken()
        expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'tok-a-new')).toBe(
          false,
        )
      }),
      runWithNewHostSession({ id: 'conn-host-b', diskless: true }, async () => {
        await barrierA.promise
        // Host B has its own authCachePromise and sees srv-b from disk
        expect(await isMcpAuthCached('srv-b')).toBe(true)
        expect(await isMcpAuthCached('srv-a')).toBe(false)

        // Host B must NOT see Host A's rejected bearer token
        expect(hasClaudeAiBearerRecoveredAfterLogin(() => 'tok-a-new')).toBe(
          false,
        )
        recordRejectedClaudeAiBearerToken('tok-b-old')
        clearRejectedClaudeAiBearerToken()
        clearMcpAuthCache()

        barrierB.resolve()
      }),
    ])
  })

  test('mcpToolSchema.ts: metaValidator and sessionRefusedToolSchemas are isolated per host', async () => {
    const badSchema: Record<string, unknown> = {
      type: 'object',
      properties: { bad: { type: 'string', exclusiveMinimum: true } },
    }
    const apiErr = new APIError(
      400,
      {
        type: 'error',
        error: {
          type: 'invalid_request_error',
          message: 'tools.0.input_schema: invalid schema',
        },
      },
      'tools.0.input_schema: invalid schema',
      new Headers(),
    )
    const sampleTools = [
      {
        name: 'mcp__srv__broken',
        isMcp: true,
        mcpInfo: { serverName: 'srv', toolName: 'broken' },
      },
    ]

    let validatorA: ReturnType<typeof getMcpDraft202012Validator> = null
    let validatorB: ReturnType<typeof getMcpDraft202012Validator> = null
    let refusedMapA: Map<string, Set<string>> | undefined
    let refusedMapB: Map<string, Set<string>> | undefined

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'schema-host-a', diskless: true },
        async () => {
          validatorA = getMcpDraft202012Validator()
          expect(validatorA).not.toBeNull()
          expect(getMcpDraft202012Validator()).toBe(validatorA)

          refusedMapA = getRefusedToolSchemas()
          const resolverA = new RefusedToolSchemaResolver()
          const retryTag = resolverA.resolve(
            apiErr,
            [{ name: 'mcp__srv__broken', input_schema: badSchema }],
            sampleTools,
          )
          expect(retryTag).toBe('retry:tool-schema-refused-1')

          const replacedA = replaceRefusedToolSchemas([
            { name: 'mcp__srv__broken', input_schema: badSchema },
          ])
          expect(replacedA[0]?.input_schema).toEqual(EMPTY_OBJECT_TOOL_SCHEMA)

          barrierA.resolve()
          await barrierB.promise

          // Host B's resets did NOT affect Host A
          expect(getMcpDraft202012Validator()).toBe(validatorA)
          expect(getRefusedToolSchemas().size).toBe(1)

          // Resetting Host A creates a fresh validator only for Host A
          resetMcpDraft202012ValidatorForTests()
          const validatorA2 = getMcpDraft202012Validator()
          expect(validatorA2).not.toBe(validatorA)
        },
      ),
      runWithNewHostSession(
        { id: 'schema-host-b', diskless: true },
        async () => {
          await barrierA.promise
          validatorB = getMcpDraft202012Validator()
          expect(validatorB).not.toBeNull()
          expect(validatorB).not.toBe(validatorA)

          refusedMapB = getRefusedToolSchemas()
          expect(refusedMapB).not.toBe(refusedMapA)
          expect(refusedMapB.size).toBe(0)

          // Host A's refused schema must NOT degrade Host B's identical tool schema
          const untouchedB = replaceRefusedToolSchemas([
            { name: 'mcp__srv__broken', input_schema: badSchema },
          ])
          expect(untouchedB[0]?.input_schema).toEqual(badSchema)

          resetRefusedToolSchemas()
          resetMcpDraft202012ValidatorForTests()
          barrierB.resolve()
        },
      ),
    ])
  })

  test('officialRegistry.ts: officialUrls, officialUrlsFetchInFlight, and urlsRegistryCannotList are isolated per host', async () => {
    delete process.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC
    const deferredA = createDeferred<{
      status: number
      data: { urls: string[] }
    }>()
    const deferredB = createDeferred<{
      status: number
      data: { urls: string[] }
    }>()
    let axiosCalls = 0

    spies.push(
      spyOn(axios, 'get').mockImplementation((async () => {
        axiosCalls++
        const sid = getActiveSessionFromAls()?.id
        if (sid === 'reg-host-a') return deferredA.promise
        return deferredB.promise
      }) as typeof axios.get),
    )

    const startedA = createDeferred<void>()
    const startedB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession({ id: 'reg-host-a', diskless: true }, async () => {
        // Non-https URL added to Host A's urlsRegistryCannotList
        expect(isOfficialMcpUrl('http://local-a.internal')).toBe(false)

        const fetchPromiseA = prefetchOfficialMcpUrls()
        startedA.resolve()
        await startedB.promise

        // Both hosts should have initiated independent in-flight fetches
        expect(axiosCalls).toBe(2)

        deferredA.resolve({
          status: 200,
          data: { urls: ['https://official-a.example.com/mcp/'] },
        })
        await fetchPromiseA

        expect(isOfficialMcpUrl('https://official-a.example.com/mcp')).toBe(
          true,
        )
        expect(isOfficialMcpUrl('https://official-b.example.com/mcp')).toBe(
          false,
        )
      }),
      runWithNewHostSession({ id: 'reg-host-b', diskless: true }, async () => {
        await startedA.promise
        const fetchPromiseB = prefetchOfficialMcpUrls()
        startedB.resolve()

        deferredB.resolve({
          status: 200,
          data: { urls: ['https://official-b.example.com/mcp/'] },
        })
        await fetchPromiseB

        expect(isOfficialMcpUrl('https://official-b.example.com/mcp')).toBe(
          true,
        )
        expect(isOfficialMcpUrl('https://official-a.example.com/mcp')).toBe(
          false,
        )

        // setOfficialMcpUrlsForTesting & reset in Host B do not affect Host A
        setOfficialMcpUrlsForTesting(['https://override-b.example.com'])
        expect(isOfficialMcpUrl('https://override-b.example.com')).toBe(true)
        resetOfficialMcpUrlsForTesting()
        expect(isOfficialMcpUrl('https://override-b.example.com')).toBe(false)
      }),
    ])
  })

  test('mcpConnectTimeout.ts: capturedCcrIngressBase, stdioDiscoverVerdictCache, loadPromise, and writeChain are isolated per host', async () => {
    const configDirA = makeTempConfigDir()
    const configDirB = makeTempConfigDir()
    const stdioA = { type: 'stdio', command: 'node', args: ['server-a.js'] }
    const stdioB = { type: 'stdio', command: 'node', args: ['server-b.js'] }

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession({ id: 'ct-host-a', diskless: true }, async () => {
        process.env.CLAUDE_CONFIG_DIR = configDirA
        resetMcpCcrIngressCapture({
          SESSION_INGRESS_URL: 'https://ingress-a.example',
        })
        expect(getCapturedCcrIngressBase()).toBe('https://ingress-a.example')
        expect(
          isMcpCcrProxyUrl('https://ingress-a.example/v2/ccr-sessions/abc'),
        ).toBe(true)

        recordRememberedLegacyStdio(stdioA)
        await flushRememberedLegacyStdioWritesForTest()
        expect(isRememberedLegacyStdio(stdioA)).toBe(true)
        await loadRememberedLegacyStdioFromDisk(Date.now(), { once: true })

        barrierA.resolve()
        await barrierB.promise

        // Host B's ingress base & stdio verdict must NEVER leak into Host A
        expect(getCapturedCcrIngressBase()).toBe('https://ingress-a.example')
        expect(
          isMcpCcrProxyUrl('https://ingress-b.example/v2/ccr-sessions/abc'),
        ).toBe(false)
        expect(isRememberedLegacyStdio(stdioA)).toBe(true)
        expect(isRememberedLegacyStdio(stdioB)).toBe(false)

        // Resetting stdio verdict cache must preserve capturedCcrIngressBase
        resetStdioDiscoverVerdictCacheForTest()
        expect(isRememberedLegacyStdio(stdioA)).toBe(false)
        expect(getCapturedCcrIngressBase()).toBe('https://ingress-a.example')
      }),
      runWithNewHostSession({ id: 'ct-host-b', diskless: true }, async () => {
        await barrierA.promise
        process.env.CLAUDE_CONFIG_DIR = configDirB
        resetMcpCcrIngressCapture({
          SESSION_INGRESS_URL: 'https://ingress-b.example',
        })
        expect(getCapturedCcrIngressBase()).toBe('https://ingress-b.example')
        expect(
          isMcpCcrProxyUrl('https://ingress-b.example/v2/ccr-sessions/abc'),
        ).toBe(true)
        expect(
          isMcpCcrProxyUrl('https://ingress-a.example/v2/ccr-sessions/abc'),
        ).toBe(false)

        expect(isRememberedLegacyStdio(stdioA)).toBe(false)
        recordRememberedLegacyStdio(stdioB)
        await flushRememberedLegacyStdioWritesForTest()
        expect(isRememberedLegacyStdio(stdioB)).toBe(true)
        clearRememberedLegacyStdio(stdioB)
        await flushRememberedLegacyStdioWritesForTest()
        expect(isRememberedLegacyStdio(stdioB)).toBe(false)

        barrierB.resolve()
      }),
    ])
  })

  test('elicitationHandler.ts, transportErrorState.ts, oauthPort.ts, and ccrInjectedMcp.ts are isolated per host', async () => {
    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()
    const releaseA = createDeferred<void>()

    let controllerA!: AbortController
    let controllerB!: AbortController

    await Promise.all([
      runWithNewHostSession({ id: 'misc-host-a', diskless: true }, async () => {
        // elicitationHandler
        recordMcpElicitationDeclinedForServer('shared-mcp', 5000)

        // transportErrorState
        beginMcpElicitation()
        expect(hasPendingMcpElicitation()).toBe(true)

        // oauthPort
        controllerA = claimOAuthRedirectPort(49321)
        setOAuthRedirectPortRelease(49321, releaseA.promise)

        // ccrInjectedMcp
        resetMcpCcrIngressCapture({
          SESSION_INGRESS_URL: 'https://ccr-a.example',
        })
        const pinned = maybePinHearthbotBareElicitation('hearthbot', {
          url: 'https://ccr-a.example/v2/ccr-sessions/s1/hearthbot/mcp',
        })
        expect(pinned).toBe(true)
        expect(isHearthbotBareElicitationPinned()).toBe(true)

        barrierA.resolve()
        await barrierB.promise

        // Verify Host B's operations did NOT disturb Host A
        expect(
          consumeMcpElicitationDeclinedDuringCall('shared-mcp', 4000),
        ).toBe(true)
        expect(hasPendingMcpElicitation()).toBe(true)
        endMcpElicitation()
        expect(hasPendingMcpElicitation()).toBe(false)

        expect(controllerA.signal.aborted).toBe(false)
        let releaseResolved = false
        const waitPromise = waitForOAuthRedirectPortRelease(49321).then(() => {
          releaseResolved = true
        })
        await Promise.resolve()
        expect(releaseResolved).toBe(false)
        releaseA.resolve()
        await waitPromise
        expect(releaseResolved).toBe(true)
        releaseOAuthRedirectPort(49321, controllerA)

        expect(isHearthbotBareElicitationPinned()).toBe(true)
      }),
      runWithNewHostSession({ id: 'misc-host-b', diskless: true }, async () => {
        await barrierA.promise

        // elicitationHandler: Host B does not see Host A's decline
        expect(
          consumeMcpElicitationDeclinedDuringCall('shared-mcp', 4000),
        ).toBe(false)
        clearMcpElicitationDeclinedState()

        // transportErrorState: Host B has 0 pending elicitations
        expect(hasPendingMcpElicitation()).toBe(false)
        _resetPendingMcpElicitationsForTests()

        // oauthPort: claiming same port in Host B does NOT abort Host A's controller
        controllerB = claimOAuthRedirectPort(49321)
        expect(controllerA.signal.aborted).toBe(false)
        // Host B does NOT block on Host A's port release promise
        await waitForOAuthRedirectPortRelease(49321)
        resetOAuthRedirectPortAborts()
        expect(controllerB.signal.aborted).toBe(true)
        expect(controllerA.signal.aborted).toBe(false)

        // ccrInjectedMcp: Host B is NOT pinned
        expect(isHearthbotBareElicitationPinned()).toBe(false)
        resetHearthbotBareElicitationPinForTests()

        barrierB.resolve()
      }),
    ])
  })

  test('clientHelpers.ts: reportedLongToolNames deduplicates per host without suppressing other hosts', async () => {
    const loggedServers: Array<{ server: string; sid: string | undefined }> = []
    spies.push(
      spyOn(logMod, 'logMCPError').mockImplementation((serverName: string) => {
        loggedServers.push({
          server: serverName,
          sid: getActiveSessionFromAls()?.id,
        })
      }),
    )

    const overlongTool = {
      name: `mcp__srv__${'a'.repeat(MAX_MCP_TOOL_NAME_LENGTH)}`,
      mcpInfo: { serverName: 'srv' },
    }
    const okTool = { name: 'mcp__srv__ok', mcpInfo: { serverName: 'srv' } }

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession({ id: 'long-host-a', diskless: true }, async () => {
        expect(filterMcpToolsByNameLength([overlongTool, okTool])).toEqual([
          okTool,
        ])
        // Second call in Host A is deduplicated
        expect(filterMcpToolsByNameLength([overlongTool])).toEqual([])
        expect(loggedServers.filter(l => l.sid === 'long-host-a')).toHaveLength(
          1,
        )

        barrierA.resolve()
        await barrierB.promise

        // Resetting Host A lets Host A log again while Host B stays deduplicated
        resetReportedLongToolNamesForTest()
        filterMcpToolsByNameLength([overlongTool])
        expect(loggedServers.filter(l => l.sid === 'long-host-a')).toHaveLength(
          2,
        )
      }),
      runWithNewHostSession({ id: 'long-host-b', diskless: true }, async () => {
        await barrierA.promise
        // Host B MUST still report the overlong tool once despite Host A having reported it
        expect(filterMcpToolsByNameLength([overlongTool, okTool])).toEqual([
          okTool,
        ])
        expect(filterMcpToolsByNameLength([overlongTool])).toEqual([])
        expect(loggedServers.filter(l => l.sid === 'long-host-b')).toHaveLength(
          1,
        )

        barrierB.resolve()
      }),
    ])
  })

  test('mcpV2Client.ts: mcpSdkGenerationLatch isolates v1 compat latch per host', async () => {
    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession({ id: 'v2-host-a', diskless: true }, async () => {
        expect(getMcpSdkGeneration({ MCP_SDK_GENERATION: 'v1' })).toBe('v2')
        expect(isMcpV1CompatMode({ MCP_SDK_GENERATION: 'v2' })).toBe(true)

        barrierA.resolve()
        await barrierB.promise

        // Still latched v1 in Host A
        expect(isMcpV1CompatMode({})).toBe(true)
        resetMcpSdkGenerationForTests()
        expect(isMcpV1CompatMode({ MCP_SDK_GENERATION: 'v2' })).toBe(false)
      }),
      runWithNewHostSession({ id: 'v2-host-b', diskless: true }, async () => {
        await barrierA.promise
        // Host B latches independently to v2 (not v1 compat)
        expect(isMcpV1CompatMode({ MCP_SDK_GENERATION: 'v2' })).toBe(false)
        expect(isMcpV1CompatMode({ MCP_SDK_GENERATION: 'v1' })).toBe(false)

        barrierB.resolve()
      }),
    ])
  })

  test('vscodeSdkMcp.ts: vscodeMcpClient and vscodeChannelErrorLogged are isolated per host', async () => {
    process.env.USER_TYPE = 'ant'
    const channelErrorsLogged: number[] = []
    spies.push(
      spyOn(analyticsMod, 'logEvent').mockImplementation(((
        eventName: string,
      ) => {
        if (eventName === 'vscode_notification_channel_error') {
          channelErrorsLogged.push(1)
        }
      }) as typeof analyticsMod.logEvent),
    )

    function makeMockVscodeClient(): {
      conn: ConnectedMCPServer
      notifications: Array<{ method: string; params?: Record<string, unknown> }>
      sdkClient: {
        setNotificationHandler: () => void
        notification: (req: {
          method: string
          params?: Record<string, unknown>
        }) => Promise<void>
        onerror?: (err: Error) => void
      }
    } {
      const notifications: Array<{
        method: string
        params?: Record<string, unknown>
      }> = []
      const sdkClient = {
        setNotificationHandler: () => {},
        notification: async (req: {
          method: string
          params?: Record<string, unknown>
        }) => {
          notifications.push(req)
        },
        onerror: undefined as ((err: Error) => void) | undefined,
      }
      const conn: ConnectedMCPServer = {
        type: 'connected',
        name: 'claude-vscode',
        capabilities: {},
        client: sdkClient as unknown as Client,
        config: { type: 'sdk', name: 'claude-vscode', scope: 'dynamic' },
        cleanup: async () => {},
      }
      return { conn, notifications, sdkClient }
    }

    const mockA = makeMockVscodeClient()
    const mockB = makeMockVscodeClient()

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'vscode-host-a', diskless: true },
        async () => {
          setupVscodeSdkMcp([mockA.conn])
          notifyVscodeFileUpdated('/path/a.ts', 'old-a', 'new-a')
          expect(
            mockA.notifications.filter(n => n.method === 'file_updated'),
          ).toHaveLength(1)

          // First channel error logs once; second is suppressed for Host A
          mockA.sdkClient.onerror?.(new Error('chan-a-1'))
          mockA.sdkClient.onerror?.(new Error('chan-a-2'))
          expect(channelErrorsLogged).toHaveLength(1)

          barrierA.resolve()
          await barrierB.promise

          // Host A still notifies mockA (never mockB)
          notifyVscodeFileUpdated('/path/a2.ts', null, 'new-a2')
          expect(
            mockA.notifications
              .filter(n => n.method === 'file_updated')
              .map(n => n.params?.filePath),
          ).toEqual(['/path/a.ts', '/path/a2.ts'])
          expect(
            mockB.notifications
              .filter(n => n.method === 'file_updated')
              .map(n => n.params?.filePath),
          ).toEqual(['/path/b.ts'])

          resetVscodeSdkMcpForTests()
        },
      ),
      runWithNewHostSession(
        { id: 'vscode-host-b', diskless: true },
        async () => {
          await barrierA.promise
          setupVscodeSdkMcp([mockB.conn])
          notifyVscodeFileUpdated('/path/b.ts', 'old-b', 'new-b')
          expect(
            mockB.notifications
              .filter(n => n.method === 'file_updated')
              .map(n => n.params?.filePath),
          ).toEqual(['/path/b.ts'])

          // Host B's first channel error MUST log independently of Host A's flag!
          mockB.sdkClient.onerror?.(new Error('chan-b-1'))
          mockB.sdkClient.onerror?.(new Error('chan-b-2'))
          expect(channelErrorsLogged).toHaveLength(2)

          barrierB.resolve()
        },
      ),
    ])
  })

  test('claudeai.ts: fetchClaudeAIMcpConfigsIfEligible.cache is instanceof Map, chains .set() on proxy, and isolates entries across hosts', async () => {
    expect(fetchClaudeAIMcpConfigsIfEligible.cache instanceof Map).toBe(true)

    const barrierA = createDeferred<void>()
    const barrierB = createDeferred<void>()

    await Promise.all([
      runWithNewHostSession(
        { id: 'claudeai-host-a', diskless: true },
        async () => {
          expect(fetchClaudeAIMcpConfigsIfEligible.cache instanceof Map).toBe(
            true,
          )
          const pA = Promise.resolve({})
          const ret = fetchClaudeAIMcpConfigsIfEligible.cache.set('key-a', pA)
          expect(ret).toBe(fetchClaudeAIMcpConfigsIfEligible.cache)
          expect(fetchClaudeAIMcpConfigsIfEligible.cache.has('key-a')).toBe(
            true,
          )

          barrierA.resolve()
          await barrierB.promise

          expect(fetchClaudeAIMcpConfigsIfEligible.cache.has('key-a')).toBe(
            true,
          )
          expect(fetchClaudeAIMcpConfigsIfEligible.cache.has('key-b')).toBe(
            false,
          )
        },
      ),
      runWithNewHostSession(
        { id: 'claudeai-host-b', diskless: true },
        async () => {
          await barrierA.promise
          expect(fetchClaudeAIMcpConfigsIfEligible.cache instanceof Map).toBe(
            true,
          )
          expect(fetchClaudeAIMcpConfigsIfEligible.cache.has('key-a')).toBe(
            false,
          )
          fetchClaudeAIMcpConfigsIfEligible.cache.set(
            'key-b',
            Promise.resolve({}),
          )
          expect(fetchClaudeAIMcpConfigsIfEligible.cache.has('key-b')).toBe(
            true,
          )
          barrierB.resolve()
        },
      ),
    ])
  })
})
