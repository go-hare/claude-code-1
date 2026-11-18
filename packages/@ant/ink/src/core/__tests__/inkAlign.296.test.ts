import { describe, expect, test } from 'bun:test'
import { ansiCodesToString, diffAnsiCodes } from '@alcalzone/ansi-tokenize'
import {
  CellWidth,
  CharPool,
  HyperlinkPool,
  StylePool,
  boldDimResetPrefix,
  cellAt,
  createScreen,
  setCellAt,
} from '../screen.js'
import { hyperlinkAt, underlineHoveredLink } from '../selection.js'
import {
  CLEAR_PROGRAM_STATUS,
  OSC,
  clearProgramStatusForId,
  programStatus,
  sanitizeProgramStatusId,
} from '../termio/osc.js'
import { programStatusQuery } from '../terminal-querier.js'
import { isITerm2OrTmuxXtversion, setXtversionName } from '../terminal.js'

describe('Ink alignment #227, #344, #408, #536', () => {
  test('#227 isITerm2OrTmuxXtversion detects iTerm2 and tmux xtversion', () => {
    setXtversionName('iTerm2 3.5.0')
    expect(isITerm2OrTmuxXtversion()).toBe(true)
    setXtversionName('tmux 3.4')
    expect(isITerm2OrTmuxXtversion()).toBe(true)
    setXtversionName('ghostty 1.0.0')
    expect(isITerm2OrTmuxXtversion()).toBe(false)
    setXtversionName('')
  })

  test('#344 OSC 7501 Program Status Protocol formatting and query', () => {
    expect(OSC.PROGRAM_STATUS).toBe(7501)
    expect(CLEAR_PROGRAM_STATUS).toBe('\x1b]7501;state=clear\x07')
    expect(clearProgramStatusForId('t1')).toBe(
      '\x1b]7501;state=clear:id=t1\x07',
    )
    expect(sanitizeProgramStatusId('a b/c')).toBe('a-b-c')

    const seq = programStatus({
      state: 'working',
      progress: 42.6,
      title: 'Building',
    })
    expect(seq).toContain(
      '\x1b]7501;state=working:app=claude-code:progress=43:title=',
    )
    const q = programStatusQuery()
    expect(q.request).toBe('\x1b]7501;?\x07')
    expect(q.match({ type: 'osc', code: 7501, data: '?ok' })).toBe(true)
    expect(q.match({ type: 'osc', code: 7501, data: 'other' })).toBe(false)
  })

  test('#408 boldDimResetPrefix prevents bold after dim from turning faint in piped output', () => {
    const dim = [
      { type: 'ansi' as const, code: '\x1b[2m', endCode: '\x1b[22m' },
    ]
    const bold = [
      { type: 'ansi' as const, code: '\x1b[1m', endCode: '\x1b[22m' },
    ]
    const prefix = boldDimResetPrefix(dim, bold)
    expect(prefix).toBe('\x1b[22m')
    const diff = diffAnsiCodes(dim, bold).filter(c => c.code !== '\x1b[22m')
    const out = prefix + ansiCodesToString(diff)
    // \x1b[22m must precede \x1b[1m
    expect(out).toBe('\x1b[22m\x1b[1m')
  })

  test('#536 underlineHoveredLink underlines contiguous link cells on screen', () => {
    const stylePool = new StylePool()
    const charPool = new CharPool()
    const hyperlinkPool = new HyperlinkPool()
    const screen = createScreen(10, 2, stylePool, charPool, hyperlinkPool)
    const baseStyle = stylePool.intern([])
    const link = 'https://example.com'
    for (let c = 2; c <= 5; c++) {
      setCellAt(screen, c, 0, {
        char: 'x',
        styleId: baseStyle,
        width: CellWidth.Narrow,
        hyperlink: link,
      })
    }
    expect(hyperlinkAt(screen, 3, 0)).toBe(link)
    const spans = underlineHoveredLink(screen, 3, 0, link, stylePool)
    expect(spans).toEqual([{ row: 0, from: 2, to: 5 }])
    const styleId3 = cellAt(screen, 3, 0)!.styleId
    expect(stylePool.get(styleId3).some(c => c.code === '\x1b[4m')).toBe(true)
  })
})
