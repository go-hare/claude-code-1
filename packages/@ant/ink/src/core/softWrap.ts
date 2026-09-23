/**
 * densable 2.1.251 soft-wrap kinds + screen.softWrap packing (`di` / `id` / `Ao`).
 *
 * Wrap producers emit SoftWrapKind per visual line. Output.write packs each
 * continuation row as `contentEnd<<16 | startCol` (optional SW_ELIDED_SEP bit)
 * so selection can clamp joins and reinsert an elided leading space.
 */
import { logForDebugging } from '../utils/debug.js'

/** densable `di` */
export const SoftWrapKind = {
  HardBreak: 0,
  Continuation: 1,
  ContinuationElidedSep: 2,
} as const

export type SoftWrapKind = (typeof SoftWrapKind)[keyof typeof SoftWrapKind]

/** densable `Ao` — bit 15 on a packed softWrap word */
export const SW_ELIDED_SEP = 32768

/** densable `id(end, start)` — high 16 = content end, low 15 = start column */
export function packSoftWrap(contentEnd: number, startCol: number): number {
  if (startCol > 32767) {
    logForDebugging(
      `packSoftWrap: start column ${startCol} exceeds the 15-bit field; bit 15 is reserved for SW_ELIDED_SEP and will be corrupted`,
      { level: 'error' },
    )
  }
  return (contentEnd << 16) | (startCol & 32767)
}

/** densable `Pr` — low 15 bits (start column) */
export function softWrapStartCol(packed: number): number {
  return packed & 32767
}

/** High 16 bits (previous line's content end) */
export function softWrapContentEnd(packed: number): number {
  return packed >>> 16
}

export function isSoftWrapContinuation(packed: number): boolean {
  return packed !== 0
}

export function hasElidedSep(packed: number): boolean {
  return (packed & SW_ELIDED_SEP) !== 0
}
