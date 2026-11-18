import { describe, expect, test } from 'bun:test'
import { getFilteredSettingsEnv } from '../managedEnv.js'
import {
  isProjectScopeBlockedEnvVar,
  PROJECT_SCOPE_BLOCKED_ENV_VARS,
  stripProjectScopeBlockedEnv,
} from '../managedEnvConstants.js'

describe('PROJECT_SCOPE_BLOCKED_ENV_VARS (#142, #159)', () => {
  test('contains expected security-sensitive env vars', () => {
    expect(
      PROJECT_SCOPE_BLOCKED_ENV_VARS.has('CLAUDE_CODE_DISABLE_ATTACHMENTS'),
    ).toBe(true)
    expect(PROJECT_SCOPE_BLOCKED_ENV_VARS.has('CLAUDE_CODE_ENABLE_CFC')).toBe(
      true,
    )
    expect(
      PROJECT_SCOPE_BLOCKED_ENV_VARS.has('CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS'),
    ).toBe(true)
  })

  test('#159 strips CLAUDE_CODE_DISABLE_ATTACHMENTS from projectSettings and localSettings', () => {
    const env = {
      CLAUDE_CODE_DISABLE_ATTACHMENTS: '1',
      FOO: 'bar',
    }
    expect(stripProjectScopeBlockedEnv(env, 'projectSettings')).toEqual({
      FOO: 'bar',
    })
    expect(stripProjectScopeBlockedEnv(env, 'localSettings')).toEqual({
      FOO: 'bar',
    })
    expect(getFilteredSettingsEnv(env, 'projectSettings')).toEqual({
      FOO: 'bar',
    })
    // User/policy settings are NOT stripped
    expect(stripProjectScopeBlockedEnv(env, 'userSettings')).toEqual(env)
    expect(stripProjectScopeBlockedEnv(env, 'policySettings')).toEqual(env)
  })

  test('#142 strips CLAUDE_CODE_ENABLE_CFC=1 from project/local but allows 0/false', () => {
    expect(isProjectScopeBlockedEnvVar('CLAUDE_CODE_ENABLE_CFC', '1')).toBe(
      true,
    )
    expect(isProjectScopeBlockedEnvVar('CLAUDE_CODE_ENABLE_CFC', 'true')).toBe(
      true,
    )
    expect(isProjectScopeBlockedEnvVar('CLAUDE_CODE_ENABLE_CFC', '0')).toBe(
      false,
    )
    expect(isProjectScopeBlockedEnvVar('CLAUDE_CODE_ENABLE_CFC', 'false')).toBe(
      false,
    )

    expect(
      stripProjectScopeBlockedEnv(
        { CLAUDE_CODE_ENABLE_CFC: '1', SAFE: 'ok' },
        'projectSettings',
      ),
    ).toEqual({ SAFE: 'ok' })
    expect(
      stripProjectScopeBlockedEnv(
        { CLAUDE_CODE_ENABLE_CFC: '0', SAFE: 'ok' },
        'projectSettings',
      ),
    ).toEqual({ CLAUDE_CODE_ENABLE_CFC: '0', SAFE: 'ok' })
  })

  test('blocks CLAUDE_AX_* prefix and allows safe exceptions (V1o / jdi)', () => {
    expect(isProjectScopeBlockedEnvVar('CLAUDE_AX_ANYTHING', '1')).toBe(true)
    expect(
      isProjectScopeBlockedEnvVar('CLAUDE_CHROME_PERMISSION_MODE', 'ask'),
    ).toBe(false)
    expect(
      isProjectScopeBlockedEnvVar('CLAUDE_CHROME_PERMISSION_MODE', 'auto'),
    ).toBe(true)
    expect(
      isProjectScopeBlockedEnvVar('CLAUDE_CODE_MODEL_CATALOG', 'off'),
    ).toBe(false)
    expect(isProjectScopeBlockedEnvVar('CLAUDE_CODE_MODEL_CATALOG', 'on')).toBe(
      true,
    )
    expect(
      isProjectScopeBlockedEnvVar('CLAUDE_CODE_DISABLE_WEB_FETCH', '1'),
    ).toBe(false)
    expect(
      isProjectScopeBlockedEnvVar('CLAUDE_CODE_DISABLE_WEB_FETCH', '0'),
    ).toBe(true)
  })
})
