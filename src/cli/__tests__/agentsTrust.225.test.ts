/**
 * densable 2.1.225 #2 — agentsTrustDecision / DTt early-outs.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test'

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
  checkHasTrustDialogAccepted: checkHasTrustDialogAcceptedMock,
}))
mock.module('../../bootstrap/state.js', () => ({
  setSessionTrustAccepted: mock(() => {}),
  getSessionTrustAccepted: getSessionTrustAcceptedMock,
}))
mock.module('../../utils/sessionRoleEnv.js', () => ({
  isSandboxedSession: isSandboxedSessionMock,
}))
mock.module('../../utils/concurrentSessions.js', () => ({
  isBgSession: isBgSessionMock,
}))
mock.module('../../utils/cwd.js', () => ({
  getCwd: getCwdMock,
}))
mock.module('../../utils/settings/settings.js', () => ({
  getSettingsForSource: getSettingsForSourceMock,
}))
mock.module('../../utils/settings/constants.js', () => ({
  getEnabledSettingSources: getEnabledSettingSourcesMock,
}))

import {
  agentsTrustDecision,
  agentsWorkspaceTrustNeedsReask,
} from '../agentsTrust.js'

describe('densable 2.1.225 agentsTrustDecision', () => {
  afterEach(() => {
    checkHasTrustDialogAcceptedMock.mockReset()
    getSessionTrustAcceptedMock.mockReset()
    isSandboxedSessionMock.mockReset()
    isBgSessionMock.mockReset()
    getCwdMock.mockReset()
    getEnabledSettingSourcesMock.mockReset()
    getSettingsForSourceMock.mockReset()
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
