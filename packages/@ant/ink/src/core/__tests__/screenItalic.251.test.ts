import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import chalk from 'chalk'
import {
  applyTextStyles,
  filterItalicOffTokens,
  rendersItalicAsStandout,
} from '../colorize.js'

const previousTerm = process.env.TERM
const previousLevel = chalk.level
const ITALIC_ON = `${String.fromCharCode(0x1b)}[3m`

afterEach(() => {
  if (previousTerm === undefined) delete process.env.TERM
  else process.env.TERM = previousTerm
  chalk.level = previousLevel
})

describe('italic suppressed for TERM=screen (2.1.251 #36)', () => {
  test('jMe emits italic SGR even on TERM=screen (intern drops off-code)', () => {
    chalk.level = 3
    process.env.TERM = 'screen'
    expect(applyTextStyles('hi', { italic: true })).toContain(ITALIC_ON)
  })

  test('jMe emits italic SGR on screen-256color', () => {
    chalk.level = 3
    process.env.TERM = 'screen-256color'
    expect(applyTextStyles('hi', { italic: true })).toContain(ITALIC_ON)
  })

  test('xterm still emits italic', () => {
    chalk.level = 3
    process.env.TERM = 'xterm-256color'
    expect(applyTextStyles('hi', { italic: true })).toContain(ITALIC_ON)
  })

  test('jJn drops italic-off tokens only when TERM starts with screen', () => {
    const tokens = [
      { endCode: '\x1b[22m' },
      { endCode: '\x1b[23m' },
      { endCode: '\x1b[24m' },
    ]
    process.env.TERM = 'screen'
    expect(rendersItalicAsStandout()).toBe(true)
    expect(filterItalicOffTokens(tokens)).toEqual([
      { endCode: '\x1b[22m' },
      { endCode: '\x1b[24m' },
    ])
    process.env.TERM = 'xterm-256color'
    expect(rendersItalicAsStandout()).toBe(false)
    expect(filterItalicOffTokens(tokens)).toEqual(tokens)
  })

  test('StylePool intern runs jJn before the cell style is stored', () => {
    const src = readFileSync(join(import.meta.dir, '../screen.ts'), 'utf8')
    expect(src).toContain('styles = filterItalicOffTokens(styles)')
  })
})
