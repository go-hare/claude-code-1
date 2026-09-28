/**
 * densable 2.1.283 SessionEnd `_go` vs `Kfe`.
 * Per-hook timeout is env ?? 1500; bound is env if set else matcher
 * timeout*1000 clamped to [1500, 60000]. Callers must not pass one number
 * for both.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  computeSessionEndHooksBoundMs,
  getSessionEndHookTimeoutMs,
} from '../hooks.js'

const ENV = 'CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS'
const saved = process.env[ENV]

afterEach(() => {
  if (saved === undefined) {
    delete process.env[ENV]
  } else {
    process.env[ENV] = saved
  }
})

describe('getSessionEndHookTimeoutMs (densable _go)', () => {
  test('defaults to 1500 when env is unset', () => {
    delete process.env[ENV]
    expect(getSessionEndHookTimeoutMs()).toBe(1500)
  })

  test('uses CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS when set', () => {
    process.env[ENV] = '9000'
    expect(getSessionEndHookTimeoutMs()).toBe(9000)
  })
})

describe('computeSessionEndHooksBoundMs (densable Kfe)', () => {
  test('env overrides matcher timeouts', () => {
    expect(
      computeSessionEndHooksBoundMs(2500, [{ hooks: [{ timeout: 10 }] }]),
    ).toBe(2500)
  })

  test('no env and no matcher timeout floors at 1500', () => {
    expect(computeSessionEndHooksBoundMs(undefined, [])).toBe(1500)
  })

  test('uses max SessionEnd matcher hook.timeout*1000', () => {
    expect(
      computeSessionEndHooksBoundMs(undefined, [
        { hooks: [{ timeout: 3 }, { timeout: 8 }] },
      ]),
    ).toBe(8000)
  })

  test('clamps matcher timeout below 1500 up to the floor', () => {
    expect(
      computeSessionEndHooksBoundMs(undefined, [{ hooks: [{ timeout: 0.2 }] }]),
    ).toBe(1500)
  })

  test('clamps matcher timeout above 60s down to the ceiling', () => {
    expect(
      computeSessionEndHooksBoundMs(undefined, [{ hooks: [{ timeout: 120 }] }]),
    ).toBe(60_000)
  })
})

describe('SessionEnd callers split per-hook vs bound', () => {
  test('gracefulShutdown / conversation / REPL pass both numbers', () => {
    const graceful = readFileSync(
      join(import.meta.dir, '../gracefulShutdown.ts'),
      'utf8',
    )
    const conversation = readFileSync(
      join(import.meta.dir, '../../commands/clear/conversation.ts'),
      'utf8',
    )
    const repl = readFileSync(
      join(import.meta.dir, '../../screens/REPL.tsx'),
      'utf8',
    )
    for (const src of [graceful, conversation, repl]) {
      expect(src).toContain('getSessionEndHookTimeoutMs')
      expect(src).toContain('getSessionEndHooksBoundMs')
      expect(src).toContain('AbortSignal.timeout(sessionEndBoundMs)')
      expect(src).toContain('timeoutMs: sessionEndTimeoutMs')
    }
  })
})
