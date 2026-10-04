/**
 * densable 2.1.283 leftover unique wrap — device-bridge logs only.
 * Locks gold event names, skip string, env URL. No WebSocket fleet.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  attachAnalyticsSink,
  _resetForTesting,
} from '../../services/analytics/index.js'
import {
  deviceBridgeRejectKey,
  logDeviceBridgeLivenessEvent,
  logDeviceBridgeTransportEvent,
  remoteToolsBridgeBaseUrl,
} from '../deviceBridgeLogs.js'

const SRC = readFileSync(
  join(import.meta.dir, '../deviceBridgeLogs.ts'),
  'utf8',
)

const recorded: Array<{
  eventName: string
  metadata: Record<string, boolean | number | undefined>
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

const previousBridgeUrl = process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL

afterEach(() => {
  _resetForTesting()
  recorded.length = 0
  if (previousBridgeUrl === undefined) {
    delete process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL
  } else {
    process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL = previousBridgeUrl
  }
})

describe('densable 2.1.283 deviceBridgeLogs leftover wrap', () => {
  test('source locks gold skip string and event names', () => {
    expect(SRC).toContain(
      '[deviceBridge] skipped: no device bridge for this OAuth environment',
    )
    expect(SRC).toContain('tengu_device_bridge_connected')
    expect(SRC).toContain('tengu_device_bridge_rejected')
    expect(SRC).toContain('tengu_device_bridge_closed')
    expect(SRC).toContain('tengu_device_bridge_connect_failed')
    expect(SRC).toContain('tengu_device_bridge_pong_timeout')
    expect(SRC).toContain('tengu_device_bridge_reconnect_exhausted')
    expect(SRC).toContain('tengu_device_bridge_heartbeat_unsupported')
    expect(SRC).toContain('tengu_device_bridge_reannounce')
    expect(SRC).toContain('tengu_device_bridge_reannounce_contended')
    expect(SRC).toContain('CLAUDE_REMOTE_TOOLS_BRIDGE_URL')
    expect(SRC).not.toContain('new WebSocket')
    expect(SRC).not.toContain('globalThis.WebSocket')
  })

  test('remoteToolsBridgeBaseUrl returns env URL when defined', () => {
    process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL = 'wss://bridge.example.test'
    expect(remoteToolsBridgeBaseUrl()).toBe('wss://bridge.example.test')
  })

  test('empty env string is still defined (gold !== void 0)', () => {
    process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL = ''
    expect(remoteToolsBridgeBaseUrl()).toBe('')
  })

  test('unset env does not ship oauth-only xe/Ne WSS', () => {
    delete process.env.CLAUDE_REMOTE_TOOLS_BRIDGE_URL
    expect(remoteToolsBridgeBaseUrl()).toBeUndefined()
    expect(SRC).toContain('wss://bridge.claudeusercontent.com')
    expect(SRC).toContain('wss://bridge-staging.claudeusercontent.com')
  })

  test('deviceBridgeRejectKey gold formats', () => {
    expect(
      deviceBridgeRejectKey({
        kind: 'rejected',
        phase: 'hello',
        reason: 'busy',
        status: 409,
        slotContention: true,
      }),
    ).toBe('rejected:hello:busy:409')
    expect(
      deviceBridgeRejectKey({
        kind: 'rejected',
        phase: 'hello',
        slotContention: false,
      }),
    ).toBe('rejected:hello::')
    expect(
      deviceBridgeRejectKey({
        kind: 'closed',
        phase: 'open',
        code: 1000,
        superseded: true,
      }),
    ).toBe('closed:open:1000:true')
    expect(deviceBridgeRejectKey({ kind: 'dial_failed' })).toBe('dial_failed')
    expect(deviceBridgeRejectKey({ kind: 'token_unavailable' })).toBe(
      'token_unavailable',
    )
    expect(deviceBridgeRejectKey({ kind: 'handshake_timeout' })).toBe(
      'handshake_timeout',
    )
    expect(deviceBridgeRejectKey({ kind: 'socket_error' })).toBe('socket_error')
    expect(
      deviceBridgeRejectKey({
        kind: 'authenticated',
        protocolVersion: 1,
        timings: {
          hbIntervalMs: 1,
          stalenessMs: 2,
          rpcTimeoutMs: 3,
        },
      }),
    ).toBeUndefined()
  })

  test('logDeviceBridgeTransportEvent uses gold names and fields', () => {
    installSink()
    logDeviceBridgeTransportEvent({
      kind: 'authenticated',
      protocolVersion: 3,
      timings: {
        hbIntervalMs: 15_000,
        stalenessMs: 45_000,
        rpcTimeoutMs: 30_000,
      },
    })
    logDeviceBridgeTransportEvent({
      kind: 'rejected',
      phase: 'hello',
      reason: 'busy',
      status: 409,
      slotContention: true,
    })
    logDeviceBridgeTransportEvent({
      kind: 'closed',
      phase: 'open',
      code: 1006,
      superseded: false,
    })
    logDeviceBridgeTransportEvent({ kind: 'token_unavailable' })
    logDeviceBridgeTransportEvent({ kind: 'handshake_timeout' })
    logDeviceBridgeTransportEvent({ kind: 'socket_error' })
    logDeviceBridgeTransportEvent({ kind: 'dial_failed' })

    expect(recorded.map(e => e.eventName)).toEqual([
      'tengu_device_bridge_connected',
      'tengu_device_bridge_rejected',
      'tengu_device_bridge_closed',
      'tengu_device_bridge_connect_failed',
      'tengu_device_bridge_connect_failed',
      'tengu_device_bridge_connect_failed',
      'tengu_device_bridge_connect_failed',
    ])
    expect(recorded[0]?.metadata).toEqual({
      protocol_version: 3,
      hb_interval_ms: 15_000,
      staleness_ms: 45_000,
      rpc_timeout_ms: 30_000,
    })
    expect(recorded[1]?.metadata).toEqual({
      phase: 'hello',
      reason: 'busy',
      status: '409',
      slot_contention: true,
    })
    expect(recorded[2]?.metadata).toEqual({
      phase: 'open',
      code: '1006',
      superseded: false,
    })
    expect(recorded[3]?.metadata).toEqual({ cause: 'token_unavailable' })
    expect(recorded[4]?.metadata).toEqual({ cause: 'handshake_timeout' })
    expect(recorded[5]?.metadata).toEqual({ cause: 'socket_error' })
    expect(recorded[6]?.metadata).toEqual({ cause: 'dial_failed' })
  })

  test('does not emit connected unless caller passes authenticated', () => {
    installSink()
    logDeviceBridgeTransportEvent({ kind: 'dial_failed' })
    logDeviceBridgeLivenessEvent({ kind: 'pong_timeout', consecutive: 2 })
    expect(
      recorded.some(e => e.eventName === 'tengu_device_bridge_connected'),
    ).toBe(false)
  })

  test('logDeviceBridgeLivenessEvent uses gold names and fields', () => {
    installSink()
    logDeviceBridgeLivenessEvent({ kind: 'pong_timeout', consecutive: 3 })
    logDeviceBridgeLivenessEvent({ kind: 'reconnect_exhausted' })
    logDeviceBridgeLivenessEvent({
      kind: 'heartbeat_unsupported',
      protocolVersion: 2,
    })
    logDeviceBridgeLivenessEvent({
      kind: 'reannounce',
      reason: 'tools_changed',
      outcome: 'rotated',
      inFlightAtStart: 1,
      drainedMs: 40,
      drainTimedOut: false,
    })
    logDeviceBridgeLivenessEvent({
      kind: 'reannounce_contended',
      reason: 'tools_changed',
    })

    expect(recorded.map(e => e.eventName)).toEqual([
      'tengu_device_bridge_pong_timeout',
      'tengu_device_bridge_reconnect_exhausted',
      'tengu_device_bridge_heartbeat_unsupported',
      'tengu_device_bridge_reannounce',
      'tengu_device_bridge_reannounce_contended',
    ])
    expect(recorded[0]?.metadata).toEqual({ consecutive: 3 })
    expect(recorded[1]?.metadata).toEqual({})
    expect(recorded[2]?.metadata).toEqual({ protocol_version: '2' })
    expect(recorded[3]?.metadata).toEqual({
      reason: 'tools_changed',
      outcome: 'rotated',
      inflight_at_start: 1,
      drained_ms: 40,
      drain_timed_out: false,
    })
    expect(recorded[4]?.metadata).toEqual({ reason: 'tools_changed' })
  })
})
