import { afterEach, describe, expect, mock, test } from 'bun:test'
import {
  _resetTmuxControlModeProbeForTesting,
  isFullscreenEnvEnabled,
} from '../fullscreen.js'

const ORIG = {
  NO_FLICKER: process.env.CLAUDE_CODE_NO_FLICKER,
  DISABLE_ALT: process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN,
  SESSION_KIND: process.env.CLAUDE_CODE_SESSION_KIND,
  TMUX: process.env.TMUX,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  TERM: process.env.TERM,
  USER_TYPE: process.env.USER_TYPE,
}

let settingsTui: string | undefined

// Relative specifier matches fullscreen.ts dynamic require('./settings/settings.js').
mock.module('../settings/settings.js', () => ({
  getSettingsForSource: () =>
    settingsTui === undefined ? {} : { tui: settingsTui },
}))

afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  restore('CLAUDE_CODE_NO_FLICKER', ORIG.NO_FLICKER)
  restore('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN', ORIG.DISABLE_ALT)
  restore('CLAUDE_CODE_SESSION_KIND', ORIG.SESSION_KIND)
  restore('TMUX', ORIG.TMUX)
  restore('TERM_PROGRAM', ORIG.TERM_PROGRAM)
  restore('TERM', ORIG.TERM)
  restore('USER_TYPE', ORIG.USER_TYPE)
  settingsTui = undefined
  _resetTmuxControlModeProbeForTesting()
})

describe('isFullscreenEnvEnabled', () => {
  test('defaults on (official 2.1.210 / PR #21439)', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    delete process.env.USER_TYPE
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('NO_FLICKER=0 forces off', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('NO_FLICKER=1 forces on', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('bg session forces on even without env', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('settings.tui=default forces off (absent env)', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    settingsTui = 'default'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('settings.tui=fullscreen forces on (absent env)', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    // Force a path that would otherwise disable: tmux -CC.
    process.env.TMUX = '/tmp/tmux-0/default,123,0'
    process.env.TERM_PROGRAM = 'tmux'
    settingsTui = 'fullscreen'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('NO_FLICKER=0 still wins over settings.tui=fullscreen', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    settingsTui = 'fullscreen'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })
})
