import { beforeEach, describe, expect, mock, test } from 'bun:test'

let mockSettings: {
  enabledMcpjsonServers?: string[]
  disabledMcpjsonServers?: string[]
  enableAllProjectMcpServers?: boolean
} = {}
let nonInteractive = false
let skipDangerous = false

mock.module('src/utils/settings/settings.js', () => ({
  getSettings_DEPRECATED: () => mockSettings,
  hasSkipDangerousModePermissionPrompt: () => skipDangerous,
}))

mock.module('src/bootstrap/state.js', () => ({
  getIsNonInteractiveSession: () => nonInteractive,
}))

mock.module('src/utils/settings/constants.js', () => ({
  isSettingSourceEnabled: () => true,
}))

const { getProjectMcpServerStatus, getProjectMcpServerStatusStrict } =
  await import('../utils.js')

describe('project MCP approval status', () => {
  beforeEach(() => {
    mockSettings = {}
    nonInteractive = false
    skipDangerous = false
  })

  test('strict status stays pending without settings approval', () => {
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
  })

  test('strict status is approved when enableAllProjectMcpServers', () => {
    mockSettings = { enableAllProjectMcpServers: true }
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('approved')
  })

  test('strict status is rejected when listed in disabledMcpjsonServers', () => {
    mockSettings = { disabledMcpjsonServers: ['evil-server'] }
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('rejected')
  })

  test('runtime status can auto-approve in non-interactive sessions', () => {
    nonInteractive = true
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
    expect(getProjectMcpServerStatus('evil-server')).toBe('approved')
  })

  test('runtime status can auto-approve with skip-dangerous prompt', () => {
    skipDangerous = true
    expect(getProjectMcpServerStatusStrict('evil-server')).toBe('pending')
    expect(getProjectMcpServerStatus('evil-server')).toBe('approved')
  })
})
