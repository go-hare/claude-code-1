/**
 * densable 2.1.251 bv + FOCUS_IN attachProbeDeferred source lock.
 * Gold: official-251 SEA @189654676 / @189662951.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  getXtversionName,
  resetTerminalProbeForTests,
  setXtversionName,
} from '../terminal.js'

const APP = join(import.meta.dir, '../../components/App.tsx')
const PROBE = join(import.meta.dir, '../terminalProbe.ts')

afterEach(() => {
  resetTerminalProbeForTests()
})

describe('densable nWn overwrite', () => {
  test('setXtversionName overwrites (not first-write-wins)', () => {
    setXtversionName('tmux 3.5')
    expect(getXtversionName()).toBe('tmux 3.5')
    setXtversionName('xterm.js(5.5.0)')
    expect(getXtversionName()).toBe('xterm.js(5.5.0)')
  })
})

describe('gold bv / FOCUS_IN attach probe source', () => {
  test('App first raw-mode bv is non-daemon only', () => {
    const src = readFileSync(APP, 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain("process.env.CLAUDE_BG_BACKEND !== 'daemon'")
    expect(src).toContain('probeTerminalIdentity')
    expect(src).toContain('waitUntilAttachStable')
    expect(src).toContain('attachProbeDeferred')
    expect(src).not.toContain('setXtversionName(r.name)')
  })

  test('handleTerminalFocus daemon arm is gold Rlt then bv', () => {
    const src = readFileSync(APP, 'utf8').replace(/\r\n/g, '\n')
    const focusHandler = src.match(
      /handleTerminalFocus = \(isFocused: boolean\): void => \{([\s\S]*?)\n {2}\};/,
    )
    expect(focusHandler).not.toBeNull()
    const focusCode = focusHandler![1]!
      .split('\n')
      .filter(l => !/^\s*\/\//.test(l) && !/^\s*\*/.test(l))
      .join('\n')
    expect(focusCode).not.toContain("prev !== 'focused'")
    expect(focusCode).toContain("process.env.CLAUDE_BG_BACKEND === 'daemon'")
    expect(focusCode).toContain('waitUntilAttachStable()')
    expect(focusCode).toContain('probeTerminalIdentity')
    expect(focusCode).not.toContain('repaintAfterFocus')
  })

  test('bv probes XTVERSION then DECRQM 2026 with Apple_Terminal skip', () => {
    const src = readFileSync(PROBE, 'utf8').replace(/\r\n/g, '\n')
    expect(src).toContain("display-message', '-p', '#{client_termtype}'")
    expect(src).toContain("name.startsWith('tmux ')")
    expect(src).toContain("TERM_PROGRAM === 'Apple_Terminal'")
    expect(src).toContain('decrqm(DEC.SYNCHRONIZED_UPDATE)')
    expect(src).toContain('decrpm?.status === 1 || decrpm?.status === 2')
  })
})
