import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import {
  _resetTmuxControlModeProbeForTesting,
  _setWindowsPlatformForTesting,
  getFullscreenGateReason,
  isFullscreenEnvEnabled,
  isFullscreenFeatureGateEnabled,
  isWindowsOverSSH,
} from '../fullscreen.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../tests/mocks/settings.js'

const ORIG = {
  NO_FLICKER: process.env.CLAUDE_CODE_NO_FLICKER,
  DISABLE_ALT: process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN,
  SESSION_KIND: process.env.CLAUDE_CODE_SESSION_KIND,
  TMUX: process.env.TMUX,
  TERM_PROGRAM: process.env.TERM_PROGRAM,
  TERM: process.env.TERM,
  USER_TYPE: process.env.USER_TYPE,
  SSH_CONNECTION: process.env.SSH_CONNECTION,
  SSH_CLIENT: process.env.SSH_CLIENT,
  SSH_TTY: process.env.SSH_TTY,
  ENTRYPOINT: process.env.CLAUDE_CODE_ENTRYPOINT,
}

/**
 * Env keys that gate isFullscreenEnvEnabled / isFullscreenFeatureGateEnabled.
 * Cleared before every test: the suite asserts against an unset baseline, but
 * the harness itself may run under CLAUDE_CODE_SESSION_KIND=bg (backgrounded
 * session) or inside tmux, and those short-circuit the gate before any
 * per-test setup runs. Tests that need a value set it explicitly.
 */
const GATE_ENV_KEYS = [
  'CLAUDE_CODE_NO_FLICKER',
  'CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN',
  'CLAUDE_CODE_SESSION_KIND',
  'CLAUDE_CODE_ENTRYPOINT',
  'TMUX',
  'TERM_PROGRAM',
  'USER_TYPE',
  'SSH_CONNECTION',
  'SSH_CLIENT',
  'SSH_TTY',
] as const

let settingsTui: 'default' | 'fullscreen' | undefined

import * as realSettings from '../settings/settings.js'
// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings)
const realGetSettingsForSource =
  settingsSnap.getSettingsForSource as typeof realSettings.getSettingsForSource
const realGetInitialSettings =
  settingsSnap.getInitialSettings as typeof realSettings.getInitialSettings

// Relative specifier matches fullscreen.ts dynamic require('./settings/settings.js').
const settingsMock = createSettingsMock(settingsSnap, {
  getSettingsForSource: (
    source: Parameters<typeof realGetSettingsForSource>[0],
  ) => {
    if (settingsTui !== undefined) {
      return { ...(realGetSettingsForSource(source) ?? {}), tui: settingsTui }
    }
    return realGetSettingsForSource(source)
  },
  getInitialSettings: () => {
    if (settingsTui !== undefined) {
      return { ...realGetInitialSettings(), tui: settingsTui }
    }
    return realGetInitialSettings()
  },
})
mock.module('../settings/settings.js', settingsMock)
mock.module('src/utils/settings/settings.js', settingsMock)
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    '../settings/settings.js',
    'src/utils/settings/settings.js',
  ])
})

beforeEach(() => {
  for (const k of GATE_ENV_KEYS) delete process.env[k]
  _setWindowsPlatformForTesting(undefined)
  _resetTmuxControlModeProbeForTesting()
})

