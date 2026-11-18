import { describe, expect, test } from 'bun:test'
import {
  matchTabUrl,
  resolveTabUrlWithRetry,
  TAB_LOOKUP_CAP_MS,
  TAB_LOOKUP_RETRY_DELAY_MS,
} from '../chromeCallPermission.js'
import {
  getChromeInstallSessionState,
  resetChromeInstallSessionState,
} from '../sessionState.js'

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
})
