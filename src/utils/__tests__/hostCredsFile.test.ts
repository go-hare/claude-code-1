import { afterEach, describe, expect, test } from 'bun:test'
import {
  applyHostCredsEnvDiff,
  getHostAuthEnvVarName,
  getHostAuthRefreshTimeoutMs,
  HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT,
  HOST_CREDS_PROC_START_DRIFT_MS,
  hostCredsEndpointChanged,
  isHostAuthTokenRefreshAvailable,
  parseHostCredsPayload,
  resetHostCredsModuleStateForTests,
  setHostAuthTokenRefreshCallback,
  splitHostCredsEnv,
  tryHostAuth401Recovery,
  withHostAuthRefreshTimeout,
} from '../hostCredsFile.js'

afterEach(() => {
  resetHostCredsModuleStateForTests()
})

describe('parseHostCredsPayload (official hj_/mj_)', () => {
  test('accepts valid payload and filters env allowlist', () => {
    const data = parseHostCredsPayload({
      env: {
        ANTHROPIC_API_KEY: 'sk-test',
        ANTHROPIC_BASE_URL: 'https://api.example',
        EVIL_KEY: 'nope',
        CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
      },
      expiresAt: null,
      pid: process.pid,
      procStart: 1,
    })
    expect(data).not.toBeNull()
    expect(data!.env).toEqual({
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_BASE_URL: 'https://api.example',
      CLAUDE_CODE_SKIP_VERTEX_AUTH: '1',
    })
    expect(data!.env.EVIL_KEY).toBeUndefined()
  })

  test('rejects missing pid/procStart', () => {
    expect(
      parseHostCredsPayload({
        env: {},
        expiresAt: null,
      }),
    ).toBeNull()
  })

  test('coerces string expiresAt/procStart', () => {
    const data = parseHostCredsPayload({
      env: {},
      expiresAt: '0',
      pid: 1,
      procStart: '42',
    })
    expect(data?.procStart).toBe(42)
    expect(data?.expiresAt).toBe(0)
  })

  test('HOST_CREDS_PROC_START_DRIFT_MS matches official gj_ (2000ms)', () => {
    expect(HOST_CREDS_PROC_START_DRIFT_MS).toBe(2000)
  })
})

describe('splitHostCredsEnv / endpoint lock', () => {
  test('splits endpoints from secrets', () => {
    const { endpoints, rest } = splitHostCredsEnv({
      ANTHROPIC_BASE_URL: 'https://a',
      ANTHROPIC_API_KEY: 'k',
    })
    expect(endpoints).toEqual({ ANTHROPIC_BASE_URL: 'https://a' })
    expect(rest).toEqual({ ANTHROPIC_API_KEY: 'k' })
  })

  test('hostCredsEndpointChanged detects drift', () => {
    const locked = new Map([['ANTHROPIC_BASE_URL', 'https://a']])
    expect(
      hostCredsEndpointChanged(
        { ANTHROPIC_BASE_URL: 'https://a', ANTHROPIC_API_KEY: 'k2' },
        locked,
      ),
    ).toBeNull()
    expect(
      hostCredsEndpointChanged({ ANTHROPIC_BASE_URL: 'https://b' }, locked),
    ).toBe('ANTHROPIC_BASE_URL')
  })
})

describe('applyHostCredsEnvDiff (official dLp)', () => {
  test('assigns next and clears removed keys', () => {
    const env: NodeJS.ProcessEnv = {
      ANTHROPIC_API_KEY: 'old',
      KEEP: 'x',
    }
    const next = applyHostCredsEnvDiff(
      { ANTHROPIC_AUTH_TOKEN: 'new' },
      new Set(['ANTHROPIC_API_KEY']),
      env,
    )
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('new')
    expect(env.KEEP).toBe('x')
    expect([...next]).toEqual(['ANTHROPIC_AUTH_TOKEN'])
  })
})

describe('host auth 401 recovery (official lfa / ASr)', () => {
  test('getHostAuthEnvVarName defaults to ANTHROPIC_AUTH_TOKEN', () => {
    expect(getHostAuthEnvVarName()).toBe(
      process.env.CLAUDE_CODE_HOST_AUTH_ENV_VAR || 'ANTHROPIC_AUTH_TOKEN',
    )
  })

  test('tryHostAuth401Recovery unavailable without callback', async () => {
    expect(isHostAuthTokenRefreshAvailable()).toBe(false)
    expect(await tryHostAuth401Recovery()).toBe('unavailable')
  })

  test('updates env when callback returns a new token', async () => {
    const envVar = getHostAuthEnvVarName()
    const prev = process.env[envVar]
    process.env[envVar] = 'old-token'
    setHostAuthTokenRefreshCallback(async () => 'new-token')
    expect(isHostAuthTokenRefreshAvailable()).toBe(true)
    expect(await tryHostAuth401Recovery()).toBe('updated')
    expect(process.env[envVar]).toBe('new-token')
    if (prev === undefined) delete process.env[envVar]
    else process.env[envVar] = prev
  })

  test('exhausts after repeated same token', async () => {
    const envVar = getHostAuthEnvVarName()
    const prev = process.env[envVar]
    process.env[envVar] = 'same'
    setHostAuthTokenRefreshCallback(async () => 'same')
    expect(await tryHostAuth401Recovery()).toBe('same')
    expect(await tryHostAuth401Recovery()).toBe('exhausted')
    if (prev === undefined) delete process.env[envVar]
    else process.env[envVar] = prev
  })

  test('failed when callback throws', async () => {
    setHostAuthTokenRefreshCallback(async () => {
      throw new Error('boom')
    })
    expect(await tryHostAuth401Recovery()).toBe('failed')
  })

  test('getHostAuthRefreshTimeoutMs defaults and parses env', () => {
    expect(getHostAuthRefreshTimeoutMs({})).toBe(
      HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT,
    )
    expect(
      getHostAuthRefreshTimeoutMs({
        CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS: '2500',
      }),
    ).toBe(2500)
    expect(
      getHostAuthRefreshTimeoutMs({
        CLAUDE_CODE_HOST_AUTH_REFRESH_TIMEOUT_MS: 'nope',
      }),
    ).toBe(HOST_AUTH_REFRESH_TIMEOUT_MS_DEFAULT)
  })

  test('withHostAuthRefreshTimeout returns null on timeout', async () => {
    const result = await withHostAuthRefreshTimeout(
      new Promise<string>(() => {}),
      20,
    )
    expect(result).toBeNull()
  })

  test('withHostAuthRefreshTimeout returns work result when faster', async () => {
    const result = await withHostAuthRefreshTimeout(
      Promise.resolve('tok'),
      1000,
    )
    expect(result).toBe('tok')
  })
})
