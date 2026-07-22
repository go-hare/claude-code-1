import { describe, expect, test } from 'bun:test'
import {
  BYTE_STREAM_IDLE_TIMEOUT_FIRST_PARTY_MS,
  isByteWatchdogEnabled,
  isStreamWatchdogEnabled,
  resolveByteStreamIdleTimeoutMs,
  resolveStreamIdleTimeoutMs,
  shouldEnableBodyIdleWatchdog,
  STREAM_IDLE_TIMEOUT_FLOOR_MS,
} from '../streamWatchdogGates.js'

describe('isStreamWatchdogEnabled', () => {
  test('default ON; falsy disables', () => {
    expect(isStreamWatchdogEnabled({})).toBe(true)
    expect(
      isStreamWatchdogEnabled({ CLAUDE_ENABLE_STREAM_WATCHDOG: '1' }),
    ).toBe(true)
    expect(
      isStreamWatchdogEnabled({ CLAUDE_ENABLE_STREAM_WATCHDOG: '0' }),
    ).toBe(false)
    expect(
      isStreamWatchdogEnabled({ CLAUDE_ENABLE_STREAM_WATCHDOG: 'false' }),
    ).toBe(false)
  })
})

describe('resolveStreamIdleTimeoutMs (IAi)', () => {
  test('floor 300000', () => {
    expect(resolveStreamIdleTimeoutMs({})).toBe(STREAM_IDLE_TIMEOUT_FLOOR_MS)
    expect(STREAM_IDLE_TIMEOUT_FLOOR_MS).toBe(300_000)
    expect(
      resolveStreamIdleTimeoutMs({ CLAUDE_STREAM_IDLE_TIMEOUT_MS: '1000' }),
    ).toBe(300_000)
    expect(
      resolveStreamIdleTimeoutMs({ CLAUDE_STREAM_IDLE_TIMEOUT_MS: '600000' }),
    ).toBe(600_000)
  })
})

describe('isByteWatchdogEnabled (Zgc)', () => {
  test('ou disables; truthy enables; else GB default on', () => {
    expect(
      isByteWatchdogEnabled({
        env: { CLAUDE_ENABLE_BYTE_WATCHDOG: '0' },
        gbDefaultOn: true,
      }),
    ).toBe(false)
    expect(
      isByteWatchdogEnabled({
        env: { CLAUDE_ENABLE_BYTE_WATCHDOG: '1' },
        gbDefaultOn: false,
      }),
    ).toBe(true)
    expect(isByteWatchdogEnabled({ env: {}, gbDefaultOn: true })).toBe(true)
    expect(isByteWatchdogEnabled({ env: {}, gbDefaultOn: false })).toBe(false)
  })
})

describe('shouldEnableBodyIdleWatchdog (k_h / densable NMh)', () => {
  test('firstParty both sides when Zgc on and Ud (first-party base)', () => {
    // no ANTHROPIC_BASE_URL → Ud() true
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'firstParty',
        currentProvider: 'firstParty',
        env: {},
        gbDefaultOn: true,
      }),
    ).toBe(true)
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'firstParty',
        currentProvider: 'firstParty',
        env: { ANTHROPIC_BASE_URL: 'https://api.anthropic.com' },
        gbDefaultOn: true,
      }),
    ).toBe(true)
  })

  test('firstParty blocked when custom ANTHROPIC_BASE_URL (densable fxc/Ud)', () => {
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'firstParty',
        currentProvider: 'firstParty',
        env: { ANTHROPIC_BASE_URL: 'https://proxy.example.com' },
        gbDefaultOn: true,
      }),
    ).toBe(false)
  })

  test('firstParty allowed with ASSUME_FIRST_PARTY even on custom base', () => {
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'firstParty',
        currentProvider: 'firstParty',
        env: {
          ANTHROPIC_BASE_URL: 'https://proxy.example.com',
          _CLAUDE_CODE_ASSUME_FIRST_PARTY_BASE_URL: '1',
        },
        gbDefaultOn: true,
      }),
    ).toBe(true)
  })

  test('Zgc off blocks', () => {
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'firstParty',
        currentProvider: 'firstParty',
        env: { CLAUDE_ENABLE_BYTE_WATCHDOG: '0' },
        gbDefaultOn: true,
      }),
    ).toBe(false)
  })

  test('bedrock needs explicit env', () => {
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'bedrock',
        currentProvider: 'bedrock',
        gbDefaultOn: true,
      }),
    ).toBe(false)
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'bedrock',
        currentProvider: 'bedrock',
        env: { CLAUDE_ENABLE_BYTE_WATCHDOG_BEDROCK: '1' },
        gbDefaultOn: true,
      }),
    ).toBe(true)
  })

  test('anthropicAws blocked with custom base URL', () => {
    expect(
      shouldEnableBodyIdleWatchdog({
        requestProvider: 'anthropicAws',
        currentProvider: 'anthropicAws',
        env: { ANTHROPIC_AWS_BASE_URL: 'https://custom' },
        gbDefaultOn: true,
      }),
    ).toBe(false)
  })
})

describe('resolveByteStreamIdleTimeoutMs (HAi)', () => {
  test('firstParty default 180000 when stream not explicit', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: {},
        gbTimeoutMs: null,
      }),
    ).toBe(BYTE_STREAM_IDLE_TIMEOUT_FIRST_PARTY_MS)
  })

  test('BYTE env wins', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: { CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS: '45000' },
      }),
    ).toBe(45_000)
  })

  test('GB override when stream not explicit', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: {},
        gbTimeoutMs: 90_000,
      }),
    ).toBe(90_000)
  })

  test('explicit STREAM_IDLE skips firstParty default path', () => {
    // stream set → chosen stays stream floor (max(600k,300k)=600k), no firstParty 180k
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: { CLAUDE_STREAM_IDLE_TIMEOUT_MS: '600000' },
        gbTimeoutMs: 90_000,
      }),
    ).toBe(600_000)
  })
})
