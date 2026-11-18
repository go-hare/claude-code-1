import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { McpCredentialStoreUnavailableError } from '../connectionHelpers.js'
import {
  McpCredentialStoreUnavailableError as SecureStorageMcpCredentialStoreUnavailableError,
  SECURE_STORAGE_READ_FAILED,
  type SecureStorage,
} from '../../../utils/secureStorage/types.js'

let mockStorage: SecureStorage

mock.module('../../../utils/secureStorage/index.js', () => ({
  getSecureStorage: () => mockStorage,
  SECURE_STORAGE_READ_FAILED,
  McpCredentialStoreUnavailableError:
    SecureStorageMcpCredentialStoreUnavailableError,
}))

const {
  ClaudeAuthProvider,
  getServerKey,
  resetCredentialStoreStrictProbeState,
} = await import('../auth.js')

describe('Wave 3 #1078 mcp/auth.ts readAsyncStrict & McpCredentialStoreUnavailableError', () => {
  beforeEach(() => {
    resetCredentialStoreStrictProbeState()
  })

  afterEach(() => {
    resetCredentialStoreStrictProbeState()
  })

  test('throws McpCredentialStoreUnavailableError when readAsync is empty and readAsyncStrict returns SECURE_STORAGE_READ_FAILED after populated read', async () => {
    const serverConfig = {
      type: 'http' as const,
      url: 'https://mcp.example.com',
    }
    const serverKey = getServerKey('srv', serverConfig)
    // First populate seenPopulated = true
    mockStorage = {
      name: 'mock',
      read: () => ({ mcpOAuth: {} }),
      readAsync: async () => ({
        mcpOAuth: {
          [serverKey]: {
            serverName: 'srv',
            serverUrl: 'https://mcp.example.com',
            accessToken: 'tok',
            expiresAt: Date.now() + 3_600_000,
          },
        },
      }),
      readAsyncStrict: async () => ({ mcpOAuth: {} }),
      update: () => ({ success: true }),
      delete: () => true,
    }

    const provider = new ClaudeAuthProvider(
      'srv',
      serverConfig,
      undefined,
      true,
    )
    expect((await provider.tokens())?.access_token).toBe('tok')

    // Now keychain locks: readAsync returns null, readAsyncStrict returns SECURE_STORAGE_READ_FAILED
    mockStorage = {
      name: 'mock',
      read: () => null,
      readAsync: async () => null,
      readAsyncStrict: async () => SECURE_STORAGE_READ_FAILED,
      update: () => ({ success: true }),
      delete: () => true,
    }

    await expect(provider.tokens()).rejects.toBeInstanceOf(
      McpCredentialStoreUnavailableError,
    )
    await expect(provider.clientInformation()).rejects.toBeInstanceOf(
      McpCredentialStoreUnavailableError,
    )
  })

  test('returns undefined when store is genuinely empty (readAsyncStrict returns null)', async () => {
    mockStorage = {
      name: 'mock',
      read: () => null,
      readAsync: async () => null,
      readAsyncStrict: async () => null,
      update: () => ({ success: true }),
      delete: () => true,
    }

    const provider = new ClaudeAuthProvider(
      'srv',
      { type: 'http', url: 'https://mcp.example.com' },
      undefined,
      true,
    )
    expect(await provider.tokens()).toBeUndefined()
    expect(await provider.clientInformation()).toBeUndefined()
  })
})
