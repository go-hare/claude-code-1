/**
 * densable 2.1.214 #40 — exit 2 still blocks when stdout JSON schema fails
 */
import { describe, expect, test } from 'bun:test'
import {
  ensureExit2BlockingError,
  resolveHookExit2ValidationGate,
  resolveJsonPathHookOutcome,
} from '../hookExit2Priority.js'

describe('resolveHookExit2ValidationGate densable #40', () => {
  test('schema failure with exit 0 → non-blocking schema path', () => {
    expect(resolveHookExit2ValidationGate(0, true)).toEqual({
      treatAsSchemaNonBlocking: true,
      shouldBlockOnExit2: false,
    })
  })

  test('schema failure with exit 2 → do NOT treat as schema non-blocking; still block', () => {
    expect(resolveHookExit2ValidationGate(2, true)).toEqual({
      treatAsSchemaNonBlocking: false,
      shouldBlockOnExit2: true,
    })
  })

  test('no schema error with exit 2 → block', () => {
    expect(resolveHookExit2ValidationGate(2, false)).toEqual({
      treatAsSchemaNonBlocking: false,
      shouldBlockOnExit2: true,
    })
  })

  test('no schema error with exit 0 → neither', () => {
    expect(resolveHookExit2ValidationGate(0, false)).toEqual({
      treatAsSchemaNonBlocking: false,
      shouldBlockOnExit2: false,
    })
  })
})

describe('ensureExit2BlockingError densable', () => {
  test('synthesizes blockingError when exit 2 and missing', () => {
    const r = ensureExit2BlockingError(
      2,
      {} as { blockingError?: { blockingError: string; command: string } },
      () => ({
        blockingError: '[cmd]: stderr',
        command: 'cmd',
      }),
    )
    expect(r.blockingError).toEqual({
      blockingError: '[cmd]: stderr',
      command: 'cmd',
    })
  })

  test('keeps existing blockingError on exit 2', () => {
    const existing = { blockingError: 'from json', command: 'x' }
    const r = ensureExit2BlockingError(2, { blockingError: existing }, () => ({
      blockingError: 'should not use',
      command: 'y',
    }))
    expect(r.blockingError).toBe(existing)
  })

  test('no-op when status is not 2', () => {
    const r = ensureExit2BlockingError(
      1,
      {} as { blockingError?: { blockingError: string; command: string } },
      () => ({
        blockingError: 'x',
        command: 'y',
      }),
    )
    expect(r.blockingError).toBeUndefined()
  })
})

describe('resolveJsonPathHookOutcome densable', () => {
  test('blocking when hasBlockingError', () => {
    expect(resolveJsonPathHookOutcome(true)).toBe('blocking')
  })
  test('success when no blockingError', () => {
    expect(resolveJsonPathHookOutcome(false)).toBe('success')
  })
})
