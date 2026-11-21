import { describe, expect, test } from 'bun:test'
import { QueryGuard } from '../QueryGuard.js'

describe('QueryGuard densable Si.isActive / isRunning', () => {
  test('dispatch becomes a model dispatch only after commitment in the same generation', () => {
    const guard = new QueryGuard()
    guard.reserve()
    const original = guard.generation
    expect(guard.isDispatchingForModel).toBe(false)
    guard.markDispatchForModel(original)
    expect(guard.isDispatchingForModel).toBe(true)
    guard.forceEnd()
    guard.reserve()
    guard.markDispatchForModel(original)
    expect(guard.isDispatchingForModel).toBe(false)
    guard.markDispatchForModel(guard.generation)
    expect(guard.isDispatchingForModel).toBe(true)
    guard.tryStart()
    expect(guard.isDispatchingForModel).toBe(false)
    guard.forceEnd()
    guard.reserve()
    expect(guard.isDispatchingForModel).toBe(false)
  })

  test('commitment does not emit another active-state update', () => {
    const guard = new QueryGuard()
    let updates = 0
    const unsubscribe = guard.subscribe(() => updates++)
    guard.reserve()
    const before = updates
    guard.markDispatchForModel(guard.generation)
    expect(updates).toBe(before)
    unsubscribe()
  })

  test('isActive covers dispatching; isRunning only running', () => {
    const g = new QueryGuard()
    expect(g.isActive).toBe(false)
    expect(g.isRunning).toBe(false)

    expect(g.reserve()).toBe(true)
    expect(g.isActive).toBe(true)
    expect(g.isRunning).toBe(false)

    expect(g.tryStart()).not.toBeNull()
    expect(g.isActive).toBe(true)
    expect(g.isRunning).toBe(true)

    g.forceEnd()
    expect(g.isActive).toBe(false)
    expect(g.isRunning).toBe(false)
  })
})
