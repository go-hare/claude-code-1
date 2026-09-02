/**
 * densable 2.1.239 Ink `dCi` / `pCi` / `syncTerminalSize`.
 * Gold: function dCi @308641488; stdoutSize/syncTerminalSize @308646494.
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { readFileSync } from 'fs'
import { join } from 'path'
import { PassThrough } from 'stream'
import Ink from '../ink.js'
import {
  MAX_TERMINAL_COLUMNS,
  MAX_TERMINAL_ROWS,
  readStdoutSize,
  sanitizeTerminalDimension,
} from '../terminalSize.js'
import { ENABLE_MOUSE_TRACKING } from '../termio/dec.js'

describe('densable dCi sanitizeTerminalDimension', () => {
  test('undefined / 0 fallback without warn', () => {
    const warns: string[] = []
    const onWarn = (m: string) => warns.push(m)
    expect(
      sanitizeTerminalDimension(undefined, 80, 8192, 'clamp', onWarn),
    ).toBe(80)
    expect(sanitizeTerminalDimension(0, 24, 2048, 'fallback', onWarn)).toBe(24)
    expect(warns).toEqual([])
  })

  test('garbage (NaN / negative) warns once-capable and falls back', () => {
    const warns: string[] = []
    expect(
      sanitizeTerminalDimension(Number.NaN, 80, 8192, 'clamp', m =>
        warns.push(m),
      ),
    ).toBe(80)
    expect(
      sanitizeTerminalDimension(-3, 24, 2048, 'fallback', m => warns.push(m)),
    ).toBe(24)
    expect(warns[0]).toContain('garbage dimension')
    expect(warns[0]).toContain('falling back to 80')
    expect(warns[1]).toContain('falling back to 24')
  })

  test('absurd clamp vs fallback', () => {
    const warns: string[] = []
    expect(
      sanitizeTerminalDimension(9000, 80, 8192, 'clamp', m => warns.push(m)),
    ).toBe(8192)
    expect(
      sanitizeTerminalDimension(9000, 80, 8192, 'fallback', m => warns.push(m)),
    ).toBe(80)
    expect(warns[0]).toContain('clamping to 8192')
    expect(warns[1]).toContain('falling back to 80')
  })

  test('finite in-range floors', () => {
    expect(sanitizeTerminalDimension(80.9, 80, 8192, 'clamp')).toBe(80)
    expect(sanitizeTerminalDimension(24, 24, 2048, 'fallback')).toBe(24)
  })
})

describe('onRender uses stdoutSize not raw TTY', () => {
  test('ink.tsx paint paths call stdoutSize()', () => {
    const src = readFileSync(join(import.meta.dir, '../ink.tsx'), 'utf8')
    expect(src).toMatch(
      /onRender\(\)[\s\S]*\{ columns: terminalWidth, rows: terminalRows \} = this\.stdoutSize\(\)/,
    )
    expect(src).toMatch(
      /onRenderScreenReader\(\)[\s\S]*\{ columns, rows: terminalRows \} = this\.stdoutSize\(\)/,
    )
    expect(src).not.toMatch(
      /onRender\(\)[\s\S]{0,900}this\.options\.stdout\.columns \|\| 80/,
    )
  })
})

describe('densable pCi readStdoutSize', () => {
  test('ctor path clamps to cCi/_Sf', () => {
    expect(MAX_TERMINAL_COLUMNS).toBe(8192)
    expect(MAX_TERMINAL_ROWS).toBe(2048)
    expect(readStdoutSize({ columns: 80, rows: 24 })).toEqual({
      cols: 80,
      rows: 24,
    })
    expect(readStdoutSize({ columns: 9000, rows: 4000 })).toEqual({
      cols: 8192,
      rows: 2048,
    })
  })
})

function makeTtyStdout() {
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
  }
  stdout.columns = 80
  stdout.rows = 24
  stdout.isTTY = true
  return stdout
}

function makeTtyStdin() {
  const stdin = new EventEmitter() as EventEmitter & {
    isTTY: boolean
    setRawMode?: (m: boolean) => void
    ref?: () => void
    unref?: () => void
    resume?: () => void
    pause?: () => void
    read?: () => null
  }
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  stdin.ref = () => {}
  stdin.unref = () => {}
  stdin.resume = () => {}
  stdin.pause = () => {}
  stdin.read = () => null
  return stdin
}

describe('densable syncTerminalSize via handleResize', () => {
  test('same-dimension resize is a no-op; live change syncs stdoutSize', () => {
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      expect(ink.stdoutSize()).toEqual({ columns: 80, rows: 24 })
      ink.ensureInteractive()
      stdout.emit('resize')
      expect(ink.stdoutSize()).toEqual({ columns: 80, rows: 24 })
      stdout.columns = 100
      stdout.rows = 30
      stdout.emit('resize')
      expect(ink.stdoutSize()).toEqual({ columns: 100, rows: 30 })
    } finally {
      ink.unmount()
    }
  })

  test('main-screen resize does not re-assert mouse (gold alt-only)', () => {
    const stdout = makeTtyStdout()
    const chunks: string[] = []
    stdout.on('data', (c: Buffer | string) => {
      chunks.push(typeof c === 'string' ? c : c.toString('utf8'))
    })
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.setMouseTracking('full')
      ink.ensureInteractive()
      chunks.length = 0
      stdout.columns = 100
      stdout.emit('resize')
      expect(chunks.join('')).not.toContain(ENABLE_MOUSE_TRACKING)
      expect(ink.stdoutSize()).toEqual({ columns: 100, rows: 24 })
    } finally {
      ink.unmount()
    }
  })

  test('garbage live winsize falls back (stdoutSize fallback mode)', () => {
    const warns: string[] = []
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
      logger: {
        debug(message, options) {
          if (options?.level === 'warn') warns.push(message)
        },
        error() {},
      },
    })
    try {
      stdout.columns = Number.NaN
      expect(ink.stdoutSize()).toEqual({ columns: 80, rows: 24 })
      expect(warns.some(m => m.includes('garbage dimension'))).toBe(true)
    } finally {
      ink.unmount()
    }
  })
})
