import { describe, expect, test } from 'bun:test'
import { resolveChromeBridgeTransportEnabled } from '../chromeBridgeTransport.js'

describe('resolveChromeBridgeTransportEnabled', () => {
  test('false when flag off', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: false,
        flagOn: false,
        localBridge: false,
        hasAccessToken: true,
      }),
    ).toBe(false)
  })

  test('false when flag on but no OAuth token (fork local path)', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: false,
        flagOn: true,
        localBridge: false,
        hasAccessToken: false,
      }),
    ).toBe(false)
  })

  test('true when flag on and OAuth token present', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: false,
        flagOn: true,
        localBridge: false,
        hasAccessToken: true,
      }),
    ).toBe(true)
  })

  test('FORCE_NATIVE wins even with token + flag', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: true,
        flagOn: true,
        localBridge: false,
        hasAccessToken: true,
      }),
    ).toBe(false)
  })

  test('LOCAL_BRIDGE allows bridge without OAuth', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: false,
        flagOn: true,
        localBridge: true,
        hasAccessToken: false,
      }),
    ).toBe(true)
  })

  test('ant-style flagOn without token still falls back to native', () => {
    expect(
      resolveChromeBridgeTransportEnabled({
        forceNative: false,
        flagOn: true, // USER_TYPE=ant
        localBridge: false,
        hasAccessToken: false,
      }),
    ).toBe(false)
  })
})
