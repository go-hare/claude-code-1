/**
 * densable 2.1.239 H9b / P9b / cei / eya:
 *   H9b: CLAUDE_CODE_REMOTE==="true" && !CLAUDE_TRUSTED_DEVICE_TOKEN && iFn()
 *   iFn: GB tengu_sessions_elevated_auth_enforcement && eya("require_trusted_devices")
 *   eya: restrictions[policy].allowed === true
 *   P9b: Nothing was sent: Remote Control session '${name}' is ${cei}.
 */
import { afterAll, afterEach, describe, expect, mock, test } from 'bun:test'
import { snapshotModuleExports } from '../../../tests/mocks/settings.js'

const realGrowthbook = await import('../../services/analytics/growthbook.js')
const growthbookSnap = snapshotModuleExports(realGrowthbook)
let gateOn = false
mock.module('src/services/analytics/growthbook.js', () => ({
  ...growthbookSnap,
  getFeatureValue_CACHED_MAY_BE_STALE: (key: string, fallback: unknown) => {
    if (key === 'tengu_sessions_elevated_auth_enforcement') return gateOn
    return growthbookSnap.getFeatureValue_CACHED_MAY_BE_STALE?.(key, fallback)
  },
}))

const {
  CLOUD_CANNOT_REACH_ELEVATED_HINT,
  formatUnreachableElevatedRefusal,
  isRemoteControlPeerUnreachableFromHere,
} = await import('../trustedDevice.js')

afterAll(() => {
  mock.module('src/services/analytics/growthbook.js', () => ({
    ...growthbookSnap,
  }))
})

const prevRemote = process.env.CLAUDE_CODE_REMOTE
const prevToken = process.env.CLAUDE_TRUSTED_DEVICE_TOKEN

afterEach(() => {
  gateOn = false
  if (prevRemote === undefined) delete process.env.CLAUDE_CODE_REMOTE
  else process.env.CLAUDE_CODE_REMOTE = prevRemote
  if (prevToken === undefined) delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
  else process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = prevToken
})

describe('densable 2.1.239 H9b / P9b elevated RC unreachable', () => {
  test('P9b uses cei hint and display name', () => {
    expect(formatUnreachableElevatedRefusal('alpha')).toBe(
      `Nothing was sent: Remote Control session 'alpha' is ${CLOUD_CANNOT_REACH_ELEVATED_HINT}.`,
    )
    expect(CLOUD_CANNOT_REACH_ELEVATED_HINT).toContain(
      'not reachable from a cloud session',
    )
  })

  test('H9b stays false after policyLimits product-cut (iFn never enforces)', () => {
    delete process.env.CLAUDE_CODE_REMOTE
    delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
    gateOn = true
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)

    process.env.CLAUDE_CODE_REMOTE = 'true'
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)

    process.env.CLAUDE_TRUSTED_DEVICE_TOKEN = 'tok'
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)
  })

  test('H9b does not treat CLAUDE_CODE_REMOTE=1 as official ===true', () => {
    process.env.CLAUDE_CODE_REMOTE = '1'
    delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
    gateOn = true
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)
  })

  test('iFn product-cut never makes peer unreachable', () => {
    process.env.CLAUDE_CODE_REMOTE = 'true'
    delete process.env.CLAUDE_TRUSTED_DEVICE_TOKEN
    gateOn = false
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)
    gateOn = true
    expect(isRemoteControlPeerUnreachableFromHere()).toBe(false)
  })
})
