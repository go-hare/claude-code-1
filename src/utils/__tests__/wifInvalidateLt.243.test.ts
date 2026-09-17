import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { logMock } from '../../../tests/mocks/log'
import { debugMock } from '../../../tests/mocks/debug'

import { analyticsMock } from '../../../tests/mocks/analytics.js'
mock.module('../../services/analytics/index.js', analyticsMock)
mock.module('../log.ts', logMock)
mock.module('../debug.ts', debugMock)

function asFetch(fn: ReturnType<typeof mock>): typeof fetch {
  return fn as unknown as typeof fetch
}

const {
  clearAnthropicProfileCaches,
  getLastIssuedWifAccessToken,
  invalidateWifToken,
  resolveProfileUserOauthAccessToken,
} = await import('../anthropicProfile.js')
const {
  clearWifCredentialRaceStateForTests,
  getWifFailedAccessTokensForTests,
  setWifCredentialsLockForTests,
} = await import('../wifCredentialRace.js')

let tempDir = ''

function writeProfile(
  dir: string,
  creds: object,
  config: object = {
    authentication: { type: 'user_oauth', client_id: 'client_test' },
  },
): string {
  mkdirSync(join(dir, 'configs'), { recursive: true })
  mkdirSync(join(dir, 'credentials'), { recursive: true })
  writeFileSync(join(dir, 'configs', 'default.json'), JSON.stringify(config))
  const credPath = join(dir, 'credentials', 'default.json')
  writeFileSync(credPath, JSON.stringify(creds))
  writeFileSync(join(dir, 'active_config'), 'default')
  return credPath
}

function pinEnv(dir: string): void {
  process.env.ANTHROPIC_CONFIG_DIR = dir
  process.env.ANTHROPIC_PROFILE = 'default'
  delete process.env.ANTHROPIC_API_KEY
  delete process.env.ANTHROPIC_AUTH_TOKEN
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN
  clearAnthropicProfileCaches()
}

afterEach(async () => {
  clearAnthropicProfileCaches()
  clearWifCredentialRaceStateForTests()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
  }
  for (const k of [
    'ANTHROPIC_CONFIG_DIR',
    'ANTHROPIC_PROFILE',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_AUTH_TOKEN',
    'CLAUDE_CODE_OAUTH_TOKEN',
  ]) {
    delete process.env[k]
  }
})

