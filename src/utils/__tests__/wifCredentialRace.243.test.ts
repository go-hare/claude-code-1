import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AnthropicProfileOauthError } from '../anthropicProfile.js'
import {
  clearWifCredentialRaceStateForTests,
  recordWifFailedAccessToken,
  setWifCredentialsLockForTests,
  WIF_LOCK_RETRIES,
  wrapWifCredentialsLock,
  wrapWifInvalidGrantRefreshCleanup,
  wrapWifSiblingRotatedTokenAdoption,
} from '../wifCredentialRace.js'

mock.module('src/services/analytics/index.js', () => ({
  logEvent: () => {},
}))

mock.module('src/utils/debug.js', () => ({
  logForDebugging: () => {},
}))

mock.module('src/utils/log.js', () => ({
  logError: () => {},
}))

let tempDir = ''

afterEach(async () => {
  clearWifCredentialRaceStateForTests()
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true })
    tempDir = ''
  }
})

function elocked(): Error {
  return Object.assign(new Error('already locked'), { code: 'ELOCKED' })
}

describe('densable 2.1.243 #24 WIF credential race', () => {
  test('always adopts sibling access token on forceRefresh', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await writeFile(
      credPath,
      JSON.stringify({
        access_token: 'sibling_tok',
        expires_at: expiresAt,
      }),
    )

    const inner = mock(async () => ({
      token: 'fresh_tok',
      expiresAt: expiresAt + 10,
    }))
    const wrapped = wrapWifSiblingRotatedTokenAdoption(
      inner,
      credPath,
      'always',
    )
    const result = await wrapped({ forceRefresh: true })
    expect(result.token).toBe('sibling_tok')
    expect(inner).not.toHaveBeenCalled()
  })

  test('after-recorded-401 does not adopt when failed set is empty', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await writeFile(
      credPath,
      JSON.stringify({
        access_token: 'sibling_tok',
        expires_at: expiresAt,
      }),
    )

    const inner = mock(async () => ({
      token: 'fresh_tok',
      expiresAt,
    }))
    const wrapped = wrapWifSiblingRotatedTokenAdoption(
      inner,
      credPath,
      'after-recorded-401',
    )
    const result = await wrapped({ forceRefresh: true })
    expect(result.token).toBe('fresh_tok')
    expect(inner).toHaveBeenCalled()
  })

  test('after-recorded-401 adopts sibling after a different token was rejected', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await writeFile(
      credPath,
      JSON.stringify({
        access_token: 'sibling_tok',
        expires_at: expiresAt,
      }),
    )
    recordWifFailedAccessToken('old_tok')

    const inner = mock(async () => ({
      token: 'fresh_tok',
      expiresAt,
    }))
    const wrapped = wrapWifSiblingRotatedTokenAdoption(
      inner,
      credPath,
      'after-recorded-401',
    )
    const result = await wrapped({ forceRefresh: true })
    expect(result.token).toBe('sibling_tok')
    expect(inner).not.toHaveBeenCalled()
  })

  test('skips rejected tokens in failedAccessTokens set', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    const expiresAt = Math.floor(Date.now() / 1000) + 3600
    await writeFile(
      credPath,
      JSON.stringify({
        access_token: 'bad_tok',
        expires_at: expiresAt,
      }),
    )
    recordWifFailedAccessToken('bad_tok')

    const inner = mock(async () => ({
      token: 'fresh_tok',
      expiresAt,
    }))
    const wrapped = wrapWifSiblingRotatedTokenAdoption(
      inner,
      credPath,
      'after-recorded-401',
    )
    const result = await wrapped({ forceRefresh: true })
    expect(result.token).toBe('fresh_tok')
    expect(inner).toHaveBeenCalled()
  })

  test('clears stale refresh_token on invalid_grant', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    await writeFile(
      credPath,
      JSON.stringify({
        access_token: 'old',
        refresh_token: 'stale_refresh',
      }),
    )

    const inner = mock(async () => {
      throw new AnthropicProfileOauthError(
        'invalid_grant',
        400,
        '{"error":"invalid_grant"}',
      )
    })
    const wrapped = wrapWifInvalidGrantRefreshCleanup(
      inner,
      credPath,
      async (path, value) => {
        await writeFile(path, JSON.stringify(value))
      },
    )
    await expect(wrapped({ forceRefresh: true })).rejects.toThrow(
      AnthropicProfileOauthError,
    )
    const parsed = JSON.parse(await readFile(credPath, 'utf-8')) as Record<
      string,
      unknown
    >
    expect(parsed.refresh_token).toBeUndefined()
  })

  test('fail-closed lock retry limit throws without calling provider', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    let lockCalls = 0
    setWifCredentialsLockForTests({
      lock: async () => {
        lockCalls++
        throw elocked()
      },
      sleep: async () => {},
    })
    const inner = mock(async () => ({ token: 'fresh', expiresAt: null }))
    const wrapped = wrapWifCredentialsLock(inner, credPath, 'fail-closed')
    await expect(wrapped({ forceRefresh: true })).rejects.toThrow(
      /Could not acquire credentials lock at .* after 5 retries/,
    )
    expect(inner).not.toHaveBeenCalled()
    expect(lockCalls).toBe(WIF_LOCK_RETRIES['fail-closed'] + 1)
  })

  test('fail-open lock retry limit still throws (official d)', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    const credPath = join(tempDir, 'credentials.json')
    setWifCredentialsLockForTests({
      lock: async () => {
        throw elocked()
      },
      sleep: async () => {},
    })
    const inner = mock(async () => ({ token: 'fresh', expiresAt: null }))
    const wrapped = wrapWifCredentialsLock(inner, credPath, 'fail-open')
    await expect(wrapped({ forceRefresh: true })).rejects.toThrow(
      AnthropicProfileOauthError,
    )
    expect(inner).not.toHaveBeenCalled()
  })

  test('fail-open proceeds without lock on non-ELOCKED acquire errors', async () => {
    const missing = join(
      tmpdir(),
      `wif-missing-${process.pid}`,
      'no',
      'creds.json',
    )
    const inner = mock(async () => ({ token: 'fresh', expiresAt: null }))
    const wrapped = wrapWifCredentialsLock(inner, missing, 'fail-open')
    const result = await wrapped({ forceRefresh: true })
    expect(result.token).toBe('fresh')
    expect(inner).toHaveBeenCalled()
  })

  test('fail-closed does not proceed when the credentials dir is missing', async () => {
    const missing = join(
      tmpdir(),
      `wif-missing-${process.pid}`,
      'no',
      'creds.json',
    )
    const inner = mock(async () => ({ token: 'fresh', expiresAt: null }))
    const wrapped = wrapWifCredentialsLock(inner, missing, 'fail-closed')
    await expect(wrapped({ forceRefresh: true })).rejects.toThrow()
    expect(inner).not.toHaveBeenCalled()
  })

  test('acquired lock serializes the inner provider', async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'wif-race-'))
    await mkdir(tempDir, { recursive: true })
    const credPath = join(tempDir, 'credentials.json')
    let inFlight = 0
    let maxInFlight = 0
    const inner = async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise<void>(resolve => setTimeout(resolve, 30))
      inFlight--
      return { token: 'fresh', expiresAt: null }
    }
    const wrapped = wrapWifCredentialsLock(inner, credPath, 'fail-closed')
    const [a, b] = await Promise.all([
      wrapped({ forceRefresh: true }),
      wrapped({ forceRefresh: true }),
    ])
    expect(a.token).toBe('fresh')
    expect(b.token).toBe('fresh')
    expect(maxInFlight).toBe(1)
  })
})
