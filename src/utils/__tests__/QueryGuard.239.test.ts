import { describe, expect, test } from 'bun:test'
import { QueryGuard } from '../QueryGuard.js'

describe('QueryGuard densable Si.isActive / isRunning', () => {
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
