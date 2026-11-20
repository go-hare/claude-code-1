import { describe, expect, test } from 'bun:test'
import { createBridgeClient } from '@ant/claude-for-chrome-mcp'
import {
  checkChromeToolPermissions,
  matchTabUrl,
  resolveTabUrlWithRetry,
  TAB_LOOKUP_CAP_MS,
  TAB_LOOKUP_RETRY_DELAY_MS,
} from '../chromeCallPermission.js'
import {
  getChromeInstallSessionState,
  resetChromeInstallSessionState,
} from '../sessionState.js'
import { getClaudeInChromeMCPToolOverrides } from '../toolRendering.js'

describe('2.1.293 #325 Chrome slow tab lookup retry', () => {
  test('constants match SEA 325 (5000ms cap, 2500ms retry delay)', () => {
    expect(TAB_LOOKUP_CAP_MS).toBe(5000)
    expect(TAB_LOOKUP_RETRY_DELAY_MS).toBe(2500)
  })

  test('matchTabUrl handles empty, missing, malformed, and valid tab lists', () => {
    expect(
      matchTabUrl({ ok: true, tabs: [], connectMs: 1, callMs: 2 }, 10),
    ).toEqual({
      ok: false,
      failure: 'empty_tab_list',
      connectMs: 1,
      callMs: 2,
    })
    expect(
      matchTabUrl(
        {
          ok: true,
          tabs: [{ tabId: 5, url: 'https://example.com' }],
          connectMs: 1,
          callMs: 2,
        },
        10,
      ),
    ).toEqual({
      ok: false,
      failure: 'tab_not_listed',
      connectMs: 1,
      callMs: 2,
    })
    expect(
      matchTabUrl(
        {
          ok: true,
          tabs: [{ tabId: 10, url: 'https://example.com' }],
          connectMs: 1,
          callMs: 2,
        },
        10,
      ),
    ).toEqual({
      ok: true,
      url: 'https://example.com',
      connectMs: 1,
      callMs: 2,
    })
  })

  test('resolveTabUrlWithRetry rescues a slow primary lookup via parallel retry', async () => {
    resetChromeInstallSessionState()
    const state = getChromeInstallSessionState()
    state.bridgeBinding = {
      socketClient: {
        isConnected: () => true,
        hasActiveSelection: () => true,
        callTool: async () => ({}),
      },
    }
    let calls = 0
    const res = await resolveTabUrlWithRetry(42, {
      capMs: 200,
      retryDelayMs: 15,
      query: async opts => {
        calls++
        if (calls === 1) {
          opts?.onSentToSelectedBrowser?.()
          await new Promise(r => setTimeout(r, 100))
          return {
            ok: false,
            failure: 'answer_timeout',
            connectMs: 1,
            callMs: 100,
          }
        }
        return {
          ok: true,
          tabs: [{ tabId: 42, url: 'https://claude.ai/chat' }],
          connectMs: 1,
          callMs: 5,
        }
      },
    })
    expect(calls).toBe(2)
    expect(res).toEqual({
      ok: true,
      url: 'https://claude.ai/chat',
      connectMs: 1,
      callMs: 5,
    })
    resetChromeInstallSessionState()
  })

  test('2.1.328: BridgeClient implements hasActiveSelection() and tool overrides wire checkPermissions via resolveTabUrlWithRetry', async () => {
    const noopLogger = {
      info: () => {},
      error: () => {},
      warn: () => {},
      debug: () => {},
      silly: () => {},
    }
    const client = createBridgeClient({
      serverName: 'claude-in-chrome',
      logger: noopLogger,
      socketPath: '',
      clientTypeId: 'claude-code',
      onToolCallDisconnected: () => 'disconnected',
      onAuthenticationError: () => {},
      bridgeConfig: {
        url: 'wss://bridge.example.test',
        getUserId: async () => 'user-1',
        getOAuthToken: async () => 'tok-1',
      },
    })
    expect(typeof client.hasActiveSelection).toBe('function')
    expect(client.hasActiveSelection?.()).toBe(false)
    client.selectExtensionById?.('dev-123', 'Chrome')
    expect(client.hasActiveSelection?.()).toBe(true)
    expect(client.getSelectedDeviceId?.()).toBe('dev-123')

    // Production tool overrides expose checkPermissions
    const overrides = getClaudeInChromeMCPToolOverrides('computer')
    expect(typeof overrides.checkPermissions).toBe('function')

    // checkChromeToolPermissions resolves tab URL via retry helper and stashes host/URL
    resetChromeInstallSessionState()
    let resolvedTabId: number | undefined
    const perm = await checkChromeToolPermissions(
      'computer',
      { tabId: 77, action: 'screenshot' },
      { toolUseId: 'tu-chrome-77' },
      {
        resolveTabUrl: async tabId => {
          resolvedTabId = tabId
          return {
            ok: true,
            url: 'https://docs.anthropic.com/en/docs',
            connectMs: 1,
            callMs: 3,
          }
        },
      },
    )
    expect(resolvedTabId).toBe(77)
    expect(perm.behavior).toBe('passthrough')
    const state = getChromeInstallSessionState()
    expect(state.resolvedHostByToolUseId.get('tu-chrome-77')?.host).toBe(
      'docs.anthropic.com',
    )
    expect(state.resolvedUrlByToolUseId.get('tu-chrome-77')).toBe(
      'https://docs.anthropic.com/en/docs',
    )

    // Non-web tab URL (chrome://) is denied
    const deniedNonWeb = await checkChromeToolPermissions(
      'computer',
      { tabId: 88 },
      { toolUseId: 'tu-chrome-88' },
      {
        resolveTabUrl: async () => ({
          ok: true,
          url: 'chrome://settings',
          connectMs: 1,
          callMs: 1,
        }),
      },
    )
    expect(deniedNonWeb.behavior).toBe('deny')

    // Unresolved tab URL is denied
    const deniedUnresolved = await checkChromeToolPermissions(
      'computer',
      { tabId: 99 },
      { toolUseId: 'tu-chrome-99' },
      {
        resolveTabUrl: async () => ({
          ok: false,
          failure: 'answer_timeout_after_retry',
          connectMs: 1,
          callMs: 5000,
        }),
      },
    )
    expect(deniedUnresolved.behavior).toBe('deny')
    resetChromeInstallSessionState()
  })
})
