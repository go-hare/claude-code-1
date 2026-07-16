import { describe, expect, test } from 'bun:test'
import { shouldRetireStaleDaemonBinary } from '../installPrompt.js'

describe('shouldRetireStaleDaemonBinary (official sAO)', () => {
  test('never retires non-transient origin', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'service',
        daemonTarget: undefined,
        clientVersion: '2.6.33',
        clientTarget: '/usr/local/bin/claude',
        daemonMtimeMs: 1,
        clientMtimeMs: 2,
      }),
    ).toBe(false)
  })

  test('same version keeps daemon even if targets differ', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.6.33',
        daemonOrigin: 'transient',
        daemonTarget: 'C:\\old\\claude.exe',
        clientVersion: '2.6.33',
        clientTarget: 'C:\\new\\claude.exe',
        daemonMtimeMs: 1,
        clientMtimeMs: 99,
      }),
    ).toBe(false)
  })

  test('same launchTarget keeps daemon even if versions differ', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'transient',
        daemonTarget: 'C:\\same\\claude.exe',
        clientVersion: '2.6.33',
        clientTarget: 'C:\\same\\claude.exe',
        daemonMtimeMs: 1,
        clientMtimeMs: 99,
      }),
    ).toBe(false)
  })

  test('no launchTarget: semver gt client > daemon retires', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'transient',
        daemonTarget: undefined,
        clientVersion: '2.6.33',
        clientTarget: 'C:\\new\\claude.exe',
        daemonMtimeMs: null,
        clientMtimeMs: null,
      }),
    ).toBe(true)
  })

  test('no launchTarget: older client does not retire', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.6.33',
        daemonOrigin: 'transient',
        daemonTarget: undefined,
        clientVersion: '2.1.153',
        clientTarget: 'C:\\old\\claude.exe',
        daemonMtimeMs: null,
        clientMtimeMs: null,
      }),
    ).toBe(false)
  })

  test('with launchTarget: newer client mtime retires', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'transient',
        daemonTarget: 'C:\\Temp\\pkg-latest\\claude.exe',
        clientVersion: '2.6.33',
        clientTarget: 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd',
        daemonMtimeMs: 1000,
        clientMtimeMs: 2000,
      }),
    ).toBe(true)
  })

  test('with launchTarget: older client mtime keeps', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'transient',
        daemonTarget: 'C:\\Temp\\pkg-latest\\claude.exe',
        clientVersion: '2.6.33',
        clientTarget: 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd',
        daemonMtimeMs: 5000,
        clientMtimeMs: 1000,
      }),
    ).toBe(false)
  })

  test('with launchTarget: missing mtime keeps', () => {
    expect(
      shouldRetireStaleDaemonBinary({
        daemonVersion: '2.1.153',
        daemonOrigin: 'transient',
        daemonTarget: 'C:\\Temp\\pkg-latest\\claude.exe',
        clientVersion: '2.6.33',
        clientTarget: 'C:\\Users\\x\\AppData\\Roaming\\npm\\claude.cmd',
        daemonMtimeMs: null,
        clientMtimeMs: 2000,
      }),
    ).toBe(false)
  })
})
