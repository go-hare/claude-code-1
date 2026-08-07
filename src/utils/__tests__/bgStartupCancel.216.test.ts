import { afterEach, describe, expect, test } from 'bun:test'
import {
  createAbortErrorReason,
  getAbortReasonMessage,
  isInterruptAbortReason,
} from '../abortController.js'
import {
  assertCanSpawnSubagent,
  getTotalAgentSpawns,
  resetSessionSpawnCaps,
} from '../sessionSpawnCaps.js'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * densable 2.1.216 #15 — Fixed background subagents getting cancelled when a
 * high-priority message arrives during their startup window.
 *
 * Gold (AgentTool L / post-setup gate):
 *   if (abortController.signal.aborted) {
 *     let Me = q_(reason)
 *     if (!(G && Me === "interrupt")) throw new wl
 *   }
 * L(G&&!B) only — remote isolation does not get interrupt immunity.
 */
describe('bg startup cancel / interrupt immunity (densable 2.1.216 #15)', () => {
  afterEach(() => {
    resetSessionSpawnCaps()
  })

  test('isInterruptAbortReason matches densable q_ === "interrupt"', () => {
    expect(isInterruptAbortReason('interrupt')).toBe(true)
    expect(isInterruptAbortReason(createAbortErrorReason('interrupt'))).toBe(
      true,
    )
    expect(isInterruptAbortReason('background')).toBe(false)
    expect(isInterruptAbortReason(undefined)).toBe(false)
    expect(getAbortReasonMessage(createAbortErrorReason('interrupt'))).toBe(
      'interrupt',
    )
  })

  test('assertCanSpawnSubagent: allowInterrupt + interrupt continues and increments', () => {
    const c = new AbortController()
    c.abort('interrupt')
    assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: true })
    expect(getTotalAgentSpawns()).toBe(1)
  })

  test('assertCanSpawnSubagent: allowInterrupt + interrupt DOMException continues', () => {
    const c = new AbortController()
    c.abort(createAbortErrorReason('interrupt'))
    assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: true })
    expect(getTotalAgentSpawns()).toBe(1)
  })

  test('assertCanSpawnSubagent: interrupt without allowInterrupt still throws', () => {
    const c = new AbortController()
    c.abort('interrupt')
    expect(() =>
      assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: false }),
    ).toThrow()
    expect(() => assertCanSpawnSubagent({ abortSignal: c.signal })).toThrow()
    expect(getTotalAgentSpawns()).toBe(0)
  })

  test('assertCanSpawnSubagent: allowInterrupt does not ignore non-interrupt abort', () => {
    const c = new AbortController()
    c.abort('user-cancel')
    expect(() =>
      assertCanSpawnSubagent({ abortSignal: c.signal, allowInterrupt: true }),
    ).toThrow()
    expect(getTotalAgentSpawns()).toBe(0)
  })

  test('assertCanSpawnSubagent: plain abort still throws (legacy path)', () => {
    const c = new AbortController()
    c.abort()
    expect(() => assertCanSpawnSubagent({ abortSignal: c.signal })).toThrow()
  })

  test('AgentTool wires densable L(G&&!B) + post-setup interrupt gate', () => {
    const src = readFileSync(
      join(
        import.meta.dir,
        '../../../packages/builtin-tools/src/tools/AgentTool/AgentTool.tsx',
      ),
      'utf8',
    )
    expect(src).toContain('allowInterrupt')
    expect(src).toContain(
      'consumeSessionSpawnSlot(shouldRunAsync && !isRemoteIsolation)',
    )
    expect(src).toContain('isInterruptAbortReason')
    expect(src).toContain(
      'shouldRunAsync && isInterruptAbortReason(toolUseContext.abortController.signal.reason)',
    )
    expect(src).toContain('cleanupWorktreeIfNeeded()')
    // Independent abort for registered async agents retained
    expect(src).toContain("Don't link to parent's abort controller")
  })
})
