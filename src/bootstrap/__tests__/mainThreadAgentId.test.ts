import { describe, expect, test } from 'bun:test'
import {
  getMainThreadAgentId,
  getSessionId,
  regenerateSessionId,
  switchSession,
} from '../state.js'
import type { SessionId } from 'src/types/ids.js'

describe('getMainThreadAgentId follows session id', () => {
  test('matches getSessionId and rebinds after regenerateSessionId', () => {
    const before = getSessionId()
    expect(getMainThreadAgentId()).toBe(
      before as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
    const next = regenerateSessionId()
    expect(next).not.toBe(before)
    expect(getMainThreadAgentId()).toBe(
      next as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
    expect(getMainThreadAgentId()).toBe(
      getSessionId() as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
  })

  test('rebinds after switchSession', () => {
    const id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' as SessionId
    switchSession(id, null)
    expect(getMainThreadAgentId()).toBe(
      id as unknown as ReturnType<typeof getMainThreadAgentId>,
    )
  })
})
