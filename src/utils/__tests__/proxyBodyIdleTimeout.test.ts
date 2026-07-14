import { afterEach, describe, expect, test } from 'bun:test'
import {
  shouldDisableFetchTimeoutForBodyIdle,
  _resetKeepAliveForTesting,
} from '../proxy.js'

afterEach(() => {
  delete process.env.API_FORCE_IDLE_TIMEOUT
  _resetKeepAliveForTesting()
})

describe('shouldDisableFetchTimeoutForBodyIdle (official F_)', () => {
  test('false when not forAnthropicAPI', () => {
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: false,
        hasBodyIdleWatchdog: true,
        env: {},
      }),
    ).toBe(false)
  })

  test('true when hasBodyIdleWatchdog and force unset', () => {
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: true,
        env: {},
      }),
    ).toBe(true)
  })

  test('true when API_FORCE_IDLE_TIMEOUT truthy even without watchdog', () => {
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: false,
        env: { API_FORCE_IDLE_TIMEOUT: '1' },
      }),
    ).toBe(true)
  })

  test('false when API_FORCE_IDLE_TIMEOUT explicitly falsy (ou)', () => {
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: true,
        env: { API_FORCE_IDLE_TIMEOUT: '0' },
      }),
    ).toBe(false)
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: true,
        env: { API_FORCE_IDLE_TIMEOUT: 'false' },
      }),
    ).toBe(false)
  })

  test('false when neither watchdog nor force', () => {
    expect(
      shouldDisableFetchTimeoutForBodyIdle({
        forAnthropicAPI: true,
        hasBodyIdleWatchdog: false,
        env: {},
      }),
    ).toBe(false)
  })
})
