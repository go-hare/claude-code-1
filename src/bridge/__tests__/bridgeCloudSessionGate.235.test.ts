/**
 * densable 2.1.235 vqo/mX — Remote Control denied inside CLAUDE_CODE_REMOTE.
 *
 * Tests the pure mX helper (feature('BRIDGE_MODE') is compile-time in bun:bundle).
 */
import { describe, expect, test } from 'bun:test'
import {
  BRIDGE_DISABLED_IN_CLOUD_SESSION,
  getBridgeDisabledReasonForCloudSession,
} from '../bridgeEnabled.js'

describe('getBridgeDisabledReasonForCloudSession (2.1.235 mX)', () => {
  test('exact densable denial string', () => {
    expect(BRIDGE_DISABLED_IN_CLOUD_SESSION).toBe(
      'Remote Control is not available inside a cloud session.',
    )
  })

  test('CLAUDE_CODE_REMOTE=true → cloud denial', () => {
    expect(
      getBridgeDisabledReasonForCloudSession({ CLAUDE_CODE_REMOTE: 'true' }),
    ).toBe(BRIDGE_DISABLED_IN_CLOUD_SESSION)
  })

  test('CLAUDE_CODE_REMOTE=1 → cloud denial', () => {
    expect(
      getBridgeDisabledReasonForCloudSession({ CLAUDE_CODE_REMOTE: '1' }),
    ).toBe(BRIDGE_DISABLED_IN_CLOUD_SESSION)
  })

  test('unset → null', () => {
    expect(getBridgeDisabledReasonForCloudSession({})).toBeNull()
  })

  test('falsy remote → null', () => {
    expect(
      getBridgeDisabledReasonForCloudSession({ CLAUDE_CODE_REMOTE: '0' }),
    ).toBeNull()
  })
})
