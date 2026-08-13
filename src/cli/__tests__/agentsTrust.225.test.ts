/**
 * densable 2.1.225 #2 — agentsTrustDecision / DTt early-outs.
 *
 * Bun mock.module is process-global: always spread pre-mock snapshots and
 * restore in afterAll. Incomplete cwd/settings/bootstrap stubs poison
 * pathGlob/cd/getDefaultOpusModel co-suites (getCwd() → undefined after
 * mockReset; getInitialSettings missing → settings.modelType TypeError).
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import * as realConfig from '../../utils/config.js'
import * as realBootstrap from '../../bootstrap/state.js'
import * as realSessionRoleEnv from '../../utils/sessionRoleEnv.js'
import * as realConcurrentSessions from '../../utils/concurrentSessions.js'
import * as realCwd from '../../utils/cwd.js'
import * as realSettings from '../../utils/settings/settings.js'
import * as realSettingsConstants from '../../utils/settings/constants.js'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const configSnap = snapshotModuleExports(realConfig)
const bootstrapSnap = snapshotModuleExports(realBootstrap)
const sessionRoleSnap = snapshotModuleExports(realSessionRoleEnv)
const concurrentSnap = snapshotModuleExports(realConcurrentSessions)
const cwdSnap = snapshotModuleExports(realCwd)
const settingsSnap = snapshotModuleExports(realSettings)
const settingsConstSnap = snapshotModuleExports(realSettingsConstants)

const checkHasTrustDialogAcceptedMock = mock(() => false)
const getSessionTrustAcceptedMock = mock(() => false)
const isSandboxedSessionMock = mock(() => false)
const isBgSessionMock = mock(() => false)
const getCwdMock = mock(() => '/tmp/project')
const getEnabledSettingSourcesMock = mock(
  () => [] as Array<'projectSettings' | 'localSettings'>,
)
const getSettingsForSourceMock = mock(
  () =>
    null as null | {
      permissions?: { allow?: string[]; additionalDirectories?: string[] }
    },
)

mock.module('../../utils/config.js', () => ({
  ...configSnap,
  checkHasTrustDialogAccepted: checkHasTrustDialogAcceptedMock,
}))
mock.module('../../bootstrap/state.js', () => ({
  ...bootstrapSnap,
  setSessionTrustAccepted: mock(() => {}),
  getSessionTrustAccepted: getSessionTrustAcceptedMock,
}))
mock.module('../../utils/sessionRoleEnv.js', () => ({
  ...sessionRoleSnap,
  isSandboxedSession: isSandboxedSessionMock,
}))
mock.module('../../utils/concurrentSessions.js', () => ({
  ...concurrentSnap,
  isBgSession: isBgSessionMock,
}))
mock.module('../../utils/cwd.js', () => ({
  ...cwdSnap,
  getCwd: getCwdMock,
}))
mock.module('../../utils/settings/settings.js', () => ({
  ...settingsSnap,
  getSettingsForSource: getSettingsForSourceMock,
}))
mock.module('../../utils/settings/constants.js', () => ({
  ...settingsConstSnap,
  getEnabledSettingSources: getEnabledSettingSourcesMock,
}))

afterAll(() => {
  mock.module('../../utils/config.js', () => ({ ...configSnap }))
  mock.module('../../bootstrap/state.js', () => ({ ...bootstrapSnap }))
  mock.module('../../utils/sessionRoleEnv.js', () => ({ ...sessionRoleSnap }))
  mock.module('../../utils/concurrentSessions.js', () => ({
    ...concurrentSnap,
  }))
  mock.module('../../utils/cwd.js', () => ({ ...cwdSnap }))
  mock.module('../../utils/settings/settings.js', () => ({ ...settingsSnap }))
  mock.module('../../utils/settings/constants.js', () => ({
    ...settingsConstSnap,
  }))
})

import {
  agentsTrustDecision,
  agentsWorkspaceTrustNeedsReask,
} from '../agentsTrust.js'

describe('densable 2.1.225 agentsTrustDecision', () => {
  afterEach(() => {
    // mockReset clears implementations → co-suites would see undefined getCwd.
    // Re-seed defaults after clear.
    checkHasTrustDialogAcceptedMock.mockReset()
    checkHasTrustDialogAcceptedMock.mockReturnValue(false)
    getSessionTrustAcceptedMock.mockReset()
    getSessionTrustAcceptedMock.mockReturnValue(false)
    isSandboxedSessionMock.mockReset()
    isSandboxedSessionMock.mockReturnValue(false)
    isBgSessionMock.mockReset()
    isBgSessionMock.mockReturnValue(false)
    getCwdMock.mockReset()
    getCwdMock.mockReturnValue('/tmp/project')
    getEnabledSettingSourcesMock.mockReset()
    getEnabledSettingSourcesMock.mockReturnValue([])
    getSettingsForSourceMock.mockReset()
    getSettingsForSourceMock.mockReturnValue(null)
    delete process.env.CI
    delete process.env.IS_DEMO
    delete process.env.CLAUBBIT
  })

  test('CI → skip', () => {
    process.env.CI = '1'
    expect(agentsTrustDecision()).toBe('skip')
  })

  test('trusted when dialog accepted and no reask surface', () => {
    checkHasTrustDialogAcceptedMock.mockReturnValue(true)
    getSessionTrustAcceptedMock.mockReturnValue(false)
    isSandboxedSessionMock.mockReturnValue(false)
    isBgSessionMock.mockReturnValue(false)
    getEnabledSettingSourcesMock.mockReturnValue([])
    expect(agentsWorkspaceTrustNeedsReask()).toBe(false)
    expect(agentsTrustDecision()).toBe('trusted')
  })

  test('ask when dialog not accepted', () => {
    checkHasTrustDialogAcceptedMock.mockReturnValue(false)
    getEnabledSettingSourcesMock.mockReturnValue([])
    expect(agentsTrustDecision()).toBe('ask')
  })

  test('DTt reask when projectSettings has allow rules', () => {
    checkHasTrustDialogAcceptedMock.mockReturnValue(true)
    getSessionTrustAcceptedMock.mockReturnValue(false)
    isSandboxedSessionMock.mockReturnValue(false)
    isBgSessionMock.mockReturnValue(false)
    getEnabledSettingSourcesMock.mockReturnValue(['projectSettings'])
    getSettingsForSourceMock.mockReturnValue({
      permissions: { allow: ['Bash(*)'] },
    })
    expect(agentsWorkspaceTrustNeedsReask()).toBe(true)
    expect(agentsTrustDecision()).toBe('ask')
  })
})
