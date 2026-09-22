/**
 * densable 2.1.248 #15 T() @191847905 sha=cf8fc01922dce784 —
 * skip is IS_DEMO | CLAUBBIT only. Me(!1) is always false; CI does not skip.
 *
 * Bun mock.module is process-global: spread pre-mock snapshots and restore
 * in afterAll (same contract as agentsTrust.225.test.ts).
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

import { agentsTrustDecision } from '../agentsTrust.js'

describe('densable 2.1.248 #15 agentsTrustDecision T()', () => {
  afterEach(() => {
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

  test('CI=1 does not skip', () => {
    process.env.CI = '1'
    expect(agentsTrustDecision()).not.toBe('skip')
    expect(agentsTrustDecision()).toBe('ask')
    checkHasTrustDialogAcceptedMock.mockReturnValue(true)
    expect(agentsTrustDecision()).toBe('trusted')
  })

  test('IS_DEMO still skip', () => {
    process.env.IS_DEMO = '1'
    expect(agentsTrustDecision()).toBe('skip')
  })

  test('CLAUBBIT still skip', () => {
    process.env.CLAUBBIT = '1'
    expect(agentsTrustDecision()).toBe('skip')
  })
})
