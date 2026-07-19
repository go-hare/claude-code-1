import { describe, expect, test } from 'bun:test'
import {
  ansi256CubeChannel,
  reduceTruecolorAnsiCodes,
  rgbToNearestAnsi256,
  TRUECOLOR_SGR_RE,
} from '../truecolorReduce.js'

function ansi(code: string, endCode = '\x1b[39m') {
  return { type: 'ansi' as const, code, endCode }
}

describe('truecolorReduce densable Gsu/Igg', () => {
  test('TRUECOLOR_SGR_RE matches densable kgg fg/bg', () => {
    const fg = '\x1b[38;2;215;119;87m'
    const bg = '\x1b[48;2;0;0;0m'
    expect(TRUECOLOR_SGR_RE.exec(fg)?.[1]).toBe('38')
    expect(TRUECOLOR_SGR_RE.exec(bg)?.[1]).toBe('48')
    expect(TRUECOLOR_SGR_RE.exec('\x1b[31m')).toBeNull()
    expect(TRUECOLOR_SGR_RE.exec('\x1b[38;5;174m')).toBeNull()
  })

  test('ansi256CubeChannel densable n(_)', () => {
    expect(ansi256CubeChannel(0)).toBe(0)
    expect(ansi256CubeChannel(47)).toBe(0)
    expect(ansi256CubeChannel(48)).toBe(1)
    expect(ansi256CubeChannel(114)).toBe(1)
    expect(ansi256CubeChannel(115)).toBe(2)
    expect(ansi256CubeChannel(255)).toBe(5)
  })

  test('rgbToNearestAnsi256 densable Igg black/white/orange-ish', () => {
    // near black → 16
    expect(rgbToNearestAnsi256(0, 0, 0)).toBe(16)
    expect(rgbToNearestAnsi256(4, 4, 4)).toBe(16)
    // pure white-ish gray with equal channels avg>244 prefers cube white
    expect(rgbToNearestAnsi256(255, 255, 255)).toBe(231)
    // Claude orange rgb(215,119,87) — known washed cube neighbor
    const idx = rgbToNearestAnsi256(215, 119, 87)
    expect(idx).toBeGreaterThanOrEqual(16)
    expect(idx).toBeLessThanOrEqual(255)
  })

  test('reduceTruecolorAnsiCodes no-ops at chalk level >= 3', () => {
    const styles = [ansi('\x1b[38;2;215;119;87m')]
    expect(reduceTruecolorAnsiCodes(styles, 3)).toBe(styles)
    expect(reduceTruecolorAnsiCodes(styles, 4)).toBe(styles)
  })

  test('reduceTruecolorAnsiCodes no-ops empty', () => {
    const styles: ReturnType<typeof ansi>[] = []
    expect(reduceTruecolorAnsiCodes(styles, 2)).toBe(styles)
  })

  test('reduceTruecolorAnsiCodes rewrites truecolor when level < 3', () => {
    const styles = [
      ansi('\x1b[1m', '\x1b[22m'),
      ansi('\x1b[38;2;215;119;87m'),
      ansi('\x1b[48;2;0;0;0m', '\x1b[49m'),
    ]
    const out = reduceTruecolorAnsiCodes(styles, 2)
    expect(out).not.toBe(styles)
    expect(out[0]).toEqual(styles[0]!)
    expect(out[1]!.code).toMatch(/^\x1b\[38;5;\d+m$/)
    expect(out[1]!.endCode).toBe('\x1b[39m')
    expect(out[2]!.code).toMatch(/^\x1b\[48;5;\d+m$/)
    expect(out[2]!.endCode).toBe('\x1b[49m')
    // black bg → 16
    expect(out[2]!.code).toBe('\x1b[48;5;16m')
  })

  test('reduceTruecolorAnsiCodes identity when no truecolor codes', () => {
    const styles = [ansi('\x1b[31m'), ansi('\x1b[1m', '\x1b[22m')]
    expect(reduceTruecolorAnsiCodes(styles, 1)).toBe(styles)
  })
})
