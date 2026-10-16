/**
 * densable 2.1.289 `il` / `mn` / `psr` read order for design OAuth.
 * Does not mock `src/utils/auth.js` — that mock is process-global and
 * designProjectGrant.289.test.ts / designAccessToken.289.test.ts own it.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  getGatewayTokenFromDescriptor,
  getOauthTokenFromFd,
  isOauthTokenFromBgSnapshot,
  resetFdCredentialState,
  setGatewayTokenFromDescriptor,
  setOauthScopesFromFd,
  setOauthTokenFromBgSnapshot,
  setOauthTokenFromFd,
} from '../../../bootstrap/state.js'
import { CCR_OAUTH_TOKEN_PATH } from '../../../utils/authFileDescriptor.js'
import {
  clearOAuthTokenCache,
  getClaudeAIOAuthTokensAsync,
} from '../../../utils/auth.js'
import {
  pinHoverRest,
  resetHoverRestPinForTests,
} from '../../../utils/storageV5/hoverRestPin.js'
import { readClaudeAiOauthFromCredentials } from '../designOauth.js'

const ENV_KEYS = [
  'CLAUDE_CODE_OAUTH_TOKEN',
  'CLAUDE_BG_AUTH_SNAPSHOT_PATH',
  'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR',
  'CLAUDE_CODE_SUBSCRIPTION_TYPE',
  'CLAUDE_CODE_RATE_LIMIT_TIER',
  'CLAUDE_CODE_OAUTH_SCOPES',
  'CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST',
] as const

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map(key => [key, process.env[key]]),
)

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function resetOauthReadState(): void {
  restoreEnv()
  resetHoverRestPinForTests()
  pinHoverRest(true)
  clearOAuthTokenCache()
  resetFdCredentialState()
  // resetFdCredentialState does not clear the gateway descriptor slot.
  setGatewayTokenFromDescriptor(undefined)
}

beforeEach(() => {
  resetOauthReadState()
})

afterEach(() => {
  restoreEnv()
  resetHoverRestPinForTests()
  clearOAuthTokenCache()
  resetFdCredentialState()
})

describe('readClaudeAiOauthFromCredentials jfe / psr', () => {
  test('second read returns the cached token until clear', async () => {
    let storageReads = 0
    const credentials = {
      readAsync: async () => {
        storageReads += 1
        return {
          claudeAiOauth: {
            accessToken: 'stored-token',
            refreshToken: 'stored-refresh',
            expiresAt: 1,
            scopes: ['user:inference'],
          },
        }
      },
    }

    const first = await readClaudeAiOauthFromCredentials(credentials)
    const second = await readClaudeAiOauthFromCredentials(credentials)
    expect(first?.accessToken).toBe('stored-token')
    expect(second?.accessToken).toBe('stored-token')
    expect(storageReads).toBe(1)

    clearOAuthTokenCache()
    const third = await readClaudeAiOauthFromCredentials(credentials)
    expect(third?.accessToken).toBe('stored-token')
    expect(storageReads).toBe(2)
  })

  test('non-snapshot FD handoff wins and is not read again', async () => {
    let storageReads = 0
    let handoffReads = 0
    const credentials = {
      readHandoffCredential: async (path: string) => {
        handoffReads += 1
        expect(path).toBe(CCR_OAUTH_TOKEN_PATH)
        return { state: 'present', contents: 'fd-token\n' }
      },
      readAsync: async () => {
        storageReads += 1
        return {
          claudeAiOauth: {
            accessToken: 'stored-token',
            refreshToken: 'r',
            expiresAt: 1,
            scopes: ['user:inference'],
          },
        }
      },
    }

    const first = await readClaudeAiOauthFromCredentials(credentials)
    const second = await readClaudeAiOauthFromCredentials(credentials)
    expect(first?.accessToken).toBe('fd-token')
    expect(second?.accessToken).toBe('fd-token')
    expect(first?.refreshToken).toBeNull()
    expect(storageReads).toBe(0)
    expect(handoffReads).toBe(1)
  })

  test('bg snapshot token does not beat the credentials handle', async () => {
    const snapPath = '/tmp/claude-code-bg-auth-snapshot-289'
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snapPath
    let storageReads = 0
    const handoffs: Array<{ path: string; symlinkAtPath: string }> = []
    const credentials = {
      readHandoffCredential: async (
        path: string,
        opts: { symlinkAtPath: string },
      ) => {
        handoffs.push({ path, symlinkAtPath: opts.symlinkAtPath })
        if (path === snapPath) {
          return {
            state: 'present',
            contents: JSON.stringify({
              accessToken: 'snap-token',
              scopes: ['user:inference'],
            }),
          }
        }
        return { state: 'absent' }
      },
      readAsync: async () => {
        storageReads += 1
        return {
          claudeAiOauth: {
            accessToken: 'stored-token',
            refreshToken: 'stored-refresh',
            expiresAt: 1,
            scopes: ['user:design:read'],
          },
        }
      },
    }

    const read = await readClaudeAiOauthFromCredentials(credentials)
    expect(read?.accessToken).toBe('stored-token')
    expect(storageReads).toBe(1)
    expect(handoffs).toEqual([{ path: snapPath, symlinkAtPath: 'refuse' }])
    expect(process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH).toBeUndefined()
  })

  test('FD token scopes follow Lso() ?? ck(_K)', async () => {
    // designAccessToken mocks the getClaudeAIOAuthTokens export. The async
    // reader is the real yK path and still returns those scopes.
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    delete process.env.CLAUDE_CODE_OAUTH_SCOPES
    setOauthTokenFromFd('tok')
    setOauthTokenFromBgSnapshot(false)
    clearOAuthTokenCache()

    expect((await getClaudeAIOAuthTokensAsync())?.scopes).toEqual([
      'user:inference',
      'user:ccr_inference',
      'user:file_upload',
    ])

    process.env.CLAUDE_CODE_OAUTH_SCOPES = 'user:inference user:profile'
    clearOAuthTokenCache()
    expect((await getClaudeAIOAuthTokensAsync())?.scopes).toEqual([
      'user:inference',
      'user:profile',
    ])

    setOauthScopesFromFd(['user:sessions:claude_code'])
    clearOAuthTokenCache()
    expect((await getClaudeAIOAuthTokensAsync())?.scopes).toEqual([
      'user:sessions:claude_code',
    ])

    setOauthScopesFromFd([])
    clearOAuthTokenCache()
    expect((await getClaudeAIOAuthTokensAsync())?.scopes).toEqual([])

    delete process.env.CLAUDE_CODE_OAUTH_SCOPES
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'env-tok'
    clearOAuthTokenCache()
    const envToken = await getClaudeAIOAuthTokensAsync()
    expect(envToken?.accessToken).toBe('env-tok')
    expect(envToken?.scopes).toEqual(['user:inference'])
  })

  test('gateway snapshot sets descriptor token, not oauth FD', async () => {
    const snapPath = '/tmp/claude-code-bg-auth-snapshot-gw-289'
    delete process.env.CLAUDE_CODE_OAUTH_TOKEN
    process.env.CLAUDE_BG_AUTH_SNAPSHOT_PATH = snapPath
    clearOAuthTokenCache()
    let sawOauthHandoff = false
    const credentials = {
      readHandoffCredential: async (path: string) => {
        if (path === snapPath) {
          return {
            state: 'present',
            contents: JSON.stringify({ gatewayToken: 'gw-1' }),
          }
        }
        sawOauthHandoff = true
        expect(getGatewayTokenFromDescriptor()).toBe('gw-1')
        expect(getOauthTokenFromFd()).toBeUndefined()
        expect(isOauthTokenFromBgSnapshot()).toBe(false)
        return { state: 'absent' }
      },
      readAsync: async () => ({}),
    }

    try {
      const tokens = await getClaudeAIOAuthTokensAsync(credentials)
      expect(sawOauthHandoff).toBe(true)
      expect(getGatewayTokenFromDescriptor()).toBe('gw-1')
      expect(tokens).toBeNull()
    } finally {
      setGatewayTokenFromDescriptor(undefined)
      resetFdCredentialState()
    }
  })
})
