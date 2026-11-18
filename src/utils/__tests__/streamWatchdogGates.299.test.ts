import { describe, expect, test } from 'bun:test'
import { resolveByteStreamIdleTimeoutMs } from '../streamWatchdogGates.js'

describe('resolveByteStreamIdleTimeoutMs (#617)', () => {
  test('firstParty on default api.anthropic.com uses 180s (or GB override)', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: {},
        gbTimeoutMs: null,
      }),
    ).toBe(180_000)

    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: {},
        gbTimeoutMs: 240_000,
      }),
    ).toBe(240_000)
  })

  test('firstParty behind custom ANTHROPIC_BASE_URL unconditionally uses 300s even if GB is 180s', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com/v1' },
        gbTimeoutMs: 180_000,
      }),
    ).toBe(300_000)

    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: { ANTHROPIC_BASE_URL: 'https://gateway.example.com/v1' },
        gbTimeoutMs: null,
      }),
    ).toBe(300_000)
  })

  test('CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS still overrides custom base URL', () => {
    expect(
      resolveByteStreamIdleTimeoutMs({
        provider: 'firstParty',
        env: {
          ANTHROPIC_BASE_URL: 'https://gateway.example.com/v1',
          CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS: '450000',
        },
        gbTimeoutMs: 180_000,
      }),
    ).toBe(450_000)
  })
})
