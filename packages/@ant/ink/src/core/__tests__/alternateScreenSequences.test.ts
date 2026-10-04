import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { enterAltScreenSequence, exitAltScreenSequence } from '../termio/dec.js'
import { supportsExtendedKeys } from '../terminal.js'

const originalTermProgram = process.env.TERM_PROGRAM
const originalWtSession = process.env.WT_SESSION

afterEach(() => {
  if (originalTermProgram === undefined) delete process.env.TERM_PROGRAM
  else process.env.TERM_PROGRAM = originalTermProgram
  if (originalWtSession === undefined) delete process.env.WT_SESSION
  else process.env.WT_SESSION = originalWtSession
})

describe('alternate screen sequences', () => {
  test('matches the official basic enter ordering', () => {
    expect(enterAltScreenSequence(false)).toBe('\x1b[?1049h\x1b[2J\x1b[H')
  })

  test('restores extended keyboard modes after entering', () => {
    expect(enterAltScreenSequence(true)).toBe(
      '\x1b[?1049h\x1b[2J\x1b[H\x1b[<u\x1b[>1u\x1b[>4;2m',
    )
  })

  test('wraps the sole alt-screen exit with keyboard resets', () => {
    expect(exitAltScreenSequence()).toBe('\x1b[<u\x1b[?1049l\x1b[>4m')
    expect(exitAltScreenSequence().split('\x1b[?1049l')).toHaveLength(2)
  })
})

describe('alt-screen enter is not gated on writeRaw', () => {
  test('Ink.setAltScreenActive does not write DEC 1049 (gold: iTerm flicker)', () => {
    const src = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    const method = src.slice(src.indexOf('setAltScreenActive(active'))
    const body = method.slice(0, method.indexOf('getMouseMode'))
    expect(body).not.toContain('enterAltScreenSequence')
    expect(body).toContain('this.resetFramesForAltScreen()')
  })

  test('AlternateScreen still enters when TerminalWriteContext is null', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../components/AlternateScreen.tsx'),
      'utf8',
    )
    expect(src).not.toMatch(/if\s*\(\s*!writeRaw\s*\)\s*return/)
    expect(src).toContain('ink?.setAltScreenActive(true, mode)')
    expect(src).toContain('enterAltScreenSequence(supportsExtendedKeys())')
    expect(src).toContain('process.stdout.write')
  })
})

describe('supportsExtendedKeys', () => {
  test('detects standalone Windows Terminal from WT_SESSION', () => {
    delete process.env.TERM_PROGRAM
    process.env.WT_SESSION = 'test-session'
    expect(supportsExtendedKeys()).toBe(true)
  })

  test('keeps higher-priority TERM_PROGRAM behavior', () => {
    process.env.TERM_PROGRAM = 'vscode'
    process.env.WT_SESSION = 'test-session'
    expect(supportsExtendedKeys()).toBe(false)
  })

  test('matches the official WarpTerminal allowlist', () => {
    process.env.TERM_PROGRAM = 'WarpTerminal'
    delete process.env.WT_SESSION
    expect(supportsExtendedKeys()).toBe(true)
  })
})
