import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  clearGrowthBookConfigOverrides,
  setGrowthBookConfigOverride,
} from '../../../services/analytics/growthbook.js'
import type { ToolPermissionContext } from '../../../Tool.js'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  clearCommandScopedAllowRules,
  getAutoModeUnavailableReason,
  resolveChromeClassifierFloorEnabled,
  restoreDangerousPermissions,
} from '../permissionSetup.js'

describe('Permissions 2.1.292-2.1.296 alignment', () => {
  const prevRemote = process.env.CLAUDE_CODE_REMOTE
  const prevFloor = process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR
    clearGrowthBookConfigOverrides()
  })

  afterEach(() => {
    if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
    else process.env.CLAUDE_CODE_REMOTE = prevRemote
    if (prevFloor === undefined)
      delete process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR
    else process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = prevFloor
    clearGrowthBookConfigOverrides()
  })

  test('#199: getAutoModeUnavailableReason accepts optional model argument', () => {
    // In bun:test without TRANSCRIPT_CLASSIFIER feature, returns 'model' (or 'settings' if disabled)
    const reason = getAutoModeUnavailableReason('claude-haiku-4-5-20251001')
    expect(reason).not.toBeNull()
  })

  test('#206: clearCommandScopedAllowRules clears alwaysAllowRules.command and strippedDangerousRules.command', () => {
    const base: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      alwaysAllowRules: {
        userSettings: ['Read'],
        command: ['Bash(git:*)', 'Write'],
      },
      strippedDangerousRules: {
        userSettings: ['Bash(*)'],
        command: ['Bash(*)'],
      },
    }

    const cleared = clearCommandScopedAllowRules(base)
    expect(cleared.alwaysAllowRules.command).toBeUndefined()
    expect(cleared.alwaysAllowRules.userSettings).toEqual(['Read'])
    expect(cleared.strippedDangerousRules?.command).toBeUndefined()
    expect(cleared.strippedDangerousRules?.userSettings).toEqual(['Bash(*)'])

    // No-op when neither command rule is present
    expect(clearCommandScopedAllowRules(cleared)).toBe(cleared)
  })

  test('#206: restoreDangerousPermissions does not leak strippedDangerousRules.command', () => {
    const base: ToolPermissionContext = {
      ...getEmptyToolPermissionContext(),
      strippedDangerousRules: {
        userSettings: ['Bash(python:*)'],
        command: ['Bash(*)'] as unknown as string[],
      },
    }
    const restored = restoreDangerousPermissions(base)
    expect(restored.alwaysAllowRules.userSettings).toContain('Bash(python:*)')
    expect(restored.alwaysAllowRules.command).toBeUndefined()
    expect(restored.strippedDangerousRules).toBeUndefined()
  })

  test('#514: resolveChromeClassifierFloorEnabled fails closed (true) in remote sessions when flag not loaded', () => {
    // Non-remote: defaults to false when flag not loaded
    expect(resolveChromeClassifierFloorEnabled()).toBe(false)

    // Remote session without payload: fails closed to true
    process.env.CLAUDE_CODE_REMOTE = '1'
    expect(resolveChromeClassifierFloorEnabled()).toBe(true)

    // Explicit env override takes precedence
    process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = '0'
    expect(resolveChromeClassifierFloorEnabled()).toBe(false)
    process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = '1'
    expect(resolveChromeClassifierFloorEnabled()).toBe(true)
    delete process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR

    // GrowthBook override (not 'payload' source) still keeps safe=true in remote mode
    setGrowthBookConfigOverride('tengu_cowork_chrome_automode_default', false)
    expect(resolveChromeClassifierFloorEnabled()).toBe(true)
  })
})
