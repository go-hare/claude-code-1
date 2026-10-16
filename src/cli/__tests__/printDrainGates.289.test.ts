/**
 * densable 2.1.289 print drain startGate admits + prewait isDoomBoundary.
 */
import { describe, expect, test } from 'bun:test'
import type { QueuedCommand } from '../../types/textInputTypes.js'
import {
  createPrintPrewaitLatch,
  createPrintStartGate,
  isPrintUserIntentCommand,
} from '../printDrainGates.js'

function prompt(opts: Partial<QueuedCommand> = {}): QueuedCommand {
  return {
    value: 'hi',
    mode: 'prompt',
    isMeta: false,
    ...opts,
  }
}

describe('createPrintStartGate (densable Tl admits)', () => {
  test('admits all when not ahead and no followers snapshot', () => {
    const gate = createPrintStartGate()
    expect(gate.admits(prompt())).toBe(true)
  })

  test('markAhead rejects all until clearAhead', () => {
    const gate = createPrintStartGate()
    const cmd = prompt()
    gate.markAhead()
    expect(gate.isHeadAhead).toBe(true)
    expect(gate.admits(cmd)).toBe(false)
    gate.clearAhead()
    expect(gate.admits(cmd)).toBe(true)
  })

  test('followersFrom membership gates admits when captured', () => {
    const gate = createPrintStartGate()
    const a = prompt({ value: 'a' })
    const b = prompt({ value: 'b' })
    gate.captureFollowersFrom([a])
    expect(gate.admits(a)).toBe(true)
    expect(gate.admits(b)).toBe(false)
  })
})

describe('createPrintPrewaitLatch (densable Dm isDoomBoundary)', () => {
  test('isDoomBoundary false until interruptBeforeArm latches intents', () => {
    const a = prompt({ value: 'a' })
    const b = prompt({ value: 'b', isMeta: true })
    const latch = createPrintPrewaitLatch({
      isUserIntent: cmd => isPrintUserIntentCommand(cmd, () => true),
    })
    expect(latch.isDoomBoundary(a, b)).toBe(false)
    latch.interruptBeforeArm([a, b])
    // a latched (user intent), b not (isMeta) → boundary
    expect(latch.isDoomBoundary(a, b)).toBe(true)
    expect(latch.isDoomBoundary(a, prompt({ value: 'c' }))).toBe(true)
    // both non-latched → no boundary
    expect(
      latch.isDoomBoundary(
        prompt({ value: 'x', isMeta: true }),
        prompt({ value: 'y', isMeta: true }),
      ),
    ).toBe(false)
  })

  test('interruptBeforeArm no-ops when no user intent queued', () => {
    const latch = createPrintPrewaitLatch({
      isUserIntent: cmd => isPrintUserIntentCommand(cmd, () => true),
    })
    const meta = prompt({ isMeta: true })
    latch.interruptBeforeArm([meta])
    expect(latch.isDoomBoundary(meta, prompt())).toBe(false)
  })

  test('parkBatch + interruptBeforeArm arms from pending intent batch', () => {
    const latch = createPrintPrewaitLatch({
      isUserIntent: () => false,
    })
    latch.parkBatch(true)
    latch.interruptBeforeArm([])
    // armed with empty latch set; any pair has has(a)===has(b)===false → no boundary
    expect(latch.isDoomBoundary(prompt(), prompt({ value: 'z' }))).toBe(false)
    latch.dropParkedBatch()
    expect(latch.isDoomBoundary(prompt(), prompt({ value: 'z' }))).toBe(false)
  })
})

describe('print.ts wires arming (not read-only stubs)', () => {
  test('drain calls parkBatch/markAhead/captureFollowersFrom/dropParkedBatch/interruptBeforeArm', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(import.meta.dir, '../print.ts'), 'utf8')
    expect(src).toContain('startGate.markAhead()')
    expect(src).toContain('startGate.captureFollowersFrom(')
    expect(src).toContain('startGate.clearAhead()')
    expect(src).toContain('prewait.parkBatch(')
    expect(src).toContain('prewait.dropParkedBatch()')
    expect(src).toContain('printPrewait?.interruptBeforeArm(')
    expect(src).toContain('abortController?.signal.aborted === true')
    expect(src).toContain('const abortedAtResult =')
    expect(src).toContain('aborted: abortedAtResult')
    expect(src).toContain('lastDispatchAborted = abortedAtResult')
    expect(src).toContain('prewait.dropParkedBatch()')
    expect(src).toContain('startGate.clearAhead()')
    const takeCancel = src.indexOf(
      'member.uuid !== undefined && consumeCancelPending(member.uuid)',
    )
    const resetAfterTake = src.indexOf('prewait.reset()', takeCancel)
    const parkAfter = src.indexOf('prewait.parkBatch(', takeCancel)
    expect(takeCancel).toBeGreaterThan(0)
    expect(resetAfterTake).toBeGreaterThan(takeCancel)
    expect(parkAfter).toBeGreaterThan(resetAfterTake)
    expect(src).toContain('queuedAutonomyClaim.staleCommands')
    expect(src).toContain("outcome: { type: 'cancelled' }")
    expect(src).not.toContain('admits: () => true')
    expect(src).not.toContain('isDoomBoundary: () => false')
  })
})
