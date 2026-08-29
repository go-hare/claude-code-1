/**
 * densable Nki / g7a / recordContentWrite (Project C residual).
 * Gold: gold-project-c-axc-write-helpers.txt
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { Axc } from '../axc.js'
import Ink from '../ink.js'
import {
  recordSlowestWrite,
  writeContentToTerminal,
  type Terminal,
} from '../terminal.js'

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

describe('Nki recordSlowestWrite', () => {
  test('first write wins the bag; longer duration replaces', () => {
    const terminal: Terminal = {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
    }
    const firstStart = performance.now() - 10
    recordSlowestWrite(terminal, firstStart, 8)
    expect(terminal.slowestWrite?.bytes).toBe(8)
    expect(terminal.slowestWrite?.startedMs).toBe(firstStart)

    const shortStart = performance.now()
    recordSlowestWrite(terminal, shortStart, 99)
    expect(terminal.slowestWrite?.bytes).toBe(8)

    const longStart = performance.now() - 50
    recordSlowestWrite(terminal, longStart, 3)
    expect(terminal.slowestWrite?.bytes).toBe(3)
    expect(terminal.slowestWrite?.startedMs).toBe(longStart)
  })
})

describe('g7a writeContentToTerminal', () => {
  test('writes then records Nki', () => {
    const chunks: string[] = []
    const stdout = new PassThrough()
    stdout.on('data', (c: Buffer | string) => {
      chunks.push(typeof c === 'string' ? c : c.toString('utf8'))
    })
    const terminal: Terminal = { stdout, stderr: new PassThrough() }
    writeContentToTerminal(terminal, 'hello')
    expect(chunks.join('')).toBe('hello')
    expect(terminal.slowestWrite?.bytes).toBe(Buffer.byteLength('hello'))
  })

  test('stdoutDead short-circuits', () => {
    const stdout = new PassThrough()
    let writes = 0
    stdout.write = ((chunk: string) => {
      writes++
      return true
    }) as typeof stdout.write
    const terminal: Terminal = {
      stdout,
      stderr: new PassThrough(),
      stdoutDead: true,
    }
    writeContentToTerminal(terminal, 'nope')
    expect(writes).toBe(0)
    expect(terminal.slowestWrite).toBeUndefined()
  })
})

describe('Ink.recordContentWrite / writeContent', () => {
  test('writeContent flushes stdout (g7a)', () => {
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
      ink.writeContent('axc-write')
      expect(chunks.join('')).toBe('axc-write')
    } finally {
      ink.unmount()
    }
  })

  test('recordContentWrite is Nki (does not throw)', () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.recordContentWrite(performance.now() - 1, 4)
      ink.recordContentWrite(performance.now(), 1)
    } finally {
      ink.unmount()
    }
  })

  test('Axc onWrite binds to Ink.recordContentWrite', () => {
    const stdout = makeTtyStdout()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      const axc = new Axc(stdout, 80, 24, ink.recordContentWrite.bind(ink))
      axc.setup()
    } finally {
      ink.unmount()
    }
  })
})
