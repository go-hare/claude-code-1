/**
 * densable 2.1.246 #25 — Ft overlays custom diffAdded/diffRemoved onto ColorDiff.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { ColorDiff, __test } from '../index'
import type { ClaudeDiffPalette } from '../index'

const { parseClaudeThemeColor, applyClaudeDiffPalette } = __test

const palette: ClaudeDiffPalette = {
  diffAdded: 'rgb(1,2,3)',
  diffRemoved: 'rgb(4,5,6)',
  diffAddedDimmed: 'rgb(7,8,9)',
  diffRemovedDimmed: 'rgb(10,11,12)',
  diffAddedWord: 'rgb(13,14,15)',
  diffRemovedWord: 'rgb(16,17,18)',
}

describe('densable 2.1.246 #25 Ft / te Claude diff overlay', () => {
  const prev = process.env.COLORTERM
  afterEach(() => {
    if (prev === undefined) delete process.env.COLORTERM
    else process.env.COLORTERM = prev
  })

  test('te parses rgb / hex / ansi256 / ansi:name', () => {
    expect(parseClaudeThemeColor('rgb(1,2,3)')).toEqual({
      r: 1,
      g: 2,
      b: 3,
      a: 255,
    })
    expect(parseClaudeThemeColor('#00ff80')).toEqual({
      r: 0,
      g: 255,
      b: 128,
      a: 255,
    })
    expect(parseClaudeThemeColor('#80f')).toEqual({
      r: 136,
      g: 0,
      b: 255,
      a: 255,
    })
    expect(parseClaudeThemeColor('ansi256(93)')).toEqual({
      r: 93,
      g: 0,
      b: 0,
      a: 0,
    })
    expect(parseClaudeThemeColor('ansi:green')).toEqual({
      r: 2,
      g: 0,
      b: 0,
      a: 0,
    })
    expect(parseClaudeThemeColor(undefined)).toBeNull()
    expect(parseClaudeThemeColor('ansi:gray')).toBeNull()
    expect(parseClaudeThemeColor('not-a-color')).toBeNull()
  })

  test('Ft dim uses *Dimmed, and bad parse keeps syntax default', () => {
    const syntax = {
      addLine: { r: 2, g: 40, b: 0, a: 255 },
      addWord: { r: 4, g: 71, b: 0, a: 255 },
      addDecoration: { r: 80, g: 200, b: 80, a: 255 },
      deleteLine: { r: 61, g: 1, b: 0, a: 255 },
      deleteWord: { r: 92, g: 2, b: 0, a: 255 },
      deleteDecoration: { r: 220, g: 90, b: 90, a: 255 },
      foreground: { r: 248, g: 248, b: 242, a: 255 },
      background: { r: 0, g: 0, b: 0, a: 1 },
      scopes: {},
    }
    const over = applyClaudeDiffPalette(syntax, palette, false)
    expect(over.addLine).toEqual({ r: 1, g: 2, b: 3, a: 255 })
    expect(over.deleteLine).toEqual({ r: 4, g: 5, b: 6, a: 255 })
    const dimmed = applyClaudeDiffPalette(syntax, palette, true)
    expect(dimmed.addLine).toEqual({ r: 7, g: 8, b: 9, a: 255 })
    expect(dimmed.deleteLine).toEqual({ r: 10, g: 11, b: 12, a: 255 })
    const bad = applyClaudeDiffPalette(
      syntax,
      { ...palette, diffAdded: 'nope' },
      false,
    )
    expect(bad.addLine).toEqual(syntax.addLine)
  })

  test('ColorDiff.render 4th arg paints custom add-line background', () => {
    process.env.COLORTERM = 'truecolor'
    const lines = new ColorDiff(
      {
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: ['+hello'],
      },
      null,
      'x.ts',
    ).render('dark', 80, false, palette)
    expect(lines).not.toBeNull()
    expect(lines!.join('\n')).toContain('\x1b[48;2;1;2;3m')
  })
})
