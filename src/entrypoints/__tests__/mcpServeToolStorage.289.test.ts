/**
 * densable 2.1.289 Ee — mcp serve tool context storageV5 / credentials.
 * Caller passes s = "raw". credentials is Nx(s) via credentialsStoreFor.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  CREDENTIALS_STORE_HANDLE,
  recordHoverRestDecision,
  resetHoverRestPinForTests,
} from '../../utils/storageV5/index.js'
import { mcpServeToolStorage } from '../mcp.js'

afterEach(() => {
  resetHoverRestPinForTests()
})

describe('mcp serve tool storage (densable 2.1.289 Ee)', () => {
  test('hover-rest off leaves credentials undefined; on yields a handle', () => {
    resetHoverRestPinForTests()
    const off = mcpServeToolStorage('raw')
    expect(off.storageV5).toBe('raw')
    expect(off.credentials).toBeUndefined()

    resetHoverRestPinForTests()
    recordHoverRestDecision(true)
    const on = mcpServeToolStorage('raw')
    expect(on.storageV5).toBe('raw')
    expect(on.credentials?.[CREDENTIALS_STORE_HANDLE]).toBe(
      'CredentialsStoreHandle',
    )
  })

  test('mcp serve passes literal raw and tools/call stores the pair once', () => {
    const mcp = readFileSync(join(import.meta.dir, '../mcp.ts'), 'utf8')
    const handler = readFileSync(
      join(import.meta.dir, '../../cli/handlers/mcp.tsx'),
      'utf8',
    )
    expect(handler).toContain(
      "startMCPServer(providedCwd, debug ?? false, verbose ?? false, 'raw')",
    )
    expect(mcp).toContain('const persist = mcpServeToolStorage(storageV5)')
    expect(mcp).toContain('storageV5: persist.storageV5')
    expect(mcp).toContain('credentials: persist.credentials')
    expect(mcp).toContain('credentials: credentialsStoreFor(storageV5)')
  })
})
