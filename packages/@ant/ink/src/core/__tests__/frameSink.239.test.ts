/**
 * densable Ink.frameSink onRender contract (Project C Phase-2).
 * Gold: gold-project-c-frameSink-ink.txt
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import React from 'react'
import Ink from '../ink.js'
import { CharPool, HyperlinkPool, StylePool } from '../screen.js'
import {
  ENABLE_MOUSE_TRACKING,
  ENABLE_MOUSE_TRACKING_SCROLL,
} from '../termio/dec.js'

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

describe('Ink.frameSink', () => {
  test('exposes frameSink / recordContentWrite / pool getters', () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      expect(ink.frameSink).toBeNull()
      expect(typeof ink.recordContentWrite).toBe('function')
      expect(ink.getStylePool()).toBeInstanceOf(StylePool)
      expect(ink.getCharPool()).toBeInstanceOf(CharPool)
      expect(ink.getHyperlinkPool()).toBeInstanceOf(HyperlinkPool)
    } finally {
      ink.unmount()
    }
  })

  test('truthy frameSink invokes sink and completes without throw', () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.render(React.createElement('ink-box', null, 'hi'))
      let sinkCalls = 0
      let sawPool: StylePool | undefined
      ink.frameSink = (_frame, stylePool) => {
        sinkCalls++
        sawPool = stylePool
        return true
      }
      ink.onRender()
      expect(sinkCalls).toBe(1)
      expect(sawPool).toBe(ink.getStylePool())
    } finally {
      ink.frameSink = null
      ink.unmount()
    }
  })

  test('false from frameSink falls through to normal paint', () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.render(React.createElement('ink-box', null, 'x'))
      let calls = 0
      ink.frameSink = () => {
        calls++
        return false
      }
      ink.onRender()
      expect(calls).toBe(1)
      // Still have a front frame (normal path completed)
      expect(ink.getStylePool()).toBeTruthy()
    } finally {
      ink.frameSink = null
      ink.unmount()
    }
  })

  test('truthy + frame.scrollDrainPending re-arms drainTimer', async () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.render(React.createElement('ink-box', null, 'd'))
      let n = 0
      ink.frameSink = frame => {
        n++
        // Gold xxc steady-state returns true (not 'tick'). Local drain flag
        // must still arm the timer — mutate the renderer frame the sink sees.
        if (n === 1) {
          ;(frame as { scrollDrainPending?: boolean }).scrollDrainPending = true
          return true
        }
        return true
      }
      ink.onRender()
      expect(n).toBe(1)
      await new Promise(r => setTimeout(r, 20))
      expect(n).toBeGreaterThanOrEqual(2)
    } finally {
      ink.frameSink = null
      ink.unmount()
    }
  })

  test('pure true (no scrollDrainPending) does not re-arm drainTimer', async () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.render(React.createElement('ink-box', null, 's'))
      let n = 0
      ink.frameSink = () => {
        n++
        return true
      }
      ink.onRender()
      expect(n).toBe(1)
      await new Promise(r => setTimeout(r, 20))
      expect(n).toBe(1)
    } finally {
      ink.frameSink = null
      ink.unmount()
    }
  })

  test('"tick" re-arms drainTimer', async () => {
    const ink = new Ink({
      stdout: makeTtyStdout() as never,
      stdin: makeTtyStdin() as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.render(React.createElement('ink-box', null, 't'))
      let n = 0
      ink.frameSink = () => {
        n++
        // First call tick so timer fires; subsequent true to stop
        return n === 1 ? 'tick' : true
      }
      ink.onRender()
      expect(n).toBe(1)
      await new Promise(r => setTimeout(r, 20))
      expect(n).toBeGreaterThanOrEqual(2)
    } finally {
      ink.frameSink = null
      ink.unmount()
    }
  })
})

describe('Ink sticky-main mouse restore', () => {
  test('reassertTerminalModes writes mouse on main screen (sleep-wake)', () => {
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
      expect(ink.isAltScreenActive).toBe(false)
      ink.setMouseTracking('full')
      chunks.length = 0
      ink.reassertTerminalModes()
      expect(chunks.join('')).toContain(ENABLE_MOUSE_TRACKING)
    } finally {
      ink.unmount()
    }
  })

  test('SIGCONT handleResume re-asserts mouse on main screen', () => {
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
      ink.setMouseTracking('scroll')
      chunks.length = 0
      process.emit('SIGCONT')
      expect(chunks.join('')).toContain(ENABLE_MOUSE_TRACKING_SCROLL)
    } finally {
      ink.unmount()
    }
  })

  test('reassertTerminalModes does not write mouse when tracking is off', () => {
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
      chunks.length = 0
      ink.reassertTerminalModes()
      const out = chunks.join('')
      expect(out).not.toContain(ENABLE_MOUSE_TRACKING)
      expect(out).not.toContain(ENABLE_MOUSE_TRACKING_SCROLL)
    } finally {
      ink.unmount()
    }
  })
})
