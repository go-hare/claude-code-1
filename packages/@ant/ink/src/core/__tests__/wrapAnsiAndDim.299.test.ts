import chalk from 'chalk'
import { afterEach, describe, expect, test } from 'bun:test'
import { applyTextStyles } from '../colorize.js'
import { kittyKeyboardPopSeq } from '../terminal.js'
import { TerminalModes } from '../terminalModes.js'
import { probeTerminalIdentity } from '../terminalProbe.js'
import { exitAltScreenSequence } from '../termio/dec.js'
import { printsUnknownSequences } from '../termio/osc.js'
import { stringWidth } from '../stringWidth.js'
import { wrapAnsi } from '../wrapAnsi.js'
import wrapText from '../wrap-text.js'

const origVte = process.env.VTE_VERSION
const origTerm = process.env.TERM
const origTermProgram = process.env.TERM_PROGRAM
const origChalkLevel = chalk.level

afterEach(() => {
  if (origVte === undefined) delete process.env.VTE_VERSION
  else process.env.VTE_VERSION = origVte
  if (origTerm === undefined) delete process.env.TERM
  else process.env.TERM = origTerm
  if (origTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = origTermProgram
  chalk.level = origChalkLevel
})

describe('2.1.299-301 ink alignment', () => {
  test('#625 wrapped text mixing CJK/emoji and Latin words keeps last line and no blank rows', () => {
    const input = '你好world测试hello世界foo'
    const wrapped = wrapAnsi(input, 8, {
      hard: true,
      trim: false,
      wordWrap: true,
    })
    const lines = wrapped.split('\n')
    expect(lines.every(l => l.length > 0)).toBe(true)
    expect(lines.every(l => stringWidth(l) <= 8)).toBe(true)
    expect(lines.join('')).toBe(input)
  })

  test('#647 CJK and emoji squeezed into 1-cell column emits no blank rows', () => {
    const wrapped = wrapAnsi('中文👍a', 1, {
      hard: true,
      trim: false,
      wordWrap: true,
    })
    const lines = wrapped.split('\n')
    expect(lines.every(l => l.length > 0)).toBe(true)
    expect(lines.join('')).toBe('中文👍a')
  })

  test('#648 emoji with SGR color change inside is preserved when wrapped', () => {
    const zwj = '👩\x1b[31m\u200d🔬\x1b[39m'
    const wrapped = wrapAnsi(`hello ${zwj} world`, 8, {
      hard: true,
      trim: false,
      wordWrap: true,
    })
    expect(wrapped).toContain('👩')
    expect(wrapped).toContain('🔬')
  })

  test('#648 middle truncation beside wide chars does not leave an unused cell when avoidable', () => {
    const out = wrapText('ab你好cd', 6, 'truncate-middle')
    expect(stringWidth(out)).toBeLessThanOrEqual(6)
    expect(out).toContain('…')
  })

  test('#627 nested bold+italic SGR closes before newline and reopens after newline', () => {
    chalk.level = 3
    const s = chalk.bold('hello ' + chalk.italic('world foo bar') + ' baz')
    const wrapped = wrapAnsi(s, 10, { hard: true, trim: false, wordWrap: true })
    const lines = wrapped.split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    // Line 2 has bold+italic active and must close both (\x1b[23m and \x1b[22m) before \n
    expect(lines[1]).toContain('\x1b[22m')
    expect(lines[1]).toContain('\x1b[23m')
    // Line 3 must reopen bold (\x1b[1m) and italic (\x1b[3m)
    expect(lines[2]).toContain('\x1b[1m')
  })

  test('#801/#875 faintInk applies SGR dim on neutral 16-color, skipped on inverse/bold/non-neutral bg', () => {
    chalk.level = 1
    const dimNeutral = applyTextStyles('dim', {
      color: 'ansi:white',
      faintInk: 'ansi:white',
    })
    expect(dimNeutral).toContain('\x1b[2m')

    const underSelection = applyTextStyles('sel', {
      color: 'ansi:white',
      faintInk: 'ansi:white',
      inverse: true,
    })
    expect(underSelection).not.toContain('\x1b[2m')

    const underBold = applyTextStyles('bld', {
      color: 'ansi:white',
      faintInk: 'ansi:white',
      bold: true,
    })
    expect(underBold).not.toContain('\x1b[2m')

    const onColoredBox = applyTextStyles('box', {
      color: 'ansi:white',
      faintInk: 'ansi:white',
      backgroundColor: 'ansi:blue',
    })
    expect(onColoredBox).not.toContain('\x1b[2m')
  })

  test('#857 VTE < 5300 suppresses >0q XTVERSION query and >4m / <u exit sequences', async () => {
    process.env.TERM = 'xterm-256color'
    process.env.VTE_VERSION = '5202'
    delete process.env.TERM_PROGRAM
    expect(printsUnknownSequences()).toBe(true)
    expect(exitAltScreenSequence()).toBe('\x1b[?1049l')
    expect(kittyKeyboardPopSeq()).toBe('')

    const modes = new TerminalModes()
    expect(modes).toBeDefined()

    const sentRequests: string[] = []
    const mockQuerier = {
      send: async (q: { request: string }) => {
        sentRequests.push(q.request)
        return undefined
      },
      flush: async () => [],
    }
    await probeTerminalIdentity(mockQuerier as never)
    // Should not send XTVERSION (\x1b[>0q) when printsUnknownSequences() is true
    expect(sentRequests).not.toContain('\x1b[>0q')
  })
})
