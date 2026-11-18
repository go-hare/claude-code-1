import { describe, expect, test } from 'bun:test'
import { createChannelPermissionCallbacks } from '../channelPermissions.js'

describe('v2.1.290 #68 — JIi channelPermissions seen Set', () => {
  test('ignores duplicate request IDs drawn twice in the same session', () => {
    const cb = createChannelPermissionCallbacks(() => true)
    let firstCalled = false
    let secondCalled = false

    const cancel1 = cb.onResponse('AbCdE', () => {
      firstCalled = true
    })
    // Resolve first request normally
    expect(cb.resolve('abcde', 'allow', 'telegram')).toBe(true)
    expect(firstCalled).toBe(true)
    cancel1()

    // Drawing the same ID (case-insensitive) a second time in the same session must be ignored
    const cancel2 = cb.onResponse('ABCDE', () => {
      secondCalled = true
    })
    expect(cb.resolve('abcde', 'allow', 'telegram')).toBe(false)
    expect(secondCalled).toBe(false)
    cancel2()
  })

  test('also deletes any pending handler if a duplicate ID is registered while pending', () => {
    const cb = createChannelPermissionCallbacks(() => true)
    let firstCalled = false
    let secondCalled = false

    cb.onResponse('dup12', () => {
      firstCalled = true
    })
    // Registering same ID again while first is still pending deletes pending and ignores both
    cb.onResponse('DUP12', () => {
      secondCalled = true
    })

    expect(cb.resolve('dup12', 'allow', 'discord')).toBe(false)
    expect(firstCalled).toBe(false)
    expect(secondCalled).toBe(false)
  })
})
