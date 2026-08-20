/**
 * densable 2.1.235 #2 — LSP hasEverConnected latch (GUr) + lpT short-circuit.
 *
 * Avoid mock.module on manager.js (process-global pollution). Use test-only
 * setters to simulate connected/disconnected server maps.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { LSPServerInstance } from '../LSPServerInstance.js'
import type { LSPServerManager } from '../LSPServerManager.js'
import {
  hasEverConnected,
  isLspConnected,
  resetLspManagerForTests,
  setLspManagerForTests,
  shouldDeferLspTool,
} from '../manager.js'

function fakeServer(state: LSPServerInstance['state']): LSPServerInstance {
  return {
    name: 'test',
    config: {
      command: ['true'],
      extensionToLanguage: { '.ts': 'typescript' },
      scope: 'dynamic',
      source: 'test',
    } as unknown as LSPServerInstance['config'],
    state,
    startTime: undefined,
    lastError: undefined,
    restartCount: 0,
    start: async () => {},
    stop: async () => {},
    restart: async () => {},
    isHealthy: () => state === 'running',
    sendRequest: async () => undefined as never,
    sendNotification: async () => {},
    onNotification: () => {},
    onRequest: () => {},
  }
}

function fakeManager(
  servers: Map<string, LSPServerInstance>,
): LSPServerManager {
  return {
    initialize: async () => {},
    shutdown: async () => {},
    getServerForFile: () => undefined,
    ensureServerStarted: async () => undefined,
    sendRequest: async () => undefined,
    getAllServers: () => servers,
    openFile: async () => {},
    changeFile: async () => {},
    saveFile: async () => {},
    closeFile: async () => {},
    isFileOpen: () => false,
    closeAllFiles: async () => {},
  }
}

beforeEach(() => {
  resetLspManagerForTests()
})

afterEach(() => {
  resetLspManagerForTests()
})

describe('densable 2.1.235 #2 hasEverConnected latch (GUr)', () => {
  test('initially false when no manager / not connected', () => {
    expect(hasEverConnected()).toBe(false)
    expect(isLspConnected()).toBe(false)
  })

  test('latches true after a non-error server is seen connected', () => {
    const servers = new Map([['ts', fakeServer('running')]])
    setLspManagerForTests({ manager: fakeManager(servers), status: 'success' })
    expect(isLspConnected()).toBe(true)
    expect(hasEverConnected()).toBe(true)
  })

  test('stays true after disconnect / all-error / manager cleared', () => {
    const servers = new Map([['ts', fakeServer('running')]])
    setLspManagerForTests({ manager: fakeManager(servers), status: 'success' })
    expect(hasEverConnected()).toBe(true)

    // Disconnect: all servers error
    servers.set('ts', fakeServer('error'))
    expect(isLspConnected()).toBe(false)
    expect(hasEverConnected()).toBe(true)

    // Reinitialize-like clear of live manager
    setLspManagerForTests({ manager: undefined, status: 'pending' })
    expect(isLspConnected()).toBe(false)
    expect(hasEverConnected()).toBe(true)
  })

  test('lpT/shouldDeferLspTool: false once latched even if pending', () => {
    const lspTool = { isLsp: true as const, name: 'LSP' }
    setLspManagerForTests({ status: 'pending', manager: undefined })
    expect(shouldDeferLspTool(lspTool)).toBe(true)

    const servers = new Map([['ts', fakeServer('running')]])
    setLspManagerForTests({ manager: fakeManager(servers), status: 'success' })
    expect(hasEverConnected()).toBe(true)

    // Mid-session reinit pending must NOT re-defer once latched
    setLspManagerForTests({ manager: undefined, status: 'pending' })
    expect(shouldDeferLspTool(lspTool)).toBe(false)
    // Non-LSP tools are never deferred by this gate
    expect(shouldDeferLspTool({})).toBe(false)
    expect(shouldDeferLspTool({ isLsp: false })).toBe(false)
  })
})
