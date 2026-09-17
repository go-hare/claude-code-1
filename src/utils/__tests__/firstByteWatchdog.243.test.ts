import { afterEach, describe, expect, test } from 'bun:test'
import {
  armStreamFirstByte,
  consumeStreamFirstByteArm,
  FIRST_BYTE_TIMEOUT_DEFAULT_MS,
  FIRST_BYTE_TIMEOUT_MIN_MS,
  resolveFirstByteDispatchTimeoutMs,
  resolveFirstByteTimeoutMs,
  STREAM_NO_RESPONSE_RETRY_CAP,
  StreamNoResponseError,
} from '../firstByteWatchdog.js'

describe('densable 2.1.243 #22 first-byte / StreamNoResponse', () => {
  afterEach(() => {
    consumeStreamFirstByteArm('arm-a')
    consumeStreamFirstByteArm('arm-b')
  })

  test('UYo retry cap is 1', () => {
    expect(STREAM_NO_RESPONSE_RETRY_CAP).toBe(1)
  })

  test('StreamNoResponseError carries official code and message', () => {
    const err = new StreamNoResponseError(180_000, 0)
    expect(err.code).toBe('StreamNoResponse')
    expect(err.name).toBe('StreamNoResponseError')
    expect(err.message).toBe(
      'No response from API within the first-byte window',
    )
    expect(err.timeoutMs).toBe(180_000)
  })

  test('ZMo: explicit CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS is clamped', () => {
    expect(
      resolveFirstByteTimeoutMs('firstParty', {
        CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '500',
      }),
    ).toBe(FIRST_BYTE_TIMEOUT_MIN_MS)
    expect(
      resolveFirstByteTimeoutMs('firstParty', {
        CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '180000',
      }),
    ).toBe(180_000)
  })

  test('ZMo: dirty CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS falls through', () => {
    expect(
      resolveFirstByteTimeoutMs('firstParty', {
        CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: 'abc',
        CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS: String(
          FIRST_BYTE_TIMEOUT_DEFAULT_MS,
        ),
        CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
      }),
    ).toBe(FIRST_BYTE_TIMEOUT_DEFAULT_MS)
  })

  test('ZMo: unset API_TIMEOUT uses byte-idle (firstParty 3 min)', () => {
    expect(
      resolveFirstByteTimeoutMs('firstParty', {
        CLAUDE_BYTE_STREAM_IDLE_TIMEOUT_MS: String(
          FIRST_BYTE_TIMEOUT_DEFAULT_MS,
        ),
        CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
      }),
    ).toBe(FIRST_BYTE_TIMEOUT_DEFAULT_MS)
  })

  test('tOo skips when the request id was not armed', () => {
    expect(
      resolveFirstByteDispatchTimeoutMs({
        clientRequestId: 'never-armed',
        provider: 'firstParty',
        routedProvider: 'firstParty',
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        body: '{}',
        env: {
          CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '180000',
          CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
        },
      }),
    ).toBeUndefined()
  })

  test('tOo returns the window for an armed first-party request', () => {
    armStreamFirstByte('arm-a')
    const ms = resolveFirstByteDispatchTimeoutMs({
      clientRequestId: 'arm-a',
      provider: 'firstParty',
      routedProvider: 'firstParty',
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      body: '',
      env: {
        CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '180000',
        CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
        API_TIMEOUT_MS: '600000',
      },
    })
    expect(ms).toBe(180_000)
    // eOo consumes the arm
    expect(
      resolveFirstByteDispatchTimeoutMs({
        clientRequestId: 'arm-a',
        provider: 'firstParty',
        routedProvider: 'firstParty',
        method: 'POST',
        url: 'https://api.anthropic.com/v1/messages',
        body: '{}',
        env: {
          CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: '180000',
          CLAUDE_ENABLE_BYTE_WATCHDOG: '1',
        },
      }),
    ).toBeUndefined()
  })
})
