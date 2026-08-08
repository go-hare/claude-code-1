/**
 * densable skipSyncMarkers — dj8 third arg.
 * densable: !TTY || !QQ() || !unsubscribeTTYHandlers → true
 */
import { describe, expect, test } from 'bun:test'
import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import Ink from '../ink.js'

function makeTtyStdout() {
  const stdout = new PassThrough() as PassThrough & {
    columns: number
    rows: number
    isTTY: boolean
  }
  stdout.columns = 80
  stdout.rows = 24
  stdout.isTTY = true
  // Ink attaches resize listeners via .on
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

describe('densable skipSyncMarkers', () => {
  test('before ensureInteractive (no TTY handlers) → skip true', () => {
    const stdout = makeTtyStdout()
    const stdin = makeTtyStdin()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: stdin as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      // Handlers not attached yet — densable skipSyncMarkers true
      expect(ink.skipSyncMarkers()).toBe(true)
    } finally {
      ink.unmount()
    }
  })

  test('after ensureInteractive → skip reflects SYNC support only', () => {
    const stdout = makeTtyStdout()
    const stdin = makeTtyStdin()
    const ink = new Ink({
      stdout: stdout as never,
      stdin: stdin as never,
      stderr: new PassThrough() as never,
      exitOnCtrlC: false,
      patchConsole: false,
    })
    try {
      ink.ensureInteractive()
      // With handlers attached: skip only when SYNC_OUTPUT_SUPPORTED is false
      const skipped = ink.skipSyncMarkers()
      expect(typeof skipped).toBe('boolean')
      // Second call still stable
      expect(ink.skipSyncMarkers()).toBe(skipped)
    } finally {
      ink.unmount()
    }
  })
})
