/**
 * densable 2.1.246 — unarchive elevated_auth fails without minting or
 * tombstoning the pointer (vfs + MCc + kz).
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  formatBridgeCredentialFailure,
  SESSION_STALE_RELOGIN_DETAIL,
  UNTRUSTED_DEVICE_HINT,
} from '../codeSessionApi.js'

const core = readFileSync(
  join(import.meta.dir, '../remoteBridgeCore.ts'),
  'utf8',
)
const api = readFileSync(join(import.meta.dir, '../codeSessionApi.ts'), 'utf8')

describe('densable 2.1.246 unarchive elevated_auth', () => {
  test('E2d returns 403 resource tokens', () => {
    expect(api).toContain("resource === 'untrusted_device'")
    expect(api).toContain("resource === 'session_stale_relogin'")
  })

  test('vfs maps tokens to elevated_auth and retries untrusted_device once', () => {
    expect(core).toContain("outcome: 'elevated_auth'")
    expect(core).toContain('bridge_repl_v2_unarchive_elevated_auth')
    expect(core).toContain('enrollTrustedDevice()')
    expect(core).toContain('clearTrustedDeviceTokenCache()')
  })

  test('MCc fails terminally and preserves the pointer', () => {
    expect(core).toContain("outcome === 'elevated_auth'")
    expect(core).toContain('unarchive elevated-auth (')
    expect(core).toContain('surfacing auth failure, pointer preserved')
    expect(core).toContain('bridge_repl_v2_reattach_elevated_auth')
    expect(core).toContain('v2_reattach_elevated_auth')
    expect(core).toContain('bridge_connect_reattach_elevated_auth')
    expect(core).toContain('isTrustedDeviceActiveForOrg()')
    expect(core).toContain('formatBridgeCredentialFailure')
    const elevatedIdx = core.indexOf("outcome === 'elevated_auth'")
    const goneFailIdx = core.indexOf("outcome === 'gone' && reattachOrFail")
    expect(elevatedIdx).toBeGreaterThan(-1)
    expect(goneFailIdx).toBeGreaterThan(elevatedIdx)
    const slice = core.slice(elevatedIdx, goneFailIdx)
    expect(slice).toContain('return null')
    expect(slice).not.toContain('mintFreshSession')
    expect(slice).not.toContain('onReattachPointerDead')
    expect(slice).not.toContain('onReattachGoneBounce')
  })

  test('kz copy is 1:1', () => {
    expect(UNTRUSTED_DEVICE_HINT).toBe(
      'this device is not enrolled as a trusted device; run /login to enroll',
    )
    expect(SESSION_STALE_RELOGIN_DETAIL).toBe(
      'session expired for trusted-device check — run /login to re-authenticate',
    )
    expect(
      formatBridgeCredentialFailure({
        terminal: true,
        reason: 'untrusted_device',
      }),
    ).toBe(UNTRUSTED_DEVICE_HINT)
    expect(
      formatBridgeCredentialFailure({
        terminal: true,
        reason: 'session_stale_relogin',
      }),
    ).toBe(SESSION_STALE_RELOGIN_DETAIL)
    expect(
      formatBridgeCredentialFailure({
        terminal: true,
        reason: 'request_rejected',
        status: 403,
      }),
    ).toBe(
      'Remote Control server rejected the request (HTTP 403) — run /remote-control to retry',
    )
  })
})
