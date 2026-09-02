/**
 * densable qpe residuals (239): daemon detach-only; alreadyOpened kEo.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  clearBridgeSessionMetaAfterQpeHandoff,
  isLeftArrowDaemonDetachOnly,
} from '../leftArrowAgents.js'
import {
  getPersistedBridgeSession,
  resetBridgeSessionMetaForTests,
  saveBridgeSessionMeta,
} from '../../../bridge/bridgeSessionMeta.js'
import { getSessionId } from '../../../bootstrap/state.js'

afterEach(() => {
  resetBridgeSessionMetaForTests()
})

describe('qpe daemon detach + alreadyOpened kEo (239)', () => {
  test('isLeftArrowDaemonDetachOnly: only daemon skips vHy', () => {
    expect(isLeftArrowDaemonDetachOnly('daemon')).toBe(true)
    expect(isLeftArrowDaemonDetachOnly(undefined)).toBe(false)
    expect(isLeftArrowDaemonDetachOnly('')).toBe(false)
    expect(isLeftArrowDaemonDetachOnly('local')).toBe(false)
    const prev = process.env.CLAUDE_BG_BACKEND
    process.env.CLAUDE_BG_BACKEND = 'daemon'
    try {
      expect(isLeftArrowDaemonDetachOnly()).toBe(true)
    } finally {
      if (prev === undefined) delete process.env.CLAUDE_BG_BACKEND
      else process.env.CLAUDE_BG_BACKEND = prev
    }
  })

  test('alreadyOpened re-clears wXr after cleanup rewrite', () => {
    resetBridgeSessionMetaForTests()
    const sessionId = getSessionId()
    expect(sessionId).toBeTruthy()
    saveBridgeSessionMeta('cse_qpe_keo', 3, {
      sessionId,
      groupingId: 'g',
    })
    expect(getPersistedBridgeSession()?.id).toBe('cse_qpe_keo')

    // no alreadyOpened → leave wXr (fallback vHy still owns kEo)
    clearBridgeSessionMetaAfterQpeHandoff(undefined)
    expect(getPersistedBridgeSession()?.id).toBe('cse_qpe_keo')
    clearBridgeSessionMetaAfterQpeHandoff(null)
    expect(getPersistedBridgeSession()?.id).toBe('cse_qpe_keo')

    // qpe already ran vHy; unmount cleanup rewrote; re-clear
    clearBridgeSessionMetaAfterQpeHandoff({
      ok: true,
      short: 'abc',
      sessionId: 'sid',
    })
    expect(getPersistedBridgeSession()).toBeUndefined()

    saveBridgeSessionMeta('cse_qpe_keo2', 4, { sessionId })
    expect(getPersistedBridgeSession()?.id).toBe('cse_qpe_keo2')
    clearBridgeSessionMetaAfterQpeHandoff({
      ok: true,
      short: 'abc',
      sessionId: 'sid',
    })
    expect(getPersistedBridgeSession()).toBeUndefined()
  })
})
