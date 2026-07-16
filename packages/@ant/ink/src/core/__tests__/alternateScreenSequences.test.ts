import { afterEach, describe, expect, test } from 'bun:test'
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
