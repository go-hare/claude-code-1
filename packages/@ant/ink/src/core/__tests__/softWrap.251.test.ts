import { describe, expect, test } from 'bun:test'
import {
  SoftWrapKind,
  SW_ELIDED_SEP,
  hasElidedSep,
  isSoftWrapContinuation,
  packSoftWrap,
  softWrapContentEnd,
  softWrapStartCol,
} from '../softWrap.js'

describe('densable 2.1.251 softWrap packing', () => {
  test('packSoftWrap is contentEnd<<16 | startCol', () => {
    const packed = packSoftWrap(80, 2)
    expect(softWrapContentEnd(packed)).toBe(80)
    expect(softWrapStartCol(packed)).toBe(2)
    expect(isSoftWrapContinuation(packed)).toBe(true)
    expect(hasElidedSep(packed)).toBe(false)
  })

  test('SW_ELIDED_SEP sets bit 15 without clobbering startCol', () => {
    const packed = packSoftWrap(40, 4) | SW_ELIDED_SEP
    expect(softWrapContentEnd(packed)).toBe(40)
    expect(softWrapStartCol(packed)).toBe(4)
    expect(hasElidedSep(packed)).toBe(true)
    expect(isSoftWrapContinuation(packed)).toBe(true)
  })

  test('HardBreak / zero is not a continuation', () => {
    expect(SoftWrapKind.HardBreak).toBe(0)
    expect(isSoftWrapContinuation(0)).toBe(false)
    expect(softWrapContentEnd(0)).toBe(0)
  })

  test('kind enum matches densable di', () => {
    expect(SoftWrapKind.HardBreak).toBe(0)
    expect(SoftWrapKind.Continuation).toBe(1)
    expect(SoftWrapKind.ContinuationElidedSep).toBe(2)
  })
})
