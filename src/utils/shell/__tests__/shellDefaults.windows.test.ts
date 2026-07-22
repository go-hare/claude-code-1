/**
 * Windows default shell: PowerShell tool on by default; ! routing prefers it.
 */
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from 'bun:test'
import * as realSettings from 'src/utils/settings/settings.js'
import * as realPlatform from 'src/utils/platform.js'
import {
  createSettingsMock,
  restoreSettingsMockWith,
  snapshotModuleExports,
} from '../../../../tests/mocks/settings.js'

const settingsState: { defaultShell?: 'bash' | 'powershell' } = {}

// Snapshot BEFORE mock — live namespace rebinds under Bun mock.module.
const settingsSnap = snapshotModuleExports(realSettings)
const platformSnap = snapshotModuleExports(realPlatform)
const realGetInitialSettings =
  settingsSnap.getInitialSettings as typeof realSettings.getInitialSettings

// Spread snapshot so co-running suites (processBashCommand, tui, etc.)
// keep the full surface under Bun process-global mock.module.
mock.module(
  'src/utils/settings/settings.js',
  createSettingsMock(settingsSnap, {
    getInitialSettings: () => ({
      ...realGetInitialSettings(),
      ...settingsState,
    }),
    getSettings_DEPRECATED: () => ({
      ...realGetInitialSettings(),
      ...settingsState,
    }),
  }),
)

// Force windows platform for these unit tests regardless of host OS.
// bashProvider.detached uses process.platform (not getPlatform) so this
// mock does not flip Unix detached in the same process.
mock.module('src/utils/platform.js', () => ({
  ...platformSnap,
  getPlatform: () => 'windows' as const,
}))
afterAll(() => {
  restoreSettingsMockWith(mock.module, settingsSnap, [
    'src/utils/settings/settings.js',
  ])
  mock.module('src/utils/platform.js', () => ({ ...platformSnap }))
})

import { isPowerShellToolEnabled } from '../shellToolUtils.js'
import { resolveDefaultShell } from '../resolveDefaultShell.js'

const ENV_KEY = 'CLAUDE_CODE_USE_POWERSHELL_TOOL'
let savedEnv: string | undefined

beforeEach(() => {
  savedEnv = process.env[ENV_KEY]
  delete process.env[ENV_KEY]
  delete settingsState.defaultShell
})

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = savedEnv
  delete settingsState.defaultShell
})

describe('isPowerShellToolEnabled (windows)', () => {
  test('enabled by default when env unset', () => {
    expect(isPowerShellToolEnabled()).toBe(true)
  })

  test('disabled when env is falsy', () => {
    process.env[ENV_KEY] = '0'
    expect(isPowerShellToolEnabled()).toBe(false)
    process.env[ENV_KEY] = 'false'
    expect(isPowerShellToolEnabled()).toBe(false)
  })

  test('enabled when env is truthy', () => {
    process.env[ENV_KEY] = '1'
    expect(isPowerShellToolEnabled()).toBe(true)
  })
})

describe('resolveDefaultShell (windows)', () => {
  test('defaults to powershell when tool enabled and no settings', () => {
    expect(resolveDefaultShell()).toBe('powershell')
  })

  test('honors settings.defaultShell=bash', () => {
    settingsState.defaultShell = 'bash'
    expect(resolveDefaultShell()).toBe('bash')
  })

  test('honors settings.defaultShell=powershell', () => {
    settingsState.defaultShell = 'powershell'
    expect(resolveDefaultShell()).toBe('powershell')
  })

  test('falls back to bash when PowerShell tool is disabled', () => {
    process.env[ENV_KEY] = '0'
    expect(resolveDefaultShell()).toBe('bash')
  })
})
