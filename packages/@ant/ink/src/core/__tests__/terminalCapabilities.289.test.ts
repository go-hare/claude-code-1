/**
 * densable 2.1.289 `Jk` / `tD` / `class o` host-keyed capabilities.
 * Gold: official-289 SEA @192996635 / function Jk @193001048.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  bindInkSessionHost,
  resetInkSessionHostForTests,
} from '../instances.js'
import { Jk, tD, type TerminalCapabilityName } from '../terminalCapabilities.js'
import {
  isNativeCursorEnabled,
  resetTerminalProbeForTests,
} from '../terminal.js'

const savedEnv = {
  TMUX: process.env.TMUX,
  STY: process.env.STY,
  TERM: process.env.TERM,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  CLAUDE_CODE_SESSION_KIND: process.env.CLAUDE_CODE_SESSION_KIND,
  CLAUDE_CODE_FORCE_TERMINAL_IMAGES:
    process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES,
  CLAUDE_CODE_FORCE_SYNC_OUTPUT: process.env.CLAUDE_CODE_FORCE_SYNC_OUTPUT,
  WT_SESSION: process.env.WT_SESSION,
  CLAUDE_CODE_ACCESSIBILITY: process.env.CLAUDE_CODE_ACCESSIBILITY,
  CLAUDE_AX_SCREEN_READER: process.env.CLAUDE_AX_SCREEN_READER,
  INK_SCREEN_READER: process.env.INK_SCREEN_READER,
  CLAUDE_CODE_NATIVE_CURSOR: process.env.CLAUDE_CODE_NATIVE_CURSOR,
  CLAUDE_CODE_DECSTBM: process.env.CLAUDE_CODE_DECSTBM,
}

function restoreEnv(): void {
  for (const key of Object.keys(savedEnv) as Array<keyof typeof savedEnv>) {
    const value = savedEnv[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function isolatePendingMousePixels(): void {
  delete process.env.TMUX
  delete process.env.STY
  delete process.env.CLAUDE_CODE_SESSION_KIND
  delete process.env.CLAUDE_CODE_FORCE_TERMINAL_IMAGES
  process.env.TERM_PROGRAM = 'Apple_Terminal'
}

afterEach(() => {
  restoreEnv()
  resetTerminalProbeForTests()
  resetInkSessionHostForTests()
})

describe('densable 2.1.289 tD / Jk', () => {
  test('tD().now is pending fallback until answer settles', () => {
    isolatePendingMousePixels()
    const host = {}
    bindInkSessionHost(() => host)
    Jk().resetCapabilities()
    expect(tD().get('mousePixels').state).toBe('pending')
    expect(tD().now('mousePixels')).toBe(false)
    expect(tD().answer('mousePixels', true, 'probe: DECRPM 1016')).toBe(true)
    expect(tD().now('mousePixels')).toBe(true)
    expect(tD().get('mousePixels')).toMatchObject({
      state: 'settled',
      value: true,
      source: 'probe: DECRPM 1016',
    })
    expect(tD().confirmed('mousePixels')).toBe(true)
    expect(tD().answer('mousePixels', true, 'again')).toBe(false)
  })

  test('tD().onSettle fires on answer and immediately when already settled', () => {
    isolatePendingMousePixels()
    const host = {}
    bindInkSessionHost(() => host)
    Jk().resetCapabilities()

    const first: boolean[] = []
    const cancel = tD().onSettle('mousePixels', value => {
      first.push(value)
    })
    expect(first).toEqual([])
    expect(tD().answer('mousePixels', true, 'probe')).toBe(true)
    expect(first).toEqual([true])
    cancel()

    const second: boolean[] = []
    const noop = tD().onSettle('mousePixels', value => {
      second.push(value)
    })
    expect(second).toEqual([true])
    expect(tD().answer('mousePixels', false, 'late')).toBe(false)
    expect(second).toEqual([true])
    noop()
  })

  test('Jk() is keyed by U().host', () => {
    isolatePendingMousePixels()
    const hostA = {}
    const hostB = {}
    bindInkSessionHost(() => hostA)
    const a = Jk()
    a.xtversionName = 'ghostty 1.2'
    expect(tD().answer('extendedKeys', true, 'host-a')).toBe(true)

    bindInkSessionHost(() => hostB)
    const b = Jk()
    expect(b).not.toBe(a)
    expect(b.xtversionName).toBeUndefined()
    expect(tD().get('extendedKeys').state).not.toBe('settled')
    expect(tD()).not.toBe(a.capabilities)

    bindInkSessionHost(() => hostA)
    expect(Jk()).toBe(a)
    expect(Jk().xtversionName).toBe('ghostty 1.2')
    expect(tD().now('extendedKeys')).toBe(true)
  })

  test('resetCapabilities drops the store; deadline settles pending to likely', () => {
    isolatePendingMousePixels()
    const host = {}
    bindInkSessionHost(() => host)
    Jk().resetCapabilities()
    const first = tD()
    expect(first.pending()).toContain('mousePixels' as TerminalCapabilityName)
    first.deadline()
    expect(first.get('mousePixels').state).toBe('settled')
    expect(first.now('mousePixels')).toBe(false)
    expect(first.get('mousePixels').source).toContain('no answer')

    Jk().resetCapabilities()
    expect(tD()).not.toBe(first)
    expect(tD().get('mousePixels').state).toBe('pending')
  })

  test('eD pins nativeCursorEnabled on Jk() host', () => {
    const host = {}
    bindInkSessionHost(() => host)
    resetTerminalProbeForTests()
    delete process.env.CLAUDE_CODE_ACCESSIBILITY
    delete process.env.CLAUDE_AX_SCREEN_READER
    delete process.env.INK_SCREEN_READER
    delete process.env.CLAUDE_CODE_NATIVE_CURSOR
    expect(isNativeCursorEnabled()).toBe(false)
    expect(Jk().nativeCursorEnabled).toBe(false)
    process.env.CLAUDE_CODE_NATIVE_CURSOR = '1'
    expect(isNativeCursorEnabled()).toBe(false)
    resetTerminalProbeForTests()
    expect(isNativeCursorEnabled()).toBe(true)
  })
})