describe('densable 2.1.243 #24 invalidateWifToken (lt)', () => {
  test('records failed token and arms after-recorded-401 sibling adopt', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const credPath = writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    writeFileSync(
      credPath,
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'sibling_tok',
        refresh_token: 'refresh_tok',
        expires_at: expiresAt,
      }),
    )

    await invalidateWifToken('old_tok')
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)

    const fetchFn = mock(async () => {
      throw new Error('refresh must not run when sibling adopt wins')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('sibling_tok')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('lt uses last-issued bearer, not disk sibling', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-issued-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const credPath = writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    // Issue old_tok into the in-memory last-issued slot (API client bearer).
    const issued = await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    expect(issued?.token).toBe('old_tok')
    expect(getLastIssuedWifAccessToken()).toBe('old_tok')

    // Sibling rotates credentials on disk while this process still holds old_tok.
    writeFileSync(
      credPath,
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'sibling_tok',
        refresh_token: 'refresh_tok',
        expires_at: expiresAt,
      }),
    )

    // densable lt(e) with e = last-issued, NOT a disk re-read.
    await invalidateWifToken(getLastIssuedWifAccessToken())
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)
    expect(getWifFailedAccessTokensForTests().has('sibling_tok')).toBe(false)
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    const fetchFn = mock(async () => {
      throw new Error('refresh must not run when sibling adopt wins')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('sibling_tok')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('lt without arg uses last-issued, not disk sibling', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-noarg-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const credPath = writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    writeFileSync(
      credPath,
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'sibling_tok',
        refresh_token: 'refresh_tok',
        expires_at: expiresAt,
      }),
    )

    await invalidateWifToken()
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)
    expect(getWifFailedAccessTokensForTests().has('sibling_tok')).toBe(false)
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    const fetchFn = mock(async () => {
      throw new Error('refresh must not run when sibling adopt wins')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('sibling_tok')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('non-force resolve keeps memory bearer when disk sibling rotates', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-mem-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const credPath = writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    expect(getLastIssuedWifAccessToken()).toBe('old_tok')

    writeFileSync(
      credPath,
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'sibling_tok',
        refresh_token: 'refresh_tok',
        expires_at: expiresAt,
      }),
    )

    // densable TokenCache hit: concurrent resolve must not clobber last-issued.
    const again = await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on memory hit')
      }),
    )
    expect(again?.token).toBe('old_tok')
    expect(getLastIssuedWifAccessToken()).toBe('old_tok')

    await invalidateWifToken(getLastIssuedWifAccessToken())
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)
    expect(getWifFailedAccessTokensForTests().has('sibling_tok')).toBe(false)
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    const fetchFn = mock(async () => {
      throw new Error('refresh must not run when sibling adopt wins')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('sibling_tok')
    expect(getLastIssuedWifAccessToken()).toBe('sibling_tok')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('lt clears last-issued so a failed force refresh cannot return the rejected bearer', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-clear-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    const credPath = writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    writeFileSync(
      credPath,
      JSON.stringify({
        type: 'oauth_token',
        access_token: 'sibling_tok',
        refresh_token: 'refresh_tok',
        expires_at: expiresAt,
      }),
    )

    await invalidateWifToken(getLastIssuedWifAccessToken())
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    setWifCredentialsLockForTests({
      lock: async () => {
        throw new Error('lock denied')
      },
    })
    await expect(
      resolveProfileUserOauthAccessToken(
        process.env,
        mock(async () => {
          throw new Error('refresh must not run when lock fails')
        }),
      ),
    ).rejects.toThrow('lock denied')
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    setWifCredentialsLockForTests(null)
    const fetchFn = mock(async () => {
      throw new Error('refresh must not run when sibling is on disk')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('sibling_tok')
    expect(getLastIssuedWifAccessToken()).toBe('sibling_tok')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('after lt, a rejected disk token is not pinned on the next resolve', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-rej-disk-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    await invalidateWifToken(getLastIssuedWifAccessToken())
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    setWifCredentialsLockForTests({
      lock: async () => {
        throw new Error('lock denied')
      },
    })
    await expect(
      resolveProfileUserOauthAccessToken(
        process.env,
        mock(async () => {
          throw new Error('refresh must not run when lock fails')
        }),
      ),
    ).rejects.toThrow('lock denied')
    expect(getLastIssuedWifAccessToken()).toBeUndefined()

    setWifCredentialsLockForTests(null)
    const fetchFn = mock(async () => {
      throw new Error('refresh attempted after rejected disk pin skipped')
    })
    await expect(
      resolveProfileUserOauthAccessToken(process.env, asFetch(fetchFn)),
    ).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalled()
    expect(getLastIssuedWifAccessToken()).toBeUndefined()
    expect(getWifFailedAccessTokensForTests().has('old_tok')).toBe(true)
  })

  test('in-flight refresh is joined before a rejected disk pin', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-join-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'old_tok',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    await resolveProfileUserOauthAccessToken(
      process.env,
      mock(async () => {
        throw new Error('should not refresh on first resolve')
      }),
    )
    await invalidateWifToken(getLastIssuedWifAccessToken())

    let release!: (value: Response) => void
    const fetchFn = mock(
      () =>
        new Promise<Response>(resolve => {
          release = resolve
        }),
    )
    const first = resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    const waitUntil = Date.now() + 2000
    while (fetchFn.mock.calls.length === 0 && Date.now() < waitUntil) {
      await Bun.sleep(10)
    }
    expect(fetchFn).toHaveBeenCalledTimes(1)
    const second = resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(fetchFn).toHaveBeenCalledTimes(1)
    release(
      new Response(
        JSON.stringify({
          access_token: 'new_tok',
          expires_in: 3600,
          refresh_token: 'refresh_tok',
        }),
        { status: 200 },
      ),
    )
    expect((await first)?.token).toBe('new_tok')
    expect((await second)?.token).toBe('new_tok')
    expect(getLastIssuedWifAccessToken()).toBe('new_tok')
  })

  test('without lt, fresh non-expiring token is returned as-is', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-lt-nolt-'))
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    writeProfile(tempDir, {
      type: 'oauth_token',
      access_token: 'still_good',
      refresh_token: 'refresh_tok',
      expires_at: expiresAt,
    })
    pinEnv(tempDir)

    const fetchFn = mock(async () => {
      throw new Error('should not refresh')
    })
    const tok = await resolveProfileUserOauthAccessToken(
      process.env,
      asFetch(fetchFn),
    )
    expect(tok?.token).toBe('still_good')
    expect(fetchFn).not.toHaveBeenCalled()
  })

  test('withRetry wires last-issued lt on profile 401', () => {
    const src = readFileSync(
      join(import.meta.dir, '../../services/api/withRetry.ts'),
      'utf8',
    )
    expect(src).toContain('invalidateWifToken')
    expect(src).toContain('getLastIssuedWifAccessToken')
    expect(src).toContain('isProfileAuthActive')
    expect(src).not.toContain('getActiveProfileAccessToken')
  })
})
