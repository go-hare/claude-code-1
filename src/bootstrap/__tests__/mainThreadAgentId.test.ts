import { describe, expect, test } from 'bun:test'
import {
  getMainThreadAgentId,
  getSessionId,
  regenerateSessionId,
  resetStateForTests,
  switchSession,
} from '../state.js'
import type { SessionId } from 'src/types/ids.js'

describe('getMainThreadAgentId sticky latch', () => {
  test('first call latches to current session id', () => {
    resetStateForTests()
    const sessionId = getSessionId()
    const mainThreadAgentId = getMainThreadAgentId()
    expect(mainThreadAgentId).toBe(
      sessionId as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
    expect(getMainThreadAgentId()).toBe(mainThreadAgentId)
  })

  test('does not rebind after regenerateSessionId (/clear)', () => {
    resetStateForTests()
    const latchedMainThreadAgentId = getMainThreadAgentId()
    const sessionIdBefore = getSessionId()
    expect(latchedMainThreadAgentId).toBe(
      sessionIdBefore as unknown as ReturnType<typeof getMainThreadAgentId>,
    )

    const sessionIdAfter = regenerateSessionId()
    expect(sessionIdAfter).not.toBe(sessionIdBefore)
    // densable Ot.mainAgentId sticky — never cleared on mJo
    expect(getMainThreadAgentId()).toBe(latchedMainThreadAgentId)
    expect(getMainThreadAgentId()).not.toBe(
      sessionIdAfter as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
  })

  test('does not rebind after switchSession (/resume)', () => {
    resetStateForTests()
    const latchedMainThreadAgentId = getMainThreadAgentId()
    const resumedSessionId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as SessionId
    switchSession(resumedSessionId, null)
    expect(getSessionId()).toBe(resumedSessionId)
    // densable Ot.mainAgentId sticky — never cleared on ZR
    expect(getMainThreadAgentId()).toBe(latchedMainThreadAgentId)
    expect(getMainThreadAgentId()).not.toBe(
      resumedSessionId as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
  })

  test('resetStateForTests clears latch so the next call re-latches', () => {
    resetStateForTests()
    const firstLatch = getMainThreadAgentId()
    regenerateSessionId()
    expect(getMainThreadAgentId()).toBe(firstLatch)

    resetStateForTests()
    const secondLatch = getMainThreadAgentId()
    expect(secondLatch).toBe(
      getSessionId() as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
    expect(secondLatch).not.toBe(firstLatch)
  })
})