afterEach(() => {
  const restore = (k: string, v: string | undefined) => {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  restore('CLAUDE_CODE_ENTRYPOINT', ORIG.ENTRYPOINT)
  restore('CLAUDE_CODE_NO_FLICKER', ORIG.NO_FLICKER)
  restore('CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN', ORIG.DISABLE_ALT)
  restore('CLAUDE_CODE_SESSION_KIND', ORIG.SESSION_KIND)
  restore('TMUX', ORIG.TMUX)
  restore('TERM_PROGRAM', ORIG.TERM_PROGRAM)
  restore('TERM', ORIG.TERM)
  restore('USER_TYPE', ORIG.USER_TYPE)
  // Always clear SSH envs so host win32 + residual SSH_* cannot trip yMi
  // in unrelated cases. Tests that need SSH set it explicitly.
  delete process.env.SSH_CONNECTION
  delete process.env.SSH_CLIENT
  delete process.env.SSH_TTY
  settingsTui = undefined
  _setWindowsPlatformForTesting(undefined)
  _resetTmuxControlModeProbeForTesting()
})

describe('isFullscreenEnvEnabled', () => {
  test('defaults on (official 2.1.210 / PR #21439)', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    delete process.env.USER_TYPE
    delete process.env.SSH_CONNECTION
    delete process.env.SSH_CLIENT
    delete process.env.SSH_TTY
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

  // The bare "bg → true" case above cannot fail: unset env already defaults to
  // true. Pin the precedence that actually distinguishes the bg branch — it is
  // checked before the NO_FLICKER opt-out, so bg beats an explicit 0, but it
  // sits after DISABLE_ALTERNATE_SCREEN, which still wins.
  test('bg session outranks NO_FLICKER=0 but not DISABLE_ALTERNATE_SCREEN', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(isFullscreenEnvEnabled()).toBe(false)

    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isFullscreenEnvEnabled()).toBe(true)

    delete process.env.CLAUDE_CODE_NO_FLICKER
    process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN = '1'
    expect(isFullscreenEnvEnabled()).toBe(false)
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
    delete process.env.TMUX
    delete process.env.SSH_CONNECTION
    settingsTui = 'fullscreen'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('NO_FLICKER=0 still wins over settings.tui=fullscreen', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    settingsTui = 'fullscreen'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('official yMi: Windows over SSH auto-off', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    _setWindowsPlatformForTesting(true)
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    expect(isWindowsOverSSH()).toBe(true)
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('official yMi: NO_FLICKER=1 wins over Windows SSH auto-off', () => {
    _setWindowsPlatformForTesting(true)
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    process.env.CLAUDE_CODE_NO_FLICKER = '1'
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('official yMi: settings.tui=fullscreen cannot re-enable Win SSH', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    _setWindowsPlatformForTesting(true)
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    settingsTui = 'fullscreen'
    expect(isFullscreenEnvEnabled()).toBe(false)
  })

  test('official yMi: non-windows SSH stays on', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    _setWindowsPlatformForTesting(false)
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    expect(isWindowsOverSSH()).toBe(false)
    expect(isFullscreenEnvEnabled()).toBe(true)
  })

  test('t3e reason: ant_default when no env/settings/GB', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    settingsTui = undefined
    // P8t path (renderer) defaults on; densable xse → ant_default (tip default-on)
    expect(getFullscreenGateReason()).toMatch(/ant_default|default_on/)
  })

  test('t3e reason: env_off when NO_FLICKER=0', () => {
    process.env.CLAUDE_CODE_NO_FLICKER = '0'
    expect(getFullscreenGateReason()).toBe('env_off')
  })

  test('t3e reason: win_ssh_auto_off', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.TMUX
    _setWindowsPlatformForTesting(true)
    process.env.SSH_CONNECTION = '1.2.3.4 1234 5.6.7.8 22'
    expect(getFullscreenGateReason()).toBe('win_ssh_auto_off')
  })

  test('Qi feature gate: GB default false without force-on', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN
    delete process.env.CLAUDE_CODE_SESSION_KIND
    delete process.env.CLAUDE_CODE_ENTRYPOINT
    delete process.env.TMUX
    settingsTui = undefined
    // Without GB amber_creek / pewter_brook, feature gate is off
    expect(isFullscreenFeatureGateEnabled()).toBe(false)
  })

  test('Qi feature gate: bg session force-on', () => {
    process.env.CLAUDE_CODE_SESSION_KIND = 'bg'
    expect(isFullscreenFeatureGateEnabled()).toBe(true)
  })

  test('Qi feature gate: settings.tui=fullscreen force-on', () => {
    delete process.env.CLAUDE_CODE_NO_FLICKER
    delete process.env.CLAUDE_CODE_SESSION_KIND
    settingsTui = 'fullscreen'
    expect(isFullscreenFeatureGateEnabled()).toBe(true)
  })
})
