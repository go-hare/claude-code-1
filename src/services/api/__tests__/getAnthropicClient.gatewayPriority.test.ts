/**
 * Regression: getAnthropicClient must apply gateway env / secure-storage
 * BEFORE getAPIProvider() and cloud client branches.
 *
 * Cold start with:
 *   CLAUDE_CODE_USE_GATEWAY=1
 *   ANTHROPIC_BASE_URL=https://gw.example
 *   ANTHROPIC_AUTH_TOKEN=<jwt>
 *   CLAUDE_CODE_USE_BEDROCK=1
 * must build Anthropic (gateway) client, not BedrockClient.
 *
 * Do NOT mock @anthropic-ai/sdk or BedrockClient (process-global mock.module
 * breaks bedrockClient.test.ts and other SDK importers). Real BedrockClient
 * construction is safe with CLAUDE_CODE_SKIP_BEDROCK_AUTH=1.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import Anthropic from '@anthropic-ai/sdk'
import * as realSettings from '../../../utils/settings/settings.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'
import { BedrockClient } from '../bedrockClient.js'

// MACRO.VERSION is only injected in dev/build.
;(globalThis as unknown as { MACRO?: { VERSION: string } }).MACRO = {
  VERSION: '0.0.0-test',
}

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings)

// getAPIProvider reads settings.modelType first. Force empty settings while
// re-exporting the real module so other named exports stay intact (no pollution
// of updateSettingsForSource etc. beyond getInitialSettings return value).
const settingsMock = createSettingsMock(settingsSnap, {
  getInitialSettings: () => ({}),
  getSettingsForSource: () => ({}),
})
mock.module('src/utils/settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.ts', settingsMock)
mock.module('../../utils/settings/settings.js', settingsMock)
mock.module('../../../utils/settings/settings.js', settingsMock)
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
    'src/utils/settings/settings.ts',
    '../../utils/settings/settings.js',
    '../../../utils/settings/settings.js',
  ])
})

function makeJwt(expSecondsFromNow = 3600): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
  ).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + expSecondsFromNow }),
  ).toString('base64url')
  return `${header}.${payload}.sig`
}

const ENV_KEYS = [
  'CLAUDE_CODE_USE_GATEWAY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_SKIP_BEDROCK_AUTH',
  'AWS_REGION',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_API_KEY',
] as const

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {}

const { clearGatewayAuth, getGatewayAuth } = await import(
  '../../../utils/gatewayEnv.js'
)
const { getAPIProvider } = await import('../../../utils/model/providers.js')
const { getAnthropicClient } = await import('../client.js')

function clientKind(client: unknown): string {
  return (
    (client as { constructor?: { name?: string } })?.constructor?.name ?? ''
  )
}

describe('getAnthropicClient gateway priority', () => {
  beforeEach(() => {
    for (const k of ENV_KEYS) {
      savedEnv[k] = process.env[k]
      delete process.env[k]
    }
    // Ensure firstParty/auth path has a key when not on bedrock/gateway.
    process.env.ANTHROPIC_API_KEY = 'test-api-key'
    clearGatewayAuth()
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
    clearGatewayAuth()
  })

  test('cold start: USE_GATEWAY + BEDROCK env builds Anthropic gateway client', async () => {
    const jwt = makeJwt()
    process.env.CLAUDE_CODE_USE_GATEWAY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example'
    process.env.ANTHROPIC_AUTH_TOKEN = jwt
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    process.env.AWS_REGION = 'us-east-1'

    // Before client call, no in-memory session yet (cold start).
    expect(getGatewayAuth()).toBeNull()
    // getAPIProvider now applies gateway env itself so early callers (sideQuery,
    // bootstrap, status) also rank gateway above BEDROCK without waiting for
    // getAnthropicClient().
    expect(getAPIProvider()).toBe('gateway')
    expect(getGatewayAuth()?.url).toContain('gw.example')

    // Clear and re-set so client path still exercises apply-before-branch.
    clearGatewayAuth()
    expect(getGatewayAuth()).toBeNull()

    const client = await getAnthropicClient({ maxRetries: 0 })

    expect(clientKind(client)).toBe('Anthropic')
    expect(clientKind(client)).not.toBe('BedrockClient')
    expect(client).toBeInstanceOf(Anthropic)
    expect(client).not.toBeInstanceOf(BedrockClient)
    expect(getAPIProvider()).toBe('gateway')
    expect(getGatewayAuth()?.url).toContain('gw.example')
    expect(client.authToken).toBe(jwt)
    expect(String(client.baseURL)).toContain('gw.example')
  })

  test('existing in-memory gateway session still wins over BEDROCK env', async () => {
    const jwt = makeJwt()
    process.env.CLAUDE_CODE_USE_GATEWAY = '1'
    process.env.ANTHROPIC_BASE_URL = 'https://gw.example'
    process.env.ANTHROPIC_AUTH_TOKEN = jwt
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'

    // Warm session first
    await getAnthropicClient({ maxRetries: 0 })
    expect(getAPIProvider()).toBe('gateway')

    const client = await getAnthropicClient({ maxRetries: 0 })
    expect(clientKind(client)).toBe('Anthropic')
    expect(client).toBeInstanceOf(Anthropic)
    expect(client).not.toBeInstanceOf(BedrockClient)
  })

  test('bedrock-only still builds BedrockClient when gateway is off', async () => {
    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    process.env.AWS_REGION = 'us-east-1'

    const client = await getAnthropicClient({ maxRetries: 0 })
    expect(clientKind(client)).toBe('BedrockClient')
    expect(client).toBeInstanceOf(BedrockClient)
    expect(getAPIProvider()).toBe('bedrock')
  })

  test('expired refreshable session is IdP-refreshed before client build (official lXe)', async () => {
    const {
      resetGatewaySecureStorageRestoreCache_FOR_TESTS,
      setTestGatewayIdpPostToken_FOR_TESTS,
      setTestGatewaySecureStorageRead_FOR_TESTS,
    } = await import('../../../utils/gatewayEnv.js')

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'expired-jwt',
        expiresAtMs: Date.now() - 1,
        idpRefreshToken: 'refresh-token',
        tokenEndpoint: 'https://idp.example/token',
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }))
    setTestGatewayIdpPostToken_FOR_TESTS(async () => ({
      data: {
        access_token: 'fresh-from-idp',
        expires_in: 3600,
        refresh_token: 'refresh-token-2',
      },
    }))

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    process.env.AWS_REGION = 'us-east-1'

    try {
      // No USE_GATEWAY env — cold restore from secure-storage only.
      expect(getGatewayAuth()).toBeNull()
      const client = await getAnthropicClient({ maxRetries: 0 })
      expect(clientKind(client)).toBe('Anthropic')
      expect(client).toBeInstanceOf(Anthropic)
      expect(client).not.toBeInstanceOf(BedrockClient)
      expect(getAPIProvider()).toBe('gateway')
      expect(getGatewayAuth()?.jwt).toBe('fresh-from-idp')
      expect(client.authToken).toBe('fresh-from-idp')
      expect(String(client.baseURL)).toContain('gw.example')
    } finally {
      setTestGatewayIdpPostToken_FOR_TESTS(null)
      setTestGatewaySecureStorageRead_FOR_TESTS(null)
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    }
  })

  test('pure-expired in-memory session re-reads storage before Wzo (external re-login)', async () => {
    const {
      resetGatewaySecureStorageRestoreCache_FOR_TESTS,
      setGatewayAuth,
      setTestGatewaySecureStorageRead_FOR_TESTS,
    } = await import('../../../utils/gatewayEnv.js')

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    // Stale pure-expired identity already in memory (no idpRefreshToken).
    setGatewayAuth({
      url: 'https://gw.example',
      jwt: 'stale-expired-jwt',
      expiresAtMs: Date.now() - 1,
    })
    setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'external-relogin-jwt',
        expiresAtMs: Date.now() + 60_000,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }))

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    process.env.AWS_REGION = 'us-east-1'

    try {
      const client = await getAnthropicClient({ maxRetries: 0 })
      expect(clientKind(client)).toBe('Anthropic')
      expect(client).toBeInstanceOf(Anthropic)
      expect(getGatewayAuth()?.jwt).toBe('external-relogin-jwt')
      expect(client.authToken).toBe('external-relogin-jwt')
    } finally {
      setTestGatewaySecureStorageRead_FOR_TESTS(null)
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    }
  })

  test('expired+idp after IdP transient TTL re-reads storage on client path', async () => {
    const {
      GATEWAY_IDP_REFRESH_TRANSIENT_REREAD_TTL_MS,
      maybeRefreshGatewayIdp,
      resetGatewaySecureStorageRestoreCache_FOR_TESTS,
      setGatewayAuth,
      setTestGatewayIdpPostToken_FOR_TESTS,
      setTestGatewaySecureStorageRead_FOR_TESTS,
      tryRestoreGatewayAuthFromSecureStorage,
    } = await import('../../../utils/gatewayEnv.js')

    resetGatewaySecureStorageRestoreCache_FOR_TESTS()

    // Wall-clock-expired + idp so client isGatewayAuthExpired(Date.now) is true.
    // Keep real Date.now for tryRestore schedule (no fake clock) so client +
    // restore clocks agree.
    const deadSession = {
      url: 'https://gw.example',
      jwt: 'dead-refreshable-jwt',
      expiresAtMs: Date.now() - 1,
      idpRefreshToken: 'dead-refresh',
      tokenEndpoint: 'https://idp.example/token',
      unpinned: true as const,
    }

    setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
      enterpriseGateway: {
        url: deadSession.url,
        jwt: deadSession.jwt,
        expiresAtMs: deadSession.expiresAtMs,
        idpRefreshToken: deadSession.idpRefreshToken,
        tokenEndpoint: deadSession.tokenEndpoint,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }))
    // Warm permanent skip (secureStorageRestoreSucceeded).
    expect(tryRestoreGatewayAuthFromSecureStorage({ quiet: true }).status).toBe(
      'restored',
    )

    setGatewayAuth(deadSession)
    setTestGatewayIdpPostToken_FOR_TESTS(async () => {
      throw new Error('idp temporarily unavailable')
    })
    // Schedule reopen in the future (now + TTL).
    await maybeRefreshGatewayIdp()

    setTestGatewaySecureStorageRead_FOR_TESTS(() => ({
      enterpriseGateway: {
        url: 'https://gw.example',
        jwt: 'external-relogin-after-transient',
        expiresAtMs: Date.now() + 60_000,
      },
      gatewayTrust: { 'gw.example': 'pin' },
    }))

    process.env.CLAUDE_CODE_USE_BEDROCK = '1'
    process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH = '1'
    process.env.AWS_REGION = 'us-east-1'

    try {
      // Before TTL: tryRestore permanent-skips; IdP still fails; identity held.
      await expect(getAnthropicClient({ maxRetries: 0 })).rejects.toThrow(
        /gateway/i,
      )
      expect(getGatewayAuth()?.jwt).toBe('dead-refreshable-jwt')

      // Elapse schedule without waiting: note(now - TTL) → after = now.
      setGatewayAuth(deadSession)
      await maybeRefreshGatewayIdp({
        nowMs: Date.now() - GATEWAY_IDP_REFRESH_TRANSIENT_REREAD_TTL_MS,
      })
      const after = await getAnthropicClient({ maxRetries: 0 })
      expect(clientKind(after)).toBe('Anthropic')
      expect(after).toBeInstanceOf(Anthropic)
      expect(getGatewayAuth()?.jwt).toBe('external-relogin-after-transient')
      expect(after.authToken).toBe('external-relogin-after-transient')
    } finally {
      setTestGatewayIdpPostToken_FOR_TESTS(null)
      setTestGatewaySecureStorageRead_FOR_TESTS(null)
      resetGatewaySecureStorageRestoreCache_FOR_TESTS()
    }
  })
})
