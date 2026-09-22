/**
 * densable 2.1.248 #13 — kxt @193501380 sha=0c86012344382869
 * catch fallbackCures then startOAuthFlow / API-key path.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'
import * as realAuth from '../../utils/auth.js'
import * as realAuthFd from '../../utils/authFileDescriptor.js'
import * as realSettings from '../../utils/settings/settings.js'
import { TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../../utils/errors.js'

const GOLD_KEYLESS =
  'Keyless Console sign-in unavailable here, continuing with the API-key sign-in:'
const GOLD_RECOMMENDED =
  "The recommended sign-in isn't available on this machine"
const GOLD_PIN =
  'Settings on this machine pin the login method or organization, so signing in without an API key is not available here.'

const authSnap = snapshotModuleExports(realAuth)
const authFdSnap = snapshotModuleExports(realAuthFd)
const settingsSnap = snapshotModuleExports(realSettings)

const apiKeySourceMock = mock((): { key: string | null; source: string } => ({
  key: null,
  source: 'none',
}))

mock.module('../../utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSettings_DEPRECATED: () => ({}),
  getSettingsForSource: () => undefined,
}))
mock.module('../../utils/auth.js', () => ({
  ...authSnap,
  getConfiguredApiKeyHelper: () => undefined,
  getAnthropicApiKeyWithSource: () => apiKeySourceMock(),
}))
mock.module('../../utils/authFileDescriptor.js', () => ({
  ...authFdSnap,
  getOAuthTokenFromFileDescriptor: () => undefined,
}))

afterAll(() => {
  mock.module('../../utils/settings/settings.js', () => ({
    ...settingsSnap,
  }))
  mock.module('../../utils/auth.js', () => ({ ...authSnap }))
  mock.module('../../utils/authFileDescriptor.js', () => ({
    ...authFdSnap,
  }))
})

const {
  CONSOLE_PROFILE_LOGIN_FALLBACK_CURES,
  CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES,
  ConsoleProfileLoginError,
  KEYLESS_CONSOLE_FALLBACK_LOG,
  RECOMMENDED_SIGNIN_UNAVAILABLE,
  kxt,
  noteKeylessConsoleFallback,
  startConsoleProfileLoginPreflight,
  wrapConsoleProfileLoginRefusal,
} = await import('../../commands/login/getAuthStatus.js')

const ENV_KEYS = [
  'ANTHROPIC_PROFILE',
  'ANTHROPIC_FEDERATION_RULE_ID',
  'ANTHROPIC_ORGANIZATION_ID',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_CONFIG_DIR',
  'ANTHROPIC_UNIX_SOCKET',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_CODE_REMOTE',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_ANTHROPIC_AWS',
  'CLAUDE_CODE_USE_ANTHROPIC_GOOGLE_CLOUD',
  'CLAUDE_CODE_USE_MANTLE',
  'CLAUDE_CODE_USE_OPENAI',
  'CLAUDE_CODE_USE_GEMINI',
  'CLAUDE_CODE_USE_GROK',
  'CLAUDE_CODE_SIMPLE',
] as const

const savedEnv: Record<string, string | undefined> = {}
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key]
}

function clearShadowingEnv(): void {
  for (const key of ENV_KEYS) {
    delete process.env[key]
  }
}

afterEach(() => {
  apiKeySourceMock.mockClear()
  apiKeySourceMock.mockImplementation(() => ({
    key: null,
    source: 'none',
  }))
  for (const key of ENV_KEYS) {
    const prev = savedEnv[key]
    if (prev === undefined) delete process.env[key]
    else process.env[key] = prev
  }
})

function refuse(
  errorClass: string,
  message = 'profile refused',
): TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS {
  return new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
    message,
    'Console profile login refused',
    errorClass,
  )
}

function wrapCaught(
  error: unknown,
): InstanceType<typeof ConsoleProfileLoginError> {
  try {
    wrapConsoleProfileLoginRefusal(error)
  } catch (caught) {
    if (caught instanceof ConsoleProfileLoginError) return caught
    throw caught
  }
  throw new Error('expected wrapConsoleProfileLoginRefusal to throw')
}

async function preflightCaught(): Promise<unknown> {
  try {
    await startConsoleProfileLoginPreflight()
    return null
  } catch (caught) {
    return caught
  }
}

const flowSrc = readFileSync(
  join(import.meta.dir, '../ConsoleOAuthFlow.tsx'),
  'utf8',
)
const statusSrc = readFileSync(
  join(import.meta.dir, '../../commands/login/getAuthStatus.ts'),
  'utf8',
)

describe('densable 2.1.248 #13 keyless console fallback', () => {
  test('gold O/N maps and Keyless log', () => {
    expect(CONSOLE_PROFILE_LOGIN_FALLBACK_CURES).toEqual({
      no_config_dir: true,
      invalid_profile_name: true,
      foreign_profile: true,
      custom_credentials_path: true,
      api_key_env_nondispatching: true,
      wif_env_quad: false,
      third_party_provider: false,
      api_key_env: false,
      env_credential_shadow: false,
      other_deployment_profile: false,
      federation_profile: false,
      unreadable_profile: false,
    })
    expect(CONSOLE_PROFILE_LOGIN_FALLBACK_SUMMARIES).toEqual({
      no_config_dir: 'no Anthropic config directory was found',
      invalid_profile_name: "the configured profile name isn't valid",
      foreign_profile: 'the profile on this machine belongs to another tool',
      custom_credentials_path:
        'the existing profile keeps its sign-in somewhere custom',
      api_key_env_nondispatching:
        'ANTHROPIC_API_KEY is set in this environment',
    })
    expect(KEYLESS_CONSOLE_FALLBACK_LOG).toBe(GOLD_KEYLESS)
    expect(RECOMMENDED_SIGNIN_UNAVAILABLE).toBe(GOLD_RECOMMENDED)
  })

  test('wrap fallbackCures only when O is true and class is in N', () => {
    const cures = wrapCaught(refuse('api_key_env_nondispatching'))
    expect(cures.fallbackCures).toBe(true)
    expect(cures.causeSummary).toBe(
      'ANTHROPIC_API_KEY is set in this environment',
    )

    const helper = wrapCaught(refuse('env_credential_shadow'))
    expect(helper.fallbackCures).toBe(false)
    expect(helper.causeSummary).toBeNull()

    const dispatching = wrapCaught(refuse('api_key_env'))
    expect(dispatching.fallbackCures).toBe(false)
    expect(dispatching.causeSummary).toBeNull()

    expect(() => wrapConsoleProfileLoginRefusal(new Error('other'))).toThrow(
      'other',
    )
  })

  test('noteKeylessConsoleFallback formats the gold warn line', () => {
    const error = wrapCaught(
      refuse(
        'api_key_env_nondispatching',
        'ANTHROPIC_API_KEY is set in this environment. Unset it to sign in without an API key.',
      ),
    )
    const reason = noteKeylessConsoleFallback(error)
    expect(reason.message).toBe(
      'ANTHROPIC_API_KEY is set in this environment. Unset it to sign in without an API key.',
    )
    expect(reason.cause).toBe('ANTHROPIC_API_KEY is set in this environment')
    expect(`${KEYLESS_CONSOLE_FALLBACK_LOG} ${reason.message}`).toBe(
      `${GOLD_KEYLESS} ANTHROPIC_API_KEY is set in this environment. Unset it to sign in without an API key.`,
    )
  })

  test('kxt invalid profile wraps to fallbackCures', async () => {
    clearShadowingEnv()
    process.env.ANTHROPIC_CONFIG_DIR = mkdtempSync(
      join(tmpdir(), 'kxt-248-invalid-'),
    )
    process.env.ANTHROPIC_PROFILE = 'not a valid name'
    const caught = await preflightCaught()
    expect(caught).toBeInstanceOf(ConsoleProfileLoginError)
    if (!(caught instanceof ConsoleProfileLoginError)) {
      throw new Error('expected ConsoleProfileLoginError')
    }
    expect(caught.fallbackCures).toBe(true)
    expect(caught.causeSummary).toBe("the configured profile name isn't valid")
  })

  test('kxt dispatching ANTHROPIC_API_KEY does not fallbackCures', async () => {
    clearShadowingEnv()
    process.env.ANTHROPIC_CONFIG_DIR = mkdtempSync(
      join(tmpdir(), 'kxt-248-dispatch-'),
    )
    process.env.ANTHROPIC_PROFILE = 'default'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    apiKeySourceMock.mockImplementation(() => ({
      key: 'sk-ant-test-key',
      source: 'ANTHROPIC_API_KEY',
    }))
    const caught = await preflightCaught()
    expect(caught).toBeInstanceOf(ConsoleProfileLoginError)
    if (!(caught instanceof ConsoleProfileLoginError)) {
      throw new Error('expected ConsoleProfileLoginError')
    }
    expect(caught.fallbackCures).toBe(false)
    expect(caught.causeSummary).toBeNull()
  })

  test('kxt non-dispatching ANTHROPIC_API_KEY fallbackCures then API-key path', async () => {
    clearShadowingEnv()
    process.env.ANTHROPIC_CONFIG_DIR = mkdtempSync(
      join(tmpdir(), 'kxt-248-nondisp-'),
    )
    process.env.ANTHROPIC_PROFILE = 'default'
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key'
    apiKeySourceMock.mockImplementation(() => ({
      key: null,
      source: 'none',
    }))
    const caught = await preflightCaught()
    expect(caught).toBeInstanceOf(ConsoleProfileLoginError)
    if (
      !(caught instanceof ConsoleProfileLoginError) ||
      !caught.fallbackCures
    ) {
      throw caught instanceof Error
        ? caught
        : new Error('expected fallbackCures')
    }
    expect(caught.causeSummary).toBe(
      'ANTHROPIC_API_KEY is set in this environment',
    )
    const reason = noteKeylessConsoleFallback(caught)
    expect(`${GOLD_KEYLESS} ${reason.message}`).toBe(
      `${GOLD_KEYLESS} ANTHROPIC_API_KEY is set in this environment. Unset it to sign in without an API key.`,
    )
  })

  test('kxt succeeds when profile login is available', async () => {
    clearShadowingEnv()
    process.env.ANTHROPIC_CONFIG_DIR = mkdtempSync(
      join(tmpdir(), 'kxt-248-ok-'),
    )
    process.env.ANTHROPIC_PROFILE = 'default'
    const result = await kxt()
    expect(result.profile).toBe('default')
    expect(result.isNewProfile).toBe(true)
  })

  test('ConsoleOAuthFlow catch fallbackCures then startOAuthFlow', () => {
    expect(statusSrc).toContain(GOLD_KEYLESS)
    expect(statusSrc).toContain(GOLD_RECOMMENDED)
    expect(flowSrc).toContain('RECOMMENDED_SIGNIN_UNAVAILABLE')
    expect(flowSrc).toContain(GOLD_PIN)
    expect(flowSrc).toContain('startConsoleProfileLoginPreflight')
    expect(flowSrc).toContain(
      '!(err instanceof ConsoleProfileLoginError) || !err.fallbackCures',
    )
    expect(flowSrc).toContain('noteKeylessConsoleFallback')
    expect(flowSrc).toContain('await oauthService')
    expect(flowSrc).toContain('.startOAuthFlow(')
    expect(flowSrc).toContain(
      'skipApiKey: !loginWithClaudeAi && preferConsoleToken',
    )
    expect(flowSrc).toContain('&& !fellBackToApiKey')
    expect(flowSrc).toContain('so this sign-in will create an API key.')
    expect(statusSrc).toContain('async function kxt')
    expect(statusSrc).toContain('api_key_env_nondispatching')
    expect(statusSrc).toContain('env_credential_shadow')
  })
})
