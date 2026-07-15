import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'crypto'
import type { SessionId } from '../../types/ids.js'
import {
  getFableSessionFallbackConsented,
  getSessionId,
  regenerateSessionId,
  setFableSessionFallbackConsented,
  switchSession,
} from '../state.js'

describe('fableSessionFallbackConsented session scope', () => {
  afterEach(() => {
    setFableSessionFallbackConsented(false)
  })

  test('regenerateSessionId clears key-less Fable consent latch', () => {
    setFableSessionFallbackConsented(true)
    expect(getFableSessionFallbackConsented()).toBe(true)
    regenerateSessionId()
    expect(getFableSessionFallbackConsented()).toBe(false)
  })

  test('switchSession clears latch when session id changes', () => {
    setFableSessionFallbackConsented(true)
    switchSession(randomUUID() as SessionId)
    expect(getFableSessionFallbackConsented()).toBe(false)
  })

  test('switchSession keeps latch when session id is unchanged', () => {
    setFableSessionFallbackConsented(true)
    switchSession(getSessionId())
    expect(getFableSessionFallbackConsented()).toBe(true)
  })
})
