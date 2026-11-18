import { describe, expect, test } from 'bun:test'
import {
  disableForkSubagent,
  getSessionBackgroundGates,
  isForkSubagentDisabled,
  resetSessionBackgroundGatesForTests,
} from '../../../utils/sessionBackgroundGates.js'
import {
  McpCredentialStoreUnavailableError,
  SECURE_STORAGE_READ_FAILED,
} from '../../../utils/secureStorage/index.js'
import { createFallbackStorage } from '../../../utils/secureStorage/fallbackStorage.js'
import type { SecureStorage } from '../../../utils/secureStorage/types.js'
import { shouldApplyMcpClientUpdate } from '../client.js'

describe('Wave 2 MCP/Session/SecureStorage alignment', () => {
  test('#924 SessionBackgroundGates tracks forkSubagentDisabled and resets cleanly', () => {
    resetSessionBackgroundGatesForTests()
    expect(isForkSubagentDisabled()).toBe(false)
    disableForkSubagent()
    expect(isForkSubagentDisabled()).toBe(true)
    expect(getSessionBackgroundGates().forkSubagentDisabled).toBe(true)
    resetSessionBackgroundGatesForTests()
    expect(isForkSubagentDisabled()).toBe(false)
  })

  test('#1121 shouldApplyMcpClientUpdate blocks cached updates over connected, un-held disabled, and needs-auth', () => {
    const baseCfg = {
      type: 'stdio' as const,
      command: 'echo',
      args: [],
      scope: 'user' as const,
    }
    const cachedIncoming = { name: 'srv', type: 'cached' }

    expect(
      shouldApplyMcpClientUpdate(
        { name: 'srv', type: 'disabled', config: baseCfg },
        cachedIncoming,
      ),
    ).toBe(false)
    expect(
      shouldApplyMcpClientUpdate(
        { name: 'srv', type: 'needs-auth', config: baseCfg },
        cachedIncoming,
      ),
    ).toBe(false)
    expect(
      shouldApplyMcpClientUpdate(
        { name: 'srv', type: 'failed', config: baseCfg },
        cachedIncoming,
      ),
    ).toBe(true)
    expect(shouldApplyMcpClientUpdate(undefined, cachedIncoming)).toBe(true)
    expect(
      shouldApplyMcpClientUpdate(
        { name: 'srv', type: 'disabled', config: baseCfg },
        { name: 'srv', type: 'pending', config: baseCfg },
      ),
    ).toBe(true)
  })

  test('#1078 McpCredentialStoreUnavailableError sets CREDENTIAL_STORE_UNAVAILABLE and phase messages', () => {
    const beforeErr = new McpCredentialStoreUnavailableError(
      'github',
      'before_request',
    )
    expect(beforeErr.name).toBe('McpCredentialStoreUnavailableError')
    expect(beforeErr.code).toBe('CREDENTIAL_STORE_UNAVAILABLE')
    expect(beforeErr.shortMessage).toBe(
      'MCP credential store could not be read',
    )
    expect(beforeErr.message).toContain('github')

    const afterErr = new McpCredentialStoreUnavailableError(
      'github',
      'after_request',
    )
    expect(afterErr.code).toBe('CREDENTIAL_STORE_UNAVAILABLE')
    expect(afterErr.shortMessage).toBe(
      'MCP credentials were read only after a request went out without them',
    )
  })

  test('#1078 createFallbackStorage.readAsyncStrict propagates SECURE_STORAGE_READ_FAILED and respects inaccessibleAs', async () => {
    const primaryLocked: SecureStorage = {
      name: 'primary',
      read: () => null,
      readAsync: async () => null,
      readAsyncStrict: async () => SECURE_STORAGE_READ_FAILED,
      update: () => ({ success: false }),
      delete: () => true,
    }
    const secondary: SecureStorage = {
      name: 'secondary',
      read: () => ({ token: 'plain' }),
      readAsync: async () => ({ token: 'plain' }),
      update: () => ({ success: true }),
      delete: () => true,
    }

    const fb = createFallbackStorage(primaryLocked, secondary)
    expect(
      await fb.readAsyncStrict?.(undefined, { inaccessibleAs: 'failure' }),
    ).toBe(SECURE_STORAGE_READ_FAILED)

    const primaryNull: SecureStorage = {
      ...primaryLocked,
      readAsyncStrict: async () => null,
    }
    const fbNull = createFallbackStorage(primaryNull, secondary)
    expect(
      await fbNull.readAsyncStrict?.(undefined, { inaccessibleAs: 'failure' }),
    ).toBeNull()
    expect(await fbNull.readAsyncStrict?.()).toEqual({ token: 'plain' })
  })
})
