import { afterEach, describe, expect, test } from 'bun:test'

import { getSessionId } from '../../bootstrap/state.js'
import {
  cacheSessionTitle,
  clearSessionMetadata,
  getCurrentSessionTitle,
  subscribeSessionTitleChanged,
} from '../sessionStorage.js'

describe('subscribeSessionTitleChanged (densable BQi)', () => {
  afterEach(() => {
    clearSessionMetadata()
  })

  test('notifies subscribers when the current session title cache changes', () => {
    const sessionId = getSessionId()
    const seen: Array<string | undefined> = []
    const unsub = subscribeSessionTitleChanged(() => {
      seen.push(getCurrentSessionTitle(sessionId))
    })

    cacheSessionTitle('Fix login button')
    expect(seen).toContain('Fix login button')
    expect(getCurrentSessionTitle(sessionId)).toBe('Fix login button')

    clearSessionMetadata()
    expect(seen.at(-1)).toBe(undefined)

    unsub()
  })
})
