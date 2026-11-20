import { afterEach, describe, expect, test } from 'bun:test'
import {
  getDesktopHostAppVersion,
  shouldResendWorkflowProgress,
} from '../taskProgressBridge.js'

const prevVersion = process.env.CLAUDE_CODE_DESKTOP_APP_VERSION
const prevEntrypoint = process.env.CLAUDE_CODE_ENTRYPOINT

afterEach(() => {
  if (prevVersion === undefined) {
    delete process.env.CLAUDE_CODE_DESKTOP_APP_VERSION
  } else {
    process.env.CLAUDE_CODE_DESKTOP_APP_VERSION = prevVersion
  }
  if (prevEntrypoint === undefined) {
    delete process.env.CLAUDE_CODE_ENTRYPOINT
  } else {
    process.env.CLAUDE_CODE_ENTRYPOINT = prevEntrypoint
  }
})

describe('Round 3 Fix 4: BH3-P1-9 claude-desktop-3p Desktop Host App Version', () => {
  test('getDesktopHostAppVersion returns version for claude-desktop-3p', () => {
    process.env.CLAUDE_CODE_DESKTOP_APP_VERSION = '6.7665.0'
    expect(getDesktopHostAppVersion('claude-desktop-3p')).toBe('6.7665.0')
    expect(getDesktopHostAppVersion('claude-desktop')).toBe('6.7665.0')
    expect(getDesktopHostAppVersion('local-agent')).toBe('6.7665.0')
    expect(getDesktopHostAppVersion('desktop')).toBe('6.7665.0')
    expect(getDesktopHostAppVersion('cli')).toBeUndefined()
  })

  test('shouldResendWorkflowProgress respects CLAUDE_CODE_DESKTOP_APP_VERSION for claude-desktop-3p', () => {
    process.env.CLAUDE_CODE_DESKTOP_APP_VERSION = '6.7665.0'
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: 4_000_000,
        entrypoint: 'claude-desktop-3p',
      }),
    ).toBe(true)

    process.env.CLAUDE_CODE_DESKTOP_APP_VERSION = '6.7000.0'
    expect(
      shouldResendWorkflowProgress({
        isNonInteractive: true,
        elapsedSinceLastProgressMs: 4_000_000,
        entrypoint: 'claude-desktop-3p',
      }),
    ).toBe(false)
  })
})
