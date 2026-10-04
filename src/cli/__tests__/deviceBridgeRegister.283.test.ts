/**
 * densable 2.1.283 leftover unique wrap — gold `xgt` remaining skip BODY.
 * Locks 3 skip strings, started fields, feature_bad error_code, Di copy.
 * No WebSocket fleet. No fake connected.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  attachAnalyticsSink,
  _resetForTesting,
} from '../../services/analytics/index.js'
import {
  DEVICE_BRIDGE_SKIPPED_EGRESS,
  DEVICE_BRIDGE_SKIPPED_TRUSTED,
  logDeviceBridgeStarted,
  noteBridgeTrustedDevicesRequired,
  SERVING_OFF_BRIDGE_TRUSTED_DEVICES,
  SERVED_BRIDGE_TRUSTED_DEVICES_NOTICE,
  startDeviceBridgeRegistration,
  startMnDeviceBridgeRegistration,
} from '../deviceBridgeRegister.js'

const SRC = readFileSync(
  join(import.meta.dir, '../deviceBridgeRegister.ts'),
  'utf8',
)

const recorded: Array<{
  eventName: string
  metadata: Record<string, boolean | number | string | undefined>
}> = []

function installSink(): void {
  _resetForTesting()
  recorded.length = 0
  attachAnalyticsSink({
    logEvent(eventName, metadata) {
      recorded.push({ eventName, metadata })
    },
    async logEventAsync(eventName, metadata) {
      recorded.push({ eventName, metadata })
    },
  })
}

afterEach(() => {
  _resetForTesting()
  recorded.length = 0
})

const resolvedAccount = async () => ({
  status: 'resolved' as const,
  accountUuid: 'acct-1',
  source: 'stored' as const,
})

describe('densable 2.1.283 deviceBridgeRegister leftover xgt wrap', () => {
  test('source locks 3 skip strings, started fields, feature_bad, Di copy', () => {
    expect(SRC).toContain(DEVICE_BRIDGE_SKIPPED_EGRESS)
    expect(SRC).toContain(DEVICE_BRIDGE_SKIPPED_TRUSTED)
    expect(SRC).toContain('[deviceBridge] skipped:')
    expect(SRC).toContain('no org')
    expect(DEVICE_BRIDGE_SKIPPED_EGRESS).toBe(
      '[deviceBridge] skipped: non-essential egress disabled, non-first-party provider, or remote sessions policy-denied',
    )
    expect(DEVICE_BRIDGE_SKIPPED_TRUSTED).toBe(
      '[deviceBridge] skipped: the bridge cannot check a device proof and trusted devices are required or unknown',
    )
    expect(SERVING_OFF_BRIDGE_TRUSTED_DEVICES).toBe(
      "This computer's tools are not offered to your cloud session over the device bridge. The bridge cannot check a device's proof, and trusted devices may be required for your organization or could not be checked. Remove the off switch for the session channel from your environment to serve over it instead.",
    )
    expect(SRC).toContain('serving_off.bridge_trusted_devices')
    expect(SRC).toContain('tengu_device_bridge_started')
    expect(SRC).toContain('transport')
    expect(SRC).toContain('redial')
    expect(SRC).toContain('readiness_wait_ms')
    expect(SRC).toContain('device_bridge_register')
    expect(SRC).toContain('trusted_devices_required_or_unknown')
    expect(SRC).toContain('tengu_feature_bad')
    expect(SRC).toContain('served-bridge-trusted-devices')
    expect(SRC).toContain('[remote-tools] ${code}: ${message}')
    expect(SRC).not.toContain('new WebSocket')
    expect(SRC).not.toContain('globalThis.WebSocket')
    expect(SRC).not.toContain("from './cloudSession.js'")
    expect(SRC).not.toContain("logEvent('tengu_device_bridge_connected'")
    expect(SRC).not.toContain('CLAUDE_CODE_NO_DEVICE_PROOF')
    expect(SRC).not.toContain('tengu_violin_amati')
  })

  test('logDeviceBridgeStarted includes transport/redial/readiness_wait_ms', () => {
    installSink()
    logDeviceBridgeStarted({
      account_source: 'stored',
      transport: 'bridge',
      redial: false,
      readiness_wait_ms: 12,
    })
    expect(recorded).toEqual([
      {
        eventName: 'tengu_device_bridge_started',
        metadata: {
          account_source: 'stored',
          transport: 'bridge',
          redial: false,
          readiness_wait_ms: 12,
        },
      },
    ])
  })

  test('noteBridgeTrustedDevicesRequired logs feature_bad + Di copy', () => {
    installSink()
    const notices: Array<[string, string]> = []
    noteBridgeTrustedDevicesRequired((code, message) => {
      notices.push([code, message])
    })
    expect(recorded).toEqual([
      {
        eventName: 'tengu_feature_bad',
        metadata: {
          feature_name: 'device_bridge_register',
          error_code: 'trusted_devices_required_or_unknown',
        },
      },
    ])
    expect(notices).toEqual([
      [
        SERVED_BRIDGE_TRUSTED_DEVICES_NOTICE,
        SERVING_OFF_BRIDGE_TRUSTED_DEVICES,
      ],
    ])
  })

  test('Wd off skips with no started event', async () => {
    installSink()
    const reg = startDeviceBridgeRegistration({
      sessionId: 'session_1',
      orgUuid: 'org-1',
      isEnabled: async () => false,
      isEgressAllowed: () => true,
      getAccount: resolvedAccount,
    })
    expect(await reg.started).toBe(false)
    expect(
      recorded.some(e => e.eventName === 'tengu_device_bridge_started'),
    ).toBe(false)
  })

  test('Moe egress skip uses DEVICE_BRIDGE_SKIPPED_EGRESS', async () => {
    installSink()
    const reg = startDeviceBridgeRegistration({
      sessionId: 'session_1',
      orgUuid: 'org-1',
      isEnabled: async () => true,
      isEgressAllowed: () => false,
      getAccount: resolvedAccount,
    })
    expect(await reg.started).toBe(false)
    expect(recorded).toEqual([])
  })

  test('bridge+tMr skip logs feature_bad and onNotice Di copy', async () => {
    installSink()
    const notices: Array<[string, string]> = []
    const reg = startDeviceBridgeRegistration({
      sessionId: 'session_1',
      orgUuid: 'org-1',
      transport: 'bridge',
      isEnabled: async () => true,
      isEgressAllowed: () => true,
      isBridgeRefused: () => true,
      getAccount: resolvedAccount,
      onNotice: (code, message) => notices.push([code, message]),
    })
    expect(await reg.started).toBe(false)
    expect(recorded).toEqual([
      {
        eventName: 'tengu_feature_bad',
        metadata: {
          feature_name: 'device_bridge_register',
          error_code: 'trusted_devices_required_or_unknown',
        },
      },
    ])
    expect(notices).toEqual([
      [
        SERVED_BRIDGE_TRUSTED_DEVICES_NOTICE,
        SERVING_OFF_BRIDGE_TRUSTED_DEVICES,
      ],
    ])
    expect(
      recorded.some(e => e.eventName === 'tengu_device_bridge_connected'),
    ).toBe(false)
  })

  test('missing org logs tengu_device_bridge_skipped', async () => {
    installSink()
    const reg = startDeviceBridgeRegistration({
      sessionId: 'session_1',
      isEnabled: async () => true,
      isEgressAllowed: () => true,
      getAccount: resolvedAccount,
    })
    expect(await reg.started).toBe(false)
    expect(recorded).toEqual([
      {
        eventName: 'tengu_device_bridge_skipped',
        metadata: {
          missing_org: true,
          missing_account: false,
          account_mismatch: false,
        },
      },
    ])
  })

  test('started path emits gold fields and never connected', async () => {
    installSink()
    const reg = startDeviceBridgeRegistration({
      sessionId: 'session_1',
      orgUuid: 'org-1',
      transport: 'auto',
      isEnabled: async () => true,
      isEgressAllowed: () => true,
      isStillEnabled: () => true,
      getAccount: resolvedAccount,
      readiness: {
        whenReady: async () => {},
      },
    })
    expect(await reg.started).toBe(true)
    expect(recorded.map(e => e.eventName)).toEqual([
      'tengu_device_bridge_started',
    ])
    expect(recorded[0]?.metadata).toMatchObject({
      account_source: 'stored',
      transport: 'auto',
      redial: false,
    })
    expect(typeof recorded[0]?.metadata.readiness_wait_ms).toBe('number')
    expect(
      recorded.some(e => e.eventName === 'tengu_device_bridge_connected'),
    ).toBe(false)
  })

  test('mn wrap passes remote-tools onNotice into xgt', async () => {
    installSink()
    const notices: Array<[string, string]> = []
    const reg = startMnDeviceBridgeRegistration({
      sessionId: 'session_1',
      orgUuid: 'org-1',
      transport: 'bridge',
      isEnabled: async () => true,
      isEgressAllowed: () => true,
      isBridgeRefused: () => true,
      getAccount: resolvedAccount,
      onNotice: (code, message) => notices.push([code, message]),
    })
    expect(await reg.started).toBe(false)
    expect(notices[0]?.[1]).toBe(SERVING_OFF_BRIDGE_TRUSTED_DEVICES)
  })
})
