/**
 * densable 2.1.232 #35 — `/feedback` `/bug` open mid-turn.
 *
 * Official changelog: open immediately while Claude is responding,
 * instead of waiting for the turn to finish.
 */
import { describe, expect, test } from 'bun:test'
import { isCommandImmediate } from '../../../utils/immediateCommand.js'

describe('/feedback densable 2.1.232 immediate', () => {
  test('index exports immediate local-jsx Command (alias /bug)', async () => {
    const mod = await import('../index.js')
    const cmd = mod.default
    expect(cmd.name).toBe('feedback')
    expect(cmd.type).toBe('local-jsx')
    expect(cmd.aliases).toContain('bug')
    expect(cmd.immediate).toBe(true)
    expect(isCommandImmediate(cmd, '')).toBe(true)
    expect(typeof cmd.load).toBe('function')
  })
})
