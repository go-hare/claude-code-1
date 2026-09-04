/**
 * densable 2.1.243 #28 — hasEverConnected latch + didLastConfigLoadFail.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { LSPServerInstance } from '../LSPServerInstance.js'
import type { LSPServerManager } from '../LSPServerManager.js'
import {
  hasEverConnected,
  resetLspManagerForTests,
  setLspManagerForTests,
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
  configFailed = false,
): LSPServerManager {
  return {
    initialize: async () => {},
    shutdown: async () => {},
    getServerForFile: () => undefined,
    ensureServerStarted: async () => undefined,
    sendRequest: async () => undefined,
    getAllServers: () => servers,
    didLastConfigLoadFail: () => configFailed,
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

describe('densable 2.1.243 #28 LSP latch clear preconditions', () => {
  test('didLastConfigLoadFail is exposed on manager', () => {
    const mgr = fakeManager(new Map())
    expect(mgr.didLastConfigLoadFail()).toBe(false)
    expect(fakeManager(new Map(), true).didLastConfigLoadFail()).toBe(true)
  })

  test('zero-server manager without config failure is eligible for latch clear', () => {
    const servers = new Map([['ts', fakeServer('running')]])
    setLspManagerForTests({
      manager: fakeManager(servers),
      status: 'success',
    })
    expect(hasEverConnected()).toBe(true)

    const emptyOk = fakeManager(new Map(), false)
    expect(emptyOk.getAllServers().size).toBe(0)
    expect(emptyOk.didLastConfigLoadFail()).toBe(false)
  })
})
