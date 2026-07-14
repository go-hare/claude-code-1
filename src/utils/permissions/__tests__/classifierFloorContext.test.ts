/**
 * Official 2.1.x: chrome/preview classifier floor fields on ToolPermissionContext
 * and canAutoClassifierRun lockstep with the auto-mode gate.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { getEmptyToolPermissionContext } from '../../../Tool.js'
import {
  getEffectivePermissionMode,
  parseMcpPermissionModeOverride,
} from '../mcpPermissionMode.js'

describe('getEmptyToolPermissionContext floor defaults', () => {
  test('includes empty mcpPermissionModeOverrides map', () => {
    const ctx = getEmptyToolPermissionContext()
    expect(ctx.mcpPermissionModeOverrides).toEqual({})
  })
})

describe('parseMcpPermissionModeOverride (WDu) control-channel contract', () => {
  test('null clears override', () => {
    expect(parseMcpPermissionModeOverride(null)).toEqual({
      ok: true,
      override: undefined,
    })
  })

  test('reject elevated modes (tighten-only)', () => {
    for (const mode of [
      'bypassPermissions',
      'acceptEdits',
      'dontAsk',
      'plan',
    ] as const) {
      expect(parseMcpPermissionModeOverride(mode)).toEqual({
        ok: false,
        rejected: mode,
      })
    }
  })
})

describe('classifier floor + canAutoClassifierRun integration', () => {
  const chromeTool = { mcpInfo: { serverName: 'claude-in-chrome' } }
  const previewTool = { mcpInfo: { serverName: 'Claude Preview' } }

  test('when canAutoClassifierRun is false, floor demotes to default', () => {
    expect(
      getEffectivePermissionMode(chromeTool, {
        mode: 'bypassPermissions',
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe('default')
  })

  test('when canAutoClassifierRun is true, floor demotes to auto', () => {
    expect(
      getEffectivePermissionMode(chromeTool, {
        mode: 'bypassPermissions',
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: true,
      }),
    ).toBe('auto')
  })

  test('preview floor is independent of chrome floor flag', () => {
    expect(
      getEffectivePermissionMode(previewTool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: true,
        previewClassifierFloorEnabled: false,
        canAutoClassifierRun: true,
      }),
    ).toBe('auto')
    expect(
      getEffectivePermissionMode(previewTool, {
        mode: 'auto',
        chromeClassifierFloorEnabled: false,
        previewClassifierFloorEnabled: true,
        canAutoClassifierRun: false,
      }),
    ).toBe('default')
  })

  test('per-server override still wins over floor', () => {
    expect(
      getEffectivePermissionMode(chromeTool, {
        mode: 'bypassPermissions',
        mcpPermissionModeOverrides: { 'claude-in-chrome': 'default' },
        chromeClassifierFloorEnabled: true,
        canAutoClassifierRun: true,
      }),
    ).toBe('default')
  })
})

describe('CLAUDE_*_CLASSIFIER_FLOOR env truthiness (mirrors init)', () => {
  const prevChrome = process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR
  const prevPreview = process.env.CLAUDE_PREVIEW_CLASSIFIER_FLOOR

  afterEach(() => {
    if (prevChrome === undefined) {
      delete process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR
    } else {
      process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = prevChrome
    }
    if (prevPreview === undefined) {
      delete process.env.CLAUDE_PREVIEW_CLASSIFIER_FLOOR
    } else {
      process.env.CLAUDE_PREVIEW_CLASSIFIER_FLOOR = prevPreview
    }
  })

  test('isEnvTruthy accepts 1/true for floor env vars', async () => {
    const { isEnvTruthy } = await import('../../envUtils.js')
    process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = '1'
    process.env.CLAUDE_PREVIEW_CLASSIFIER_FLOOR = 'true'
    expect(isEnvTruthy(process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR)).toBe(true)
    expect(isEnvTruthy(process.env.CLAUDE_PREVIEW_CLASSIFIER_FLOOR)).toBe(true)
    process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR = '0'
    expect(isEnvTruthy(process.env.CLAUDE_CHROME_CLASSIFIER_FLOOR)).toBe(false)
  })
})
