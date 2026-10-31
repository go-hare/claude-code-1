/**
 * densable DualInk `a()` / `FPe` / `X` — `C.of(U())` bag, not SessionHost.
 * Never `export function a|FPe|X`.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ensureDualInkCurrent,
  getDualInkCurrentBag,
  isDualInkCurrentPresent,
  resetDualInkCurrentForTests,
} from '../instances.js'

const SRC = join(import.meta.dir, '../instances.ts')

describe('densable DualInk a()/FPe on U()', () => {
  test('source is C.of(U()) bag; never export minify a/FPe/X', () => {
    const src = readFileSync(SRC, 'utf8')
    expect(src).toContain('dualInkCurrentFactory.of(U())')
    expect(src).toContain('class DualInkCurrentBag')
    expect(src).not.toContain('export function a(')
    expect(src).not.toContain('export function FPe(')
    expect(src).not.toContain('export function X(')
    expect(src).not.toContain('dualInkCurrent:')
    expect(src).toContain('mintDualInkCurrent')
    expect(src).not.toContain('mint: () =>')
  })

  test('FPe is current!==undefined; X mints A() once', () => {
    resetDualInkCurrentForTests()
    expect(isDualInkCurrentPresent()).toBe(false)
    expect(getDualInkCurrentBag().current).toBe(undefined)
    const minted = ensureDualInkCurrent()
    expect(isDualInkCurrentPresent()).toBe(true)
    expect(ensureDualInkCurrent()).toBe(minted)
    expect(
      (minted.liveReplicas as { workingCopyPath: undefined }).workingCopyPath,
    ).toBe(undefined)
    expect(minted.authoringProgress).toEqual({
      slotsByBlockIndex: new Map(),
      failureReported: false,
    })
    expect(minted.artifactPolicyFetchAnswer).toBe(null)
  })
})
