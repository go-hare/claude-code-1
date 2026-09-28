import { describe, expect, test } from 'bun:test'
import {
  backgroundForegroundToolCalls,
  listForegroundToolCalls,
  registerForegroundToolCall,
} from '../foregroundToolCalls.js'

describe('densable 2.1.283 send-now backgroundNow', () => {
  test('backgroundForegroundToolCalls detaches without throwing on a bad call', () => {
    const session = {}
    let moved = false
    const unregister = registerForegroundToolCall(session, {
      toolUseId: 'ok',
      backgroundNow: () => {
        moved = true
        return true
      },
    })
    registerForegroundToolCall(session, {
      toolUseId: 'bad',
      backgroundNow: () => {
        throw new Error('stay in foreground')
      },
    })
    expect(backgroundForegroundToolCalls(session)).toBe(1)
    expect(moved).toBe(true)
    expect(listForegroundToolCalls(session).length).toBe(2)
    unregister()
  })
})
