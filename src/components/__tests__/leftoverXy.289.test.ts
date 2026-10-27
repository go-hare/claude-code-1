/**
 * densable 2.1.289 ir invert: S=!i?Xt:P?hex:u?Yt:xY.
 * Gold xY @180270597 is raw SGR 7. DualInk leftover DualInkGs is gray.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import chalk from 'chalk'
import { readFileSync } from 'fs'
import { join } from 'path'
import { leftoverXt, leftoverXy } from '../../utils/leftoverXy.js'
import { tokenize, styledCharsFromTokens } from '@alcalzone/ansi-tokenize'
import { StylePool } from '../../../packages/@ant/ink/src/core/screen.js'

const textInput = readFileSync(
  join(import.meta.dir, '../TextInput.tsx'),
  'utf8',
)
const vimInput = readFileSync(
  join(import.meta.dir, '../VimTextInput.tsx'),
  'utf8',
)
const base = readFileSync(join(import.meta.dir, '../BaseTextInput.tsx'), 'utf8')
const placeholder = readFileSync(
  join(import.meta.dir, '../../hooks/renderPlaceholder.ts'),
  'utf8',
)
const declared = readFileSync(
  join(
    import.meta.dir,
    '../../../packages/@ant/ink/src/hooks/use-declared-cursor.ts',
  ),
  'utf8',
)

describe('densable 2.1.289 ir leftoverXy invert', () => {
  let savedLevel: typeof chalk.level
  beforeEach(() => {
    savedLevel = chalk.level
    chalk.level = 3
  })
  afterEach(() => {
    chalk.level = savedLevel
  })

  test('below truecolor falls back to raw SGR 7 (gold xY)', () => {
    chalk.level = 2
    expect(leftoverXy('T')).toBe('\x1b[7mT\x1b[27m')
    chalk.level = 0
    expect(leftoverXy(' ')).toBe('\x1b[7m \x1b[27m')
  })

  test('cursor cell is DualInk gray bg black fg; Xt is identity', () => {
    expect(leftoverXy('T')).toBe(
      '\x1b[48;2;160;160;160m\x1b[30mT\x1b[39m\x1b[49m',
    )
    expect(leftoverXy(' ')).toBe(
      '\x1b[48;2;160;160;160m\x1b[30m \x1b[39m\x1b[49m',
    )
    expect(leftoverXy('T')).not.toBe('\x1b[7mT\x1b[27m')
    expect(leftoverXt('T')).toBe('T')
    const pool = new StylePool()
    const chars = styledCharsFromTokens(tokenize(leftoverXy(' ')))
    expect(chars.length).toBe(1)
    const id = pool.intern(chars[0]!.styles)
    const codes = pool.get(id).map(c => c.code)
    expect(codes.some(c => c.includes('48;2;160;160;160'))).toBe(true)
    expect(codes.some(c => c === '\x1b[7m')).toBe(false)
  })

  test('DualInk QUe inverse is leftover DualInk xY, not chalk.inverse', () => {
    const colorize = readFileSync(
      join(import.meta.dir, '../../../packages/@ant/ink/src/core/colorize.ts'),
      'utf8',
    )
    expect(colorize).toContain('leftoverDualInkXy')
    expect(colorize).not.toContain('result = chalk.inverse(result)')
  })

  test('TextInput invert is leftoverXy, not chalk.inverse', () => {
    expect(textInput).toContain('invert = leftoverXy')
    expect(textInput).toContain('invert = leftoverXt')
    expect(textInput).toContain('isNativeCursorEnabled()')
    expect(textInput).not.toContain('chalk.inverse')
    expect(textInput).toContain('!isScreenReaderModeEnabled()')
    expect(textInput).toContain('cursorChar: props.showCursor')
    // densable UTt `visible:!c` — soft invert cell (voice hex or leftoverXy)
    // counts as painted. Native / unfocused identity invert is unpainted.
    expect(textInput).toContain(
      'leftoverVoiceHex || (isTerminalFocused && !nativeCursor)',
    )
  })

  test('Vim $K invert leftoverXy; cursorChar uses eD not Xe', () => {
    expect(vimInput).toContain(
      'invert: isTerminalFocused ? leftoverXy : leftoverXt',
    )
    expect(vimInput).toContain(
      "cursorChar: props.showCursor && !nativeCursor ? ' ' : ''",
    )
    expect(vimInput).not.toContain('chalk.inverse')
    expect(vimInput).toContain('cursorCellPainted={!nativeCursor}')
    expect(textInput).toContain(
      'leftoverVoiceHex || (isTerminalFocused && !nativeCursor)',
    )
  })

  test('UTt Ye showCursor gated on eD; hidePlaceholderText or Xe', () => {
    expect(base).toContain(
      'showCursor: Boolean(props.showCursor) && !nativeCursor',
    )
    expect(base).toContain(
      'hidePlaceholderText: Boolean(hidePlaceholderText) || screenReader',
    )
    expect(base).toContain('visible: !cursorCellPainted')
    expect(placeholder).toContain('invert = leftoverXy')
    expect(placeholder).not.toContain('chalk.inverse')
    expect(declared).toContain('visible = false')
    expect(declared).toContain('visible?: boolean')
    expect(declared).toContain('visible,')
  })
})
